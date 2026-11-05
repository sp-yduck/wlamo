#!/usr/bin/env bash
# Rebuild vendor/wllama from ngxson/wllama master (needs git, node, python3; installs emsdk + cmake locally).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$(mktemp -d)}"
EMSDK_VERSION=4.0.20
DAWN_TAG=v20260317.182325
cd "$WORK"
[ -d wllama ] || git clone --depth 1 --recurse-submodules --shallow-submodules https://github.com/ngxson/wllama.git
[ -d emsdk ] || git clone --depth 1 https://github.com/emscripten-core/emsdk.git
(cd emsdk && ./emsdk install $EMSDK_VERSION && ./emsdk activate $EMSDK_VERSION)
source emsdk/emsdk_env.sh
python3 -m venv venv && venv/bin/pip -q install cmake && export PATH="$WORK/venv/bin:$PATH"
cd wllama
mkdir -p build/emdawn && curl -sL -o build/emdawn.zip "https://github.com/google/dawn/releases/download/$DAWN_TAG/emdawnwebgpu_pkg-$DAWN_TAG.zip"
python3 -c "import zipfile; zipfile.ZipFile('build/emdawn.zip').extractall('build/emdawn')"
DAWN="$PWD/build/emdawn/emdawnwebgpu_pkg"
(cd build && emcmake cmake .. -DGGML_WEBGPU=ON -DGGML_WEBGPU_JSPI=ON -DEMDAWNWEBGPU_DIR="$DAWN" && emmake make wllama -j"$(nproc)")
mkdir -p build-compat && (cd build-compat && emcmake cmake .. -DWLLAMA_COMPAT=ON -DLLAMA_WASM_MEM64=OFF -DGGML_WEBGPU=ON -DGGML_WEBGPU_JSPI=OFF -DEMDAWNWEBGPU_DIR="$DAWN" && emmake make wllama -j"$(nproc)")
mkdir -p src/wasm compat/wasm && cp build/wllama.{js,wasm} src/wasm/ && cp build-compat/wllama.{js,wasm} compat/wasm/
npm ci && npm run clean && npm run build:worker && npm run build:tsup && npm run build:typedef && ./scripts/post_build.sh
V="$ROOT/vendor/wllama"
rm -rf "$V/esm" "$V/compat" && cp -r esm "$V/" && mkdir -p "$V/compat" && cp compat/wasm/* "$V/compat/"
echo "vendor/wllama updated from wllama $(git rev-parse --short HEAD), llama.cpp $(git -C llama.cpp rev-parse --short HEAD)"
