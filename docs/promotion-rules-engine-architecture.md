# CONFIG-2F.2 Promotion Rules Engine Architecture

## Objective

CONFIG-2F.2 defines the SaaS-ready Promotion Rules Engine architecture for LoopDesk cart drawer, cart page, and future checkout/customer journey touchpoints. This phase is design-only: it does not change storefront runtime behavior, admin behavior, checkout behavior, cart mutation behavior, database schema, or discount enforcement.

The engine replaces the current single-upsell mental model with a reusable `PromotionRule[]` model that separates storefront offer display from Shopify-safe discount enforcement.

## Core principle: display is separate from enforcement

LoopDesk must treat promotion rendering and discount enforcement as separate systems:

- **Offer display:** LoopDesk runtime evaluates public rule metadata against the current cart and decides which offer cards to show in the drawer, cart page, or both.
- **Discount enforcement:** Shopify-safe mechanisms apply actual savings later. The preferred long-term mechanism is a Shopify Discount Function. Discount enforcement is not implemented in CONFIG-2F.2.

This separation lets LoopDesk show compelling offers immediately while avoiding unsafe client-side price assumptions. Display prices are marketing/copy values unless they are backed by a future enforcement mechanism.

## Existing baseline to preserve

The live Megaska bag already has a working single-offer flow with config parsing, cart trigger matching, offer rendering, `/cart/add.js`, and hide-if-already-in-cart behavior. The Promotion Rules Engine should generalize this behavior without changing production runtime during the architecture phase.

## PromotionRule schema

The backend/admin schema should be versioned JSON stored in the existing `ShopModuleConfig.config` pattern under module key `promotion_rules_config`. No new database table is required for the MVP unless later phases need relational querying, analytics, auditing, or cross-rule constraints that JSON cannot safely support.

```ts
type PromotionRulesConfig = {
  schemaVersion: 1;
  enabled: boolean;
  maxVisibleOffers: number;
  conflictStrategy: "priority_first" | "exclusive_group";
  rules: PromotionRule[];
  updatedAt?: string;
  updatedBy?: string;
};

type PromotionRule = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  status: "draft" | "active" | "paused" | "archived";
  adminNotes?: string;
  schedule: PromotionSchedule;
  eligibility: PromotionEligibility;
  reward: PromotionReward;
  display: PromotionDisplay;
  limits: PromotionLimits;
};
```

### Identity

```ts
type PromotionRuleIdentity = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  status: "draft" | "active" | "paused" | "archived";
};
```

- `id` is a stable rule identifier for admin editing and runtime diagnostics. Public runtime can expose a sanitized public rule id when needed, but should not expose private database ids.
- `name` is merchant-facing and not required on the storefront.
- `enabled` is a hard runtime gate.
- `priority` controls display order; lower numbers should sort first unless the admin UI explicitly labels the opposite.
- `status` separates draft/admin lifecycle from the boolean runtime gate.

### Eligibility

Initial trigger types:

```ts
type PromotionEligibility = {
  match: "all" | "any";
  triggers: PromotionTrigger[];
};

type PromotionTrigger =
  | { type: "always" }
  | { type: "cart_contains_product"; productGid: string; variantGids?: string[] }
  | { type: "cart_contains_collection"; collectionGid: string }
  | { type: "cart_contains_product_type"; productType: string }
  | { type: "cart_contains_tag"; tag: string }
  | { type: "cart_subtotal_gte"; amount: number; currencyCode?: string }
  | { type: "cart_quantity_gte"; quantity: number };
```

Future trigger types should be reserved in validation and API design but not exposed until implemented:

- `customer_logged_in`
- `customer_tag`
- `first_order`
- `location_pincode`
- `payment_method`
- `discount_code_present`

Eligibility must rely only on data available to the runtime surface. If a trigger needs private Admin API data, the backend must pre-resolve it into safe public metadata or mark the rule unavailable for storefront matching.

### Reward / offer

Supported offer types in the long-term schema:

```ts
type PromotionReward =
  | OfferProductReward
  | OfferCollectionReward
  | FreeGiftReward
  | FixedPriceOfferReward
  | PercentageDiscountReward
  | FixedAmountDiscountReward;

type OfferProductReward = {
  type: "offer_product";
  productGid: string;
  variantGid: string;
  quantity: number;
  requiresDiscountEnforcement: false;
};

type FixedPriceOfferReward = {
  type: "fixed_price_offer";
  productGid: string;
  variantGid: string;
  quantity: number;
  displayPrice: MoneyDisplay;
  compareAtDisplayPrice?: MoneyDisplay;
  requiresDiscountEnforcement: true;
  enforcement?: DiscountEnforcementReference;
};
```

MVP recommendation:

- Implement `offer_product` first.
- Support fixed display price and compare-at display price as display metadata only.
- Add the selected offer variant to the cart through `/cart/add.js`.
- Do not enforce a real price unless a safe discount-code mechanism already exists for the shop.

### Display

