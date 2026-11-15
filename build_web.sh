#!/usr/bin/env bash
# Build the engine for the browser: Goose -> C -> WebAssembly (Emscripten).
#
#   ./build_web.sh           build web/app.js + web/app.wasm
#   ./build_web.sh --serve   build, then serve web/ on http://localhost:8080
#   ./build_web.sh --all --serve  rebuild every browser entry point, then serve
#   ./build_web.sh --game --serve  build and serve the Beacon Run sample
#   ./build_web.sh --viewer --serve build and serve the model viewer
#   ./build_web.sh --reference-checks --serve build and serve WebGL API checks
#   ./build_web.sh --animation-benchmark --serve build and serve the morph benchmark
#
# Emscripten is expected in .toolchain/emsdk (see README) or on PATH.

set -euo pipefail
cd "$(dirname "$0")"

if [ -n "${EMSDK:-}" ] && [ -f "$EMSDK/emsdk_env.sh" ]; then
  # shellcheck disable=SC1091
  source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
elif [ -f .toolchain/emsdk/emsdk_env.sh ]; then
  # shellcheck disable=SC1091
  source .toolchain/emsdk/emsdk_env.sh >/dev/null 2>&1
fi

command -v emcc >/dev/null || { echo "emcc not found: install the Emscripten SDK (see README)"; exit 1; }
command -v goose >/dev/null || { echo "goose not found: put the Goose compiler on PATH"; exit 1; }

# Each page has its own linked renderer. Refresh all of them when the backend
# changes; building one page cannot update another page's app.wasm.
if [ "${1:-}" = "--all" ]; then
  for mode in "" --game --siege --viewer --benchmark --animation-benchmark --reference-checks; do
    if [ -n "$mode" ]; then "$0" "$mode"; else "$0"; fi
  done
  python3 tools/check_web_builds.py
  if [ "${2:-}" = "--serve" ]; then
    echo "serving http://localhost:8080/ (ctrl-c to stop)"
    python3 -m http.server 8080 --directory web
  fi
  exit 0
fi

mkdir -p build/web

root=src/app_web.goose
output=web/app.js
backend_cflags=()
renderer_sources=(platform/g3_web.c platform/g3_input.c)
exports='["_g3_host_start","_g3_app_init","_g3_app_frame","_g3_app_shutdown","_g3_app_drawn","_g3_app_culled","_g3_app_triangles","_g3_app_meshes","_g3_app_nodes","_g3_input_key","_g3_input_mouse","_g3_input_resize","_malloc","_free"]'
if [ "${1:-}" = "--game" ]; then
  root=src/game_web.goose
  output=web/game/app.js
  exports='["_g3_host_start","_g3_app_init","_g3_app_frame","_g3_app_shutdown","_game_reset","_game_score","_game_state","_game_time","_game_floor_texture","_g3_input_key","_g3_input_mouse","_g3_input_resize","_malloc","_free"]'
elif [ "${1:-}" = "--siege" ]; then
  root=src/siege_web.goose
  output=web/siege/app.js
  exports='["_g3_host_start","_g3_app_init","_g3_app_frame","_g3_app_shutdown","_siege_reset","_siege_wave","_siege_health","_siege_score","_siege_state","_siege_alive","_siege_dash","_siege_drawn","_g3_input_key","_g3_input_mouse","_g3_input_resize","_malloc","_free"]'
elif [ "${1:-}" = "--viewer" ]; then
  root=src/viewer_web.goose
  output=web/viewer/app.js
  exports='["_g3_host_start","_g3_app_init","_g3_app_frame","_g3_app_shutdown","_g3_viewer_orbit","_g3_viewer_zoom","_g3_viewer_pan","_g3_input_resize","_malloc","_free"]'
elif [ "${1:-}" = "--benchmark" ]; then
  root=src/benchmark_web.goose
  output=web/benchmark/app.js
  backend_cflags=(-DG3_BENCHMARK_TIMING)
  exports='["_g3_host_start","_g3_app_init","_g3_app_frame","_g3_app_shutdown","_g3_benchmark_set_count","_g3_benchmark_set_motion","_g3_benchmark_set_rotation","_g3_benchmark_set_spread","_g3_host_scene_draw_calls","_g3_host_scene_draw_ms","_g3_input_resize","_malloc","_free"]'
elif [ "${1:-}" = "--animation-benchmark" ]; then
  root=src/viewer_web.goose
  output=web/benchmark/animation/app.js
  exports='["_g3_host_start","_g3_app_init","_g3_app_frame","_g3_app_shutdown","_g3_host_scene_draw_calls","_g3_input_resize","_malloc","_free"]'
