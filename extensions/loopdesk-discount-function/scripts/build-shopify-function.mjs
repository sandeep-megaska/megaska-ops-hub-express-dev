import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const distDir = join(root, "dist");
const bundledJsPath = join(distDir, "function.js");
const wasmPath = join(distDir, "index.wasm");
const entryPath = join(distDir, "javy-entry.js");
const witPath = join(tmpdir(), `loopdesk-discount-function-${process.pid}.wit`);

const jsExport = "cartLinesDiscountsGenerateRun";
const wasmExport = "cart-lines-discounts-generate-run";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

async function main() {
  mkdirSync(distDir, { recursive: true });
  if (existsSync(wasmPath)) rmSync(wasmPath);

  const entry = `import __runFunction from "@shopify/shopify_function/run";\nimport { ${jsExport} as userFunction } from "../src/cart_lines_discounts_generate_run.js";\n\nexport function ${jsExport}() {\n  return __runFunction(userFunction);\n}\n`;
  writeFileSync(entryPath, entry);

  const esbuildBin = resolve("node_modules/.bin/esbuild");
  if (!existsSync(esbuildBin)) {
    throw new Error("Missing esbuild binary. Run npm install in extensions/loopdesk-discount-function so the esbuild devDependency is installed.");
  }

  run(esbuildBin, [entryPath, "--bundle", "--format=esm", "--target=es2022", "--legal-comments=none", `--outfile=${bundledJsPath}`]);

  const wit = `package function:impl;\n\nworld shopify-function {\n  export %${wasmExport}: func();\n}\n`;
  writeFileSync(witPath, wit);

  const javyBin = resolve("node_modules/.bin/javy");
  if (!existsSync(javyBin)) {
    throw new Error("Missing Javy compiler binary. Run npm install in extensions/loopdesk-discount-function so the javy dependency is installed.");
  }

  const pluginCandidates = [
    "node_modules/@shopify/shopify_function/bin/javy_quickjs_provider_v3.wasm",
    "node_modules/@shopify/shopify_function/javy_quickjs_provider_v3.wasm",
    "node_modules/javy/dist/javy_quickjs_provider_v3.wasm",
    "node_modules/javy/bin/javy_quickjs_provider_v3.wasm",
  ].map((path) => join(root, path));
  const pluginPath = pluginCandidates.find((path) => existsSync(path));
  if (!pluginPath) {
    throw new Error("Missing Shopify Functions Javy provider plugin. Ensure @shopify/shopify_function v2.x and javy are installed.");
  }

  run(javyBin, ["build", "-C", "dynamic", "-C", `plugin=${pluginPath}`, "-C", `wit=${witPath}`, "-C", "wit-world=shopify-function", "-o", wasmPath, bundledJsPath]);

  const size = statSync(wasmPath).size;
  if (size <= 8) {
    rmSync(wasmPath);
    throw new Error("Refusing synthetic/minimal index.wasm. The Shopify JavaScript Function/Javy pipeline must produce a real WASM artifact.");
  }

  console.log(`LoopDesk Discount Function WASM artifact generated: dist/index.wasm (${size} bytes)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
