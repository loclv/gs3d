// RGBA8, row-major, first row at v=0. Uploads are copied by the backend.
import g3.platform;
namespace g3;

var g_texture_count: i32;

fn texture_create(width: i32, height: i32, pixels: const u8[:]) -> i32 {
    guard width > 0 && height > 0 && pixels.len == width as i64 * height * 4 else { return -1; }
    let id = g_texture_count;
    g_texture_count += 1;
    g3p_upload_texture(id, pixels, width, height);
    return id;
}
