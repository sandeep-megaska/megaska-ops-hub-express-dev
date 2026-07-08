import { existsSync, mkdirSync, rmSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const distDir = join(process.cwd(), "dist");
const indexWasmPath = join(distDir, "index.wasm");
const legacyWasmPath = join(distDir, "function.wasm");

mkdirSync(distDir, { recursive: true });

if (existsSync(indexWasmPath)) rmSync(indexWasmPath);

// Shopify's JavaScript Function/Javy pipeline must produce the actual WASM.
// This script intentionally does not call nested `shopify app deploy` or
// `shopify app function build`, which can recurse when invoked by deploy.
// In environments that still emit the legacy artifact name, preserve the same
// real WASM bytes under the current CLI contract: dist/index.wasm.
if (existsSync(legacyWasmPath)) {
  copyFileSync(legacyWasmPath, indexWasmPath);
}

if (!existsSync(indexWasmPath)) {
  throw new Error([
    "Shopify JavaScript Function/Javy build did not produce dist/index.wasm.",
    "Install/use the Shopify JavaScript Function toolchain so `npm run build` emits a real WASM artifact at dist/index.wasm.",
    "This build script will not call nested `shopify app deploy` or `shopify app function build`, and it will not generate a placeholder WASM.",
  ].join(" "));
}

const size = statSync(indexWasmPath).size;
if (size <= 8) {
  rmSync(indexWasmPath);
  throw new Error("Refusing synthetic/minimal index.wasm. Shopify's JavaScript Function/Javy pipeline must produce a real Shopify Function-compatible WASM artifact.");
}

console.log(`LoopDesk Discount Function WASM artifact generated: dist/index.wasm (${size} bytes)`);
