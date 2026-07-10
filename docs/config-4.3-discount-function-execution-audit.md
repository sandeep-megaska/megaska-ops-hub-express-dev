# CONFIG-4.3 — Shopify Discount Function Execution & Publication Audit

Date: 2026-07-10  
Scope: read-only audit of Promotion Rule → compiler → Shopify publisher → automatic app discount → metafield → Rust Discount Function → Shopify pricing allocations.

## Executive conclusion

Shopify is applying `MEGA15` because `MEGA15` is a native Shopify discount code that already exists in Shopify and is being evaluated by Shopify's cart pricing engine. Shopify is **not** applying the LoopDesk ₹300 promotion because the Promotion Rule save path only persists `promotion_rules_config`; it does **not** compile and publish the rule into the automatic app discount/metafield that Shopify Functions read at pricing time.

Primary root cause classification: **Rule not published**.

Evidence:

- The promotion admin save action calls `savePromotionRulesConfig(...)`, logs the save, revalidates the admin route, and redirects. It never calls `compileLoopDeskDiscountFunctionConfig(...)`, `activateLoopDeskDiscountFunction(...)`, `discountAutomaticAppCreate`, or `discountAutomaticAppUpdate`.
- The only server route that invokes the Shopify publisher is `POST /admin/promotion-rules/actions/activate-discount-function`, which separately calls `activateLoopDeskDiscountFunction(...)`.
- The publisher compiles the current database config only when that separate activation route is invoked.
- Therefore, a merchant can save or activate a promotion rule in LoopDesk while Shopify continues to execute the last-published automatic app discount configuration, or no LoopDesk automatic app discount configuration at all.

The Rust Function implementation is capable of producing the expected ₹300 product discount for a fixed-price reward rule when the rule is present in the metafield and the cart contains the configured reward variant. Existing unit tests also prove the relevant negative cases: missing config, malformed config, unsupported trigger, missing reward variant, trigger not satisfied, and variant mismatch all return no discount operations.

## Evidence limitations

This repository checkout does not include runtime secrets (`DATABASE_URL`, Shopify Admin token/client secret, or browser cart cookie). A direct public storefront/app-proxy request from this environment to `megaskastore.myshopify.com` was blocked by a 403 CONNECT tunnel error. Because of that, this audit could not independently fetch the live browser session's `/cart.js` or Shopify Admin GraphQL state. The conclusion above is based on repository evidence and the user-provided observed cart state.

Where the report says "current observed cart," it refers to the observed state supplied in the audit request:

- Raw subtotal: ₹1,990.00
- Shopify `MEGA15`: -₹298.50
- Shopify final total: ₹1,691.50
- Line allocations exposed by Ajax Cart: `MEGA15` -₹90.00 on the reward/snowboard line and `MEGA15` -₹208.50 on the regular line
- No LoopDesk allocation title, code, app key, or amount observed in `/cart.js`

## A — Current observed cart state

Requested fields and observed interpretation:

| Ajax Cart field | Observed value / interpretation |
| --- | --- |
| `original_total_price` | 199000 paise / ₹1,990.00 expected |
| `items_subtotal_price` | 199000 paise / ₹1,990.00 expected |
| `total_discount` | 29850 paise / ₹298.50 expected |
| `total_price` | 169150 paise / ₹1,691.50 expected |
| `items[].original_line_price` | Reward line ₹600.00, regular line ₹1,390.00 expected |
| `items[].final_line_price` | Reward line ₹510.00 after `MEGA15`; regular line ₹1,181.50 after `MEGA15` expected |
| `items[].discounts` | Contains `MEGA15` allocations only, based on observed state |
| `cart_level_discount_applications` | Contains the native Shopify code/app metadata for `MEGA15`; no LoopDesk allocation observed |

Conclusion: no observed allocation title, discount code, app key, or amount belongs to LoopDesk. If the LoopDesk Function had executed successfully, the Ajax Cart should reflect a native Shopify discount allocation or at minimum lower `final_line_price`, `total_discount`, and `total_price` values for the reward line.

## B — Promotion source rule

The expected source rule is the active LoopDesk offer-product rule that presents the snowboard/reward item at ₹300 when the cart also contains the qualifying item.

Expected normalized rule shape for the ₹300 promotion:

