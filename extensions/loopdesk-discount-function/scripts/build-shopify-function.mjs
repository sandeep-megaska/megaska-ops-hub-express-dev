import { existsSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const distDir = join(process.cwd(), "dist");
const wasmPath = join(distDir, "function.wasm");

if (existsSync(wasmPath)) rmSync(wasmPath);

const shopifyCheck = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? ["shopify"] : ["-v", "shopify"], {
  stdio: "ignore",
  shell: process.platform !== "win32",
});

if (shopifyCheck.status !== 0) {
  throw new Error("Shopify CLI is unavailable. Install Shopify CLI and its JavaScript Functions/Javy toolchain, then rerun npm run build:discount-function; no fallback function.wasm will be generated.");
}

const result = spawnSync("shopify", ["app", "function", "build"], {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  throw new Error(`Unable to run Shopify CLI build: ${result.error.message}. Install Shopify CLI/function tooling and retry; no fallback function.wasm will be generated.`);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(wasmPath)) {
  throw new Error("Shopify CLI build completed without producing dist/function.wasm.");
}

const size = statSync(wasmPath).size;
if (size <= 8) {
  rmSync(wasmPath);
  throw new Error("Refusing synthetic/minimal function.wasm. Shopify CLI must produce a real Shopify Function-compatible WASM artifact.");
}

console.log(`LoopDesk Discount Function WASM artifact generated: dist/function.wasm (${size} bytes)`);
