(function () {
  if (window.LoopDeskPromotionPricing) return;
  function plain(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function idTail(v) { return String(v || "").split("/").pop(); }
  function sameId(a, b) { return String(a || "") === String(b || "") || idTail(a) === idTail(b); }
  function valueCents(discount) {
    if (!plain(discount)) return NaN;
    var cents = discount.valueCents || discount.amountCents || discount.fixedPriceCents || discount.fixedAmountCents;
    if (cents !== undefined && cents !== null && cents !== "") return Number(cents);
    var value = Number(discount.value);
    return Number.isFinite(value) ? Math.round(value * 100) : NaN;
  }
  function variantQty(cart, gid) {
    return (cart && Array.isArray(cart.items) ? cart.items : []).reduce(function (sum, item) {
      return sum + (sameId(item && (item.variant_id || item.variant_gid || item.variantGid || item.id), gid) ? Math.max(0, Number(item.quantity) || 0) : 0);
    }, 0);
  }
  function containsProduct(cart, gid) { return (cart && Array.isArray(cart.items) ? cart.items : []).some(function (item) { return sameId(item && (item.product_id || item.product_gid || item.productGid), gid); }); }
  function containsVariant(cart, gid) { return variantQty(cart, gid) > 0; }
  function withoutReward(cart, rewardVariantGid) {
    if (!cart || !Array.isArray(cart.items)) return cart;
    var items = cart.items.filter(function (item) { return !sameId(item && (item.variant_id || item.variant_gid || item.variantGid || item.id), rewardVariantGid); });
    return Object.assign({}, cart, { items: items, item_count: items.reduce(function (sum, item) { return sum + (Number(item.quantity) || 0); }, 0) });
  }
  function triggerMatches(trigger, cart) {
    var type = trigger && trigger.type;
    var value = trigger && (trigger.value || trigger.productGid || trigger.variantGid || trigger.subtotalGte || trigger.quantityGte);
    if (!type || type === "always") return true;
    if (type === "cart_contains_product") return containsProduct(cart, trigger.productGid || value);
    if (type === "cart_contains_variant") return containsVariant(cart, trigger.variantGid || value);
    if (type === "cart_subtotal_gte" || type === "cart_subtotal_min") return Number(cart && cart.total_price || 0) >= Number(trigger.subtotalGte || value || 0);
    if (type === "cart_quantity_gte" || type === "cart_quantity_min") return Number(cart && cart.item_count || 0) >= Number(trigger.quantityGte || value || 0);
    return false;
  }
  function triggersEligible(cart, rule, rewardVariantGid) {
    var eligibility = plain(rule && rule.eligibility) ? rule.eligibility : {};
    var triggers = Array.isArray(eligibility.triggers) && eligibility.triggers.length ? eligibility.triggers : [{ type: "always" }];
    var triggerCart = withoutReward(cart, rewardVariantGid);
    return eligibility.match === "all" ? triggers.every(function (t) { return triggerMatches(t, triggerCart); }) : triggers.some(function (t) { return triggerMatches(t, triggerCart); });
  }
  function resolvePromotionDisplayPricing(input) {
    input = plain(input) ? input : {};
    var rule = plain(input.rule) ? input.rule : {};
    var reward = plain(input.reward) ? input.reward : plain(rule.reward) ? rule.reward : {};
    var discount = plain(input.discount) ? input.discount : plain(reward.discount) ? reward.discount : {};
    var cart = input.cart || { items: [] };
    var rewardVariantGid = String(input.rewardVariantGid || reward.variantGid || "");
    var originalUnit = Math.max(0, Number(input.rewardUnitPrice) || 0);
    var quantity = Math.max(1, Number(input.rewardQuantity) || Number(reward.quantity) || 1);
    var limits = plain(rule.limits) ? rule.limits : {};
    var cap = Math.max(1, Number(input.quantityCap) || Number(limits.maxQuantityPerCart) || quantity);
    var eligibleQuantity = Math.max(0, Math.min(quantity, cap));
    var eligible = Boolean(input.triggerEligible !== undefined ? input.triggerEligible : triggersEligible(cart, rule, rewardVariantGid));
    var promoUnit = null, discountPerUnit = 0, type = null;
    if (eligible && eligibleQuantity > 0 && originalUnit > 0) {
      if (discount.type === "percentage") {
        var pct = Number(discount.value);
        if (Number.isFinite(pct) && pct > 0 && pct <= 100) { promoUnit = Math.max(0, Math.round(originalUnit * (100 - pct) / 100)); type = "percentage"; }
      } else if (discount.type === "fixed_amount") {
        var amt = Math.min(originalUnit, valueCents(discount));
        if (Number.isFinite(amt) && amt > 0) { promoUnit = Math.max(0, originalUnit - amt); type = "fixed_amount"; }
      } else if (discount.type === "fixed_price") {
        var fixed = valueCents(discount);
        if (Number.isFinite(fixed) && fixed >= 0 && fixed < originalUnit) { promoUnit = fixed; type = "fixed_price"; }
      }
      if (promoUnit !== null && promoUnit >= originalUnit) { promoUnit = null; type = null; }
    }
    discountPerUnit = promoUnit === null ? 0 : Math.max(0, originalUnit - promoUnit);
    var label = promoUnit === null ? "" : type === "percentage" ? String(Number(discount.value)) + "% off" : type === "fixed_amount" ? "Offer applied" : "Special price";
    return { isEligible: Boolean(eligible && promoUnit !== null), originalUnitPrice: originalUnit, promotionalUnitPrice: promoUnit, discountPerUnit: discountPerUnit, eligibleQuantity: eligibleQuantity, originalLineTotal: originalUnit * quantity, promotionalLineTotal: promoUnit === null ? null : (promoUnit * eligibleQuantity) + (originalUnit * Math.max(0, quantity - eligibleQuantity)), displayLabel: label, discountType: type, note: promoUnit === null ? null : "Discount applied at checkout" };
  }
  function summarizeCart(cart, rules) {
    var discount = 0;
    (cart && Array.isArray(cart.items) ? cart.items : []).forEach(function (item) {
      (Array.isArray(rules) ? rules : []).some(function (rule) {
        var reward = plain(rule.reward) ? rule.reward : {};
        var gid = reward.variantGid || "";
        if (!sameId(item.variant_id || item.variant_gid || item.variantGid || item.id, gid)) return false;
        var qty = Math.max(1, Number(item.quantity) || 1);
        var unit = Math.round(Number(item.final_line_price || item.original_line_price || item.line_price || 0) / qty);
        var resolved = resolvePromotionDisplayPricing({ cart: cart, rule: rule, rewardVariantGid: gid, rewardUnitPrice: unit, rewardQuantity: qty });
        if (resolved.isEligible) { discount += resolved.discountPerUnit * resolved.eligibleQuantity; return true; }
        return false;
      });
    });
    var subtotal = Number(cart && cart.total_price || 0);
    return { offerDiscount: discount, estimatedAfterOffer: Math.max(0, subtotal - discount) };
  }
  window.LoopDeskPromotionPricing = { resolvePromotionDisplayPricing: resolvePromotionDisplayPricing, summarizeCart: summarizeCart };
})();
