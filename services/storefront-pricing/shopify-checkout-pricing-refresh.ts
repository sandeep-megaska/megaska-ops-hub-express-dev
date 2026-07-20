/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "../db/prisma.ts";
import { CheckoutPricingSnapshotService } from "./pricing-snapshot-service.ts";
import { ShopifyCheckoutPricingSnapshotRepository } from "./pricing-snapshot-repository.ts";
import { addressPricingFingerprint, cartPricingFingerprint, pricingInputFingerprint } from "./pricing-snapshot-fingerprint.ts";
import { cartSnapshotPricingFingerprint } from "./pricing-mutation-fingerprints.ts";
import { taxSummaryFromShopifyDraftOrder } from "./tax-summary.ts";
import type { ShopifyCheckoutPricingRefreshInput, ShopifyCheckoutPricingRefreshResult, ShopifyPricingRefreshFailureCode } from "./shopify-checkout-pricing-refresh-types.ts";

type Graphql = (shopDomain: string, query: string, variables: Record<string, unknown>, options: { shopId: string }) => Promise<any>;
type Dependencies = { db?: any; graphql?: Graphql; snapshots?: Pick<CheckoutPricingSnapshotService, "recordAuthoritativePricingSnapshot">; now?: () => Date; audit?: (event: string, data: Record<string, unknown>) => void };
type RecordValue = Record<string, any>;

const MONEY_FIELDS = ["subtotalPriceSet", "totalDiscountsSet", "totalShippingPriceSet", "totalTaxSet", "totalPriceSet"] as const;
const PRICING_FIELDS = `id taxesIncluded currencyCode updatedAt
  subtotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
  totalDiscountsSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
  totalShippingPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
  totalTaxSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
  totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
  taxLines { title rate priceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } } }`;

function fail(code: ShopifyPricingRefreshFailureCode, retryable = false): ShopifyCheckoutPricingRefreshResult { return { ok: false, code, retryable }; }
function object(value: unknown): RecordValue | null { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null; }
function gid(value: unknown) { const raw = String(value ?? "").trim(); return raw.startsWith("gid://shopify/ProductVariant/") ? raw : /^\d+$/.test(raw) ? `gid://shopify/ProductVariant/${raw}` : null; }
function lines(snapshot: unknown) {
  const root = object(snapshot); const candidates = Array.isArray(snapshot) ? snapshot : root?.lineItems ?? root?.items ?? root?.lines;
  if (!Array.isArray(candidates)) return [];
  return candidates.map((raw) => { const line = object(raw); const variantId = gid(line?.variantId ?? line?.variant_id ?? line?.merchandiseId ?? line?.id); const quantity = Number(line?.quantity ?? line?.qty); return variantId && Number.isSafeInteger(quantity) && quantity > 0 ? { variantId, quantity } : null; }).filter(Boolean) as { variantId: string; quantity: number }[];
}
function names(name: unknown) { const parts = String(name ?? "").trim().split(/\s+/); return { firstName: parts.shift() || "", lastName: parts.join(" ") }; }
function safeDate(value: unknown, fallback: Date) { const date = new Date(String(value ?? "")); return Number.isFinite(date.getTime()) ? date : fallback; }
function exponent(currency: string) { return ["BIF","CLP","DJF","GNF","ISK","JPY","KMF","KRW","PYG","RWF","UGX","UYI","VND","VUV","XAF","XOF","XPF"].includes(currency) ? 0 : 2; }

/** Selects shopMoney consistently: Express Checkout currently settles in the shop currency. */
function validateShopMoney(draft: RecordValue) {
  const currencies = new Set<string>();
  for (const field of MONEY_FIELDS) {
    const money = object(object(draft[field])?.shopMoney);
    if (!money || money.amount === null || money.amount === undefined || !Number.isFinite(Number(money.amount)) || Number(money.amount) < 0) throw new Error("invalid money");
    currencies.add(String(money.currencyCode || "").toUpperCase());
  }
  if (!Array.isArray(draft.taxLines)) throw new Error("invalid tax lines");
  for (const raw of draft.taxLines) { const line = object(raw); const money = object(object(line?.priceSet)?.shopMoney); if (!line || typeof line.title !== "string" || !money || !Number.isFinite(Number(money.amount)) || Number(money.amount) < 0) throw new Error("invalid tax line"); currencies.add(String(money.currencyCode || "").toUpperCase()); }
  const currency = String(draft.currencyCode || "").toUpperCase();
  if (!currency) throw new Error("currency missing");
  if (currencies.size !== 1 || !currencies.has(currency)) throw new Error("mixed currency");
  return currency;
}

