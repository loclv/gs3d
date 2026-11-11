#!/usr/bin/env bash
# Build the engine with the CPU backend: a headless renderer that writes PPMs,
# and the two self-tests (math, then whole frames read back pixel by pixel).
#
#   ./build_native.sh          build everything
#   ./build_native.sh --test   build everything, then run both self-tests
#
# Needs only the Goose compiler and a C compiler.

set -euo pipefail
cd "$(dirname "$0")"

command -v goose >/dev/null || { echo "goose not found: put the Goose compiler on PATH"; exit 1; }

mkdir -p build

echo "goose -> build/app_native"
goose build -o build/app_native src/app_native.goose

echo "goose -> build/test_math"
goose build -o build/test_math src/test_math.goose

echo "goose -> build/test_engine"
goose build -o build/test_engine src/test_engine.goose

echo "built build/app_native, build/test_math and build/test_engine"

if [ "${1:-}" = "--test" ]; then
  echo
  ./build/test_math
  echo
  ./build/test_engine
fi
