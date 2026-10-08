import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../megaska-otp/assets/loopdesk-cart-drawer.js", import.meta.url), "utf8");

// Shopify answers 409 Conflict when cart requests overlap (e.g. the drawer's
// reload racing a page that is still changing the cart).
test("cart reloads retry Shopify's 409/429 conflict answers", () => {
  assert.match(source, /function getCartJson\(attempt\) \{[\s\S]*?response\.status === 409 \|\| response\.status === 429\) && attempt < 3/);
  assert.match(source, /function fetchCart\(\) \{[\s\S]*?return getCartJson\(0\)/);
});

test("a superseded cart reload cannot show the load error over a newer one", () => {
  const fetchCart = source.match(/function fetchCart\(\) \{[\s\S]*?\n  \}\n/)[0];
  assert.match(fetchCart, /var sequence = \+\+cartFetchSequence;/);
  assert.match(fetchCart, /\.catch\(function \(error\) \{\n {8}if \(sequence !== cartFetchSequence\) return;\n {8}state\.error =/);
  assert.match(fetchCart, /\.finally\(function \(\) \{\n {8}if \(sequence !== cartFetchSequence\) return;/);
});