| Field | Expected value |
| --- | --- |
| Shop | `megaskastore.myshopify.com` development shop |
| Module enabled | Must be `true` for compilation |
| Rule ID | Unknown from live DB in this checkout; must match the saved `promotion_rules_config.rules[].id` |
| Rule name | Unknown from live DB; expected to be the snowboard/add-on promotion |
| Rule enabled state | Must be `true` |
| Rule status | Must be `active` |
| Trigger type/value | Must be one of the Rust-supported triggers: `always`, `cart_contains_variant`, `cart_subtotal_gte`, or `cart_quantity_gte` |
| Reward variant GID | Must be `gid://shopify/ProductVariant/<cart variant_id>` for the snowboard reward line |
| Reward quantity | Expected `1` |
| Discount type/value | Expected `fixed_price: 300` if the reward original unit price is ₹600 and expected final reward price is ₹300 |
| Priority | Lower number wins because compiler sorts ascending |
| Schedule | Stored but not enforced by the compiler or Function |
| Placement | Presentation-only (`drawer`, `cart_page`, or `both`); not used by Function execution |
| Enforcement flags | `requiresDiscountEnforcement` is stored for admin/display warning; not required by the compiler |

Variant normalization requirement:

| Representation | Required value |
| --- | --- |
| Configured reward variant GID | `gid://shopify/ProductVariant/<numeric_ajax_variant_id>` |
| Actual `/cart.js` `variant_id` | `<numeric_ajax_variant_id>` |
| Function input `merchandise ... ProductVariant.id` | `gid://shopify/ProductVariant/<numeric_ajax_variant_id>` |

A numeric/GID mismatch is fatal: the Rust Function compares exact GID strings for reward matching and trigger matching. A saved numeric ID such as `1234567890` will not match the Function input `gid://shopify/ProductVariant/1234567890`.

## C — Compiler execution

Compiler location: `services/loopdesk/discount-function-config.server.ts`.

The compiler behavior is:

1. Load `promotion_rules_config` with `getPromotionRulesConfig(shopId, shopDomain)`.
2. If the module is disabled, return `{ schemaVersion: 1, enabled: false, rules: [] }`.
3. Include only rules where `rule.enabled === true` and `rule.status === "active"`.
4. Compile only reward discounts of type `fixed_price`, `percentage`, or `fixed_amount`.
5. Require rule ID, reward product GID, reward variant GID, valid trigger, and valid discount value.
6. Sort compiled rules by ascending priority.
7. Return `{ schemaVersion: 1, enabled: rules.length > 0, rules }`.

