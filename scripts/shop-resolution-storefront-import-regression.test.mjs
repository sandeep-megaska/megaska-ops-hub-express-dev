import assert from 'node:assert/strict';
import fs from 'node:fs';

const forbiddenModule = 'promotion-storefront-products.server';
const guardedFiles = [
  'services/shopify/shop-resolver.ts',
  'services/shopify/shop.ts',
  'services/shopify/storefront.ts',
  'services/shopify/admin.ts',
  'services/shopify/dashboard.ts',
  'services/loopdesk/merchant-settings.ts',
  'services/loopdesk/runtime-config.ts',
  'app/api/runtime/config/route.ts',
];

for (const file of guardedFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(
    source.includes(forbiddenModule),
    false,
    `${file} must not import or depend on ${forbiddenModule}`
  );
}

console.log('shop resolution storefront import regression tests passed');
