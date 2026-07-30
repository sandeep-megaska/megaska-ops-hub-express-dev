import { parseCsvToRecords } from "./review-csv.ts";
import {
  normalizeImportRows,
  reviewImportDedupeKey,
  type NormalizedReviewImport,
  type ReviewImportPlatform,
} from "./review-import-mapping.ts";
import { normalizeShopifyProductId, normalizeShopifyVariantId } from "./shopify-product-id.ts";

// Persistence layer for review import. Consumes the pure parser + mapping engine
// (review-csv / review-import-mapping), resolves each row to a numeric Shopify
// product id, skips rows already present (natural-key dedup against existing
// reviews), creates ProductReview (+ media + merchant reply) rows as
// source = MANUAL_IMPORT, and recomputes per-product aggregates. Prisma and the
// aggregate helper are lazily imported so buildReviewCreateData stays unit-
// testable without booting pg.

const MAX_ERRORS = 500;

export interface ImportReviewsInput {
  shopId: string;
  csv: string;
  platform?: ReviewImportPlatform;
  dryRun?: boolean;
  defaultStatus?: string;
  defaultVerified?: boolean;
  now?: Date;
}

export interface ImportRowError {
  csvLine: number;
  message: string;
}

export interface ImportReviewsResult {
  platform: string;
  dryRun: boolean;
  totalDataRows: number;
  created: number;
  duplicatesSkippedInFile: number;
  duplicatesSkippedExisting: number;
  unmatched: number;
  failed: number;
  affectedProducts: number;
  errors: ImportRowError[];
  errorsTruncated: boolean;
}

export interface ReviewCreateData {
  shopId: string;
  source: string;
  status: string;
  rating: number;
  title: string | null;
  body: string | null;
  customerDisplayName: string;
  verifiedPurchase: boolean;
  shopifyProductId: string;
  shopifyVariantId: string | null;
  productTitleSnapshot: string;
  productHandleSnapshot: string | null;
  submittedAt: Date;
  publishedAt: Date | null;
  moderatedAt: Date | null;
  moderationNote: string;
}

// Minimal client contract; loose so this module never imports generated Prisma
// types at load and a fake can be injected in tests.
export interface ReviewImportDb {
  productReview: {
    findMany(args: unknown): Promise<
      { shopifyProductId: string; customerDisplayName: string; rating: number; body: string | null; submittedAt: Date | string }[]
    >;
    create(args: unknown): Promise<{ id: string }>;
  };
  productReviewMedia: { create(args: unknown): Promise<unknown> };
  productReviewMerchantReply: { create(args: unknown): Promise<unknown> };
}

// Pure mapping from a normalized import row to ProductReview create data. An
// imported PUBLISHED review is treated as already-moderated (moderatedAt set)
// so it surfaces immediately; other statuses stay unmoderated.
export function buildReviewCreateData(
  row: NormalizedReviewImport,
  shopId: string,
  normalizedProductId: string,
): ReviewCreateData {
  const published = row.status === "PUBLISHED";
  return {
    shopId,
    source: "MANUAL_IMPORT",
    status: row.status,
    rating: row.rating,
    title: row.title,
    body: row.body,
    customerDisplayName: row.customerDisplayName,
    verifiedPurchase: row.verifiedPurchase,
    shopifyProductId: normalizedProductId,
    shopifyVariantId: normalizeShopifyVariantId(row.shopifyVariantId),
    productTitleSnapshot: row.productTitleSnapshot,
    productHandleSnapshot: row.productHandle,
    submittedAt: row.submittedAt,
    publishedAt: row.publishedAt,
    moderatedAt: published ? row.publishedAt ?? row.submittedAt : null,
    moderationNote: "Imported via CSV",
  };
}

function pushError(errors: ImportRowError[], error: ImportRowError): void {
  if (errors.length < MAX_ERRORS) errors.push(error);
}

export interface ImportReviewsDeps {
  db?: ReviewImportDb;
  // Aggregate recompute; injectable so integration tests avoid booting Prisma.
  recalculate?: (shopId: string, shopifyProductId: string, db: unknown) => Promise<unknown>;
}

