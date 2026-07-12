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

const resolverSource = fs.readFileSync('services/shopify/shop-resolver.ts', 'utf8');
assert.match(
  resolverSource,
  /getShopByIdAndDomain/,
  'shop resolver must preserve strict shop id + domain binding'
);
assert.match(
  resolverSource,
  /preferredShopId/,
  'resolveShopConfig must preserve optional preferred shop id support'
);
assert.match(
  resolverSource,
  /process\.env\.NODE_ENV === "production"/,
  'global Storefront environment credentials must be disabled in production fallback logic'
);
assert.match(
  resolverSource,
  /return unresolved\(normalizedPreferred\)/,
  'explicit unresolved shop identities must fail closed instead of falling back to another tenant'
);

const storefrontSource = fs.readFileSync('services/shopify/storefront.ts', 'utf8');
assert.equal(
  storefrontSource.includes('shopConfig.storefrontAccessToken || String(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN'),
  false,
  'Storefront requests must not silently fall back to a global environment token'
);
assert.match(
  storefrontSource,
  /options\?\.shopId/,
  'Storefront requests must preserve optional shop id binding'
);
assert.match(
  storefrontSource,
  /storefrontCredentialSource/,
  'Storefront diagnostics must report the credential source without exposing the credential'
);

console.log('shop resolution and Storefront tenant-safety regression tests passed');
