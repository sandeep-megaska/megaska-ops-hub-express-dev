# LoopD2C payment customization — hide COD for prepaid carts

Hides **Cash on Delivery** at Shopify Checkout when the cart drawer marked the
cart `loopd2c_payment_intent = prepaid`. This is the enabler for the modal-free
architecture: **both** prepaid and COD complete natively in Shopify Checkout, so
we can retire the custom COD modal (and its unpaid-draft-order pattern that
carries app-rejection risk).

Works on **non-Plus** stores because it ships in our public app and COD is a
manual payment method (non-Plus stores may hide/reorder/rename manual methods).

## How it fits the existing functions

| Function | Reads | Does |
|---|---|---|
| `loopdesk-discount-function` | `loopd2c_payment_intent` + prepaid-offer metafield | applies the prepaid discount on prepaid carts |
| `megaska-phone-checkout-validation` | verified-phone attrs | enforces verified phone / blocks COD-at-checkout leaks |
| **this** | `loopd2c_payment_intent` | **hides COD on prepaid carts** |

All three read the same `loopd2c_payment_intent` cart attribute — the payment
function does NOT need to detect the applied discount (which its input can't see);
it reads the intent the drawer already stamped.

## Finishing the extension shell (one-time — needs the Shopify CLI)

This folder holds the **function logic** (`src/*.js`), the **input query**
(`src/*.graphql`) and **tests**. The extension **shell** — `shopify.extension.toml`
with a CLI-registered `uid`, and the generated `schema.graphql` for the
`cart.payment-methods.transform.run` target — must be created with the CLI (it
can't be authored by hand):

```bash
shopify app generate extension --template payment_customization --name loopd2c-payment-customization
```

Then:
1. Replace the generated sample `src/run.*` with `src/cart_payment_methods_transform_run.js`
   and `.graphql` from here (or point the toml `input_query` / `export` at these files).
2. `shopify app function schema` to fetch `schema.graphql`.
3. **Verify the hide-operation field name** against the generated schema. This code
   uses `paymentMethodHide: { paymentMethodId }` (the `cart.payment-methods.transform.run`
   convention). If your API version names it `hide: { paymentMethodId }`, change the
   one `.map(...)` line in `src/cart_payment_methods_transform_run.js` accordingly.
4. `shopify app deploy`.

## Tests

```bash
node --test extensions/loopd2c-payment-customization/tests/
```
