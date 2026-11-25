// Turn Shopify's product CSV export (Products > Export > CSV for Excel,
// Numbers, or other spreadsheet programs) into catalog rows. Pure: no I/O.
//
// Layout of the export: one row per variant. The first row of a product
// carries the product fields; extra rows repeat only the Handle plus variant
// and/or image columns. Extra images get rows of their own.

import { parseCsvRecords } from "./csv.ts";

export type ImportedVariant = {
  sku: string | null;
  optionValues: string[];
  position: number;
  price: string;
  compareAtPrice: string | null;
  barcode: string | null;
  weightGrams: number | null;
  taxable: boolean;
  hsnCode: string | null;
  inventoryTracked: boolean;
  inventoryPolicy: "deny" | "continue";
  /** Only used for variants that have never had a stock reading (see apply.ts). */
  inventoryQuantity: number | null;
  imageUrl: string | null;
};

export type ImportedProduct = {
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  productCategory: string;
  tags: string[];
  published: boolean;
  status: "active" | "draft" | "archived";
  options: Array<{ name: string; values: string[] }>;
  metafields: Record<string, string>;
  seoTitle: string | null;
  seoDescription: string | null;
  variants: ImportedVariant[];
  media: Array<{ position: number; url: string; alt: string | null }>;
};

export type ParseResult = {
  products: ImportedProduct[];
  warnings: string[];
};

const REQUIRED_COLUMNS = ["Handle", "Title", "Variant Price"];

/** Shopify metafield columns look like "Colour (product.metafields.shopify.color-pattern)". */
const METAFIELD_COLUMN = /\(product\.metafields\.([^.()]+)\.([^()]+)\)\s*$/;

const yes = (v: string | undefined) => (v ?? "").trim().toLowerCase() === "true";
const blank = (v: string | undefined) => (v ?? "").trim() === "";
const orNull = (v: string | undefined) => (blank(v) ? null : (v as string).trim());