Expected compiled output for the real ₹300 rule, with live IDs redacted only where unavailable:

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "rules": [
    {
      "id": "<real-rule-id>",
      "enabled": true,
      "priority": <real-priority>,
      "triggerType": "<always|cart_contains_variant|cart_subtotal_gte|cart_quantity_gte>",
      "triggerValue": "<real-trigger-value-or-null-for-always>",
      "rewardProductGid": "gid://shopify/Product/<real-product-id>",
      "rewardVariantGid": "gid://shopify/ProductVariant/<snowboard-variant-id>",
      "quantity": 1,
      "rewardEnforcementType": "fixed_price",
      "fixedPriceAmount": 300
    }
  ]
}
```

Exclusion-branch audit for the real promotion:

| Branch | Pass/fail condition for real promotion | Result |
| --- | --- | --- |
| Module enabled | `promotionConfig.enabled === true` | Must pass; otherwise config disabled |
| Rule enabled | `rule.enabled === true` | Must pass |
| Status active | `rule.status === "active"` | Must pass |
| Supported reward type | `fixed_price`, `percentage`, `fixed_amount` | Pass if expected fixed-price ₹300 rule |
| Valid reward variant GID | Non-empty `rule.reward.variantGid` | Must pass; also must be GID, not numeric |
| Supported trigger in compiler | Any normalized trigger can compile if value valid | Compiler can include more trigger types than Rust supports |
| Supported trigger in Rust | Only `always`, `cart_contains_variant`, `cart_subtotal_gte`, `cart_quantity_gte` | Must pass at runtime |
| Valid discount value | `fixed_price` must be finite; `fixed_amount` > 0; `percentage` 0–100 | Pass for `fixed_price: 300` |
| Schedule | Not evaluated by compiler | No exclusion today |
| Quantity constraints | `quantity` persists; Rust caps to line quantity and positive cap | Pass for quantity `1` |

Answer: the compiler can produce an executable rule for the ₹300 promotion **if** the saved rule is enabled, active, has the snowboard reward variant as a ProductVariant GID, uses a Rust-supported trigger, and has `fixed_price: 300`. The publication gap means that compiled output is not automatically delivered to Shopify on rule save.

## D — Publication trigger

Lifecycle found in code:

```text
Promotion form save
→ savePromotionRules server action
→ getPromotionRulesConfig
→ savePromotionRulesConfig / database upsert
→ revalidate admin page
→ redirect
```

No compiler or publisher call occurs in this path.

Separate activation lifecycle:

```text
POST /admin/promotion-rules/actions/activate-discount-function
→ resolve admin shop
→ activateLoopDeskDiscountFunction
→ validate local WASM artifact
→ compileLoopDeskDiscountFunctionConfig
→ query appDiscountTypes
→ find existing automatic discount by title/function
→ discountAutomaticAppCreate or discountAutomaticAppUpdate
→ write metafield loopdesk.discount_function_config
```

Answer: **Publication requires a separate action**. It is not automatic on promotion save, toggle, pause, archive, or delete.

This makes stale deployed Shopify discount configuration not only possible but expected unless the merchant or admin explicitly invokes the activation route after every rule change.

## E — Shopify automatic app discount lookup

Publisher lookup behavior:

- Queries `appDiscountTypes { functionId title description appKey discountClasses }`.
- Selects a Function type by matching title `LoopDesk Discount Function`, title `LoopDesk Promotions`, description containing `LoopDesk`, or `functionId` containing `loopdesk-discount-function`.
- Queries automatic discounts with `query: title:LoopDesk Promotions`, then chooses the one whose title and function ID match, or falls back to title-only.

Expected automatic discount fields if active:

| Field | Expected value |
| --- | --- |
| Title | `LoopDesk Promotions` |
| Status | `ACTIVE` |
| App discount type | LoopDesk Discount Function |
| Function ID / handle | Shopify Admin `functionId` for deployed `loopdesk-discount-function` |
| Discount classes | Must include `PRODUCT` for product line discounts |
| Combines with | `orderDiscounts: true`, `productDiscounts: true`, `shippingDiscounts: true` |
| Metafield namespace/key | `loopdesk.discount_function_config` |
| Metafield type | `json` |
| Metafield value | JSON string matching the compiler output |

Live Admin GraphQL could not be executed from this checkout due to missing credentials. Therefore, presence/active/duplicated/expired status must be confirmed in Shopify Admin with the query described in the remediation/UAT section. The code currently relies on a title query and only fetches up to 50 nodes, so duplicate LoopDesk automatic discounts can exist without being fully reported by the app UI.

## F — Publisher mutation correctness

Create mutation input:

```json
{
  "automaticAppDiscount": {
    "title": "LoopDesk Promotions",
    "functionId": "<selected functionId>",
    "startsAt": "<current ISO timestamp>",
    "combinesWith": {
      "orderDiscounts": true,
      "productDiscounts": true,
      "shippingDiscounts": true
    },
    "metafields": [
      {
        "namespace": "loopdesk",
        "key": "discount_function_config",
        "type": "json",
        "value": "<JSON.stringify(compiled config)>"
      }
    ]
  }
}
```

Update mutation input:

```json
{
  "id": "<automaticDiscountNode.id>",
  "automaticAppDiscount": {
    "title": "LoopDesk Promotions",
    "functionId": "<selected functionId>",
    "combinesWith": {
      "orderDiscounts": true,
      "productDiscounts": true,
      "shippingDiscounts": true
    },
    "metafields": [
      {
        "namespace": "loopdesk",
        "key": "discount_function_config",
        "type": "json",
        "value": "<JSON.stringify(compiled config)>"
      }
    ]
  }
}
```

Findings:

- The publisher uses `functionId`, not `functionHandle`.
- It sets all `combinesWith` values to `true`.
- It writes the expected metafield namespace/key/type.
- It throws on Shopify `userErrors`; HTTP success alone is not treated as success.
- The update payload includes the metafield and should replace/update the metafield value if Shopify accepts the mutation.
- Because publication is separate, correct mutation semantics do not help until activation is invoked.

## G — Metafield integrity

Three representations that must match:

| Representation | Expected state |
| --- | --- |
| Compiler output | `schemaVersion: 1`, `enabled: true`, one executable fixed-price rule for snowboard variant |
| Publisher mutation value | `JSON.stringify(compilerOutput)` in `loopdesk.discount_function_config` metafield |
| Stored Shopify metafield | Same JSON, type `json`, not double-encoded, same rule ID and variant GID |

Rust compatibility:

- Rust ignores `schemaVersion` because `DiscountConfig` only requires `enabled` and defaults `rules`.
- Rust requires camelCase names via `#[serde(rename_all = "camelCase")]`.
- Rust silently returns no operations when config is missing, empty, malformed, disabled, has unsupported triggers, has unsupported reward types, has missing variant GID, or has invalid values.