export async function refreshShopifyCheckoutPricing(input: ShopifyCheckoutPricingRefreshInput, dependencies: Dependencies = {}): Promise<ShopifyCheckoutPricingRefreshResult> {
  const db = dependencies.db ?? prisma; const graphql = dependencies.graphql ?? (async (...args: Parameters<Graphql>) => (await import("../express-checkout/shopify-admin.ts")).shopifyAdminGraphql(...args));
  const now = dependencies.now?.() ?? new Date();
  const audit = dependencies.audit ?? ((event, data) => console.info("[SHOPIFY CHECKOUT PRICING]", event, data));
  try {
    return await db.$transaction(async (tx: any) => {
      if (typeof tx.$executeRaw === "function") await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.shopId}:${input.checkoutIntentId}:shopify_pricing_refresh`}))`;
      const intent = await tx.expressCheckoutIntent.findFirst({ where: { id: input.checkoutIntentId, shopId: input.shopId }, include: { discounts: { where: { shopId: input.shopId }, orderBy: { createdAt: "desc" } } } });
      if (!intent) return fail("checkout_intent_not_found");
      if (intent.cartSnapshot === null || intent.cartSnapshot === undefined) return fail("cart_snapshot_missing");
      const cartLines = lines(intent.cartSnapshot); if (!cartLines.length) return fail("cart_snapshot_invalid");
      const address = await tx.expressCheckoutAddressSnapshot.findFirst({ where: { shopId: input.shopId, intentId: input.checkoutIntentId, ...(intent.customerProfileId ? { customerProfileId: intent.customerProfileId } : {}) }, orderBy: { createdAt: "desc" } });
      if (!address) return fail("address_missing");
      const shop = await tx.shop.findFirst({ where: { id: input.shopId }, select: { shopDomain: true } }); if (!shop) return fail("checkout_intent_shop_mismatch");
      const previous = await tx.shopifyCheckoutPricingSnapshot.findFirst({ where: { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId }, select: { shopifyDraftOrderId: true } });
      const expectedFingerprints = {
        cart: cartSnapshotPricingFingerprint(intent.cartSnapshot) ?? cartPricingFingerprint(cartLines),
        address: addressPricingFingerprint({ countryCode: address.country, provinceCode: address.province, postalCode: address.zip, city: address.city }),
        shipping: pricingInputFingerprint({ title: "Shipping", amountMinor: intent.shippingAmountPaise, currency: intent.currency }),
        discount: pricingInputFingerprint((intent.discounts || []).map((d: any) => ({ type: d.type, code: d.code || null, rawShopifyPayload: d.rawShopifyPayload || null }))),
      };
      const reusedDraftOrder = Boolean(previous?.shopifyDraftOrderId); const { firstName, lastName } = names(address.name);
      const draftInput = { lineItems: cartLines, shippingAddress: { firstName, lastName, address1: address.address1, address2: address.address2 || undefined, city: address.city, province: address.province, country: address.country, zip: address.zip, phone: address.phone }, shippingLine: { title: "Shipping", price: (intent.shippingAmountPaise / 100).toFixed(2) }, customAttributes: [{ key: "megaska_express_intent_id", value: intent.id }] };
      const mutation = reusedDraftOrder
        ? `mutation DraftOrderUpdate($id: ID!, $input: DraftOrderInput!) { draftOrderUpdate(id: $id, input: $input) { draftOrder { ${PRICING_FIELDS} } userErrors { field message } } }`
        : `mutation DraftOrderCreate($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { ${PRICING_FIELDS} } userErrors { field message } } }`;
      let response: any;
      try { response = await graphql(shop.shopDomain, mutation, { ...(reusedDraftOrder ? { id: previous.shopifyDraftOrderId } : {}), input: draftInput }, { shopId: input.shopId }); }
      catch { audit("refresh_failed", { shopId: input.shopId, checkoutIntentPublicId: intent.id, reason: input.reason, resultStatus: "failed", failureCode: "shopify_unavailable" }); return fail("shopify_unavailable", true); }
      const payload = reusedDraftOrder ? response?.draftOrderUpdate : response?.draftOrderCreate;
      if (payload?.userErrors?.length) { const code = reusedDraftOrder ? "draft_order_update_failed" : "draft_order_create_failed"; audit("refresh_failed", { shopId: input.shopId, checkoutIntentPublicId: intent.id, reason: input.reason, operation: reusedDraftOrder ? "update" : "create", resultStatus: "failed", failureCode: code, userErrorCount: payload.userErrors.length }); return fail(code); }
      const draft = object(payload?.draftOrder); if (!draft?.id) return fail("draft_order_response_invalid");
      let currency: string; let taxSummary;
      try { currency = validateShopMoney(draft); taxSummary = taxSummaryFromShopifyDraftOrder(draft, { currencyExponent: exponent(String(draft.currencyCode).toUpperCase()) }); }
      catch (error) { return fail(error instanceof Error && error.message === "currency missing" ? "draft_order_currency_missing" : "draft_order_pricing_invalid"); }
      const authoritativeAt = safeDate(draft.updatedAt, now);
      const latestIntent = await tx.expressCheckoutIntent.findFirst({ where: { id: input.checkoutIntentId, shopId: input.shopId }, include: { discounts: { where: { shopId: input.shopId }, orderBy: { createdAt: "desc" } } } });
      const latestAddress = await tx.expressCheckoutAddressSnapshot.findFirst({ where: { shopId: input.shopId, intentId: input.checkoutIntentId, ...(intent.customerProfileId ? { customerProfileId: intent.customerProfileId } : {}) }, orderBy: { createdAt: "desc" } });
      const latestLines = lines(latestIntent?.cartSnapshot);
      const latestFingerprints = latestIntent && latestAddress && latestLines.length ? {
        cart: cartSnapshotPricingFingerprint(latestIntent.cartSnapshot) ?? cartPricingFingerprint(latestLines),
        address: addressPricingFingerprint({ countryCode: latestAddress.country, provinceCode: latestAddress.province, postalCode: latestAddress.zip, city: latestAddress.city }),
        shipping: pricingInputFingerprint({ title: "Shipping", amountMinor: latestIntent.shippingAmountPaise, currency: latestIntent.currency }),
        discount: pricingInputFingerprint((latestIntent.discounts || []).map((d: any) => ({ type: d.type, code: d.code || null, rawShopifyPayload: d.rawShopifyPayload || null }))),
      } : null;
      if (!latestFingerprints || Object.keys(expectedFingerprints).some((key) => expectedFingerprints[key as keyof typeof expectedFingerprints] !== latestFingerprints[key as keyof typeof latestFingerprints])) {
        audit("refresh_discarded", { shopId: input.shopId, checkoutIntentPublicId: intent.id, reason: input.reason, resultStatus: "failed", failureCode: "pricing_inputs_changed" });
        return fail("pricing_inputs_changed", true);
      }
      let snapshot;
      try {
        const snapshotService = dependencies.snapshots ?? new CheckoutPricingSnapshotService(new ShopifyCheckoutPricingSnapshotRepository(tx));
        snapshot = await snapshotService.recordAuthoritativePricingSnapshot({ shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, snapshot: { source: "SHOPIFY", shopifyDraftOrderId: draft.id, currency, subtotalMinor: taxSummary.subtotal, discountsMinor: taxSummary.discounts, shippingMinor: taxSummary.shipping, totalTaxMinor: taxSummary.totalTax, totalPayableMinor: taxSummary.totalPayable, taxesIncluded: taxSummary.taxesIncluded, taxSummary, refreshReason: input.reason, authoritativeAt, cartFingerprint: expectedFingerprints.cart, addressFingerprint: expectedFingerprints.address, shippingFingerprint: expectedFingerprints.shipping, discountFingerprint: expectedFingerprints.discount } });
      } catch { return fail("pricing_snapshot_persist_failed", true); }
      if (!snapshot) return fail("pricing_snapshot_persist_failed", true);
      audit("refresh_succeeded", { shopId: input.shopId, checkoutIntentPublicId: intent.id, reason: input.reason, operation: reusedDraftOrder ? "update" : "create", reusedDraftOrder, shopifyDraftOrderId: draft.id, snapshotPublicId: snapshot.publicId, currency, totalPayable: taxSummary.totalPayable, totalTax: taxSummary.totalTax, taxesIncluded: taxSummary.taxesIncluded, resultStatus: "succeeded", timestamp: now.toISOString() });
      return { ok: true, checkoutIntentPublicId: intent.id, shopifyDraftOrderId: draft.id, snapshotPublicId: snapshot.publicId, taxSummary, authoritativeAt, reusedDraftOrder };
    }, { timeout: 20_000 });
  } catch { return fail("pricing_snapshot_persist_failed", true); }
}
