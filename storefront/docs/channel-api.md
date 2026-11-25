# Megaska storefront: Channel API v1

For Ginesys OMS (Browntape) and any other system that keeps stock for the
Megaska website. Version 1 covers **stock** and the **product list**.
**Orders** are planned for Phase 2 and are described at the end as a draft
to agree on.

- Base URL (test): `https://<test-deployment>.vercel.app/api/channel/v1`
- Base URL (live, after launch): `https://megaska.com/api/channel/v1`
- Format: JSON over HTTPS, UTF-8. Times are ISO 8601 (`2026-11-25T10:00:00+05:30`).

## Authentication

Every request sends an API key, created by Megaska on the storefront admin page:

```
Authorization: Bearer msk_xxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys carry scopes: `inventory:write`, `inventory:read`, `products:read`.
A missing or wrong key gets `401`; a key without the scope gets `403`.
Keys can be revoked at any time and replaced with a new one.

Optional: send `X-Request-Id: <your id>` and we echo it back and log it
against every stock change, which makes support questions easy to trace.

### Test the connection

```
GET /ping
→ 200 {"ok": true, "client": "Browntape", "scopes": ["inventory:write", ...], "request_id": "..."}
```

## Stock

### Set stock levels — `POST /inventory`

Sends **absolute available quantities** by SKU. These are not adjustments
(+/-), so sending the same request twice is harmless and a retry after a
timeout is always safe.

```http
POST /inventory
Content-Type: application/json

{
  "items": [
    { "sku": "MBPS07-Black-S", "quantity": 202, "updated_at": "2026-11-25T10:00:00+05:30" },
    { "sku": "MBPS07-Black-M", "quantity": 0 }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `sku` | yes | The Megaska SKU, matched without regard to case |
| `quantity` | yes | Units available to sell online, a whole number ≥ 0 |
| `updated_at` | recommended | When this quantity was true in your system. Without it, the time we receive the request is used. |

Rules:

- At most **1000 items per request**. For a full stock sync, send batches of up to 1000.
- **The newest reading wins.** If we already hold a reading for a SKU with
  an `updated_at` equal to or later than yours, yours is ignored and
  reported as `stale`. Two pushes that arrive out of order therefore can't
  leave old stock on the site.
- If one item is invalid (bad quantity or timestamp), the **whole request is
  rejected** with `422` and nothing changes. Fix it and resend.
- A SKU we don't know is reported as `unknown_sku`. That is not an error:
  the other items are still applied.

Response `200`:

```json
{
  "ok": true,
  "summary": { "updated": 1, "unchanged": 0, "stale": 0, "unknown_sku": 1 },
  "results": [
    { "sku": "MBPS07-Black-S", "outcome": "updated", "quantity": 202 },
    { "sku": "XYZ-1", "outcome": "unknown_sku" }
  ],
  "request_id": "..."
}
```

| Outcome | Meaning |
|---|---|
| `updated` | Stock changed to your quantity |
| `unchanged` | We already had that quantity |
| `stale` | We hold a newer reading; `quantity` is the value we kept |
| `unknown_sku` | No product variant has this SKU |

The product page updates within seconds (sold out ↔ available).

### Read stock — `GET /inventory`

- Specific SKUs: `GET /inventory?sku=MBPS07-Black-S,MBPS07-Black-M`
- All SKUs, page by page: `GET /inventory?limit=500`, then
  `GET /inventory?after=<next_after>&limit=500` until `next_after` is `null`.

```json
{ "items": [ { "sku": "MBPS07-Black-S", "quantity": 202, "updated_at": "2026-11-25T04:30:00.000Z", "source": "api:Browntape" } ],
  "next_after": "MBPS07-Black-S", "request_id": "..." }
```

`source` is `api:<client>` once a channel has set the stock. It is `csv` while
the number still comes from the Shopify product import.

## Products — `GET /products`

Every SKU with the details needed to map it, for example to create the
channel listing in Browntape. Page with `?after=<next_after>&limit=` (up to 500).

```json
{
  "items": [
    {
      "sku": "MBPS07-Black-S",
      "barcode": null,
      "product_handle": "black",
      "product_title": "Block Color Spandex Full Length Padded One Piece Swimming Costume",
      "variant_title": "Black / S / Polyester-Spandex",
      "options": { "Color": "Black", "Size": "S", "Fabric": "Polyester-Spandex" },
      "product_type": "Swimwears",
      "price": "995.00",
      "mrp": "1899.00",
      "hsn_code": "61124990",
      "weight_grams": 240,
      "taxable": true,
      "status": "active",
      "published": true,
      "quantity": 202,
      "image_url": "https://cdn.shopify.com/...",
      "url_path": "/products/black"
    }
  ],
  "next_after": "MBPS07-Black-S",
  "request_id": "..."
}
```

`price` is the selling price including GST, and `mrp` is the compare-at
price, or the price when there is none.

## Errors

```json
{ "error": { "code": "validation_failed", "message": "...", "details": ["items[3] (SKU-1): ..."] }, "request_id": "..." }
```

| HTTP | code | What to do |
|---|---|---|
| 400 | `invalid_json` | Fix the body |
| 401 | `unauthorized` | Check the key |
| 403 | `forbidden` | The key lacks a scope; ask Megaska |
| 422 | `validation_failed` | Fix the listed items and resend; nothing was applied |
| 500 | `internal_error` | Retry with backoff; nothing was applied |

## Phase 2 draft: orders (to agree with Ginesys)

When checkout moves to the Megaska website, orders need to reach Browntape
for fulfilment. We can do this either way round, depending on what Ginesys
supports for a custom website channel:

**A. Browntape pulls from us** (we would add these endpoints):

- `GET /orders?status=confirmed&updated_after=...`: new paid orders, and
  COD orders after confirmation
- `POST /orders/{id}/status` with `{"status": "packed" | "shipped" | "delivered" | "cancelled" | "returned", "awb": "...", "courier": "..."}`

**B. We push to Browntape**, calling the Ginesys order-create API on each
new order, and Browntape calls us back with status updates.

Questions for Ginesys / Browntape:

1. For a custom website channel, does Browntape pull orders and push stock
   (option A), or does it expect orders to be pushed to it (option B)? Please
   share the API documentation for that channel type.
2. Can Browntape call `POST /inventory` above on every stock change, and
   send a full sync (all SKUs) at least once a day?
3. Does Browntape send each SKU's available quantity (after reservations), or
   its on-hand quantity?
4. Which order fields are required (GSTIN, HSN, payment mode, COD amount,
   shipping split)?
