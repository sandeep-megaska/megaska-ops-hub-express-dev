# LoopDesk Discount Function build artifact directory

`npm run build:discount-function` delegates to Shopify Function tooling and must produce a real `dist/function.wasm` artifact.

The generated `function.wasm` artifact is intentionally ignored and must not be committed. The build does not create a placeholder or fallback WASM; if Shopify CLI, Javy, wasm32-wasip1, or other required function tooling is unavailable, the build fails clearly instead.
