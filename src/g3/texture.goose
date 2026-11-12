// RGBA8, row-major, first row at v=0. Uploads are copied by the backend.
import g3.platform;
namespace g3;

var g_texture_count: i32;
var g_asset_textures: i32[>..];

fn texture_create(width: i32, height: i32, pixels: const u8[:]) -> i32 {
    guard width > 0 && height > 0 && pixels.len == width as i64 * height * 4 else { return -1; }
    let id = g_texture_count;
    g_texture_count += 1;
    g3p_upload_texture(id, pixels, width, height);
    return id;
}

// Only asset-owned textures are recycled. The browser host releases the
// backend texture before returning its id here.
fn texture_asset_create() -> i32 {
    let pixel: u8[4] = [255, 255, 255, 255];
    for i in 0..g_asset_textures.len {
        if g_asset_textures[i] >= 0 {
            let id = g_asset_textures[i];
            g_asset_textures[i] = -1;
            g3p_upload_texture(id, pixel[..], 1, 1);
            return id;
        }
    }
    return texture_create(1, 1, pixel[..]);
}

fn texture_asset_release(id: i32) {
    guard id >= 0 && id < g_texture_count else { return; }
    for free in g_asset_textures { if free == id { return; } }
    for i in 0..g_asset_textures.len {
        if g_asset_textures[i] < 0 { g_asset_textures[i] = id; return; }
    }
    g_asset_textures.push(id);
}
