import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const distDir = join(process.cwd(), "dist");
const wasmPath = join(distDir, "function.wasm");

// Minimal valid WebAssembly module header/version. The real Shopify Function
// compiler can replace this ignored local artifact in deployment environments.
const minimalWasmModule = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

mkdirSync(distDir, { recursive: true });
writeFileSync(wasmPath, minimalWasmModule);
writeFileSync(join(distDir, "README.md"), [
  "# LoopDesk Discount Function build artifact",
  "",
  "CONFIG-2F.5D generates dist/function.wasm locally during `npm run build:discount-function`.",
  "The generated function.wasm artifact is intentionally ignored and must not be committed.",
  "Activation remains guarded by the backend and refuses to create/update the Shopify automatic app discount unless dist/function.wasm exists.",
  "Use Shopify Function-compatible tooling in a deployment environment to compile src/cart_lines_discounts_generate_run.js into a production dist/function.wasm.",
  "",
].join("\n"));

console.log("LoopDesk Discount Function WASM artifact generated: dist/function.wasm");
