#!/usr/bin/env bash
# Build the engine with the CPU backend: a headless renderer that writes PPMs,
# and the two self-tests (math, then whole frames read back pixel by pixel).
#
#   ./build_native.sh          build everything
#   ./build_native.sh --test   build everything, then run both self-tests
#
# Needs Goose, a C compiler, pkg-config, libpng, and libjpeg.

set -euo pipefail
cd "$(dirname "$0")"

command -v goose >/dev/null || { echo "goose not found: put the Goose compiler on PATH"; exit 1; }
command -v pkg-config >/dev/null || { echo "pkg-config not found: needed to locate libpng and libjpeg"; exit 1; }
pkg-config --exists libpng libjpeg || { echo "libpng/libjpeg development packages not found (pkg-config libpng libjpeg)"; exit 1; }

native_cc="$PWD/tools/native_cc.sh"

mkdir -p build

echo "goose -> build/app_native"
goose build --cc "$native_cc" -o build/app_native src/app_native.goose

echo "goose -> build/test_math"
goose build --cc "$native_cc" -o build/test_math src/test_math.goose

echo "goose -> build/test_engine"
goose build --cc "$native_cc" -o build/test_engine src/test_engine.goose

echo "goose -> build/test_game"
goose build --cc "$native_cc" -o build/test_game src/test_game.goose

goose build --cc "$native_cc" -o build/test_siege src/test_siege.goose

echo "goose -> build/test_sound"
goose build --cc "$native_cc" -o build/test_sound src/test_sound.goose

echo "built build/app_native, build/test_math, build/test_engine build/test_game, build/test_siege and build/test_sound"

if [ "${1:-}" = "--test" ]; then
  echo
  ./build/test_math
  echo
  ./build/test_engine
  ./build/test_game
  ./build/test_siege
  ./build/test_sound

  echo
  echo "== zero-warning check (ideal 11) =="
  for f in src/*.goose; do
    log="build/check_$(basename "$f").log"
    goose check "$f" >"$log" 2>&1
    if grep -qi "warning" "$log"; then
      echo "FAIL: warnings in $f"; cat "$log"; exit 1
    fi
    rm -f "$log"
  done
  echo "ok: 0 warnings on all roots"

  echo
  echo "== determinism check (ideal 7): byte-identical PPM across worker counts =="
  for n in 1 3 5 8; do
    G3_THREADS=$n ./build/app_native --frames 2 --width 320 --height 240 \
      --out "build/det_${n}.ppm" >/dev/null 2>&1
  done
  cmp build/det_1.ppm build/det_3.ppm
  cmp build/det_1.ppm build/det_5.ppm
  cmp build/det_1.ppm build/det_8.ppm
  rm -f build/det_*.ppm
  echo "ok: PPM byte-identical at 1, 3, 5 and 8 workers"
fi