elif [ "${1:-}" = "--reference-checks" ]; then
  root=src/reference_web.goose
  output=web/viewer/reference/app.js
  exports='["_g3_host_start","_g3_app_init","_g3_app_frame","_g3_app_shutdown","_g3_reference_target_create","_g3_reference_target_resize","_g3_reference_target_fill","_g3_reference_target_feedback","_g3_reference_set_screen_effects","_g3_reference_set_output","_g3_reference_clear_color","_g3_reference_post_process","_g3_reference_post_process_queue_clear","_g3_reference_post_process_queue_add","_g3_reference_post_process_queue_add_shader","_g3_reference_post_process_queue_execute","_g3_reference_shader_create","_g3_reference_shader_create_invalid","_g3_reference_shader_run","_g3_reference_shader_remove","_g3_reference_show_texture","_g3_reference_clear_scene","_g3_reference_target_remove","_g3_input_resize","_malloc","_free"]'
fi

# The default landing page prefers WebGPU and retains the full WebGL2 backend
# as an automatic fallback. Specialized tools still build their WebGL2 paths.
if [ "${1:-}" = "" ] || [ "${1:-}" = "--benchmark" ]; then
  backend_cflags+=(-DG3_DUAL_RENDERER)
  renderer_sources+=(platform/g3_webgpu.c)
fi

# The asset bridge is available to either browser entry point.
asset_exports='"_g3_asset_mesh_begin","_g3_asset_vertex","_g3_asset_triangle","_g3_asset_mesh_end","_g3_asset_mesh_update","_g3_asset_mesh_generation","_g3_asset_mesh_valid","_g3_asset_release_mesh","_g3_asset_node","_g3_asset_matrix","_g3_asset_material","_g3_asset_material_specular","_g3_asset_material_clearcoat","_g3_asset_material_sheen","_g3_asset_material_anisotropy","_g3_asset_material_environment","_g3_asset_material_uv_transform","_g3_asset_node_material","_g3_asset_material_generation","_g3_asset_material_valid","_g3_asset_release_material","_g3_asset_node_generation","_g3_asset_node_valid","_g3_asset_node_release","_g3_asset_scene_epoch","_g3_asset_texture","_g3_asset_texture_generation","_g3_asset_texture_valid","_g3_asset_release_texture","_g3_asset_camera_add","_g3_asset_camera_add_current","_g3_asset_camera_active","_g3_asset_camera_update","_g3_asset_camera_select","_g3_asset_camera_remove","_g3_asset_lights_begin","_g3_asset_lights_active","_g3_asset_lights_clear","_g3_asset_lights_release","_g3_asset_light_directional","_g3_asset_light_point","_g3_asset_light_spot","_g3_asset_light_point_shadow","_g3_asset_light_spot_shadow","_g3_asset_pick","_g3_asset_output_srgb","_g3_asset_tone_mapping","_g3_asset_fxaa","_g3_asset_exposure","_g3_asset_environment_map","_g3_asset_environment_lighting","_g3_asset_environment_rotation","_g3_host_mesh_update","_g3_host_mesh_update_cpu","_g3_host_mesh_morph","_g3_host_morph_weights","_g3_host_mesh_morph_release","_g3_host_mesh_skin","_g3_host_joint_palette","_g3_host_texture","_g3_host_texture_srgb","_g3_host_texture_hdr","_g3_host_texture_wrap","_g3_host_texture_filter"'
exports="${exports%]},${asset_exports}]"

# 1. Goose to C. --standalone means no C main is generated: the host below is
#    the entry point, and `goose_init` sets the runtime up.
echo "goose -> build/web/g3.c"
goose --standalone --header build/web/g3.h -o build/web/g3.c "$root"

# 2. C to WebAssembly. The default page links WebGPU plus WebGL2 fallback;
#    specialized pages keep their feature-complete WebGL2 backend.
#
#    GS_STACK_RESERVE caps what each of the engine's data stacks reserves. The
#    default is 2 GiB of address space per stack, which is free natively and is
#    not free in a wasm heap: the engine keeps several arenas, so 64 MiB each
#    is the difference between a 2 GiB heap and a few hundred MiB.
echo "c -> $output and wasm"
mkdir -p "$(dirname "$output")"
emcc build/web/g3.c "${renderer_sources[@]}" -o "$output" \
  -Ibuild/web -Iplatform \
  "${backend_cflags[@]}" \
  -O3 \
  -DGS_STACK_RESERVE='(64ull<<20)' \
  -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2gb \
  -sSTACK_SIZE=1048576 \
  -sEXIT_RUNTIME=0 \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createGoose3D \
  -sENVIRONMENT=web,node \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32 \
  -sEXPORTED_FUNCTIONS="$exports"

echo "built $output"

if [ "${1:-}" = "--serve" ] || [ "${2:-}" = "--serve" ]; then
  echo "serving http://localhost:8080/ (ctrl-c to stop)"
  # A module script needs a real http origin; file:// will not load it.
  python3 -m http.server 8080 --directory web
fi
