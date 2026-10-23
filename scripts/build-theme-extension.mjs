// Builds the storefront theme app extension's JS/CSS.
//
// Readable sources live in extensions/megaska-otp-src/. Shopify serves theme extension
// assets exactly as deployed, so this writes minified copies to
// extensions/megaska-otp/assets/, which is what `shopify app deploy` uploads. Edit the
// sources, run `npm run build:extension`, and commit both.
//
//   node scripts/build-theme-extension.mjs           build
//   node scripts/build-theme-extension.mjs --check   fail if assets/ is out of date
import { transform } from "esbuild";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(root, "extensions/megaska-otp-src");
const ASSET_DIR = path.join(root, "extensions/megaska-otp/assets");
const BUILT = /\.(js|css)$/;

function banner(file) {
  return `/* Built from extensions/megaska-otp-src/${file} by npm run build:extension. Do not edit. */\n`;
}

export async function buildAsset(file, source) {
  const result = await transform(source, {
    loader: file.endsWith(".css") ? "css" : "js",
    minify: true,
    // Matches what the sources already use (optional chaining etc.); nothing is down-levelled.
    target: "es2020",
    legalComments: "none",
  });
  return banner(file) + result.code;
}

async function main() {
  const check = process.argv.includes("--check");
  const sources = (await readdir(SOURCE_DIR)).filter((file) => BUILT.test(file)).sort();
  const problems = [];
  let before = 0;
  let after = 0;

  for (const file of sources) {
    const source = await readFile(path.join(SOURCE_DIR, file), "utf8");
    const built = await buildAsset(file, source);
    before += Buffer.byteLength(source);
    after += Buffer.byteLength(built);
    const target = path.join(ASSET_DIR, file);
    if (check) {
      const current = await readFile(target, "utf8").catch(() => null);
      if (current !== built) problems.push(`${file} is out of date`);
    } else {
      await writeFile(target, built);
    }
  }

  // A built asset whose source was deleted would still be deployed.
  for (const file of (await readdir(ASSET_DIR)).filter((name) => BUILT.test(name))) {
    if (!sources.includes(file)) problems.push(`${file} has no source in extensions/megaska-otp-src`);
  }

  if (problems.length) {
    console.error(`Theme extension assets need a rebuild (npm run build:extension):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`${check ? "Checked" : "Built"} ${sources.length} assets: ${before} → ${after} bytes`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
