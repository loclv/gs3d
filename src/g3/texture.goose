// RGBA8 textures and linear RGBA32F HDR textures are row-major, first row at
// v=0. Uploads are copied by the backend.
import g3.platform;
namespace g3;

let WRAP_CLAMP = 0;
let WRAP_REPEAT = 1;
let WRAP_MIRROR = 2;
let FILTER_NEAREST = 9728;
let FILTER_LINEAR = 9729;
let FILTER_NEAREST_MIPMAP_NEAREST = 9984;
let FILTER_LINEAR_MIPMAP_NEAREST = 9985;
let FILTER_NEAREST_MIPMAP_LINEAR = 9986;
let FILTER_LINEAR_MIPMAP_LINEAR = 9987;

var g_texture_count: i32;
var g_render_target: i32 = -1;
var g_render_target_width: i32;
var g_render_target_height: i32;
var g_asset_textures: i32[>..];
struct TextureSlot { generation: i32 = 1, asset_owned: bool, asset_free: bool, removed: bool, render_target: bool }
struct TextureHandle { id: i32 = -1, generation: i32 }
struct RenderTargetHandle { texture: TextureHandle }
var g_texture_slots: TextureSlot[>..];

fn texture_handle(id: i32) -> TextureHandle {
    guard id >= 0 && id < g_texture_slots.len && !g_texture_slots[id].asset_free && !g_texture_slots[id].removed else { return TextureHandle { .. }; }
    return TextureHandle { id: id, generation: g_texture_slots[id].generation };
}

fn texture_handle_valid(handle: TextureHandle) -> bool {
    return handle.id >= 0 && handle.id < g_texture_slots.len && !g_texture_slots[handle.id].asset_free && !g_texture_slots[handle.id].removed &&
           g_texture_slots[handle.id].generation == handle.generation;
}

fn texture_slot_live(id: i32) -> bool {
    return id >= 0 && id < g_texture_count && !g_texture_slots[id].asset_free && !g_texture_slots[id].removed;
}

fn texture_create(width: i32, height: i32, pixels: const u8[:]) -> i32 {
    guard width > 0 && height > 0 && pixels.len == width as i64 * height * 4 else { return -1; }
    let id = g_texture_count;
    g_texture_count += 1;
    g_texture_slots.push(TextureSlot { .. });
    g3p_upload_texture(id, pixels, width, height);
    return id;
}

// sRGB RGB channels are decoded to linear before filtering; alpha stays linear.
fn texture_create_srgb(width: i32, height: i32, pixels: const u8[:]) -> i32 {
    guard width > 0 && height > 0 && pixels.len == width as i64 * height * 4 else { return -1; }
    let id = g_texture_count;
    g_texture_count += 1;
    g_texture_slots.push(TextureSlot { .. });
    g3p_upload_texture_srgb(id, pixels, width, height);
    return id;
}

// Decode encoded PNG/JPEG bytes with the native CPU backend. Browser hosts use
// their own image decoder and do not call this native-only entry point.
fn texture_create_encoded_srgb(encoded: const u8[:]) -> i32, i32 {
    guard encoded.len > 0 && encoded.len <= 268435456 else { return -1, 2; }
    let id = g_texture_count;
    g_texture_count += 1;
    g_texture_slots.push(TextureSlot { .. });
    let result = g3p_decode_texture_srgb(id, encoded);
    if result != 0 {
        g3p_release_texture(id);
        g_texture_slots[id].removed = true;
        return -1, result;
    }
    return id, 0;
}

// Decode PNG/JPEG bytes while preserving their channel values as linear data.
fn texture_create_encoded_linear(encoded: const u8[:]) -> i32, i32 {
    guard encoded.len > 0 && encoded.len <= 268435456 else { return -1, 2; }
    let id = g_texture_count;
    g_texture_count += 1;
    g_texture_slots.push(TextureSlot { .. });
    let result = g3p_decode_texture_linear(id, encoded);
    if result != 0 {
        g3p_release_texture(id);
        g_texture_slots[id].removed = true;
        return -1, result;
    }
    return id, 0;
}

// HDR linear RGBA32F texture, intended for equirectangular environment maps.
fn texture_create_hdr(width: i32, height: i32, pixels: const f32[:]) -> i32 {
    guard width > 0 && height > 0 && pixels.len == width as i64 * height * 4 else { return -1; }
    let id = g_texture_count;
    g_texture_count += 1;
    g_texture_slots.push(TextureSlot { .. });
    g3p_upload_texture_hdr(id, pixels, width, height);
    return id;
}

// Create a sampleable linear RGBA render target. The target keeps its own
// dimensions when the window is resized. Tone mapping and FXAA are screen-only.
fn render_target_create(width: i32, height: i32) -> i32 {
    guard width > 0 && height > 0 && width <= 4096 && height <= 4096 &&
          width as i64 * height <= 4194304 else { return -1; }
    let id = g_texture_count;
    g_texture_count += 1;
    g_texture_slots.push(TextureSlot { render_target: true, .. });
    guard g3p_create_render_target(id, width, height) else {
        g_texture_slots[id].removed = true;
        return -1;
    }
    return id;
}

fn render_target_handle(id: i32) -> RenderTargetHandle {
    guard id >= 0 && id < g_texture_count && g_texture_slots[id].render_target && texture_slot_live(id) else { return RenderTargetHandle { .. }; }
    return RenderTargetHandle { texture: texture_handle(id) };
}

fn render_target_handle_valid(handle: RenderTargetHandle) -> bool {
    return texture_handle_valid(handle.texture) && g_texture_slots[handle.texture.id].render_target;
}

fn render_target_texture_id(handle: RenderTargetHandle) -> i32 {
    guard render_target_handle_valid(handle) else { return -1; }
    return handle.texture.id;
}