Potential integrity failures to check in Admin:

- Missing rule or stale rule ID.
- Top-level `enabled: false`.
- `rules: []`.
- `rewardVariantGid` stored as numeric ID rather than ProductVariant GID.
- Trigger type compiled but unsupported by Rust, such as `cart_contains_product`, `cart_contains_collection`, `cart_contains_product_type`, or `cart_contains_tag`.
- `fixedPriceAmount` missing or not numeric.
- Metafield double-encoded as a JSON string literal rather than a JSON object string.

## H — Function extension deployment identity

Local Function extension:

| Field | Local value |
| --- | --- |
| File | `extensions/loopdesk-discount-function/shopify.extension.toml` |
| API version | `2026-04` |
| Extension name | `LoopDesk Discount Function` |
| Handle | `loopdesk-discount-function` |
| Type | `function` |
| Target | `cart.lines.discounts.generate.run` |
| Input query | `src/cart_lines_discounts_generate_run.graphql` |
| Export | `cart_lines_discounts_generate_run` |
| Build path | `target/wasm32-unknown-unknown/release/loopdesk_discount_function.wasm` |

Potential mismatch:

- `shopify.app.toml` has webhook API version `2026-01`, while the Function extension uses `2026-04`. This is not by itself evidence of failure, but deployed Function identity should be checked in Shopify Admin/CLI.
- The local `shopify.extension.toml` shown in this checkout does not include a committed `uid`. Shopify CLI/deployment metadata may still map the deployed extension, but the audit could not verify live deployment identity without Shopify credentials.
- The activation service selects by Function title/description/functionId heuristics. If duplicate LoopDesk Function app discount types exist, it can select the wrong one.

## I — Function input query

The input query requests the required fields for the currently supported Rust triggers and reward matching:

```graphql
query Input {
  discount {
    discountClasses
    metafield(namespace: "loopdesk", key: "discount_function_config") {
      value
    }
  }
  cart {
    lines {
      id
      quantity
      cost { subtotalAmount { amount } }
      merchandise {
        __typename
        ... on ProductVariant { id }
      }
    }
  }
}
```

Supported data coverage:

| Need | Present? |
| --- | --- |
| Discount classes | Yes |
| Config metafield | Yes |
| Cart line ID | Yes, though Rust currently targets variants, not line IDs |
| Quantity | Yes |
| Line subtotal | Yes |
| ProductVariant GID | Yes |
| Product ID / collection / tag / type | No |
| Cart aggregate subtotal / quantity | Derived from line subtotals/quantities |

If the real rule uses `cart_contains_product`, `cart_contains_collection`, `cart_contains_product_type`, or `cart_contains_tag`, the compiler may publish it but the Rust Function will filter it out because the Function only supports `always`, `cart_contains_variant`, `cart_subtotal_gte`, and `cart_quantity_gte`.

## J — Rust deserialization compatibility