```ts
type PromotionDisplay = {
  heading: string;
  description?: string;
  badge?: string;
  ctaLabel: string;
  imageOverrideUrl?: string;
  offerPriceDisplay?: string;
  comparePriceDisplay?: string;
  placement: "drawer" | "cart_page" | "both";
  hideIfOfferProductAlreadyInCart: boolean;
};
```

Display text must be safe for public storefront exposure and should be normalized server-side. Price display fields are labels, not proof of discount enforcement.

### Limits

```ts
type PromotionLimits = {
  maxQuantityPerCart?: number;
  showOncePerSession?: boolean;
  oneOfferPerRule: true;
  exclusiveGroup?: string;
};
```

Global config owns `maxVisibleOffers`, priority order, and default conflict handling. Each rule can optionally join an `exclusiveGroup`, where only the highest-priority eligible rule in that group is returned.

### Scheduling

```ts
type PromotionSchedule = {
  alwaysActive: boolean;
  startAt?: string;
  endAt?: string;
  timezone?: string;
};
```

Rules are runtime-eligible only when `alwaysActive` is true or the current instant falls between `startAt` and `endAt`. Store timezones should be explicit to avoid merchant confusion when editing schedules.

## Config storage shape

Persist one shop-scoped row:

- `moduleKey`: `promotion_rules_config`
- `enabled`: module-level on/off switch
- `config`: normalized `PromotionRulesConfig`

Example:

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "maxVisibleOffers": 1,
  "conflictStrategy": "priority_first",
  "rules": [
    {
      "id": "rule_starter_cross_sell",
      "name": "Starter Cross-sell",
      "enabled": true,
      "priority": 10,
      "status": "active",
      "schedule": { "alwaysActive": true, "timezone": "Asia/Kolkata" },
      "eligibility": {
        "match": "any",
        "triggers": [
          { "type": "cart_contains_product", "productGid": "gid://shopify/Product/123" }
        ]
      },
      "reward": {
        "type": "offer_product",
        "productGid": "gid://shopify/Product/456",
        "variantGid": "gid://shopify/ProductVariant/789",
        "quantity": 1,
        "requiresDiscountEnforcement": false
      },
      "display": {
        "heading": "Complete your setup",
        "description": "Add this matching item before checkout.",
        "badge": "Recommended",
        "ctaLabel": "Add offer",
        "offerPriceDisplay": "₹499",
        "comparePriceDisplay": "₹999",
        "placement": "both",
        "hideIfOfferProductAlreadyInCart": true
      },
      "limits": {
        "maxQuantityPerCart": 1,
        "showOncePerSession": false,
        "oneOfferPerRule": true
      }
    }
  ]
}
```

## Runtime public shape

The runtime endpoint should project backend config into a safe storefront shape. It should expose enabled, currently valid rules with only matching metadata, display copy, offer product public data, and discount public metadata.

```ts
type PublicPromotionRulesConfig = {
  schemaVersion: 1;
  enabled: boolean;
  maxVisibleOffers: number;
  rules: PublicPromotionRule[];
};

