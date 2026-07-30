// Maps parsed CSV records from any supported platform into the canonical
// ProductReview import shape. Pure and dependency-free so the whole mapping /
// validation / dedup pipeline is unit-testable without a database. The DB
// writer (phase 2b) consumes NormalizedReviewImport rows, resolves products,
// and persists with source = MANUAL_IMPORT.

export type ReviewImportPlatform = "megaska" | "judge_me" | "shopify_native" | "generic";

export const REVIEW_IMPORT_PLATFORMS: ReviewImportPlatform[] = [
  "megaska",
  "judge_me",
  "shopify_native",
  "generic",
];

// Canonical field -> candidate normalized header names, tried in order (first
// match wins). Header normalization (see review-csv.normalizeHeader) already
// lowercased and underscored, so aliases are listed in that form.
const FIELD_ALIASES: Record<string, string[]> = {
  // Shopify product id is preferred over any platform-internal product id.
  shopifyProductId: ["shopify_product_id", "product_external_id", "external_product_id", "external_id", "product_id", "platform_product_id"],
  productHandle: ["product_handle", "handle", "product_slug"],
  variantId: ["variant_id", "shopify_variant_id", "variant"],
  productTitle: ["product_title", "product_name"],
  rating: ["rating", "score", "stars", "star_rating", "review_rating", "rating_value"],
  reviewTitle: ["title", "review_title", "headline", "subject", "review_heading"],
  body: ["body", "review_body", "content", "review_content", "review", "comment", "message", "text", "description"],
  authorName: ["author_name", "author", "reviewer_name", "name", "customer_name", "display_name", "reviewer", "user_name", "full_name"],
  authorEmail: ["author_email", "reviewer_email", "email", "customer_email", "user_email"],
  verified: ["verified_purchase", "verified", "is_verified", "verified_buyer"],
  status: ["status", "state", "published", "curated", "review_state", "moderation_status", "approved"],
  replyBody: ["reply_body", "reply", "reply_content", "response", "reply_text", "merchant_reply", "store_reply", "comment_reply"],
  replyAuthor: ["reply_author", "reply_author_name", "reply_by", "responder"],
  mediaUrls: ["media_urls", "picture_urls", "pictures", "images", "image_urls", "photo_urls", "photos", "media", "picture", "image"],
  submittedAt: ["submitted_at", "created_at", "review_date", "date", "created", "review_created_at", "timestamp", "reviewed_at"],
  publishedAt: ["published_at", "publish_date"],
};

const STATUS_TOKENS: Record<string, string> = {
  published: "PUBLISHED", public: "PUBLISHED", ok: "PUBLISHED", approved: "PUBLISHED",
  active: "PUBLISHED", live: "PUBLISHED", true: "PUBLISHED", yes: "PUBLISHED", "1": "PUBLISHED", curated: "PUBLISHED",
  pending: "PENDING_MODERATION", queued: "PENDING_MODERATION", unmoderated: "PENDING_MODERATION",
  unapproved: "PENDING_MODERATION", awaiting: "PENDING_MODERATION", hold: "PENDING_MODERATION",
  false: "PENDING_MODERATION", no: "PENDING_MODERATION", "0": "PENDING_MODERATION",
  rejected: "REJECTED", spam: "REJECTED", declined: "REJECTED", denied: "REJECTED",
  hidden: "HIDDEN", unpublished: "HIDDEN", archived: "HIDDEN", disabled: "HIDDEN", draft: "DRAFT",
};

export interface NormalizeImportOptions {
  platform?: ReviewImportPlatform;
  // Status applied when a row has no recognizable status/state cell.
  defaultStatus?: string;
  // verified_purchase applied when a row has no verified cell. Imported reviews
  // were not placed through our checkout, so the honest default is false.
  defaultVerified?: boolean;
  // Injected clock so mapping is deterministic in tests; the route passes new Date().
  now?: Date;
  // Hard cap on media URLs kept per review.
  maxMediaUrls?: number;
}

export interface NormalizedReviewImport {
  dedupeKey: string;
  shopifyProductId: string | null;
  productHandle: string | null;
  shopifyVariantId: string | null;
  productTitleSnapshot: string;
  rating: number;
  title: string | null;
  body: string | null;
  customerDisplayName: string;
  authorEmail: string | null;
  verifiedPurchase: boolean;
  status: string;
  submittedAt: Date;
  publishedAt: Date | null;
  replyBody: string | null;
  replyAuthor: string | null;
  mediaUrls: string[];
  csvLine: number;
}

export interface ImportRowError {
  csvLine: number;
  message: string;
}

export interface ReviewImportPreview {
  platform: ReviewImportPlatform;
  rows: NormalizedReviewImport[];
  errors: ImportRowError[];
  totalDataRows: number;
  validCount: number;
  errorCount: number;
  duplicatesSkipped: number;
}

const TITLE_MAX = 150;
const BODY_MAX = 5000;
const NAME_MAX = 100;

