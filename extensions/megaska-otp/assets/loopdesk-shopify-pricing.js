(function (root) {
  function currencyOf(raw, fallback) {
    var value = raw && (raw.currency || raw.currencyCode || (raw.cost && raw.cost.totalAmount && raw.cost.totalAmount.currencyCode));
    return String(value || fallback || "INR").trim().toUpperCase();
  }
  function minor(amount, currency, available) {
    if (available === undefined) available = true;
    if (amount === null || amount === undefined || amount === "") return { amount: null, currencyCode: currency, available: false };
    if (typeof amount === "number" && isFinite(amount)) return { amount: amount, currencyCode: currency, available: available };
    var parsed = Number(amount);
    return isFinite(parsed) ? { amount: Math.round(parsed * 100), currencyCode: currency, available: available } : { amount: null, currencyCode: currency, available: false };
  }
  function unavailable(currency) { return { amount: null, currencyCode: currency, available: false }; }
  function titleOf(allocation) { return allocation && (allocation.title || (allocation.discount_application && allocation.discount_application.title) || (allocation.discountApplication && (allocation.discountApplication.title || allocation.discountApplication.code))) || null; }
  function codeOf(allocation) { return allocation && (allocation.code || (allocation.discount_application && allocation.discount_application.code) || (allocation.discountApplication && allocation.discountApplication.code)) || null; }
  function allocationAmount(allocation, currency) {
    if (allocation && allocation.amountSet && allocation.amountSet.shopMoney && allocation.amountSet.shopMoney.amount !== undefined) return minor(allocation.amountSet.shopMoney.amount, allocation.amountSet.shopMoney.currencyCode || currency);
    if (allocation && allocation.discountedAmount && allocation.discountedAmount.amount !== undefined) return minor(allocation.discountedAmount.amount, allocation.discountedAmount.currencyCode || currency);
    return minor(allocation && allocation.amount, currency);
  }
  function normalizeAllocation(allocation, currency, targetType, lineKey) {
    return {
      targetType: targetType,
      lineKey: lineKey,
      title: titleOf(allocation),
      code: codeOf(allocation),
      appKey: allocation && ((allocation.discount_application && allocation.discount_application.app_key) || (allocation.discountApplication && allocation.discountApplication.appKey)) || null,
      amount: allocationAmount(allocation, currency),
      sourceRawType: allocation && (allocation.type || (allocation.discount_application && allocation.discount_application.type) || (allocation.discountApplication && allocation.discountApplication.__typename)) || null
    };
  }
  function fixMoney(money, currency) { return money && money.currencyCode && money.currencyCode !== currency ? Object.assign({}, money, { currencyCode: currency }) : money; }
  function normalizeAjaxCartPricing(rawCart, options) {
    rawCart = rawCart || {};
    var currency = currencyOf(rawCart);
    var lines = Array.isArray(rawCart.items) ? rawCart.items.map(function (item) {
      var key = item && item.key ? String(item.key) : null;
      var allocations = Array.isArray(item && item.discounts) ? item.discounts.map(function (discount) { return normalizeAllocation(discount, currency, "line", key); }) : null;
      return {
        id: item && item.id !== undefined ? item.id : null,
        key: key,
        variantId: item && item.variant_id !== undefined ? item.variant_id : null,
        productId: item && item.product_id !== undefined ? item.product_id : null,
        quantity: Number(item && item.quantity || 0),
        title: item && (item.title || item.product_title) || null,
        originalTotal: minor(item && item.original_line_price, currency),
        discountedTotal: minor(item && item.discounted_price !== undefined && item.quantity !== undefined ? Number(item.discounted_price) * Number(item.quantity) : item && item.final_line_price, currency),
        finalLineTotal: minor(item && item.final_line_price, currency),
        discountAllocations: allocations
      };
    }) : [];
    var allAllocations = [];
    lines.forEach(function (line) { if (line.discountAllocations) allAllocations = allAllocations.concat(line.discountAllocations); });
    var discountCodes = Array.isArray(rawCart.cart_level_discount_applications) ? rawCart.cart_level_discount_applications.map(function (app) { return { code: String(app && (app.code || app.title) || ""), applicable: null }; }).filter(function (entry) { return entry.code; }) : null;
    var model = {
      cartIdentity: { token: rawCart.token || null, cartId: null, sourceIdentity: rawCart.token || null },
      currency: currency,
      lines: lines,
      originalSubtotal: minor(rawCart.original_total_price !== undefined && rawCart.original_total_price !== null ? rawCart.original_total_price : rawCart.items_subtotal_price, currency),
      discountedSubtotal: minor(rawCart.items_subtotal_price, currency),
      totalDiscount: minor(rawCart.total_discount, currency),
      finalTotal: minor(rawCart.total_price, currency),
      shipping: unavailable(currency),
      tax: unavailable(currency),
      discountCodes: discountCodes,
      discountAllocations: allAllocations.length ? allAllocations : null,
      sourceType: "ajax-cart",
      fetchedAt: options && options.fetchedAt || new Date().toISOString(),
      authoritative: true,
      rawCapabilities: { originalSubtotal: true, discountedSubtotal: true, finalTotal: true, perLineOriginalTotal: true, perLineDiscountedTotal: true, lineDiscountAllocations: true, cartDiscountAllocations: false, discountCodeApplicability: false, loopDeskAppDiscountAttribution: false }
    };
    model.originalSubtotal = fixMoney(model.originalSubtotal, currency);
    model.discountedSubtotal = fixMoney(model.discountedSubtotal, currency);
    model.totalDiscount = fixMoney(model.totalDiscount, currency);
    model.finalTotal = fixMoney(model.finalTotal, currency);
    model.lines = model.lines.map(function (line) { return Object.assign({}, line, { originalTotal: fixMoney(line.originalTotal, currency), discountedTotal: fixMoney(line.discountedTotal, currency), finalLineTotal: fixMoney(line.finalLineTotal, currency), discountAllocations: line.discountAllocations ? line.discountAllocations.map(function (a) { return Object.assign({}, a, { amount: fixMoney(a.amount, currency) }); }) : null }); });
    model.discountAllocations = model.discountAllocations ? model.discountAllocations.map(function (a) { return Object.assign({}, a, { amount: fixMoney(a.amount, currency) }); }) : null;
    return model;
  }
  root.LoopDeskShopifyPricing = Object.assign({}, root.LoopDeskShopifyPricing || {}, { normalizeAjaxCartPricing: normalizeAjaxCartPricing });
})(typeof window !== "undefined" ? window : globalThis);