type PublicPromotionRule = {
  publicId: string;
  priority: number;
  eligibility: PromotionEligibility;
  reward: {
    type: "offer_product" | "fixed_price_offer" | "free_gift";
    productId: string;
    variantId: string;
    quantity: number;
    discount?: {
      displayOnly: boolean;
      label?: string;
      codeHint?: string;
    };
  };
  offerProduct: {
    productId: string;
    variantId: string;
    title: string;
    variantTitle?: string;
    imageUrl?: string;
    availableForSale: boolean;
    price?: string;
  };
  display: PromotionDisplay;
  limits: PromotionLimits;
};
```

Do not expose:

- admin-only notes;
- private merchant data;
- future discount-function secrets;
- raw database ids;
- unavailable or invalid product/variant rules;
- inactive, disabled, expired, future, draft, paused, or archived rules.

## Runtime matching algorithm

The reusable matcher signature should be:

```ts
function getEligibleOffers(input: {
  cart: RuntimeCart;
  promotionRules: PublicPromotionRulesConfig;
  placement: "drawer" | "cart_page" | "checkout";
  now: Date;
  sessionState?: PromotionSessionState;
}): EligibleOffer[];
```

Algorithm:

1. Return `[]` when module config is disabled.
2. Start with enabled public rules for the requested placement.
3. Ignore rules that are expired, future-dated, or not always active for `now`.
4. Ignore rules whose offer product or variant is missing, unavailable, or invalid.
5. Evaluate eligibility triggers against the cart using `all`/`any` semantics.
6. Enforce hide-if-already-in-cart by checking offer product and variant against current cart lines.
7. Enforce `maxQuantityPerCart` by checking existing offer quantity.
8. Enforce `showOncePerSession` using session state, if available.
9. Resolve conflicts, including exclusive groups if configured.
10. Sort by `priority` and deterministic tie-breakers such as `publicId`.
11. Cap by global `maxVisibleOffers`.
12. Return display-ready `EligibleOffer[]` with no private fields.

Initial drawer behavior should set `maxVisibleOffers` to `1`, which preserves the current single-best-offer UX while enabling multi-rule configuration behind the scenes.

## Drawer rendering flow

Initial drawer runtime flow:

1. Load LoopDesk runtime config, including public promotion rules.
2. Fetch or receive the current Ajax cart state.
3. Call `getEligibleOffers({ cart, promotionRules, placement: "drawer", now })`.
4. Render the first eligible offer card only.
5. Show heading, description, badge, image, price display, compare price display, and CTA label from the public display shape.
6. On CTA click, add the configured offer variant with `/cart/add.js` and the configured quantity.
7. Reload drawer cart state after the add succeeds.
8. Re-run matching; if `hideIfOfferProductAlreadyInCart` is true, the offer disappears.
9. Do not trigger OTP.
10. Do not open checkout automatically.
11. Do not claim that a discount was applied unless the selected future enforcement path confirms it.

Cart page runtime should use the same matcher with `placement: "cart_page"` and may display more than one offer in a later phase when `maxVisibleOffers > 1` is intentionally enabled.

## Admin UX model

A future admin screen should manage `promotion_rules_config` without introducing new storage in the MVP. Required UX capabilities:

- List promotion rules with name, status, enabled state, priority, schedule, trigger summary, offer summary, and placement.
- Create a rule from a guided form.
- Edit rule identity, eligibility, reward, display, limits, and schedule.
- Enable or disable a rule without deleting it.
- Reorder priority by drag-and-drop or numeric priority.
- Preview eligibility against a sample cart.
- Select trigger product, collection, product type, or tag.
- Select offer product, collection, and variant.
- Configure offer copy and pricing display.
- Warn when display prices are not backed by discount enforcement.
- Warn when a rule references an unavailable product or variant.
- Show future enforcement status as display-only, discount-code-backed, discount-function-backed, or unsupported.

The admin service should normalize and validate saved JSON before persistence. The public runtime projection should be generated server-side rather than trusting merchant-authored JSON directly.

## Discount enforcement roadmap

Discount enforcement is explicitly out of scope for CONFIG-2F.2.

### Option A: Shopify Discount Function

Best long-term SaaS option. A Shopify Discount Function can apply product, order, and shipping discounts in checkout. One function processes one discount but may output savings across product/order/shipping classes, subject to Shopify combination rules. Shopify stores can have a maximum of 25 active discount functions, so LoopDesk should design a consolidated function strategy rather than one function per promotion rule.

Recommended direction:

- Store promotion rule metadata in LoopDesk config.
- Use cart attributes or line item properties only for non-secret, non-authoritative hints.
- Have the Discount Function independently validate cart state and promotion eligibility.
- Keep secrets and enforcement-only IDs out of the public runtime shape.

### Option B: Merchant-created discount code

Useful MVP fallback when a merchant can create and manage discount codes. Shopify added `/cart/update.js` discount support using the `discount` parameter in May 2025, which can support discount-code-based flows from the storefront cart.

Recommended constraints:

- Use only merchant-approved codes.
- Store public code hints separately from private/admin-only mapping.
- Clearly handle combination rules and failure states.
- Do not represent a display price as enforced until the cart confirms the discount code has been accepted.

### Option C: Hidden discounted product

Not recommended except as an emergency merchant workaround. It creates catalog complexity, inventory risks, reporting noise, and accidental discovery risks. If used, it should be explicitly labeled as a merchant workaround and not as the SaaS default.

## Risks and limitations

- **Display/enforcement mismatch:** Display prices can mislead customers if no discount enforcement exists. The UI must label display-only offers carefully.
- **Public data exposure:** Rules must be projected to a safe public shape and must not leak admin notes, secrets, or internal IDs.
- **Cart data limits:** Collection, tag, and product type matching only works when the runtime cart has the required product metadata or the backend pre-resolves it.
- **Scheduling ambiguity:** Timezone handling must be explicit and tested.
- **Conflict complexity:** Multiple eligible offers can compete; the MVP should start with priority-first and one visible offer.
- **Shopify combination rules:** Future discount enforcement can be constrained by Shopify discount combination behavior.
- **Function limits:** The 25 active discount functions limit makes a per-rule function strategy unsuitable for SaaS scale.
- **Ajax discount fallback variability:** Discount-code MVP flows must confirm actual cart state after `/cart/update.js` rather than assuming success.
- **Session-only limits:** `showOncePerSession` is not a durable customer limit and should not be used for enforcement.

## Next implementation phase recommendation

CONFIG-2F.3 should implement the non-enforcing public rules foundation without changing the existing production drawer UX beyond preserving the current single-offer behavior behind the new model:

1. Add typed promotion rule config normalization around `promotion_rules_config`.
2. Add backend projection from admin config to safe public runtime config.
3. Add unit tests for normalization, public redaction, scheduling, and invalid offer filtering.
4. Add a pure runtime matcher with fixture tests for each initial trigger type.
5. Adapt the drawer internally to consume `eligibleOffers` while still showing only the best eligible offer.
6. Keep `/cart/add.js`, hide-if-already-in-cart, no OTP trigger, and no auto-checkout behavior unchanged.
7. Defer discount enforcement and admin CRUD UI to later phases after the matcher and config contract are stable.