function pick(record: Record<string, string>, field: string): string {
  const aliases = FIELD_ALIASES[field] || [];
  for (const alias of aliases) {
    const value = record[alias];
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function parseRating(raw: string): number | null {
  if (!raw) return null;
  const match = raw.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const rounded = Math.round(Number(match[0]));
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

function parseBool(raw: string, fallback: boolean): boolean {
  if (!raw) return fallback;
  if (/^(true|1|yes|y|verified|verified_buyer)$/i.test(raw.trim())) return true;
  if (/^(false|0|no|n|unverified)$/i.test(raw.trim())) return false;
  return fallback;
}

function parseStatus(raw: string, fallback: string): string {
  if (!raw) return fallback;
  const token = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  // Try the whole token, then its first word (handles values like "ok - spam free").
  return STATUS_TOKENS[token] || STATUS_TOKENS[token.split("_")[0]] || fallback;
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const date = new Date(raw.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

// Extract the numeric Shopify product id from a gid, else return the trimmed
// value as-is. The DB writer applies the canonical normalizer for persistence.
function normalizeProductId(raw: string): string {
  if (!raw) return "";
  const gid = raw.match(/gid:\/\/shopify\/Product\/(\d+)/i);
  return gid ? gid[1] : raw.trim();
}

function splitMediaUrls(raw: string, max: number): string[] {
  if (!raw) return [];
  // URLs never contain whitespace, so any whitespace or delimiter run separates
  // entries — covers comma (Judge.me), newline, pipe (Loox), and space-joined lists.
  return raw
    .split(/[\s,|;]+/)
    .map((part) => part.trim())
    .filter((part) => /^(https?:\/\/|\/)/i.test(part))
    .slice(0, max);
}

// Stable, order-independent dedup key. FNV-1a keeps it compact; two rows that
// describe the same review (same product, author, rating, body, day) collapse.
function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildDedupeKey(row: {
  productRef: string;
  customerDisplayName: string;
  rating: number;
  body: string | null;
  submittedAt: Date;
}): string {
  const material = [
    row.productRef.toLowerCase(),
    row.customerDisplayName.toLowerCase(),
    String(row.rating),
    (row.body || "").slice(0, 200).toLowerCase().replace(/\s+/g, " ").trim(),
    row.submittedAt.toISOString().slice(0, 10),
  ].join("");
  return fnv1a(material);
}

export function normalizeImportRows(
  records: Record<string, string>[],
  options: NormalizeImportOptions = {},
): ReviewImportPreview {
  const platform = options.platform || "generic";
  const defaultStatus = options.defaultStatus || "PUBLISHED";
  const defaultVerified = options.defaultVerified ?? false;
  const now = options.now || new Date();
  const maxMediaUrls = options.maxMediaUrls ?? 20;

  const rows: NormalizedReviewImport[] = [];
  const errors: ImportRowError[] = [];
  const seen = new Set<string>();
  let duplicatesSkipped = 0;

  records.forEach((record, index) => {
    // CSV line number: header is line 1, first data row is line 2.
    const csvLine = index + 2;

    const rating = parseRating(pick(record, "rating"));
    if (rating == null) {
      errors.push({ csvLine, message: "Missing or invalid rating (must be a whole number 1-5)." });
      return;
    }

    const shopifyProductId = normalizeProductId(pick(record, "shopifyProductId"));
    const productHandle = pick(record, "productHandle");
    if (!shopifyProductId && !productHandle) {
      errors.push({ csvLine, message: "Missing product reference (need product_id or product_handle)." });
      return;
    }

    const bodyRaw = pick(record, "body");
    const titleRaw = pick(record, "reviewTitle");
    const nameRaw = pick(record, "authorName");
    const productTitleRaw = pick(record, "productTitle");

    const customerDisplayName = truncate(nameRaw || "Anonymous", NAME_MAX);
    const body = bodyRaw ? truncate(bodyRaw, BODY_MAX) : null;
    const title = titleRaw ? truncate(titleRaw, TITLE_MAX) : null;

    const status = parseStatus(pick(record, "status"), defaultStatus);
    const verifiedPurchase = parseBool(pick(record, "verified"), defaultVerified);
    const submittedAt = parseDate(pick(record, "submittedAt")) || now;
    let publishedAt = parseDate(pick(record, "publishedAt"));
    // Aggregates count only PUBLISHED reviews with a publishedAt; backfill it so
    // imported published reviews actually surface on the storefront.
    if (!publishedAt && status === "PUBLISHED") publishedAt = submittedAt;

    const productRef = shopifyProductId || productHandle;
    const productTitleSnapshot = truncate(
      productTitleRaw || productHandle || shopifyProductId || "Imported product",
      TITLE_MAX,
    );

    const dedupeKey = buildDedupeKey({ productRef, customerDisplayName, rating, body, submittedAt });
    if (seen.has(dedupeKey)) {
      duplicatesSkipped += 1;
      return;
    }
    seen.add(dedupeKey);

    rows.push({
      dedupeKey,
      shopifyProductId: shopifyProductId || null,
      productHandle: productHandle || null,
      shopifyVariantId: pick(record, "variantId") || null,
      productTitleSnapshot,
      rating,
      title,
      body,
      customerDisplayName,
      authorEmail: pick(record, "authorEmail") || null,
      verifiedPurchase,
      status,
      submittedAt,
      publishedAt,
      replyBody: pick(record, "replyBody") ? truncate(pick(record, "replyBody"), BODY_MAX) : null,
      replyAuthor: pick(record, "replyAuthor") || null,
      mediaUrls: splitMediaUrls(pick(record, "mediaUrls"), maxMediaUrls),
      csvLine,
    });
  });

  return {
    platform,
    rows,
    errors,
    totalDataRows: records.length,
    validCount: rows.length,
    errorCount: errors.length,
    duplicatesSkipped,
  };
}
