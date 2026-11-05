# Vendored wllama build

Built from ngxson/wllama master (d275dac) with llama.cpp 5aeac37.

Why: the npm release @wllama/wllama@3.8.1 bundles a llama.cpp that predates
ggml-org/llama.cpp#30045, so loading PLaMo 3 fails with
`unknown tokenizer: 'plamo3'`. Rebuild with `scripts/build-wllama.sh`.
