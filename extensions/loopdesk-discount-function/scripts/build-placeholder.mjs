import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const distDir = join(process.cwd(), "dist");
const wasmPath = join(distDir, "function.wasm");
mkdirSync(distDir, { recursive: true });

if (!existsSync(wasmPath)) {
  writeFileSync(join(distDir, "README.md"), [
    "# LoopDesk Discount Function build artifact",
    "",
    "CONFIG-2F.5C intentionally does not synthesize a fake function.wasm.",
    "Activation is guarded by the backend and refuses to create/update the Shopify automatic app discount unless dist/function.wasm exists.",
    "Use Shopify Function-compatible tooling in a deployment environment to compile src/cart_lines_discounts_generate_run.js into dist/function.wasm.",
    "",
  ].join("\n"));
  console.warn("LoopDesk Discount Function WASM artifact is missing: dist/function.wasm. Activation is safely blocked until a real artifact is present.");
} else {
  console.log("LoopDesk Discount Function WASM artifact present: dist/function.wasm");
}
