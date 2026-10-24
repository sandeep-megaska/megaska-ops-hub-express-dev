import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./install.ts", import.meta.url), "utf8");

test("installs and reinstalls create a storefront token when the shop has none", () => {
  assert.match(source, /if \(rows\[0\]\?\.id\) await ensureStorefrontToken\(rows\[0\]\.id, input\.shopDomain, input\.accessToken\);/);
  const helper = source.slice(source.indexOf("async function ensureStorefrontToken("), source.indexOf("export async function persistShopInstallation("));
  assert.match(helper, /if \(existing\[0\]\?\.hasToken\) return;/, "keeps an existing token");
  assert.match(helper, /storefrontAccessTokenCreate\(input: \$input\)/);
  assert.match(helper, /"storefrontTokenEncrypted" = \$\{encrypted\}/, "stored encrypted");
  assert.match(helper, /"storefrontAccessToken" = NULL/, "never stored in plain text");
  assert.match(helper, /\} catch \(error\) \{\n {4}console\.error\("\[SHOP INSTALL\] storefront token failed"/, "never blocks the install");
});

test("installed shops without a storefront token get one when the app is opened, at most hourly", () => {
  const backfill = source.slice(source.indexOf("async function backfillStorefrontToken("), source.indexOf("/**\n * Returns the installed Shop row"));
  assert.match(backfill, /if \(shop\.storefrontAccessToken \|\| shop\.storefrontTokenEncrypted\) return;/, "keeps an existing token");
  assert.match(backfill, /Date\.now\(\) - lastAttempt < STOREFRONT_BACKFILL_RETRY_MS\) return;/, "throttled per shop");
  assert.match(backfill, /storefrontBackfillAttempts\.set\(shop\.id, Date\.now\(\)\);\n {2}const accessToken/, "attempt recorded before calling Shopify");
  assert.match(backfill, /await ensureStorefrontToken\(shop\.id, shop\.shopDomain, accessToken\);/);
  assert.match(source, /if \(existing && !shopNeedsInstall\(existing\)\) \{\n {4}await backfillStorefrontToken\(existing\);\n {4}return existing;\n {2}\}/);
});
