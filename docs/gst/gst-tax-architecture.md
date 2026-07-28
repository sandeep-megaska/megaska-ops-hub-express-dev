# GST tax architecture (ADR)

Status: Accepted · Scope: GST invoicing module · Audience: engineers + product

## Context

The app is a public multi-tenant Shopify SaaS that produces GST-compliant tax
invoices for Indian merchants. Two systems touch "tax":

- **Shopify** charges the customer at checkout and shows a tax line. Its tax
  model is coarse: region rates + **collection-level** overrides. It has **no
  per-SKU rate** and **no GST intelligence** (it cannot pick a slab from an HSN,
  cannot do price-threshold slabs, cannot split CGST/SGST vs IGST).
- **This app** produces the compliance document: HSN/SAC, the correct GST rate,
  and the CGST/SGST/IGST split.

The recurring question was "do merchants configure tax in two places?" and we
oscillated on who owns the rate. Screenshots of the market-leading app (GST Pro)
on a live store settled it.

## What GST Pro does (evidence)

- **Shopify side:** Manual Tax with a single **India base rate (5%)** + per-state
  IGST entries. Simple, set once. Only *charges* the customer.
- **App side (the real engine):**
  - an **HSN master** (HSN → GST% + description, with product/variant counts),
  - **product → HSN** mapping with a **Source** (Manual vs Shopify HS field),
  - **price-cap rules** (e.g. `5% ≤ ₹2500`) — impossible in Shopify,
  - **collection rules** for bulk mapping,
  - HSN migration tooling.
- The **invoice rate is computed from the app's HSN master + price-cap logic**,
  not from Shopify's charged tax.

## Decision

**The app is authoritative for HSN + GST rate (incl. price-cap slabs) and for the
CGST/SGST/IGST split. Shopify is a simple checkout charger, configured once with a
base rate that matches.** This matches the market standard and is the only model
that can express Indian GST rules Shopify cannot.

"Two places" is real but asymmetric and correct:

| Concern | Owner | Effort |
| --- | --- | --- |
| HSN, GST rate, price-cap slabs, CGST/SGST/IGST split, invoice format/numbering | **App** | rich, per-product (bulk-managed) |
| Tax charged at checkout | **Shopify** | one base rate, set once |

For **tax-inclusive (MRP)** stores (the Indian norm), Shopify's rate does not even
change what the customer pays — only the app's invoice matters for compliance.

## The app already has the bones

| GST Pro concept | Existing model | State |
| --- | --- | --- |
| HSN master | `GstHsnCode` (code, description, isService, effective dates) | exists, no UI |
| Slabs | `GstTaxSlab` (rate, cess, effective dates) | exists |
| HSN→slab (versioned) | `GstHsnSlabMap` (priority, effective dates) | exists |
| Product→HSN w/ source | `GstProductTaxMap` (**`source` field**, status, effective dates) | exists, no UI |
| Flat SKU sheet | `GstSkuTaxMap` | **the only thing the UI drives today** |

The gap is not the data model — it is that the UI drives the flat `GstSkuTaxMap`
while the richer HSN-master/product-map system is dormant, and three GST-Pro
capabilities are missing (price-cap, collection rules, Shopify HS-field sync).

## Target architecture

1. **Consolidate onto the HSN master + product map**; make `GstSkuTaxMap` a
   resolution key into it, not a parallel source of truth.
2. **Price-cap / threshold rates** — add price-band fields to the HSN→slab
   mapping (e.g. `5% ≤ ₹2500 else 12%`).
3. **Collection Rules** — bulk-assign HSN by Shopify collection.
4. **Shopify HS-field integration** — import HSN from the native HS/Tariff code
   (`source: "SHOPIFY"`); optionally write app HSN back to it.
5. **Invoice** = app HSN master + price-cap → rate; app derives CGST/SGST/IGST
   from supplier state (Shopify Settings → General) vs place of supply.
6. **Shopify tax** = one base rate, set to match (not per-SKU).
7. **Reconciliation** — flag orders where tax charged (Shopify) ≠ tax invoiced
   (app), to catch a wrong Shopify rate before it ships on an invoice.

## Consequences

- Merchants maintain GST data in **one rich place** (the app); Shopify is a
  one-time base-rate setup.
- No dependency on unavailable Shopify APIs (tax-override *rates* are not
  API-settable) or paid Shopify Tax.
- Scales O(slabs)/O(collections), not O(SKUs), on the Shopify side.
- The app keeps owning the parts Shopify structurally cannot do.

## Immediate action (config, not code)

The reference GST Pro store has **Shopify India = 5%**. The MEGASKA store is set
to **18%**, which is the entire source of the 5% (invoice) vs 18% (checkout)
mismatch. Set **Settings → Taxes → India = 5%** to match the app's HSN mapping;
then charged = invoiced.

## Roadmap (each independently shippable)

1. **Reconciliation flag** (charged vs invoiced) — first, small, high-signal.
2. HSN-master + product-map UI (surface existing tables; show Source).
3. Price-cap rules (schema + resolver + migration).
4. Collection Rules (bulk mapping).
5. Shopify HS-field import / write-back.
