#!/usr/bin/env node
// Backfill: move any plaintext Shop OAuth tokens to encrypted-at-rest.
//
// Context: the app now persists Shopify admin/storefront tokens only in the
// "*Encrypted" columns (AES-256-GCM via services/shopify/token-crypto). Rows
// installed before that change may still hold plaintext in "accessToken" /
// "storefrontAccessToken". This script encrypts those values into the encrypted
// columns (without clobbering an existing ciphertext) and then nulls the
// plaintext columns.
//
// Usage:
//   node scripts/backfill-encrypt-shop-tokens.mjs            # dry-run (default)
//   node scripts/backfill-encrypt-shop-tokens.mjs --apply    # perform the writes
//
// Run against every environment's database (production + preview), same as a
// migration. Requires DATABASE_URL and the token encryption key
// (SHOPIFY_TOKEN_ENCRYPTION_KEY / TOKEN_ENCRYPTION_KEY / SHOPIFY_API_SECRET).
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { encryptShopifyToken } from "../services/shopify/token-crypto.ts";

const apply = process.argv.slice(2).includes("--apply");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function preview(token) {
  const value = String(token || "");
  if (!value) return "(empty)";
  return `${value.slice(0, 4)}…(${value.length} chars)`;
}

async function main() {
  // Sanity: the encryption key must be present, otherwise we would null
  // plaintext tokens without a recoverable ciphertext.
  if (encryptShopifyToken("__probe__") === null) {
    throw new Error(
      "Token encryption key is not configured (SHOPIFY_TOKEN_ENCRYPTION_KEY / TOKEN_ENCRYPTION_KEY / SHOPIFY_API_SECRET). Aborting.",
    );
  }

  const rows = await prisma.$queryRaw`
    SELECT "id", "shopDomain", "accessToken", "accessTokenEncrypted",
           "storefrontAccessToken", "storefrontTokenEncrypted"
    FROM "Shop"
    WHERE "accessToken" IS NOT NULL OR "storefrontAccessToken" IS NOT NULL
  `;

  console.log(`${apply ? "APPLY" : "DRY-RUN"}: ${rows.length} shop row(s) with plaintext token(s)\n`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const adminPlain = row.accessToken ? String(row.accessToken) : null;
    const storePlain = row.storefrontAccessToken ? String(row.storefrontAccessToken) : null;

    // Only fill an encrypted column that is currently empty; never overwrite an
    // existing ciphertext. If a plaintext exists but cannot be encrypted, leave
    // the row untouched so we don't destroy the only copy of the token.
    let adminEnc = row.accessTokenEncrypted || null;
    let storeEnc = row.storefrontTokenEncrypted || null;
    let failed = false;

    if (adminPlain && !adminEnc) {
      adminEnc = encryptShopifyToken(adminPlain);
      if (!adminEnc) failed = true;
    }
    if (storePlain && !storeEnc) {
      storeEnc = encryptShopifyToken(storePlain);
      if (!storeEnc) failed = true;
    }

    if (failed) {
      skipped += 1;
      console.warn(`  SKIP  ${row.shopDomain} (id=${row.id}) — encryption returned null`);
      continue;
    }

    console.log(
      `  ${apply ? "UPDATE" : "would update"} ${row.shopDomain} (id=${row.id}) ` +
        `admin=${adminPlain ? preview(adminPlain) : "-"} storefront=${storePlain ? preview(storePlain) : "-"}`,
    );

    if (apply) {
      await prisma.$executeRaw`
        UPDATE "Shop"
        SET "accessTokenEncrypted" = ${adminEnc},
            "storefrontTokenEncrypted" = ${storeEnc},
            "accessToken" = NULL,
            "storefrontAccessToken" = NULL,
            "updatedAt" = NOW()
        WHERE "id" = ${row.id}
      `;
    }
    updated += 1;
  }

  console.log(`\n${apply ? "Applied" : "Would apply"} to ${updated} row(s); skipped ${skipped}.`);
  if (!apply) console.log("Re-run with --apply to perform the writes.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