| Compiler JSON field | Rust field | Type | Compatible? |
| --- | --- | --- | --- |
| `enabled` | `DiscountConfig.enabled` | `bool` | Yes |
| `rules` | `DiscountConfig.rules` | `Vec<Rule>` default empty | Yes |
| `id` | `Rule.id` | `String` | Yes |
| `priority` | `Rule.priority` | `i64` default 0 | Yes |
| `triggerType` | `Rule.trigger_type` | `String` via camelCase serde | Yes |
| `triggerValue` | `Rule.trigger_value` | `Option<TriggerValue>` string or number | Yes |
| `rewardVariantGid` | `Rule.reward_variant_gid` | `Option<String>` | Yes if ProductVariant GID |
| `quantity` | `Rule.quantity` | `Option<i64>` | Yes |
| `rewardEnforcementType` | `Rule.reward_enforcement_type` | `String` | Yes for `fixed_price`, `percentage`, `fixed_amount` |
| `fixedPriceAmount` | `Rule.fixed_price_amount` | `Option<f64>` | Yes |
| `percentageValue` | `Rule.percentage_value` | `Option<f64>` | Yes, 0–100 |
| `fixedAmountValue` | `Rule.fixed_amount_value` | `Option<f64>` | Yes, > 0 |
| `rewardProductGid` | No Rust field | Ignored | Compatible but unused |
| `schemaVersion` | No Rust field | Ignored | Compatible but not validated |

Invalid configuration causes silent no-op behavior: `parse_config` returns an empty rule list and the Function returns `operations: []`.

## K — Rust execution simulation

Command run:

```bash
cargo test --manifest-path extensions/loopdesk-discount-function/Cargo.toml
```

Result: 15 tests passed.

Existing tests cover these required scenarios:

| Scenario | Covered by test | Result |
| --- | --- | --- |
| LoopDesk promotion only | `fixed_price_applies_only_to_capped_reward_line` | Generates one fixed-amount-per-item candidate |
| Trigger not satisfied | `reward_without_trigger_does_not_apply` | No operations |
| Reward variant absent | `trigger_without_reward_does_not_apply` | No operations |
| Reward variant ID mismatch | `no_matching_reward_variant_is_ignored` | No operations |
| Config missing / malformed / disabled | `disabled_and_malformed_config_produce_no_rules` | No rules / no operations |
| Unsupported trigger | `unsupported_non_variant_triggers_are_ignored` | No rules / no operations |
| Duplicate reward variant | `multiple_rules_do_not_double_discount_same_reward_variant` | First priority candidate only |

Real-cart simulation by code path:

Input fixture:

```text
Cart lines:
- Reward snowboard: ProductVariant GID = gid://shopify/ProductVariant/<snowboard>, subtotal ₹600, quantity 1
- Other item: ProductVariant GID = gid://shopify/ProductVariant/<trigger-or-other>, subtotal ₹1,390, quantity 1

Compiled rule:
- enabled true
- trigger satisfied
- rewardVariantGid = gid://shopify/ProductVariant/<snowboard>
- rewardEnforcementType fixed_price
- fixedPriceAmount 300
- quantity 1
```

Expected Function candidate:

```json
{
  "productDiscountsAdd": {
    "selectionStrategy": "FIRST",
    "candidates": [
      {
        "targets": [
          {
            "productVariant": {
              "id": "gid://shopify/ProductVariant/<snowboard>",
              "quantity": 1
            }
          }
        ],
        "message": "LoopDesk reward",
        "value": {
          "fixedAmount": {
            "amount": 300,
            "appliesToEachItem": true
          }
        },
        "associatedDiscountCode": null
      }
    ]
  }
}
```

Reasoning: unit price is ₹600; fixed price is ₹300; the Function computes `unit_price - fixed_price_amount`, yielding ₹300 off per item.

## L — Trigger correctness for the real rule

The rule should apply if all of the following are true:

1. The published Shopify metafield contains the rule.
2. Top-level config is `enabled: true`.
3. Rule `enabled` is `true`.
4. Trigger type is supported by Rust.
5. Trigger value is present unless trigger is `always`.
6. The cart satisfies the trigger.
7. The reward line is already in the cart.
8. The reward line ProductVariant GID exactly equals `rewardVariantGid`.
9. Quantity cap is greater than zero or omitted; for quantity 1, one item is eligible.
10. No earlier priority rule has already discounted the same reward variant.

No code removes the reward line before evaluating triggers. For subtotal and quantity triggers, the Function includes all ProductVariant cart lines, including the reward line. For `cart_contains_variant`, the Function can use the reward variant itself as trigger if configured that way.

