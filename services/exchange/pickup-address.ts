import { prisma } from "../db/prisma";
import { getSingleShopifyOrderByGid } from "../gst/shopify-runtime-admin";

// Resolve the shipping address to use for an exchange reverse pickup / replacement
// shipment. The exchange request only snapshots name/phone/email — not the
// address — and the linked CustomerProfile address is often empty. The authoritative
// source is the ORDER's shipping address, which the request can reach via
// shopifyOrderId. Resolution order (cheapest + most authoritative first):
//   1. Local GstOrderImport snapshot (no API call; present whenever the order was
//      GST-synced, which the payment-time auto flow already does).
//   2. Live Shopify Admin fetch by order id (per-shop token) — authoritative.
//   3. The CustomerProfile address + request snapshots (last resort).

export interface ResolvedShippingAddress {
  name: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  pin: string;
  country: string;
  email: string;
  source: "gst-import" | "shopify" | "profile";
}

// Shopify/GST order shape (GstOrderImport.snapshot and getSingleShopifyOrderByGid
// return the same normalized structure).
interface OrderLike {
  shippingAddress?: {
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    provinceCode?: string | null;
    zip?: string | null;
    country?: string | null;
    phone?: string | null;
  } | null;
  phone?: string | null;
  email?: string | null;
  customerName?: string | null;
}

export interface ExchangeRequestForAddress {
  shopId: string | null;
  shopifyOrderId: string | null;
  orderNumber: string;
  customerNameSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  customerEmailSnapshot: string | null;
  customerProfile?: {
    fullName: string | null;
    phoneE164: string | null;
    email: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    stateProvince: string | null;
    postalCode: string | null;
    countryRegion: string | null;
  } | null;
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function joinName(first: unknown, last: unknown) {
  return [first, last].map(clean).filter(Boolean).join(" ").trim();
}

// Delhivery requires name, phone, address line, city, state and pin.
function isComplete(a: ResolvedShippingAddress) {
  return Boolean(a.name && a.phone && a.address1 && a.city && a.state && a.pin);
}

function filledRequiredCount(a: ResolvedShippingAddress) {
  return [a.name, a.phone, a.address1, a.city, a.state, a.pin].filter(Boolean).length;
}

function fromOrderLike(order: OrderLike, req: ExchangeRequestForAddress, source: "gst-import" | "shopify"): ResolvedShippingAddress {
  const s = order.shippingAddress || {};
  return {
    name: clean(s.name) || joinName(s.firstName, s.lastName) || clean(order.customerName) || clean(req.customerNameSnapshot),
    phone: clean(s.phone) || clean(order.phone) || clean(req.customerPhoneSnapshot),
    address1: clean(s.address1),
    address2: clean(s.address2),
    city: clean(s.city),
    state: clean(s.province) || clean(s.provinceCode),
    pin: clean(s.zip),
    country: clean(s.country) || "India",
    email: clean(order.email) || clean(req.customerEmailSnapshot),
    source,
  };
}

function fromProfile(req: ExchangeRequestForAddress): ResolvedShippingAddress {
  const p = req.customerProfile;
  return {
    name: clean(p?.fullName) || clean(req.customerNameSnapshot),
    phone: clean(p?.phoneE164) || clean(req.customerPhoneSnapshot),
    address1: clean(p?.addressLine1),
    address2: clean(p?.addressLine2),
    city: clean(p?.city),
    state: clean(p?.stateProvince),
    pin: clean(p?.postalCode),
    country: clean(p?.countryRegion) || "India",
    email: clean(p?.email) || clean(req.customerEmailSnapshot),
    source: "profile",
  };
}

/**
 * Best-effort shipping address for an exchange request's order. Returns the first
 * COMPLETE candidate (order sources preferred over the profile), else the most
 * complete partial candidate, else null when nothing is available. Never throws.
 */
export async function resolveExchangeShippingAddress(
  req: ExchangeRequestForAddress,
): Promise<ResolvedShippingAddress | null> {
  const candidates: ResolvedShippingAddress[] = [];

  // 1) Local GST order import snapshot — no API call.
  if (req.shopId && req.shopifyOrderId) {
    try {
      const imported = await prisma.gstOrderImport.findFirst({
        where: { shopId: req.shopId, shopifyOrderId: req.shopifyOrderId },
        select: { snapshot: true },
      });
      const snapshot = imported?.snapshot;
      if (snapshot && typeof snapshot === "object") {
        const candidate = fromOrderLike(snapshot as OrderLike, req, "gst-import");
        if (isComplete(candidate)) return candidate;
        candidates.push(candidate);
      }
    } catch {
      // fall through to the live fetch
    }
  }

  // 2) Live Shopify fetch — authoritative, per-shop token.
  if (req.shopId && req.shopifyOrderId) {
    try {
      const shop = await prisma.shop.findUnique({ where: { id: req.shopId }, select: { shopDomain: true } });
      const order = await getSingleShopifyOrderByGid({
        shopifyOrderGid: req.shopifyOrderId,
        shopDomain: shop?.shopDomain || undefined,
      });
      if (order) {
        const candidate = fromOrderLike(order as OrderLike, req, "shopify");
        if (isComplete(candidate)) return candidate;
        candidates.push(candidate);
      }
    } catch {
      // fall through to the profile
    }
  }

  // 3) CustomerProfile + snapshots — last resort.
  const profileCandidate = fromProfile(req);
  if (isComplete(profileCandidate)) return profileCandidate;
  candidates.push(profileCandidate);

  // Nothing complete — return the most-filled candidate so the builder can raise a
  // specific missing-field error, or null if there's truly nothing.
  const best = candidates.sort((a, b) => filledRequiredCount(b) - filledRequiredCount(a))[0];
  return best && filledRequiredCount(best) > 0 ? best : null;
}
