// RGBA8, row-major, first row at v=0. Uploads are copied by the backend.
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
var g_asset_textures: i32[>..];
struct TextureSlot { generation: i32 = 1, asset_owned: bool, asset_free: bool }
struct TextureHandle { id: i32 = -1, generation: i32 }
var g_texture_slots: TextureSlot[>..];

fn texture_handle(id: i32) -> TextureHandle {
    guard id >= 0 && id < g_texture_slots.len && !g_texture_slots[id].asset_free else { return TextureHandle { .. }; }
    return TextureHandle { id: id, generation: g_texture_slots[id].generation };
}

fn texture_handle_valid(handle: TextureHandle) -> bool {
    return handle.id >= 0 && handle.id < g_texture_slots.len && !g_texture_slots[handle.id].asset_free &&
           g_texture_slots[handle.id].generation == handle.generation;
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

// New uploads start clamp-to-edge. Set wrapping after each upload.
fn texture_set_wrap(id: i32, wrap_u: i32, wrap_v: i32) -> bool {
    guard id >= 0 && id < g_texture_count && wrap_u >= 0 && wrap_u <= 2 && wrap_v >= 0 && wrap_v <= 2 else { return false; }
    g3p_texture_wrap(id, wrap_u, wrap_v);
    return true;
}

fn texture_set_filter(id: i32, min_filter: i32, mag_filter: i32) -> bool {
    let min_ok = min_filter == FILTER_NEAREST || min_filter == FILTER_LINEAR ||
                 (min_filter >= FILTER_NEAREST_MIPMAP_NEAREST && min_filter <= FILTER_LINEAR_MIPMAP_LINEAR);
    guard id >= 0 && id < g_texture_count && min_ok && (mag_filter == FILTER_NEAREST || mag_filter == FILTER_LINEAR) else { return false; }
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
            g3p_upload_texture(id, pixel[..], 1, 1);
            return id;
        }
    }
    let id = texture_create(1, 1, pixel[..]);
    if id >= 0 { g_texture_slots[id].asset_owned = true; }
    return id;
}

fn texture_asset_release(id: i32) {
    guard id >= 0 && id < g_texture_count && g_texture_slots[id].asset_owned && !g_texture_slots[id].asset_free else { return; }
    g_texture_slots[id].asset_free = true;
    for i in 0..g_asset_textures.len {
        if g_asset_textures[i] < 0 { g_asset_textures[i] = id; return; }
    }
    g_asset_textures.push(id);
}

fn texture_asset_release_handle(handle: TextureHandle) -> bool {
    guard texture_handle_valid(handle) && g_texture_slots[handle.id].asset_owned else { return false; }
    texture_asset_release(handle.id);
    return true;
}