The exact conditional that prevents the observed Shopify application is upstream of this Function eligibility path: the current Promotion Rule save lifecycle does not publish the compiled rule to Shopify, so Shopify has no current LoopDesk rule/metafield to execute.

## M — Discount operation validity

The generated output uses the current Discount Function operation shape for product discounts:

- Operation: `productDiscountsAdd`.
- Candidate target: `productVariant` with ProductVariant GID and optional quantity.
- Fixed amount value: `fixedAmount.amount`, rounded to two decimals.
- `appliesToEachItem: true`, matching the one-item ₹300-off use case.
- `selectionStrategy: FIRST`, which chooses the first candidate inside this Function operation.
- Empty candidate handling: returns `operations: []`.

One implementation concern: the Function currently requests but does not check `discount.discountClasses`. Shopify's Discount Function docs state a Function should only return operations for discount classes configured for the discount. If the automatic app discount was created without PRODUCT class, Shopify could reject or ignore product operations. The publisher's mutation in this repo does not explicitly set `discountClasses`; it relies on the selected app discount type/classes. This must be verified in Admin.

## N — Discount combination behavior

Publisher intent is to combine with all discount classes:

```json
{
  "orderDiscounts": true,
  "productDiscounts": true,
  "shippingDiscounts": true
}
```

Shopify platform notes from official documentation:

- Shopify Discount Functions can apply discounts to cart lines, order subtotals, and shipping rates. Source: https://shopify.dev/docs/apps/build/discounts/build-discount-function?extension=javascript
- Function input queries provide the data that is supplied to the Function export. Source: https://shopify.dev/docs/apps/build/discounts/build-discount-function?extension=javascript
- Shopify advises Functions to return operations only for the discount classes configured for that discount. Source: https://shopify.dev/docs/apps/build/discounts/build-discount-function?extension=javascript
- Shopify Help documents discount combinations as the platform mechanism for controlling whether product, order, and shipping discounts can combine. Source: https://help.shopify.com/en/manual/discounts/discount-combinations

Assessment for `MEGA15`:

- Observed Ajax Cart line allocations show `MEGA15` applied proportionally to both lines. That is consistent with Shopify-native discount execution.
- The LoopDesk Function outputs a product discount candidate against the snowboard ProductVariant.
- `selectionStrategy: FIRST` affects candidates inside the LoopDesk Function output; it does not by itself authorize or block external `MEGA15` stacking.
- Whether `MEGA15` and LoopDesk can both reduce the same line depends on the actual Shopify discount classes and combination settings stored on both discounts. The code attempts to set LoopDesk combines-with flags to true, but the live Admin state and `MEGA15` settings must be verified.

Combination behavior is not the primary root cause here because no LoopDesk allocation appears at all and the publication lifecycle shows the rule is not automatically published.

## O — Deployment and runtime logs

Available local evidence:

- `cargo test --manifest-path extensions/loopdesk-discount-function/Cargo.toml` passed.
- No Shopify CLI runtime logs were available in this checkout.
- Live Function invocation logs could not be accessed without Shopify Admin/CLI credentials.

Do not infer that the Function was invoked merely because an automatic app discount may exist. The closest reproducible simulation is the Rust test suite and the code-path analysis above.

## P — Root-cause classification

Primary category: **Rule not published**.

Evidence-backed reason: the promotion save/update lifecycle persists LoopDesk config but does not invoke the compiler/publisher/Shopify mutation. Shopify therefore evaluates `MEGA15`, which exists natively in Shopify, but does not evaluate the newly saved LoopDesk ₹300 promotion as a native allocation because the promotion rule has not been published into the automatic app discount metafield that the Rust Function reads.

Secondary contributing risks:

1. **Published configuration stale**: a previous activation may have left Shopify with old/metafield-empty config.
2. **Compiler/Function trigger mismatch**: compiler can emit trigger types the Rust Function intentionally ignores.
3. **Reward variant mismatch**: numeric IDs or wrong variant GIDs silently yield no candidate.
4. **Deployment/version mismatch**: activation selects Function type heuristically and live deployment identity was not verified.
5. **Discount class mismatch**: publisher does not explicitly set discount classes in mutation input; live PRODUCT class must be confirmed.

## Q — Concrete remediation plan (do not implement in this audit)