fn render_target_set_handle(handle: RenderTargetHandle) -> bool {
    guard render_target_handle_valid(handle) else { return false; }
    return render_target_set(handle.texture.id);
}

// Select the target for the next frame. Pass -1 to render to the window.
fn render_target_set(id: i32) -> bool {
    if id == -1 {
        g_render_target = -1;
        g_render_target_width = 0;
        g_render_target_height = 0;
        return true;
    }
    guard id >= 0 && id < g_texture_count && g_texture_slots[id].render_target && texture_slot_live(id) else { return false; }
    g_render_target = id;
    g_render_target_width = g3p_texture_width(id);
    g_render_target_height = g3p_texture_height(id);
    return true;
}

fn render_target_resize(id: i32, width: i32, height: i32) -> bool {
    guard id >= 0 && id < g_texture_count && g_texture_slots[id].render_target && texture_slot_live(id) &&
          width > 0 && height > 0 && width <= 4096 && height <= 4096 &&
          width as i64 * height <= 4194304 else { return false; }
    guard g3p_resize_render_target(id, width, height) else { return false; }
    if id == g_render_target { g_render_target_width = width; g_render_target_height = height; }
    return true;
}

fn render_target_resize_handle(handle: RenderTargetHandle, width: i32, height: i32) -> bool {
    guard render_target_handle_valid(handle) else { return false; }
    return render_target_resize(handle.texture.id, width, height);
}

// Native-only Radiance RGBE loader. Browser applications should use loadHDRImage.
fn texture_load_hdr(path: const u8[:]) -> i32 {
    guard path.len > 0 else { return -1; }
    let id = g_texture_count;
    g_texture_count += 1;
    g_texture_slots.push(TextureSlot { .. });
    if !g3p_load_radiance_hdr(id, path) {
        g_texture_slots[id].removed = true;
        return -1;
    }
    return id;
}

// New uploads start clamp-to-edge. Set wrapping after each upload.
fn texture_set_wrap(id: i32, wrap_u: i32, wrap_v: i32) -> bool {
    guard texture_slot_live(id) && wrap_u >= 0 && wrap_u <= 2 && wrap_v >= 0 && wrap_v <= 2 else { return false; }
    g3p_texture_wrap(id, wrap_u, wrap_v);
    return true;
}

fn texture_set_filter(id: i32, min_filter: i32, mag_filter: i32) -> bool {
    let min_ok = min_filter == FILTER_NEAREST || min_filter == FILTER_LINEAR ||
                 (min_filter >= FILTER_NEAREST_MIPMAP_NEAREST && min_filter <= FILTER_LINEAR_MIPMAP_LINEAR);
    guard texture_slot_live(id) && min_ok && (mag_filter == FILTER_NEAREST || mag_filter == FILTER_LINEAR) else { return false; }
    g3p_texture_filter(id, min_filter, mag_filter);
    return true;
}

// Only asset-owned textures are recycled. The browser host releases the
// backend texture before returning its id here.
fn texture_asset_create() -> i32 {
    let pixel: u8[4] = [255, 255, 255, 255];
    for i in 0..g_asset_textures.len {
        if g_asset_textures[i] >= 0 && g_texture_slots[g_asset_textures[i]].generation < 2147483647 {
            let id = g_asset_textures[i];
            g_asset_textures[i] = -1;
            g_texture_slots[id].generation += 1;
            g_texture_slots[id].asset_free = false;
            g_texture_slots[id].removed = false;
            g3p_upload_texture(id, pixel[..], 1, 1);
            return id;
        }
    }
    let id = texture_create(1, 1, pixel[..]);
    if id >= 0 { g_texture_slots[id].asset_owned = true; }
    return id;
}

fn texture_asset_create_encoded_srgb(encoded: const u8[:]) -> i32, i32 {
    guard encoded.len > 0 && encoded.len <= 268435456 else { return -1, 2; }
    let id = texture_asset_create();
    guard id >= 0 else { return -1, 4; }
    let result = g3p_decode_texture_srgb(id, encoded);
    if result != 0 {
        texture_asset_release(id);
        return -1, result;
    }
    return id, 0;
}

fn texture_asset_create_encoded_linear(encoded: const u8[:]) -> i32, i32 {
    guard encoded.len > 0 && encoded.len <= 268435456 else { return -1, 2; }
    let id = texture_asset_create();
    guard id >= 0 else { return -1, 4; }
    let result = g3p_decode_texture_linear(id, encoded);
    if result != 0 {
        texture_asset_release(id);
        return -1, result;
    }
    return id, 0;
}

fn texture_asset_release(id: i32) {
    guard id >= 0 && id < g_texture_count && g_texture_slots[id].asset_owned && !g_texture_slots[id].asset_free else { return; }
    g_texture_slots[id].asset_free = true;
    g3p_release_texture(id);
    for i in 0..g_asset_textures.len {
        if g_asset_textures[i] < 0 { g_asset_textures[i] = id; return; }
    }
    g_asset_textures.push(id);
}

fn texture_remove_storage(handle: TextureHandle) -> bool {
    guard texture_handle_valid(handle) && !g_texture_slots[handle.id].asset_owned else { return false; }
    if handle.id == g_render_target { g_render_target = -1; g_render_target_width = 0; g_render_target_height = 0; }
    g3p_release_texture(handle.id);
    g_texture_slots[handle.id].removed = true;
    return true;
}

fn texture_asset_release_handle(handle: TextureHandle) -> bool {
    guard texture_handle_valid(handle) && g_texture_slots[handle.id].asset_owned else { return false; }
    texture_asset_release(handle.id);
    return true;
}