/** "995", "995.5", "1,499.00" -> "995.00". Null if empty or not a number. */
export function normaliseMoney(raw: string | undefined): string | null {
  if (blank(raw)) return null;
  const cleaned = (raw as string).replace(/[,\s₹]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return `${whole}.${(frac + "00").slice(0, 2)}`;
}

function compareMoney(a: string, b: string): number {
  const cents = (v: string) => BigInt(v.replace(".", ""));
  const d = cents(a) - cents(b);
  return d === 0n ? 0 : d < 0n ? -1 : 1;
}

function toInt(raw: string | undefined): number | null {
  if (blank(raw)) return null;
  const n = Number((raw as string).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseShopifyProductsCsv(text: string): ParseResult {
  const { headers, records } = parseCsvRecords(text);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length) {
    throw new Error(
      `This does not look like a Shopify product export: missing column(s) ${missing.join(", ")}. ` +
        `In Shopify, go to Products > Export and choose "CSV for Excel, Numbers, or other spreadsheet programs".`,
    );
  }

  const metafieldColumns = headers
    .map((h) => ({ header: h, match: METAFIELD_COLUMN.exec(h) }))
    .filter((m): m is { header: string; match: RegExpExecArray } => m.match !== null)
    .map(({ header, match }) => ({ header, key: `${match[1]}.${match[2]}` }));

  // Group rows by handle, keeping file order.
  const groups = new Map<string, Array<Record<string, string>>>();
  for (const r of records) {
    const handle = r["Handle"]?.trim().toLowerCase();
    if (!handle) continue;
    if (!groups.has(handle)) groups.set(handle, []);
    groups.get(handle)!.push(r);
  }

  const warnings: string[] = [];
  const products: ImportedProduct[] = [];
  const seenSkus = new Map<string, string>();

  for (const [handle, rows] of groups) {
    const head = rows.find((r) => !blank(r["Title"])) ?? rows[0];
    if (blank(head["Title"])) {
      warnings.push(`${handle}: no row has a Title, skipped`);
      continue;
    }

    // Options: names from the product row. "Title / Default Title" means none.
    const optionNames = [1, 2, 3]
      .map((n) => head[`Option${n} Name`]?.trim() ?? "")
      .filter((name, idx, all) => name !== "" && all.indexOf(name) === idx);
    const placeholder =
      optionNames.length === 1 && optionNames[0] === "Title" && (head["Option1 Value"] ?? "") === "Default Title";
    const options = placeholder ? [] : optionNames.map((name) => ({ name, values: [] as string[] }));

    const variants: ImportedVariant[] = [];
    const media = new Map<string, { position: number; url: string; alt: string | null }>();
    let nextImagePosition = 1;

    for (const r of rows) {
      const imageUrl = orNull(r["Image Src"]);
      if (imageUrl && !media.has(imageUrl)) {
        const position = toInt(r["Image Position"]) ?? nextImagePosition;
        media.set(imageUrl, { position, url: imageUrl, alt: orNull(r["Image Alt Text"]) });
        nextImagePosition = Math.max(nextImagePosition, position + 1);
      }

      const isVariantRow = !blank(r["Variant Price"]) || !blank(r["Variant SKU"]) || !blank(r["Option1 Value"]);
      if (!isVariantRow) continue;

      const price = normaliseMoney(r["Variant Price"]);
      const sku = orNull(r["Variant SKU"]);
      if (!price) {
        warnings.push(`${handle}${sku ? ` (${sku})` : ""}: variant has no valid price, skipped`);
        continue;
      }
      const optionValues = options.map((_, i) => r[`Option${i + 1} Value`]?.trim() ?? "");
      options.forEach((o, i) => {
        if (optionValues[i] && !o.values.includes(optionValues[i])) o.values.push(optionValues[i]);
      });

      if (sku) {
        const owner = seenSkus.get(sku.toLowerCase());
        if (owner) {
          warnings.push(`SKU ${sku} appears more than once (${owner} and ${handle}); later row skipped`);
          continue;
        }
        seenSkus.set(sku.toLowerCase(), handle);
      }

      const compareAt = normaliseMoney(r["Variant Compare At Price"]);
      const tracker = (r["Variant Inventory Tracker"] ?? "").trim().toLowerCase();
      variants.push({
        sku,
        optionValues,
        position: variants.length + 1,
        price,
        compareAtPrice: compareAt && compareMoney(compareAt, price) > 0 ? compareAt : null,
        barcode: orNull(r["Variant Barcode"]),
        weightGrams: toInt(r["Variant Grams"]),
        taxable: blank(r["Variant Taxable"]) ? true : yes(r["Variant Taxable"]),
        hsnCode: orNull(r["Variant HS Code"]) ?? orNull(r["Variant Harmonized System Code"]),
        inventoryTracked: tracker !== "",
        inventoryPolicy: (r["Variant Inventory Policy"] ?? "").trim().toLowerCase() === "continue" ? "continue" : "deny",
        inventoryQuantity: toInt(r["Variant Inventory Qty"]),
        imageUrl: orNull(r["Variant Image"]),
      });
    }

    if (!variants.length) {
      warnings.push(`${handle}: no variants with a price, skipped`);
      continue;
    }

    const metafields: Record<string, string> = {};
    for (const { header, key } of metafieldColumns) {
      const value = orNull(head[header]);
      if (value !== null) metafields[key] = value;
    }
    const productHsn = metafields["gst_pro.hsn"] ?? null;
    if (productHsn) for (const v of variants) v.hsnCode ??= productHsn;

    const statusRaw = (head["Status"] ?? "").trim().toLowerCase();
    const status = statusRaw === "draft" || statusRaw === "archived" ? statusRaw : "active";

    products.push({
      handle,
      title: head["Title"].trim(),
      descriptionHtml: head["Body (HTML)"] ?? "",
      vendor: head["Vendor"] ?? "",
      productType: head["Type"] ?? "",
      productCategory: head["Product Category"] ?? "",
      tags: (head["Tags"] ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      published: blank(head["Published"]) ? status === "active" : yes(head["Published"]),
      status,
      options,
      metafields,
      seoTitle: orNull(head["SEO Title"]),
      seoDescription: orNull(head["SEO Description"]),
      variants,
      media: [...media.values()].sort((a, b) => a.position - b.position).map((m, i) => ({ ...m, position: i + 1 })),
    });
  }

  return { products, warnings };
}