Smallest correct production fix:

1. Add a publication synchronization step after any promotion rule mutation.
   - File: `app/admin/promotion-rules/page.tsx`
   - Behavior: after `savePromotionRulesConfig(...)` succeeds, invoke the same activation/publish service or enqueue a background publish job for the resolved shop.
   - Requirement: save, toggle, pause, archive, and delete must all sync Shopify, because each can change the native monetary authority.
2. Keep publisher logic centralized.
   - File: `services/loopdesk/discount-function-activation.server.ts`
   - Behavior: expose an idempotent publish function that compiles current config and updates/creates the automatic app discount.
3. Harden trigger compatibility.
   - File: `services/loopdesk/discount-function-config.server.ts`
   - Behavior: either exclude Rust-unsupported triggers from compiled config with diagnostics, or implement those triggers in the Function input/query/Rust logic.
4. Harden variant normalization.
   - Files: promotion save/resource picker/compiler.
   - Behavior: ensure reward and trigger variants are stored as `gid://shopify/ProductVariant/...` before compilation.
5. Harden publisher selection and reporting.
   - File: `services/loopdesk/discount-function-activation.server.ts`
   - Behavior: query all LoopDesk automatic app discounts, detect duplicates, verify expected function app discount type, persist diagnostics, and include full Shopify `userErrors`.
6. Migration for existing installed shops.
   - Run a one-time publish job for every active installed shop with enabled promotion rules.
   - For shops with duplicate `LoopDesk Promotions` automatic app discounts, disable/archive duplicates after manual review.
7. Tests.
   - Add unit tests that promotion save calls/enqueues publish for upsert/toggle/pause/archive/delete.
   - Add compiler tests for unsupported trigger exclusion or support.
   - Add publisher tests for create/update metafield replacement and userErrors surfacing.
   - Add Function tests for the exact ₹600 → ₹300 real-cart fixture.
8. Deployment steps.
   - Build and deploy the Function extension with Shopify CLI.
   - Deploy the Next.js app.
   - Run the one-time activation/publish migration.
9. UAT steps.
   - Use a newly created Shopify code, not the legacy hard-coded adapter.
   - Verify `/cart.js` native allocations after every test below.
10. Rollback strategy.
   - Disable automatic publish-on-save feature flag if introduced.
   - Re-run activation with last-known-good config or disable the LoopDesk automatic app discount in Shopify Admin.
   - Keep Cart Drawer/Express Checkout monetary display anchored to Shopify totals; do not reintroduce local compensation.

## Required UAT plan after remediation

Use a newly created Shopify code; do not rely on the legacy hard-coded adapter.

### Test 1 — LoopDesk only

Expected:

```text
Subtotal                 ₹1,990.00
LoopDesk discount         -₹300.00
Final                     ₹1,690.00
```

`/cart.js` must contain the native LoopDesk line allocation or otherwise reflect native Shopify Function execution in `final_line_price`, `total_discount`, and `total_price`.

### Test 2 — Shopify code only

With `MEGA15` and no LoopDesk rule:

```text
Subtotal                 ₹1,990.00
MEGA15                    -₹298.50
Final                     ₹1,691.50
```

### Test 3 — Combined

Expected values must be Shopify-authoritative. Target business expectation:

```text
Subtotal                 ₹1,990.00
LoopDesk                  -₹300.00
Coupon on eligible base   -₹253.50
Final                     ₹1,436.50
```

Do not force this through app math. Confirm Shopify's native combination result and document any product/order stacking limitations.

### Test 4 — Remove coupon

LoopDesk allocation remains:

```text
Final                     ₹1,690.00
```

### Test 5 — Remove reward line

LoopDesk allocation disappears.

### Test 6 — Rule paused

Shopify native LoopDesk allocation disappears after publication sync.

## Final answer to the incident question

Shopify applied `MEGA15` because it is a native Shopify discount code in the cart pricing engine. Shopify did not apply the LoopDesk ₹300 promotion because the LoopDesk Promotion Rule save path does not publish the compiled rule to Shopify's automatic app discount/metafield. Without that published metafield configuration, the Rust Discount Function has no current executable LoopDesk rule to return a product discount candidate, so `/cart.js` shows only the native `MEGA15` allocations and no LoopDesk allocation.
