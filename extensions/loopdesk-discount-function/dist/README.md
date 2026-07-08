# LoopDesk Discount Function build artifact

CONFIG-2F.5D generates dist/function.wasm locally during `npm run build:discount-function`.
The generated function.wasm artifact is intentionally ignored and must not be committed.
Activation remains guarded by the backend and refuses to create/update the Shopify automatic app discount unless dist/function.wasm exists.
Use Shopify Function-compatible tooling in a deployment environment to compile src/cart_lines_discounts_generate_run.js into a production dist/function.wasm.