export async function importReviews(input: ImportReviewsInput, deps: ImportReviewsDeps = {}): Promise<ImportReviewsResult> {
  const shopId = String(input.shopId || "").trim();
  if (!shopId) throw new Error("shopId is required to import reviews");

  const { records } = parseCsvToRecords(input.csv || "");
  const preview = normalizeImportRows(records, {
    platform: input.platform,
    defaultStatus: input.defaultStatus,
    defaultVerified: input.defaultVerified,
    now: input.now,
  });

  const errors: ImportRowError[] = preview.errors.slice(0, MAX_ERRORS);
  const result: ImportReviewsResult = {
    platform: preview.platform,
    dryRun: Boolean(input.dryRun),
    totalDataRows: preview.totalDataRows,
    created: 0,
    duplicatesSkippedInFile: preview.duplicatesSkipped,
    duplicatesSkippedExisting: 0,
    unmatched: 0,
    failed: 0,
    affectedProducts: 0,
    errors,
    errorsTruncated: false,
  };

  // Keep only rows with a resolvable numeric Shopify product id; handle-only
  // rows can't be attached to a storefront product and are reported.
  const importable: { row: NormalizedReviewImport; productId: string; dedupeKey: string }[] = [];
  for (const row of preview.rows) {
    const productId = normalizeShopifyProductId(row.shopifyProductId);
    if (!productId) {
      result.unmatched += 1;
      pushError(errors, {
        csvLine: row.csvLine,
        message: "No numeric Shopify product id; a product_id column is required to attach the review to a storefront product.",
      });
      continue;
    }
    importable.push({
      row,
      productId,
      dedupeKey: reviewImportDedupeKey({
        productRef: productId,
        customerDisplayName: row.customerDisplayName,
        rating: row.rating,
        body: row.body,
        submittedAt: row.submittedAt,
      }),
    });
  }

  if (importable.length === 0) {
    result.errorsTruncated = errors.length >= MAX_ERRORS;
    return result;
  }

  const client = deps.db ?? ((await import("../db/prisma.ts")).prisma as unknown as ReviewImportDb);
  const productIds = [...new Set(importable.map((item) => item.productId))];

  // Cross-import dedup: reviews already stored for these products, keyed the
  // same way, are skipped so re-uploading a file doesn't duplicate reviews.
  const existing = await client.productReview.findMany({
    where: { shopId, shopifyProductId: { in: productIds }, status: { not: "DELETED" } },
    select: { shopifyProductId: true, customerDisplayName: true, rating: true, body: true, submittedAt: true },
  });
  const existingKeys = new Set(
    existing.map((review) =>
      reviewImportDedupeKey({
        productRef: review.shopifyProductId,
        customerDisplayName: review.customerDisplayName,
        rating: review.rating,
        body: review.body,
        submittedAt: review.submittedAt instanceof Date ? review.submittedAt : new Date(review.submittedAt),
      }),
    ),
  );

  const toCreate = importable.filter((item) => {
    if (existingKeys.has(item.dedupeKey)) {
      result.duplicatesSkippedExisting += 1;
      return false;
    }
    return true;
  });

  if (result.dryRun) {
    result.created = toCreate.length; // would-create count
    result.affectedProducts = new Set(toCreate.map((item) => item.productId)).size;
    result.errorsTruncated = errors.length >= MAX_ERRORS;
    return result;
  }

  const recalculate =
    deps.recalculate ?? (await import("./review-foundation.ts")).recalculateProductReviewAggregate;
  const affected = new Set<string>();

  for (const item of toCreate) {
    try {
      const review = await client.productReview.create({ data: buildReviewCreateData(item.row, shopId, item.productId) });
      for (let index = 0; index < item.row.mediaUrls.length; index += 1) {
        await client.productReviewMedia.create({
          data: {
            shopId,
            productReviewId: review.id,
            mediaType: "IMAGE",
            status: "READY",
            storageProvider: "external",
            storageKey: `external:${review.id}:${index}`,
            publicUrl: item.row.mediaUrls[index],
            approved: true,
            sortOrder: index,
          },
        });
      }
      if (item.row.replyBody) {
        await client.productReviewMerchantReply.create({
          data: { shopId, productReviewId: review.id, body: item.row.replyBody, authorLabel: item.row.replyAuthor || "Store team" },
        });
      }
      result.created += 1;
      affected.add(item.productId);
    } catch (error) {
      result.failed += 1;
      pushError(errors, { csvLine: item.row.csvLine, message: error instanceof Error ? error.message : "Failed to create review." });
    }
  }

  // Aggregates are best-effort: a failure here must not fail the whole import.
  for (const productId of affected) {
    try {
      await recalculate(shopId, productId, client);
    } catch {
      /* leave the aggregate to the next recompute */
    }
  }

  result.affectedProducts = affected.size;
  result.errorsTruncated = errors.length >= MAX_ERRORS;
  return result;
}
