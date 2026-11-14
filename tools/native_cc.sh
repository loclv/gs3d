#!/usr/bin/env bash
# Goose sidecars do not expose compiler flags. Add the portable pkg-config
# flags for the native image decoder while preserving Goose's compiler args.
set -euo pipefail

read -r -a real_compiler <<< "${G3_NATIVE_CC:-${CC:-clang}}"
read -r -a image_cflags <<< "$(pkg-config --cflags libpng libjpeg)"
read -r -a image_libs <<< "$(pkg-config --libs libpng libjpeg)"
for arg in "$@"; do
    if [[ "$arg" == "-c" || "$arg" == "-E" || "$arg" == "-S" ]]; then
        exec "${real_compiler[@]}" "${image_cflags[@]}" "$@"
    fi
done
exec "${real_compiler[@]}" "${image_cflags[@]}" "$@" "${image_libs[@]}"
