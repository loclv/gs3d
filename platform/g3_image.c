/* Native PNG/JPEG image decoding for the CPU backend. Decoded sRGB pixels are
   uploaded through the same texture path used by ordinary RGBA textures. */
#include "g3_abi.h"
#include <stdio.h>
#include <jpeglib.h>
#include <png.h>
#include <setjmp.h>
#include <stdlib.h>
#include <string.h>

enum {
    G3_IMAGE_OK = 0,
    G3_IMAGE_UNSUPPORTED = 1,
    G3_IMAGE_INVALID = 2,
    G3_IMAGE_DECODE_FAILED = 3
};

#define G3_IMAGE_MAX_DIMENSION 4096
#define G3_IMAGE_MAX_PIXELS 4194304

static int dimensions_ok(uint32_t width, uint32_t height) {
    return width > 0 && height > 0 && width <= G3_IMAGE_MAX_DIMENSION &&
           height <= G3_IMAGE_MAX_DIMENSION &&
           (uint64_t)width * height <= G3_IMAGE_MAX_PIXELS;
}

static void upload_rgba(int32_t id, uint8_t *rgba, int32_t width, int32_t height) {
    g3_u8_slice pixels = { .data = rgba, .len = (int64_t)width * height * 4 };
    g3p_upload_texture_srgb(id, pixels, width, height);
}

static int decode_png(int32_t id, g3_u8_slice encoded) {
    png_image image;
    memset(&image, 0, sizeof(image));
    image.version = PNG_IMAGE_VERSION;
    if (!png_image_begin_read_from_memory(&image, encoded.data, (size_t)encoded.len))
        return G3_IMAGE_INVALID;
    if (!dimensions_ok(image.width, image.height)) {
        png_image_free(&image);
        return G3_IMAGE_INVALID;
    }
    image.format = PNG_FORMAT_RGBA;
    png_bytep rgba = malloc(PNG_IMAGE_SIZE(image));
    if (!rgba) {
        png_image_free(&image);
        return G3_IMAGE_DECODE_FAILED;
    }
    if (!png_image_finish_read(&image, NULL, rgba, 0, NULL)) {
        free(rgba);
        png_image_free(&image);
        return G3_IMAGE_INVALID;
    }
    upload_rgba(id, rgba, (int32_t)image.width, (int32_t)image.height);
    free(rgba);
    png_image_free(&image);
    return G3_IMAGE_OK;
}

typedef struct {
    struct jpeg_error_mgr base;
    jmp_buf jump;
} g3_jpeg_error;

static void jpeg_fail(j_common_ptr decoder) {
    g3_jpeg_error *error = (g3_jpeg_error *)decoder->err;
    longjmp(error->jump, 1);
}

static int decode_jpeg(int32_t id, g3_u8_slice encoded) {
    struct jpeg_decompress_struct decoder;
    g3_jpeg_error error;
    memset(&decoder, 0, sizeof(decoder));
    decoder.err = jpeg_std_error(&error.base);
    error.base.error_exit = jpeg_fail;
    uint8_t * volatile rgba = NULL;
    uint8_t * volatile row = NULL;
    volatile int created = 0;
    if (setjmp(error.jump)) {
        free((void *)rgba);
        free((void *)row);
        if (created) jpeg_destroy_decompress(&decoder);
        return G3_IMAGE_INVALID;
    }
    jpeg_create_decompress(&decoder);
    created = 1;
    jpeg_mem_src(&decoder, encoded.data, (unsigned long)encoded.len);
    if (jpeg_read_header(&decoder, TRUE) != JPEG_HEADER_OK) {
        jpeg_destroy_decompress(&decoder);
        return G3_IMAGE_INVALID;
    }
    decoder.out_color_space = JCS_RGB;
    jpeg_start_decompress(&decoder);
    if (!dimensions_ok(decoder.output_width, decoder.output_height) || decoder.output_components != 3) {
        jpeg_destroy_decompress(&decoder);
        return G3_IMAGE_INVALID;
    }
    size_t row_size = (size_t)decoder.output_width * 3;
    size_t pixel_size = (size_t)decoder.output_width * decoder.output_height * 4;
    rgba = malloc(pixel_size);
    row = malloc(row_size);
    if (!rgba || !row) {
        free((void *)rgba); free((void *)row);
        jpeg_destroy_decompress(&decoder);
        return G3_IMAGE_DECODE_FAILED;
    }
    while (decoder.output_scanline < decoder.output_height) {
        JSAMPROW rows[1] = { (JSAMPROW)row };
        JDIMENSION y = decoder.output_scanline;
        if (jpeg_read_scanlines(&decoder, rows, 1) != 1) {
            free((void *)rgba); free((void *)row);
            jpeg_destroy_decompress(&decoder);
            return G3_IMAGE_INVALID;
        }
        size_t dst = (size_t)y * decoder.output_width * 4;
        for (JDIMENSION x = 0; x < decoder.output_width; x++) {
            rgba[dst + x * 4 + 0] = row[x * 3 + 0];
            rgba[dst + x * 4 + 1] = row[x * 3 + 1];
            rgba[dst + x * 4 + 2] = row[x * 3 + 2];
            rgba[dst + x * 4 + 3] = 255;
        }
    }
    int32_t width = (int32_t)decoder.output_width;
    int32_t height = (int32_t)decoder.output_height;
    jpeg_finish_decompress(&decoder);
    jpeg_destroy_decompress(&decoder);
    upload_rgba(id, (uint8_t *)rgba, width, height);
    free((void *)rgba); free((void *)row);
    return G3_IMAGE_OK;
}

int32_t g3p_decode_texture_srgb(int32_t id, g3_u8_slice encoded) {
    if (id < 0 || !encoded.data || encoded.len < 2 || encoded.len > 268435456)
        return G3_IMAGE_INVALID;
    if (encoded.len >= 8 && png_sig_cmp(encoded.data, 0, 8) == 0)
        return decode_png(id, encoded);
    if (encoded.data[0] == 0xff && encoded.data[1] == 0xd8)
        return decode_jpeg(id, encoded);
    return G3_IMAGE_UNSUPPORTED;
}
