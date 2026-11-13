// Native image loading helpers. The initial disk format is binary PPM (P6);
// browser applications should use the image decoders in web/assets.js.
import os;
import g3.texture;
namespace g3;

let NATIVE_TEXTURE_ERROR_NONE = 0;
let NATIVE_TEXTURE_ERROR_IO = 1;
let NATIVE_TEXTURE_ERROR_UNSUPPORTED_FORMAT = 2;
let NATIVE_TEXTURE_ERROR_INVALID_IMAGE = 3;
let NATIVE_TEXTURE_ERROR_UPLOAD = 4;
var g_native_texture_error: i32;

// Returns the result code from the most recent native image load. Each call
// resets the value first; zero means success. This is process-global state.
fn native_texture_last_error() -> i32 { return g_native_texture_error; }

fn native_ppm_whitespace(c: u8) -> bool {
    return c == 9 || c == 10 || c == 11 || c == 12 || c == 13 || c == 32;
}

fn native_ppm_skip(bytes: const u8[:], cursor: i64&) -> bool {
    while cursor < bytes.len {
        if native_ppm_whitespace(bytes[cursor]) { cursor += 1; }
        else if bytes[cursor] == 35 {
            while cursor < bytes.len && bytes[cursor] != 10 && bytes[cursor] != 13 { cursor += 1; }
        } else { return true; }
    }
    return false;
}

fn native_ppm_number(bytes: const u8[:], cursor: i64&) -> i64, bool {
    guard native_ppm_skip(bytes, cursor) else { return 0, false; }
    var value: i64 = 0;
    var digits: i64 = 0;
    while cursor < bytes.len && bytes[cursor] >= 48 && bytes[cursor] <= 57 {
        guard value <= 100000000 else { return 0, false; }
        value = value * 10 + bytes[cursor] - 48;
        cursor += 1;
        digits += 1;
    }
    guard digits > 0 else { return 0, false; }
    return value, true;
}

// Load a binary PPM image into an sRGB texture. PPM scanlines are top-down;
// the renderer stores v=0 in the first row, so rows are flipped during decode.
fn native_texture_load_ppm(path: const u8[:]) -> TextureHandle {
    g_native_texture_error = NATIVE_TEXTURE_ERROR_NONE;
    var bytes: u8[>..] = [];
    if path.len == 0 || !read_file(path, bytes) {
        g_native_texture_error = NATIVE_TEXTURE_ERROR_IO;
        return TextureHandle { .. };
    }
    if bytes.len < 2 {
        g_native_texture_error = NATIVE_TEXTURE_ERROR_INVALID_IMAGE;
        return TextureHandle { .. };
    }
    if bytes[0] != 80 || bytes[1] != 54 {
        g_native_texture_error = NATIVE_TEXTURE_ERROR_UNSUPPORTED_FORMAT;
        return TextureHandle { .. };
    }
    if bytes.len < 3 {
        g_native_texture_error = NATIVE_TEXTURE_ERROR_INVALID_IMAGE;
        return TextureHandle { .. };
    }
    var cursor: i64 = 2;
    let width, width_ok = native_ppm_number(bytes[..], cursor);
    let height, height_ok = native_ppm_number(bytes[..], cursor);
    let maximum, maximum_ok = native_ppm_number(bytes[..], cursor);
    if !width_ok || !height_ok || !maximum_ok || width <= 0 || height <= 0 || maximum != 255 ||
       width > 4096 || height > 4096 || width * height > 4194304 || cursor >= bytes.len ||
       !native_ppm_whitespace(bytes[cursor]) {
        g_native_texture_error = NATIVE_TEXTURE_ERROR_INVALID_IMAGE;
        return TextureHandle { .. };
    }
    let separator = bytes[cursor];
    cursor += 1;
    if separator == 13 && cursor < bytes.len && bytes[cursor] == 10 { cursor += 1; }
    if bytes.len - cursor != width * height * 3 {
        g_native_texture_error = NATIVE_TEXTURE_ERROR_INVALID_IMAGE;
        return TextureHandle { .. };
    }
    var pixels: u8[>..] = [];
    for output_y in 0..height {
        let source_y = height - 1 - output_y;
        for x in 0..width {
            let at = cursor + (source_y * width + x) * 3;
            pixels.push(bytes[at]);
            pixels.push(bytes[at + 1]);
            pixels.push(bytes[at + 2]);
            pixels.push(255);
        }
    }
    let id = texture_create_srgb(width as i32, height as i32, pixels[..]);
    if id < 0 {
        g_native_texture_error = NATIVE_TEXTURE_ERROR_UPLOAD;
        return TextureHandle { .. };
    }
    return texture_handle(id);
}
