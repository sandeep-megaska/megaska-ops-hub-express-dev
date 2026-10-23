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
