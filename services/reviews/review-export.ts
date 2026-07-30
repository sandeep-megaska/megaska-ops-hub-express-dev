// Canonical LoopD2C review CSV contract. Export emits exactly these columns, in
// this order; the Judge.me / Shopify-native importers map their columns INTO
// this same shape so an exported file round-trips cleanly back through import.
export const REVIEW_EXPORT_HEADERS = [
  "review_id",
  "product_id",
  "product_handle",
  "variant_id",
  "product_title",
  "rating",
  "title",
  "body",
  "author_name",
  "verified_purchase",
  "status",
  "source",
  "reply_body",
  "reply_author",
  "media_urls",
  "submitted_at",
  "published_at",
] as const;

// Human/importer-friendly lowercase tokens for the enum values. The importer
// maps these back to ProductReviewStatus; keep the two in sync.
const STATUS_TOKEN: Record<string, string> = {
  DRAFT: "draft",
  PENDING_MODERATION: "pending",
  PUBLISHED: "published",
  REJECTED: "rejected",
  HIDDEN: "hidden",
  DELETED: "deleted",
};

// Pipe with surrounding spaces separates multiple media URLs inside the single
// media_urls cell (commas would collide with CSV field separation).
export const MEDIA_URL_SEPARATOR = " | ";

// The minimal shape a review needs to render one export row. Kept explicit (not
// a Prisma type) so the pure formatter is unit-testable without a database and
// stays stable even when the generated client is regenerated.
export interface ExportableReviewMedia {
  publicUrl?: string | null;
  thumbnailUrl?: string | null;
}

export interface ExportableReviewReply {
  body?: string | null;
  authorLabel?: string | null;
}

export interface ExportableReview {
  id: string;
  shopifyProductId: string;
  productHandleSnapshot?: string | null;
  shopifyVariantId?: string | null;
  productTitleSnapshot: string;
  rating: number;
  title?: string | null;
  body?: string | null;
  customerDisplayName: string;
  verifiedPurchase: boolean;
  status: string;
  source: string;
  submittedAt?: Date | string | null;
  publishedAt?: Date | string | null;
  merchantReply?: ExportableReviewReply | null;
  media?: ExportableReviewMedia[] | null;
}

export interface ReviewExportFilters {
  // Explicit ProductReviewStatus enum values to include. When omitted, every
  // status EXCEPT DELETED is exported (soft-deleted reviews stay out of a
  // merchant-facing backup unless explicitly requested).
  statuses?: string[];
  includeDeleted?: boolean;
}

export interface ReviewExportResult {
  csv: string;
  rowCount: number;
}

// RFC 4180 field escaping: quote when the value contains a quote, comma, or a
// line break, and double any embedded quotes.
function csvEscape(value: unknown): string {
  const raw = String(value ?? "");
  if (raw.includes('"') || raw.includes(",") || raw.includes("\n") || raw.includes("\r")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function iso(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function mediaUrls(media: ExportableReviewMedia[] | null | undefined): string {
  return (media || [])
    .map((item) => (item.publicUrl || item.thumbnailUrl || "").trim())
    .filter(Boolean)
    .join(MEDIA_URL_SEPARATOR);
}

// Pure formatter: reviews -> canonical CSV. No I/O, so it is unit-testable and
// shared by the DB wrapper below (mirrors services/gst/report-export toCsv).
export function reviewRowsToCsv(reviews: ExportableReview[]): ReviewExportResult {
  const rows = reviews.map((review) => [
    review.id,
    review.shopifyProductId,
    review.productHandleSnapshot ?? "",
    review.shopifyVariantId ?? "",
    review.productTitleSnapshot,
    String(review.rating),
    review.title ?? "",
    review.body ?? "",
    review.customerDisplayName,
    review.verifiedPurchase ? "true" : "false",
    STATUS_TOKEN[review.status] ?? String(review.status).toLowerCase(),
    String(review.source).toLowerCase(),
    review.merchantReply?.body ?? "",
    review.merchantReply?.authorLabel ?? "",
    mediaUrls(review.media),
    iso(review.submittedAt),
    iso(review.publishedAt),
  ]);

  const csv = [
    REVIEW_EXPORT_HEADERS.join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ].join("\r\n");

  return { csv, rowCount: rows.length };
}

// Minimal client contract the DB wrapper needs. Kept loose so this module never
// imports the generated Prisma types at load time (keeps the pure formatter
// above importable in unit tests without booting Prisma/pg), and so a fake can
// be injected in integration tests.
export interface ReviewExportDb {
  productReview: {
    findMany(args: unknown): Promise<unknown[]>;
  };
}

// DB wrapper: per-shop read of ProductReview (+ merchant reply and non-deleted
// media) then delegate to the pure formatter. shopId is required and never
// falls back to a global scope (tenant isolation, matching the GST/promotions
// fail-closed convention). The Prisma client is lazily imported so importing
// this module for the pure formatter does not eagerly initialise the pg pool.
export async function buildReviewExportCsv(
  shopId: string,
  filters: ReviewExportFilters = {},
  db?: ReviewExportDb,
): Promise<ReviewExportResult> {
  const scopedShopId = String(shopId || "").trim();
  if (!scopedShopId) throw new Error("shopId is required to export reviews");

  const client = db ?? ((await import("../db/prisma.ts")).prisma as unknown as ReviewExportDb);

  const where: { shopId: string; status?: { in?: string[]; not?: string } } = { shopId: scopedShopId };
  if (Array.isArray(filters.statuses) && filters.statuses.length > 0) {
    where.status = { in: filters.statuses };
  } else if (!filters.includeDeleted) {
    where.status = { not: "DELETED" };
  }

  const reviews = await client.productReview.findMany({
    where,
    orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
    include: {
      merchantReply: true,
      media: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
    },
  });

  return reviewRowsToCsv(reviews as unknown as ExportableReview[]);
}
