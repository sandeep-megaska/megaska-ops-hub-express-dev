# LoopDesk Discount Function build artifact

CONFIG-2F.5C intentionally does not synthesize a fake function.wasm.
Activation is guarded by the backend and refuses to create/update the Shopify automatic app discount unless dist/function.wasm exists.
Use Shopify Function-compatible tooling in a deployment environment to compile src/cart_lines_discounts_generate_run.js into dist/function.wasm.
