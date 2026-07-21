#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const runtimeRoots = ["app", "services", "lib", "extensions", "scripts", "prisma", "sections", "templates"];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".mts", ".liquid", ".json", ".graphql"]);
const excludedSegments = ["/node_modules/", "/generated/", "/migrations/", "/tests/", "/fixtures/"];
const excludedFiles = new Set([
  // Controlled, tenant-gated migration adapter; remove with MEGA15 migration.
  "services/express-checkout/legacy-coupon-adapter.ts",
  // Generated Shopify schemas contain only Shopify's documentation example domain.
  "extensions/loopdesk-discount-function/schema.graphql",
  "extensions/megaska-phone-checkout-validation/schema.graphql",
]);

const rules = [
  ["hard-coded Shopify shop domain", /(?<!example\.)\b[a-z0-9][a-z0-9-]*\.myshopify\.com\b/i],
  ["legacy Megaska web domain", /\b(?:www\.)?megaska\.com\b/i],
  ["development Vercel URL", /https?:\/\/[a-z0-9.-]*(?:megaska|express-dev)[a-z0-9.-]*\.vercel\.app/i],
  ["legacy global Shopify access token", /process\.env(?:\.(?:SHOPIFY_ADMIN_ACCESS_TOKEN|SHOPIFY_STORE_ACCESS_TOKEN|SHOPIFY_STORES_ACCESS_TOKEN|SHOPIFY_ADMIN_TOKEN|SHOPIFY_STOREFRONT_TOKEN|SHOPIFY_STOREFRONT_ACCESS_TOKEN)|\[["'](?:SHOPIFY_ADMIN_ACCESS_TOKEN|SHOPIFY_STORE_ACCESS_TOKEN|SHOPIFY_STORES_ACCESS_TOKEN|SHOPIFY_ADMIN_TOKEN|SHOPIFY_STOREFRONT_TOKEN|SHOPIFY_STOREFRONT_ACCESS_TOKEN)["']\])/],
  ["global merchant Razorpay credential", /process\.env\.(?:RAZORPAY_KEY_ID|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET)\b/],
  ["global merchant Delhivery credential", /process\.env\.(?:DELHIVERY_API_TOKEN|DELHIVERY_API_PIN|DELHIVERY_ORIGIN_PIN(?:CODE)?|DELHIVERY_PICKUP_LOCATION)\b/],
  ["hard-coded Razorpay key", /\brzp_(?:live|test)_[A-Za-z0-9]{8,}\b/],
  ["hard-coded Delhivery token", /(?:Authorization\s*[:=]\s*["'`]Token\s+)[A-Za-z0-9_-]{12,}/i],
  ["hard-coded shop id", /\b(?:DEFAULT|TEST|DEV|SEED)_SHOP_ID\s*=\s*["'][^"']+["']/],
  ["production development flag", /VERCEL_ENV\s*===?\s*["']production["'][\s\S]{0,160}(?:DEV_OR_E2E|DEV_DELIVERY|TEST_ENV|MOCK_ENV)[\s\S]{0,80}===?\s*["']true["']/],
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const normalized = `/${path.relative(root, absolute).replaceAll(path.sep, "/")}`;
    if (excludedSegments.some((segment) => normalized.includes(segment))) continue;
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (extensions.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

const files = (await Promise.all(runtimeRoots.map(async (directory) => {
  try { return await walk(path.join(root, directory)); } catch { return []; }
}))).flat();
const violations = [];

for (const file of files) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  if (excludedFiles.has(relative) || /(?:^|\.)test\.[^.]+$/.test(path.basename(file))) continue;
  const source = await readFile(file, "utf8");
  for (const [label, expression] of rules) {
    const match = source.match(expression);
    if (!match) continue;
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} ${label}`);
  }
}

if (violations.length) {
  console.error("SaaS environment audit failed:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`SaaS environment audit passed (${files.length} runtime files checked).`);
}
