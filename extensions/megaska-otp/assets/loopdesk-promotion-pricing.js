(function (root) {
  "use strict";

  var TYPES = { PRODUCT: "PRODUCT_PROMOTION", ORDER: "ORDER_PROMOTION", COUPON: "COUPON", SHIPPING: "SHIPPING_DISCOUNT", MANUAL: "MANUAL_DISCOUNT", UNKNOWN: "UNKNOWN" };
  var WARNINGS = { INCOMPLETE: "pricing_breakdown_incomplete", MISMATCH: "pricing_total_mismatch", UNCLASSIFIED: "pricing_unclassified_discount" };

  function amount(value) { var number = Number(value); return Number.isFinite(number) && number > 0 ? Math.round(number) : 0; }
  function applications(cart) { return Array.isArray(cart && cart.cart_level_discount_applications) ? cart.cart_level_discount_applications : []; }
  function codes(cart) {
    var result = [];
    (Array.isArray(cart && cart.discount_codes) ? cart.discount_codes : []).forEach(function (entry) { var code = typeof entry === "string" ? entry : entry && entry.code; if (code) result.push(String(code).toUpperCase()); });
    applications(cart).forEach(function (entry) { if (String(entry && entry.type || "").toLowerCase() === "discount_code") { var code = entry.code || entry.title; if (code) result.push(String(code).toUpperCase()); } });
    return result.filter(function (code, index) { return result.indexOf(code) === index; });
  }
  function allocationAmount(allocation) { return amount(allocation && (allocation.amount || allocation.discounted_amount || allocation.discountedAmount && allocation.discountedAmount.amount)); }
  function allocationCode(allocation, knownCodes) {
    var code = allocation && (allocation.code || allocation.discount_application && allocation.discount_application.code || allocation.discountApplication && allocation.discountApplication.code);
    if (code) return String(code).toUpperCase();
    var title = String(allocation && (allocation.title || allocation.discount_application && allocation.discount_application.title) || "").toUpperCase();
    return knownCodes.indexOf(title) >= 0 ? title : null;
  }
  function application(allocation) { return allocation && (allocation.discount_application || allocation.discountApplication) || {}; }
  function classify(allocation, item, knownCodes) {
    var app = application(allocation);
    var raw = String(allocation && (allocation.type || app.type) || "").toLowerCase();
    var code = allocationCode(allocation, knownCodes);
    if (code || raw === "discount_code") return TYPES.COUPON;
    var targetType = String(app.target_type || app.targetType || "").toLowerCase();
    if (raw.indexOf("shipping") >= 0 || targetType.indexOf("shipping") >= 0) return TYPES.SHIPPING;
    if (raw.indexOf("manual") >= 0) return TYPES.MANUAL;
    // An order-wide automatic discount (e.g. a tiered % off the whole order) is
    // spread across every line: target_selection "all" or allocation_method
    // "across". Detect it BEFORE the product-line marker so the order tier's
    // share that Shopify allocates onto a product-offer line is attributed to the
    // order discount instead of being double-counted as a product saving.
    var target = String(app.target_selection || app.targetSelection || "").toLowerCase();
    var method = String(app.allocation_method || app.allocationMethod || "").toLowerCase();
    if (target === "all" || method === "across") return TYPES.ORDER;
    var properties = item && item.properties || {};
    if (properties._loopdesk_promotion_rule_id || properties._loopdesk_promotion_compilation_version) return TYPES.PRODUCT;
    if (target === "explicit" || target === "entitled") return TYPES.PRODUCT;
    return TYPES.UNKNOWN;
  }
  function appliedDiscounts(cart) {
    var knownCodes = codes(cart), discounts = [];
    (Array.isArray(cart && cart.items) ? cart.items : []).forEach(function (item) {
      var allocations = Array.isArray(item && item.discount_allocations) ? item.discount_allocations : Array.isArray(item && item.discounts) ? item.discounts : [];
      allocations.forEach(function (allocation) {
        var type = classify(allocation, item, knownCodes), code = allocationCode(allocation, knownCodes);
        discounts.push({ type: type, title: String(allocation && (allocation.title || allocation.discount_application && allocation.discount_application.title) || code || "Discount"), amount: allocationAmount(allocation), source: "SHOPIFY", automatic: !code, code: code });
      });
    });
    return discounts;
  }
  function sumType(discounts, type) { return discounts.reduce(function (sum, discount) { return sum + (discount.type === type ? discount.amount : 0); }, 0); }
  function build(cart) {
    cart = cart || {};
    var merchandise = amount(cart.original_total_price);
    if (!merchandise && Number(cart.original_total_price) !== 0) merchandise = amount(cart.items_subtotal_price || cart.total_price);
    var finalPayable = Math.max(0, Number.isFinite(Number(cart.total_price)) ? Math.round(Number(cart.total_price)) : merchandise);
    var shopifySavings = amount(cart.total_discount);
    if (!shopifySavings && merchandise > finalPayable) shopifySavings = merchandise - finalPayable;
    var discounts = appliedDiscounts(cart), allocated = discounts.reduce(function (sum, discount) { return sum + discount.amount; }, 0), warnings = [];
    if (allocated !== shopifySavings) warnings.push(WARNINGS.INCOMPLETE);
    if (merchandise !== finalPayable + shopifySavings) warnings.push(WARNINGS.MISMATCH);
    if (discounts.some(function (discount) { return discount.type === TYPES.UNKNOWN; })) warnings.push(WARNINGS.UNCLASSIFIED);
    var splitReliable = allocated === shopifySavings && !warnings.includes(WARNINGS.UNCLASSIFIED);
    return {
      currencyCode: String(cart.currency || "INR").toUpperCase(), merchandiseSubtotal: merchandise, qualifyingSubtotal: merchandise,
      productPromotionSavings: splitReliable ? sumType(discounts, TYPES.PRODUCT) : 0,
      orderPromotionSavings: splitReliable ? sumType(discounts, TYPES.ORDER) : 0,
      couponSavings: splitReliable ? sumType(discounts, TYPES.COUPON) : 0,
      shippingSavings: splitReliable ? sumType(discounts, TYPES.SHIPPING) : 0,
      totalSavings: shopifySavings, finalPayableSubtotal: finalPayable, appliedDiscounts: discounts,
      pricingAuthority: "SHOPIFY", isAuthoritative: Number.isFinite(Number(cart.total_price)), isEstimated: !Number.isFinite(Number(cart.total_price)),
      breakdownComplete: splitReliable, warnings: warnings, cartIdentity: String(cart.token || ""), cartFingerprint: fingerprint(cart)
    };
  }
  function fingerprint(cart) { return [cart && cart.token || "", cart && cart.item_count || 0, cart && cart.original_total_price || 0, cart && cart.total_discount || 0, cart && cart.total_price || 0, codes(cart).join(",")].join(":"); }
  function combinationStatus(settings, left, right) {
    if (!settings || typeof settings !== "object") return "NOT_VERIFIED";
    if (left === TYPES.ORDER && right === TYPES.ORDER) return "CANNOT_COMBINE";
    var productPair = left === TYPES.PRODUCT || right === TYPES.PRODUCT;
    var orderPair = left === TYPES.ORDER || right === TYPES.ORDER;
    if (productPair && orderPair) return settings.productDiscounts === true ? "CAN_COMBINE" : settings.productDiscounts === false ? "CANNOT_COMBINE" : "NOT_VERIFIED";
    if ((left === TYPES.COUPON || right === TYPES.COUPON) && orderPair) return settings.orderDiscounts === true ? "CAN_COMBINE" : settings.orderDiscounts === false ? "CANNOT_COMBINE" : "NOT_VERIFIED";
    if ((left === TYPES.SHIPPING || right === TYPES.SHIPPING)) return settings.shippingDiscounts === true ? "CAN_COMBINE" : settings.shippingDiscounts === false ? "CANNOT_COMBINE" : "NOT_VERIFIED";
    return "NOT_VERIFIED";
  }
  root.LoopDeskPromotionPricing = { build: build, fingerprint: fingerprint, combinationStatus: combinationStatus, TYPES: TYPES, WARNINGS: WARNINGS };
})(typeof window !== "undefined" ? window : globalThis);
