(function () {
  const API_BASE_URL = "https://megaska-ops-hub-exs1.vercel.app";
  const SESSION_STORAGE_KEY = "megaska_session_token";
  const MODAL_ID = "mk-exchange-modal-layer";


  const ACTIVE_STATUSES = [
    "OPEN",
    "AWAITING_PAYMENT",
    "PAYMENT_RECEIVED",
    "APPROVED",
    "PICKUP_PENDING",
    "PICKUP_SCHEDULED",
    "PICKUP_COMPLETED",
    "ITEM_RECEIVED",
    "REPLACEMENT_PROCESSING",
    "REPLACEMENT_SHIPPED",
  ];

  const STATUS_DESCRIPTIONS = {
    OPEN: "Request received",
    AWAITING_PAYMENT: "Under review",
    PAYMENT_RECEIVED: "Approved for exchange",
    APPROVED: "Approved for exchange",
    PICKUP_PENDING: "Reverse pickup pending",
    PICKUP_SCHEDULED: "Reverse pickup scheduled",
    PICKUP_COMPLETED: "Pickup completed",
    ITEM_RECEIVED: "Item received at warehouse",
    REPLACEMENT_PROCESSING: "Replacement being processed",
    REPLACEMENT_SHIPPED: "Replacement shipped",
    CLOSED: "Exchange completed",
    REJECTED: "Request rejected",
  };



  const CANCELLATION_BLOCKING_STATUSES = ["OPEN", "APPROVED", "CLOSED"];

  const CANCELLATION_STATUS_DESCRIPTIONS = {
    OPEN: "Cancellation request received",
    APPROVED: "Cancellation approved",
    REJECTED: "Cancellation request rejected",
    CLOSED: "Cancellation request closed",
  };

  const ISSUE_BLOCKING_STATUSES = ["OPEN", "AWAITING_PAYMENT", "PICKUP_PENDING", "PAYMENT_RECEIVED", "APPROVED"];
  const ISSUE_STATUS_DESCRIPTIONS = {
    OPEN: "Issue request received",
    AWAITING_PAYMENT: "Under review",
    PICKUP_PENDING: "Need more information",
    PAYMENT_RECEIVED: "Approved for exchange",
    APPROVED: "Approved for refund",
    REJECTED: "Issue request rejected",
    CLOSED: "Issue request closed",
  };
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function injectStyles() {
    if (document.getElementById("mk-exchange-modal-styles")) return;
    const style = document.createElement("style");
    style.id = "mk-exchange-modal-styles";
    style.textContent = `
      .mk-ex-modal-layer { position: fixed; inset: 0; z-index: 10020; display: none; }
      .mk-ex-modal-layer.open { display: block; }
      .mk-ex-modal-overlay { position: absolute; inset: 0; background: rgba(17,24,39,.5); }
      .mk-ex-modal { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: min(520px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; background: #fffaf7; border: 1px solid #f1e7df; border-radius: 18px; padding: 16px; box-shadow: 0 20px 50px rgba(17,24,39,.25); }
      .mk-ex-modal h3 { margin: 0 0 10px; font-size: 18px; }
      .mk-ex-modal p { margin: 0; }
      .mk-ex-row { margin-top: 10px; display: grid; gap: 6px; }
      .mk-ex-label { font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .03em; }
      .mk-ex-input, .mk-ex-textarea { width: 100%; box-sizing: border-box; border: 1px solid #eadfd7; border-radius: 12px; background: #fff; padding: 10px 12px; font: inherit; }
      .mk-ex-textarea { min-height: 80px; resize: vertical; }
      .mk-ex-error { margin-top: 10px; color: #b91c1c; font-size: 13px; }
      .mk-ex-muted { color: #6b7280; font-size: 13px; }
      .mk-ex-success { margin-top: 10px; border: 1px solid #d9f1e4; background: #f5fcf8; border-radius: 12px; padding: 10px; display: grid; gap: 6px; }
      .mk-ex-actions { margin-top: 14px; display: flex; gap: 10px; justify-content: flex-end; }
      .mk-ex-btn { border: 1px solid #eadfd7; border-radius: 12px; background: #fff; color: #1f2937; padding: 10px 14px; font-weight: 600; cursor: pointer; text-decoration: none; }
      .mk-ex-btn.primary { background: #e85d75; border-color: #e85d75; color: #fff; }
      .mk-ex-btn:disabled { opacity: .7; cursor: not-allowed; }
      @media (max-width: 640px) { .mk-ex-modal { top: 10px; transform: translateX(-50%); max-height: calc(100vh - 20px); border-radius: 14px; } }
    `;
    document.head.appendChild(style);
  }

  async function getSessionToken() {
    try {
      if (window.MegaskaAuth) {
        if (typeof window.MegaskaAuth.getSessionToken === "function") {
          const token = await window.MegaskaAuth.getSessionToken();
          if (token) return token;
        }
        if (typeof window.MegaskaAuth.getToken === "function") {
          const token = await window.MegaskaAuth.getToken();
          if (token) return token;
        }
      }
    } catch {}

    try {
      return localStorage.getItem(SESSION_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  function normalizeFulfillmentStatus(value) {
    const status = String(value || "")
      .trim()
      .toLowerCase();

    if (!status) return null;
    if (status === "unfulfilled") return "UNFULFILLED";
    if (status === "fulfilled") return "FULFILLED";
    if (status === "delivered") return "DELIVERED";
    if (status === "partial" || status === "partially fulfilled" || status === "partially_fulfilled") return "PARTIAL";
    return null;
  }

  function normalizeDeliveredAt(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  function readFirstValue(values) {
    for (const value of values) {
      const text = String(value || "").trim();
      if (text) return text;
    }
    return "";
  }

  function getDataValue(node, key) {
    if (!node || !key) return "";
    const camel = key.replace(/-([a-z])/g, function (_, char) {
      return char.toUpperCase();
    });
    return String((node.dataset && node.dataset[camel]) || node.getAttribute("data-" + key) || "").trim();
  }

  function findStructuredOrderSource(drawer, sourceButton) {
    if (sourceButton && sourceButton.closest) {
      const candidate = sourceButton.closest("[data-shopify-order-id], [data-order-number]");
      if (candidate) return candidate;
    }

    const fromDrawer = drawer.querySelector(
      "[data-shopify-order-id], [data-order-number], [data-order-id], .megaska-dashboard-list-item"
    );
    return fromDrawer || drawer;
  }

  function getDrawerOrderContext(sourceButton) {
    const drawer = document.getElementById("mk-order-drawer");
    if (!drawer) return null;
    const structuredSource = findStructuredOrderSource(drawer, sourceButton);

    const productTitle = drawer.querySelector(".mk-order-hero-name")?.textContent?.trim() || "";
    const metaText = drawer.querySelector(".mk-order-hero-meta")?.textContent?.trim() || "";
    const orderNumber =
      readFirstValue([
        getDataValue(sourceButton, "order-number"),
        getDataValue(structuredSource, "order-number"),
        getDataValue(drawer, "order-number"),
      ]) ||
      metaText.split("•")[0]?.trim() ||
      "";
    const statusText = readFirstValue([
      getDataValue(sourceButton, "order-fulfillment-status"),
      getDataValue(sourceButton, "fulfillment-status"),
      getDataValue(drawer, "order-fulfillment-status"),
      getDataValue(drawer, "fulfillment-status"),
      getDataValue(drawer.querySelector("[data-order-fulfillment-status]"), "order-fulfillment-status"),
    ]);
    const deliveredAt = readFirstValue([
      getDataValue(sourceButton, "order-delivered-at"),
      getDataValue(sourceButton, "delivered-at"),
      getDataValue(structuredSource, "order-delivered-at"),
      getDataValue(structuredSource, "delivered-at"),
      getDataValue(drawer, "order-delivered-at"),
      getDataValue(drawer, "delivered-at"),
      getDataValue(drawer.querySelector("[data-order-delivered-at]"), "order-delivered-at"),
    ]);

    const metaLower = metaText.toLowerCase();
    const inferredStatus = statusText
      ? statusText
      : metaLower.includes("delivered")
        ? "delivered"
        : metaLower.includes("fulfilled")
          ? "fulfilled"
          : metaLower.includes("unfulfilled")
            ? "unfulfilled"
            : "";

    return {
      orderNumber,
      productTitle:
        readFirstValue([
          getDataValue(sourceButton, "item-title"),
          getDataValue(structuredSource, "item-title"),
          productTitle,
        ]) || "",
      currentSize: "",
      variantTitle: readFirstValue([
        getDataValue(sourceButton, "variant-title"),
        getDataValue(structuredSource, "variant-title"),
      ]),
      sku: readFirstValue([getDataValue(sourceButton, "sku"), getDataValue(structuredSource, "sku")]),
      shopifyOrderId: readFirstValue([
        getDataValue(sourceButton, "shopify-order-id"),
        getDataValue(structuredSource, "shopify-order-id"),
        getDataValue(sourceButton, "order-id"),
        getDataValue(structuredSource, "order-id"),
      ]),
      shopifyLineItemId: readFirstValue([
        getDataValue(sourceButton, "shopify-line-item-id"),
        getDataValue(structuredSource, "shopify-line-item-id"),
        getDataValue(sourceButton, "line-item-id"),
        getDataValue(structuredSource, "line-item-id"),
      ]),
      displayMeta: metaText,
      deliveredAt: normalizeDeliveredAt(deliveredAt),
      fulfilledAt: normalizeDeliveredAt(readFirstValue([
        getDataValue(sourceButton, "order-fulfilled-at"),
        getDataValue(structuredSource, "order-fulfilled-at"),
        getDataValue(drawer, "order-fulfilled-at"),
      ])),
      fulfillmentStatus: normalizeFulfillmentStatus(inferredStatus),
      financialStatus: readFirstValue([
        getDataValue(sourceButton, "order-financial-status"),
        getDataValue(structuredSource, "order-financial-status"),
        getDataValue(drawer, "order-financial-status"),
      ]),
      paymentGatewayName: readFirstValue([
        getDataValue(sourceButton, "payment-gateway-name"),
        getDataValue(structuredSource, "payment-gateway-name"),
        getDataValue(drawer, "payment-gateway-name"),
      ]),
    };
  }



  function normalizeStatusValue(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isCancellationEligible(context) {
    const fulfillmentStatus = normalizeStatusValue(context?.fulfillmentStatus);
    const financialStatus = normalizeStatusValue(context?.financialStatus);

    if (["void", "cancel", "refunded"].some(function (keyword) { return financialStatus.includes(keyword); })) {
      return { eligible: false, reason: "Order is already cancelled." };
    }

    if (["fulfilled", "delivered", "shipped", "in transit", "out for delivery", "ready for pickup", "label printed", "partial"].some(function (keyword) { return fulfillmentStatus.includes(keyword); })) {
      return { eligible: false, reason: "Cancellation not possible — order already shipped." };
    }

    return { eligible: true, reason: "Eligible" };
  }

  function getBlockingCancellationMessage(requestStatus) {
    const status = String(requestStatus || "").trim().toUpperCase();
    return status === "CLOSED" ? "Cancelled" : "Cancellation Requested";
  }
  function closeModal() {
    const layer = document.getElementById(MODAL_ID);
    if (layer) {
      layer.classList.remove("open");
      layer.remove();
    }
  }

  function renderModal(context) {
    closeModal();
    injectStyles();

    const layer = document.createElement("div");
    layer.id = MODAL_ID;
    layer.className = "mk-ex-modal-layer open";
    layer.innerHTML = `
      <div class="mk-ex-modal-overlay" data-mk-ex-close="1"></div>
      <div class="mk-ex-modal" role="dialog" aria-modal="true" aria-label="Exchange request">
        <h3>Exchange request</h3>
        <p class="mk-ex-muted">Tell us the size you need and any useful details.</p>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Item</label>
          <input class="mk-ex-input" id="mk-ex-product" value="${escapeHtml(context.productTitle || "")}" readonly />
        </div>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Current size (if available)</label>
          <input class="mk-ex-input" id="mk-ex-current-size" value="${escapeHtml(context.currentSize || "")}" placeholder="e.g. M" />
        </div>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Requested size</label>
          <input class="mk-ex-input" id="mk-ex-requested-size" placeholder="e.g. L" />
        </div>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Reason / note</label>
          <textarea class="mk-ex-textarea" id="mk-ex-reason" placeholder="Tell us the size you need and any useful details."></textarea>
        </div>

        <div class="mk-ex-error" id="mk-ex-error" style="display:none"></div>
        <div id="mk-ex-success" style="display:none"></div>

        <div class="mk-ex-actions" id="mk-ex-form-actions">
          <button class="mk-ex-btn" type="button" data-mk-ex-close="1">Cancel</button>
          <button class="mk-ex-btn primary" type="button" id="mk-ex-submit">Submit Exchange Request</button>
        </div>
      </div>
    `;

    document.body.appendChild(layer);

    layer.addEventListener("click", function (event) {
      const target = event.target;
      if (target && target.getAttribute && target.getAttribute("data-mk-ex-close") === "1") {
        closeModal();
      }
    });

    const submitBtn = document.getElementById("mk-ex-submit");
    if (submitBtn) {
      submitBtn.addEventListener("click", function () {
        submitExchange(context);
      });
    }
  }

  function setSubmittingState(isSubmitting) {
    const submitBtn = document.getElementById("mk-ex-submit") || document.getElementById("mk-cancel-submit") || document.getElementById("mk-issue-submit");
    if (!submitBtn) return;
    submitBtn.disabled = isSubmitting;
    submitBtn.textContent = isSubmitting
      ? "Submitting..."
      : (submitBtn.id === "mk-cancel-submit"
        ? "Submit Cancellation Request"
        : (submitBtn.id === "mk-issue-submit" ? "Submit Issue Request" : "Submit Exchange Request"));
  }

  function showError(message) {
    const node = document.getElementById("mk-ex-error");
    if (!node) return;
    node.style.display = "block";
    node.textContent = message;
  }

  function clearError() {
    const node = document.getElementById("mk-ex-error");
    if (!node) return;
    node.style.display = "none";
    node.textContent = "";
  }

  function renderSuccess(request, stockReviewMessage) {
    const success = document.getElementById("mk-ex-success");
    const actions = document.getElementById("mk-ex-form-actions");
    if (!success || !actions) return;

    success.style.display = "block";
    success.className = "mk-ex-success";
    success.innerHTML = `
      <strong>Exchange request created</strong>
      <div>Request ID: ${escapeHtml(request?.id || "—")}</div>
      <div>Request status: ${escapeHtml(request?.status || "OPEN")}</div>
      <div>Reverse pickup fee: ₹120</div>
      <div>Payment: Manual support follow-up</div>
      <div class="mk-ex-muted">Payment for reverse pickup is currently handled manually. Our support team will share the payment instructions or next steps after reviewing your request.</div>
      <div class="mk-ex-muted">Forward shipping for the replacement item will be free once the exchange is approved.</div>
      <div class="mk-ex-muted">${escapeHtml(stockReviewMessage || "Exchange approval depends on the availability of the requested size.")}</div>
      <div class="mk-ex-muted">If the requested size is unavailable, our team will contact you with the next steps.</div>
    `;

    actions.innerHTML = '<button class="mk-ex-btn" type="button" data-mk-ex-close="1">Close</button>';
  }



  function renderCancellationSuccess(request) {
    const success = document.getElementById("mk-ex-success");
    const actions = document.getElementById("mk-ex-form-actions");
    if (!success || !actions) return;

    success.style.display = "block";
    success.className = "mk-ex-success";
    success.innerHTML = `
      <strong>Cancellation request created</strong>
      <div>Request ID: ${escapeHtml(request?.id || "—")}</div>
      <div>Request status: ${escapeHtml(request?.status || "OPEN")}</div>
      <div class="mk-ex-muted">Our operations team will review this request and update you shortly.</div>
    `;

    actions.innerHTML = '<button class="mk-ex-btn" type="button" data-mk-ex-close="1">Close</button>';
  }

  function renderIssueSuccess(request) {
    const success = document.getElementById("mk-ex-success");
    const actions = document.getElementById("mk-ex-form-actions");
    if (!success || !actions) return;

    success.style.display = "block";
    success.className = "mk-ex-success";
    success.innerHTML = `
      <strong>Issue request created</strong>
      <div>Request ID: ${escapeHtml(request?.id || "—")}</div>
      <div>Request status: ${escapeHtml(request?.status || "OPEN")}</div>
      <div class="mk-ex-muted">This is an exception workflow and will be reviewed by operations.</div>
      <div class="mk-ex-muted">No return is auto-approved. We may ask for more evidence.</div>
    `;

    actions.innerHTML = '<button class="mk-ex-btn" type="button" data-mk-ex-close="1">Close</button>';
  }
  function toCustomerSafeError(message) {
    const text = String(message || "").trim();
    if (!text) return "Exchange request creation failed. Please try again.";

    if (
      text.includes("Exchange can be requested only after the order has been delivered") ||
      text.includes("Exchange requests cannot be processed more than") ||
      text.includes("Requested size is required") ||
      text.includes("Current size and requested size are identical") ||
      text.includes("already have an open exchange request") ||
      text.includes("An exchange request already exists for this order")
    ) {
      return text;
    }

    return "Exchange request creation failed. Please try again.";
  }

  function findExistingActiveRequest(requests, context) {
    if (!Array.isArray(requests)) return null;
    return (
      requests.find(function (req) {
        if (!ACTIVE_STATUSES.includes(String(req?.status || ""))) return false;
        if (String(req?.orderNumber || "").trim() !== String(context.orderNumber || "").trim()) return false;
        const items = Array.isArray(req?.items) ? req.items : [];
        if (!items.length) return true;
        if (context.shopifyLineItemId) {
          return items.some(function (item) {
            return String(item?.shopifyLineItemId || "").trim() === String(context.shopifyLineItemId || "").trim();
          });
        }
        return items.some(function (item) {
          return String(item?.productTitle || "").trim().toLowerCase() === String(context.productTitle || "").trim().toLowerCase();
        });
      }) || null
    );
  }

  function renderExistingRequestStatus(request) {
    const success = document.getElementById("mk-ex-success");
    const actions = document.getElementById("mk-ex-form-actions");
    if (!success || !actions) return;

    success.style.display = "block";
    success.className = "mk-ex-success";

    const status = String(request?.status || "OPEN");
    const stockReview = String(request?.items?.[0]?.eligibilitySnapshot?.stockReviewMessage || "").trim();

    success.innerHTML = `
      <strong>Exchange request already exists</strong>
      <div>Request ID: ${escapeHtml(request?.id || "—")}</div>
      <div>Current status: ${escapeHtml(status)}</div>
      <div>${escapeHtml(STATUS_DESCRIPTIONS[status] || "Status updated")}</div>
      <div class="mk-ex-muted">Payment: Manual support follow-up (if applicable)</div>
      ${stockReview ? `<div class="mk-ex-muted">${escapeHtml(stockReview)}</div>` : ""}
    `;

    actions.innerHTML = '<button class="mk-ex-btn" type="button" data-mk-ex-close="1">Close</button>';
  }

  async function submitExchange(context) {
    clearError();
    const requestedSize = document.getElementById("mk-ex-requested-size")?.value?.trim() || "";
    const reason = document.getElementById("mk-ex-reason")?.value?.trim() || "";
    const currentSize = document.getElementById("mk-ex-current-size")?.value?.trim() || "";

    if (!context.orderNumber || !context.productTitle) {
      showError("Order details are missing. Please close and reopen this order.");
      return;
    }

    if (!requestedSize) {
      showError("Requested size is required.");
      return;
    }

    const token = await getSessionToken();
    if (!token) {
      showError("Session expired. Please login again.");
      return;
    }

    try {
      setSubmittingState(true);

      const createResponse = await fetch(API_BASE_URL + "/api/requests/exchange", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          orderNumber: context.orderNumber,
          productTitle: context.productTitle,
          currentSize: currentSize || null,
          requestedSize,
          reason: reason || "Size exchange requested",
          customerNote: reason || null,
          shopifyOrderId: context.shopifyOrderId || null,
          shopifyLineItemId: context.shopifyLineItemId || null,
          variantTitle: context.variantTitle || null,
          sku: context.sku || null,
          deliveredAt: context.deliveredAt || null,
          fulfilledAt: context.fulfilledAt || null,
          fulfillmentStatus: context.fulfillmentStatus || null,
          quantity: 1,
        }),
      });

      const createData = await createResponse.json().catch(function () {
        return {};
      });

      if (!createResponse.ok || !createData?.request?.id) {
        throw new Error(toCustomerSafeError(createData?.error || ""));
      }

      renderSuccess(createData.request, createData.stockReviewMessage);
    } catch (error) {
      showError(toCustomerSafeError(error instanceof Error ? error.message : ""));
    } finally {
      setSubmittingState(false);
    }
  }



  function renderCancellationModal(context) {
    closeModal();
    injectStyles();

    const layer = document.createElement("div");
    layer.id = MODAL_ID;
    layer.className = "mk-ex-modal-layer open";
    layer.innerHTML = `
      <div class="mk-ex-modal-overlay" data-mk-ex-close="1"></div>
      <div class="mk-ex-modal" role="dialog" aria-modal="true" aria-label="Cancellation request">
        <h3>Cancel order</h3>
        <p class="mk-ex-muted">Cancellation is allowed only before dispatch/shipment.</p>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Order</label>
          <input class="mk-ex-input" value="${escapeHtml(context.orderNumber || "")}" readonly />
        </div>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Reason</label>
          <input class="mk-ex-input" id="mk-cancel-reason" placeholder="e.g. Ordered by mistake" />
        </div>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Optional note</label>
          <textarea class="mk-ex-textarea" id="mk-cancel-note" placeholder="Add any useful detail"></textarea>
        </div>

        <div class="mk-ex-error" id="mk-ex-error" style="display:none"></div>
        <div id="mk-ex-success" style="display:none"></div>

        <div class="mk-ex-actions" id="mk-ex-form-actions">
          <button class="mk-ex-btn" type="button" data-mk-ex-close="1">Back</button>
          <button class="mk-ex-btn primary" type="button" id="mk-cancel-submit">Submit Cancellation Request</button>
        </div>
      </div>
    `;

    document.body.appendChild(layer);

    layer.addEventListener("click", function (event) {
      const target = event.target;
      if (target && target.getAttribute && target.getAttribute("data-mk-ex-close") === "1") {
        closeModal();
      }
    });

    const submitBtn = document.getElementById("mk-cancel-submit");
    if (submitBtn) {
      submitBtn.addEventListener("click", function () {
        submitCancellation(context);
      });
    }
  }

  function findExistingActiveCancellation(requests, context) {
    if (!Array.isArray(requests)) return null;
    return (
      requests.find(function (req) {
        if (!CANCELLATION_BLOCKING_STATUSES.includes(String(req?.status || ""))) return false;
        return String(req?.orderNumber || "").trim() === String(context.orderNumber || "").trim();
      }) || null
    );
  }

  function renderExistingCancellationStatus(request) {
    const success = document.getElementById("mk-ex-success");
    const actions = document.getElementById("mk-ex-form-actions");
    if (!success || !actions) return;

    const status = String(request?.status || "OPEN");
    success.style.display = "block";
    success.className = "mk-ex-success";
    success.innerHTML = `
      <strong>${escapeHtml(getBlockingCancellationMessage(status))}</strong>
      <div>Request ID: ${escapeHtml(request?.id || "—")}</div>
      <div>Current status: ${escapeHtml(status)}</div>
      <div>${escapeHtml(CANCELLATION_STATUS_DESCRIPTIONS[status] || "Status updated")}</div>
    `;

    actions.innerHTML = '<button class="mk-ex-btn" type="button" data-mk-ex-close="1">Close</button>';
  }

  function findExistingActiveIssue(requests, context) {
    if (!Array.isArray(requests)) return null;
    return (
      requests.find(function (req) {
        if (!ISSUE_BLOCKING_STATUSES.includes(String(req?.status || ""))) return false;
        return String(req?.orderNumber || "").trim() === String(context.orderNumber || "").trim();
      }) || null
    );
  }

  function renderExistingIssueStatus(request) {
    const success = document.getElementById("mk-ex-success");
    const actions = document.getElementById("mk-ex-form-actions");
    if (!success || !actions) return;

    const status = String(request?.status || "OPEN");
    success.style.display = "block";
    success.className = "mk-ex-success";
    success.innerHTML = `
      <strong>Issue request already exists</strong>
      <div>Request ID: ${escapeHtml(request?.id || "—")}</div>
      <div>Current status: ${escapeHtml(status)}</div>
      <div>${escapeHtml(ISSUE_STATUS_DESCRIPTIONS[status] || "Status updated")}</div>
    `;

    actions.innerHTML = '<button class="mk-ex-btn" type="button" data-mk-ex-close="1">Close</button>';
  }

  function renderIssueModal(context) {
    closeModal();
    injectStyles();

    const layer = document.createElement("div");
    layer.id = MODAL_ID;
    layer.className = "mk-ex-modal-layer open";
    layer.innerHTML = `
      <div class="mk-ex-modal-overlay" data-mk-ex-close="1"></div>
      <div class="mk-ex-modal" role="dialog" aria-modal="true" aria-label="Issue request">
        <h3>Report issue</h3>
        <p class="mk-ex-muted">This is for damaged/wrong/quality exceptions only. Normal returns are not supported.</p>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Order</label>
          <input class="mk-ex-input" value="${escapeHtml(context.orderNumber || "")}" readonly />
        </div>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Item</label>
          <input class="mk-ex-input" value="${escapeHtml(context.productTitle || "")}" readonly />
        </div>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Issue reason</label>
          <select class="mk-ex-input" id="mk-issue-reason">
            <option value="">Select reason</option>
            <option value="WRONG_ITEM">Wrong item received</option>
            <option value="DAMAGED_ITEM">Damaged item</option>
            <option value="QUALITY_ISSUE">Quality issue</option>
            <option value="OTHER_EXCEPTION">Other approved exception</option>
          </select>
        </div>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Description</label>
          <textarea class="mk-ex-textarea" id="mk-issue-note" placeholder="Share short issue details."></textarea>
        </div>

        <div class="mk-ex-row">
          <label><input type="checkbox" id="mk-issue-unused" /> I confirm item is unused.</label>
          <label><input type="checkbox" id="mk-issue-unwashed" /> I confirm item is unwashed.</label>
          <label><input type="checkbox" id="mk-issue-tags" /> I confirm tags are intact.</label>
          <label><input type="checkbox" id="mk-issue-window" /> I confirm request is within 2 days of delivery.</label>
        </div>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Image proof URL(s) (optional, comma-separated)</label>
          <input class="mk-ex-input" id="mk-issue-image-urls" placeholder="https://... , https://..." />
        </div>

        <div class="mk-ex-row">
          <label class="mk-ex-label">Video/unboxing proof URL(s) (optional, comma-separated)</label>
          <input class="mk-ex-input" id="mk-issue-video-urls" placeholder="https://... , https://..." />
        </div>

        <div class="mk-ex-error" id="mk-ex-error" style="display:none"></div>
        <div id="mk-ex-success" style="display:none"></div>

        <div class="mk-ex-actions" id="mk-ex-form-actions">
          <button class="mk-ex-btn" type="button" data-mk-ex-close="1">Back</button>
          <button class="mk-ex-btn primary" type="button" id="mk-issue-submit">Submit Issue Request</button>
        </div>
      </div>
    `;

    document.body.appendChild(layer);

    layer.addEventListener("click", function (event) {
      const target = event.target;
      if (target && target.getAttribute && target.getAttribute("data-mk-ex-close") === "1") {
        closeModal();
      }
    });

    const submitBtn = document.getElementById("mk-issue-submit");
    if (submitBtn) {
      submitBtn.addEventListener("click", function () {
        submitIssue(context);
      });
    }
  }

  function splitUrls(raw) {
    return String(raw || "")
      .split(",")
      .map(function (value) { return value.trim(); })
      .filter(Boolean)
      .slice(0, 8);
  }

  async function submitIssue(context) {
    clearError();
    const reason = document.getElementById("mk-issue-reason")?.value?.trim() || "";
    const customerNote = document.getElementById("mk-issue-note")?.value?.trim() || "";
    const declaredUnused = Boolean(document.getElementById("mk-issue-unused")?.checked);
    const declaredUnwashed = Boolean(document.getElementById("mk-issue-unwashed")?.checked);
    const declaredTagsIntact = Boolean(document.getElementById("mk-issue-tags")?.checked);
    const declaredWithinWindow = Boolean(document.getElementById("mk-issue-window")?.checked);
    const imageEvidenceUrls = splitUrls(document.getElementById("mk-issue-image-urls")?.value);
    const videoEvidenceUrls = splitUrls(document.getElementById("mk-issue-video-urls")?.value);

    if (!context.orderNumber || !context.productTitle) {
      showError("Order details are missing. Please close and reopen this order.");
      return;
    }
    if (!reason) {
      showError("Issue reason is required.");
      return;
    }
    if (!declaredUnused || !declaredUnwashed || !declaredTagsIntact || !declaredWithinWindow) {
      showError("All policy declarations are required for issue requests.");
      return;
    }

    const token = await getSessionToken();
    if (!token) {
      showError("Session expired. Please login again.");
      return;
    }

    try {
      setSubmittingState(true);
      const createResponse = await fetch(API_BASE_URL + "/api/requests/issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          orderNumber: context.orderNumber,
          shopifyOrderId: context.shopifyOrderId || null,
          shopifyLineItemId: context.shopifyLineItemId || null,
          productTitle: context.productTitle,
          variantTitle: context.variantTitle || null,
          reason,
          customerNote: customerNote || null,
          deliveredAt: context.deliveredAt || null,
          fulfilledAt: context.fulfilledAt || null,
          fulfillmentStatus: context.fulfillmentStatus || null,
          paymentGatewayName: context.paymentGatewayName || null,
          declaredUnused,
          declaredUnwashed,
          declaredTagsIntact,
          imageEvidenceUrls,
          videoEvidenceUrls,
        }),
      });

      const data = await createResponse.json().catch(function () { return {}; });
      if (!createResponse.ok || !data?.request?.id) {
        throw new Error(String(data?.error || "Issue request creation failed. Please try again."));
      }

      renderIssueSuccess(data.request);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Issue request creation failed. Please try again.");
    } finally {
      setSubmittingState(false);
    }
  }

  async function submitCancellation(context) {
    clearError();

    const reason = document.getElementById("mk-cancel-reason")?.value?.trim() || "";
    const customerNote = document.getElementById("mk-cancel-note")?.value?.trim() || "";

    if (!context.orderNumber) {
      showError("Order details are missing. Please close and reopen this order.");
      return;
    }

    const eligibility = isCancellationEligible(context);
    if (!eligibility.eligible) {
      showError(eligibility.reason);
      return;
    }

    if (!reason) {
      showError("Cancellation reason is required.");
      return;
    }

    const token = await getSessionToken();
    if (!token) {
      showError("Session expired. Please login again.");
      return;
    }

    try {
      setSubmittingState(true);

      const createResponse = await fetch(API_BASE_URL + "/api/requests/cancellation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          orderNumber: context.orderNumber,
          shopifyOrderId: context.shopifyOrderId || null,
          fulfillmentStatus: context.fulfillmentStatus || null,
          financialStatus: context.financialStatus || null,
          reason,
          customerNote: customerNote || null,
        }),
      });

      const data = await createResponse.json().catch(function () {
        return {};
      });

      if (!createResponse.ok || !data?.request?.id) {
        throw new Error(String(data?.error || "Cancellation request creation failed. Please try again."));
      }

      renderCancellationSuccess(data.request);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Cancellation request creation failed. Please try again.");
    } finally {
      setSubmittingState(false);
    }
  }

  function looksLikeCancellationButton(button) {
    if (!button || !button.querySelector) return false;
    const title = button.querySelector("strong")?.textContent?.trim()?.toLowerCase() || "";
    return title === "cancel order" || title === "cancel" || button.getAttribute("data-order-action") === "cancellation";
  }
  function looksLikeExchangeButton(button) {
    if (!button || !button.querySelector) return false;
    const title = button.querySelector("strong")?.textContent?.trim()?.toLowerCase() || "";
    return title === "exchange" || button.getAttribute("data-order-action") === "exchange";
  }
  function looksLikeIssueButton(button) {
    if (!button || !button.querySelector) return false;
    const title = button.querySelector("strong")?.textContent?.trim()?.toLowerCase() || "";
    return (
      title === "report issue" ||
      title === "report issue / return request" ||
      button.getAttribute("data-order-action") === "issue" ||
      button.getAttribute("data-order-action") === "report-issue"
    );
  }

  function bindExchangeHook() {
    document.addEventListener("click", function (event) {
      const button = event.target && event.target.closest ? event.target.closest(".mk-order-action-item") : null;
      if (!button) return;
      const isExchangeAction = looksLikeExchangeButton(button);
      const isCancellationAction = looksLikeCancellationButton(button);
      const isIssueAction = looksLikeIssueButton(button);
      if (!isExchangeAction && !isCancellationAction && !isIssueAction) return;
      event.preventDefault();

      const context = getDrawerOrderContext(button);
      if (!context) return;

      if (isCancellationAction) {
        const cancellationEligibility = isCancellationEligible(context);
        if (!cancellationEligibility.eligible) {
          renderCancellationModal(context);
          showError(cancellationEligibility.reason);
          const actions = document.getElementById("mk-ex-form-actions");
          if (actions) {
            actions.innerHTML = '<button class="mk-ex-btn" type="button" data-mk-ex-close="1">Close</button>';
          }
          return;
        }

        renderCancellationModal(context);
      } else if (isIssueAction) {
        renderIssueModal(context);
      } else {
        renderModal(context);
      }

      (async function () {
        try {
          const token = await getSessionToken();
          if (!token) return;

          const endpoint = isCancellationAction
            ? "/api/requests/cancellation"
            : (isIssueAction ? "/api/requests/issue" : "/api/requests/exchange");
          const response = await fetch(API_BASE_URL + endpoint, {
            headers: {
              Authorization: "Bearer " + token,
            },
          });
          const data = await response.json().catch(function () {
            return {};
          });
          if (!response.ok) return;

          if (isCancellationAction) {
            const existingCancellation = findExistingActiveCancellation(data?.requests, context);
            if (existingCancellation) {
              renderExistingCancellationStatus(existingCancellation);
            }
            return;
          }

          if (isIssueAction) {
            const existingIssue = findExistingActiveIssue(data?.requests, context);
            if (existingIssue) {
              renderExistingIssueStatus(existingIssue);
            }
            return;
          }

          const existing = findExistingActiveRequest(data?.requests, context);
          if (existing) {
            renderExistingRequestStatus(existing);
          }
        } catch {}
      })();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        const layer = document.getElementById(MODAL_ID);
        if (layer) closeModal();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindExchangeHook);
  } else {
    bindExchangeHook();
  }
})();
