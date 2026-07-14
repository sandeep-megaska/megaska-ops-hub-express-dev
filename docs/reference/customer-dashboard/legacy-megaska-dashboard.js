(function () {
  const ROOT_ID = "megaska-account-app";
  const API_BASE_URL = "https://megaska-ops-hub-exs1.vercel.app";
  const API_URL = API_BASE_URL + "/api/dashboard/summary";
  const SESSION_STORAGE_KEY = "megaska_session_token";
  const ORDER_DRAWER_ID = "mk-order-drawer";
  let currentOrders = [];
  let selectedOrderIndex = -1;
  let escapeListenerBound = false;

function normalizeShopDomain(input) {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function isMyShopifyDomain(value) {
  return /\.myshopify\.com$/i.test(String(value || "").trim());
}

function getCurrentShopDomain() {
  const fromMegaskaAuth =
    window?.MegaskaAuth &&
    typeof window.MegaskaAuth.getCurrentShopDomain === "function"
      ? normalizeShopDomain(window.MegaskaAuth.getCurrentShopDomain())
      : "";

  if (isMyShopifyDomain(fromMegaskaAuth)) {
    return fromMegaskaAuth;
  }

  const candidates = [
    window?.MEGASKA_SHOP_DOMAIN,
    window?.Shopify?.shop,
    document?.documentElement?.getAttribute?.("data-shop-domain"),
    document?.body?.getAttribute?.("data-shop-domain"),
  ]
    .map(normalizeShopDomain)
    .filter(Boolean);

  for (const candidate of candidates) {
    if (isMyShopifyDomain(candidate)) {
      return candidate;
    }
  }

  return "";
}



  function getRoot() {
    return document.getElementById(ROOT_ID);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function initials(firstName, lastName) {
    return ((firstName || "").charAt(0) + (lastName || "").charAt(0)).toUpperCase() || "M";
  }

  function formatDate(raw) {
    if (!raw) return "—";
    try {
      return new Date(raw).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    } catch {
      return raw || "—";
    }
  }

  function currency(amount, currencyCode) {
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: currencyCode || "INR",
        maximumFractionDigits: 0
      }).format(Number(amount || 0));
    } catch {
      return "₹" + String(amount || 0);
    }
  }

  function orderPillClass(status) {
    const s = String(status || "").toLowerCase();
    if (["delivered", "fulfilled", "paid", "authorized"].includes(s)) return "ok";
    if (["in transit", "processing", "pending", "partially fulfilled", "unfulfilled"].includes(s)) return "warn";
    return "";
  }
function titleCaseStatus(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    });
}

function firstNonEmpty() {
  for (let i = 0; i < arguments.length; i += 1) {
    const value = String(arguments[i] || "").trim();
    if (value) return value;
  }
  return "";
}

function getPrimaryShipment(order) {
  const tracking = order && order.tracking ? order.tracking : null;
  const shipments = Array.isArray(tracking && tracking.shipments) ? tracking.shipments : [];

  const realShipment =
    shipments.find(function (shipment) {
      return String(shipment.awb || "").trim() || String(shipment.trackingUrl || "").trim();
    }) || shipments[0] || null;

  if (realShipment) return realShipment;

  const fulfillments = Array.isArray(order && order.fulfillments) ? order.fulfillments : [];
  for (const fulfillment of fulfillments) {
    const info = Array.isArray(fulfillment && fulfillment.trackingInfo)
      ? fulfillment.trackingInfo[0]
      : null;

    if (info && (info.number || info.url || info.company)) {
      return {
        provider: info.company || "Shipping partner",
        awb: info.number || "",
        trackingUrl: info.url || "",
        normalizedStatus: fulfillment.status || order.fulfillmentStatus || "",
        statusLabel: titleCaseStatus(fulfillment.status || order.fulfillmentStatus || ""),
        statusUpdatedAt: fulfillment.deliveredAt || fulfillment.createdAt || order.processedAt || null,
        timeline: []
      };
    }
  }

  return null;
}

function getShipmentDisplay(order) {
  const shipment = getPrimaryShipment(order);
  if (!shipment) return null;

  const timeline = Array.isArray(shipment.timeline) ? shipment.timeline : [];
  const latestEvent = timeline[0] || null;

  const statusLabel = firstNonEmpty(
    shipment.statusLabel,
    latestEvent && latestEvent.statusLabel,
    shipment.normalizedStatus,
    order && order.fulfillmentStatus
  );

  return {
    provider: firstNonEmpty(shipment.provider, "Delhivery"),
    awb: firstNonEmpty(shipment.awb),
    trackingUrl: firstNonEmpty(shipment.trackingUrl),
    statusLabel: titleCaseStatus(statusLabel || "Shipment update pending"),
    statusUpdatedAt: shipment.statusUpdatedAt || (latestEvent && latestEvent.occurredAt) || null,
    latestDescription: firstNonEmpty(latestEvent && latestEvent.description),
    latestLocation: firstNonEmpty(latestEvent && latestEvent.location),
    hasTracking: Boolean(firstNonEmpty(shipment.awb, shipment.trackingUrl))
  };
}

function renderTrackingMini(order) {
  const shipment = getShipmentDisplay(order);
  if (!shipment || !shipment.hasTracking) return "";

  return `
    <div class="mk-tracking-mini">
      <span>${escapeHtml(shipment.statusLabel)}</span>
      ${
        shipment.awb
          ? `<small>${escapeHtml(shipment.provider)} • AWB ${escapeHtml(shipment.awb)}</small>`
          : `<small>${escapeHtml(shipment.provider)}</small>`
      }
    </div>
  `;
}

function renderTrackingCard(order) {
  const shipment = getShipmentDisplay(order);

  if (!shipment || !shipment.hasTracking) {
    return `
      <section class="mk-order-detail-card">
        <h3 class="mk-order-detail-card-title">Shipment tracking</h3>
        <div class="mk-order-info-row">
          <span>Status</span>
          <strong>${escapeHtml(order.fulfillmentStatus || "Tracking pending")}</strong>
        </div>
        <div class="mk-order-action-note">
          Tracking details will appear here once your order is shipped.
        </div>
      </section>
    `;
  }

  return `
    <section class="mk-order-detail-card">
      <h3 class="mk-order-detail-card-title">Shipment tracking</h3>

      <div class="mk-order-info-row">
        <span>Carrier</span>
        <strong>${escapeHtml(shipment.provider)}</strong>
      </div>

      ${
        shipment.awb
          ? `<div class="mk-order-info-row"><span>Tracking number</span><strong>${escapeHtml(shipment.awb)}</strong></div>`
          : ""
      }

      <div class="mk-order-info-row">
        <span>Status</span>
        <strong>${escapeHtml(shipment.statusLabel)}</strong>
      </div>

      ${
        shipment.statusUpdatedAt
          ? `<div class="mk-order-info-row"><span>Last update</span><strong>${escapeHtml(formatDate(shipment.statusUpdatedAt))}</strong></div>`
          : ""
      }

      ${
        shipment.latestDescription || shipment.latestLocation
          ? `<div class="mk-order-action-note">${escapeHtml(shipment.latestDescription || "Shipment updated")}${shipment.latestLocation ? ` • ${escapeHtml(shipment.latestLocation)}` : ""}</div>`
          : ""
      }

      ${
        shipment.trackingUrl
          ? `<a class="mk-btn secondary" href="${escapeHtml(shipment.trackingUrl)}" target="_blank" rel="noopener">Track package</a>`
          : ""
      }
    </section>
  `;
}

function renderExchangeProgressCard(order) {
  const progress = order && order.exchangeProgress ? order.exchangeProgress : null;
  if (!progress || !Array.isArray(progress.steps) || !progress.steps.length) return "";

  const reverseShipment = progress.reverseShipment || null;
  const forwardShipment = progress.forwardShipment || null;

  return `
    <section class="mk-order-detail-card mk-exchange-progress-card">
      <h3 class="mk-order-detail-card-title">Exchange progress</h3>

      <div class="mk-exchange-progress">
        ${progress.steps
          .map(function (step) {
            const done = step.state === "completed";
            return `
              <div class="mk-exchange-step ${done ? "is-complete" : "is-pending"}">
                <span class="mk-exchange-step-dot"></span>
                <span class="mk-exchange-step-label">${escapeHtml(step.label)}</span>
              </div>
            `;
          })
          .join("")}
      </div>

      ${
        reverseShipment && (reverseShipment.awb || reverseShipment.trackingUrl)
          ? `<div class="mk-order-action-note">
              Reverse pickup: ${escapeHtml(titleCaseStatus(reverseShipment.status || "Scheduled"))}
              ${reverseShipment.awb ? ` • AWB ${escapeHtml(reverseShipment.awb)}` : ""}
              ${
                reverseShipment.trackingUrl
                  ? `<br><a href="${escapeHtml(reverseShipment.trackingUrl)}" target="_blank" rel="noopener">Track reverse pickup</a>`
                  : ""
              }
            </div>`
          : ""
      }

      ${
        forwardShipment && (forwardShipment.awb || forwardShipment.trackingUrl)
          ? `<div class="mk-order-action-note">
              Replacement shipment: ${escapeHtml(titleCaseStatus(forwardShipment.status || "Shipped"))}
              ${forwardShipment.awb ? ` • AWB ${escapeHtml(forwardShipment.awb)}` : ""}
              ${
                forwardShipment.trackingUrl
                  ? `<br><a href="${escapeHtml(forwardShipment.trackingUrl)}" target="_blank" rel="noopener">Track replacement</a>`
                  : ""
              }
            </div>`
          : ""
      }
    </section>
  `;
}


function renderCancellationCard(order) {
  const status = firstNonEmpty(order.latestCancellationStatus);
  const refundStatus = firstNonEmpty(order.latestCancellationRefundStatus);
  const explanation = firstNonEmpty(order.latestCancellationExplanation);

  if (!status && !refundStatus && !explanation) return "";

  return `
    <section class="mk-order-detail-card mk-cancellation-card">
      <h3 class="mk-order-detail-card-title">Cancellation update</h3>

      ${status ? `
        <div class="mk-order-info-row">
          <span>Status</span>
          <strong>${escapeHtml(titleCaseStatus(status))}</strong>
        </div>
      ` : ""}

      ${refundStatus ? `
        <div class="mk-order-info-row">
          <span>Refund</span>
          <strong>${escapeHtml(refundStatus)}</strong>
        </div>
      ` : ""}

      ${explanation ? `
        <div class="mk-order-action-note mk-cancellation-note">
          ${escapeHtml(explanation)}
        </div>
      ` : ""}
    </section>
  `;
}

function renderRequestDeadlineCard(order) {
  const requestWindowExpiresAt = firstNonEmpty(order.requestWindowExpiresAt);
  const reversePickupWindowExpiresAt = firstNonEmpty(order.reversePickupWindowExpiresAt);
  const requestLockReason = firstNonEmpty(order.requestLockReason);
  const reversePickupLockReason = firstNonEmpty(order.reversePickupLockReason);

  if (!requestWindowExpiresAt && !reversePickupWindowExpiresAt && !requestLockReason && !reversePickupLockReason) {
    return "";
  }

  return `
    <section class="mk-order-detail-card">
      <h3 class="mk-order-detail-card-title">Request deadlines</h3>

      ${
        requestWindowExpiresAt
          ? `<div class="mk-order-info-row">
              <span>Exchange / issue request window</span>
              <strong>Until ${escapeHtml(formatDate(requestWindowExpiresAt))}</strong>
            </div>`
          : ""
      }

      ${
        reversePickupWindowExpiresAt
          ? `<div class="mk-order-info-row">
              <span>Reverse pickup window</span>
              <strong>Until ${escapeHtml(formatDate(reversePickupWindowExpiresAt))}</strong>
            </div>`
          : ""
      }

      ${
        requestLockReason
          ? `<div class="mk-order-action-note">${escapeHtml(requestLockReason)}</div>`
          : ""
      }

      ${
        reversePickupLockReason
          ? `<div class="mk-order-action-note">${escapeHtml(reversePickupLockReason)}</div>`
          : ""
      }
    </section>
  `;
}

function showLoading() {
    const root = getRoot();
    if (!root) return;
    root.innerHTML = `
      <div class="mk-state">
        <div class="mk-spinner"></div>
        <div class="mk-state-title">Loading your account</div>
        <div class="mk-state-sub">Please wait while we fetch your Megaska dashboard.</div>
      </div>
    `;
  }

  function showError(message) {
    const root = getRoot();
    if (!root) return;
    root.innerHTML = `
      <div class="mk-state">
        <div class="mk-state-title">Unable to load dashboard</div>
        <div class="mk-state-sub">${escapeHtml(message || "Something went wrong while loading your account.")}</div>
      </div>
    `;
  }

  function showUnauthorized() {
    const root = getRoot();
    if (!root) return;
    root.innerHTML = `
      <div class="mk-state">
        <div class="mk-state-title">Session required</div>
        <div class="mk-state-sub">Please login with your mobile number to view your Megaska account.</div>
      </div>
    `;
  }
  function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase();
  }

    function getOrderActionState(order) {
  const cancellationStatus = String(order?.latestCancellationStatus || "").trim().toUpperCase();
  const exchangeStatus = String(order?.latestExchangeStatus || "").trim().toUpperCase();
  const issueStatus = String(order?.latestIssueStatus || "").trim().toUpperCase();

  const canRequestCancellation = Boolean(order?.canRequestCancellation);
  const canRequestExchange = Boolean(order?.canRequestExchange);
  const canReportIssue = Boolean(order?.canReportIssue);
  const requestLockReason = firstNonEmpty(order?.requestLockReason);
const reversePickupLockReason = firstNonEmpty(order?.reversePickupLockReason);
const requestWindowExpiresAt = firstNonEmpty(order?.requestWindowExpiresAt);
const reversePickupWindowExpiresAt = firstNonEmpty(order?.reversePickupWindowExpiresAt);
  const hasCancellationRequest = Boolean(cancellationStatus);
  const hasActiveCancellationRequest = ["OPEN", "APPROVED"].includes(cancellationStatus);
  const hasActiveExchangeRequest = Boolean(order?.hasActiveExchangeRequest) || [
    "OPEN",
    "AWAITING_PAYMENT",
    "PAYMENT_RECEIVED",
    "APPROVED",
    "PICKUP_PENDING",
    "PICKUP_SCHEDULED",
    "PICKUP_COMPLETED",
    "ITEM_RECEIVED",
    "REPLACEMENT_PROCESSING",
    "REPLACEMENT_SHIPPED"
  ].includes(exchangeStatus);

  const hasActiveIssueRequest = [
    "OPEN",
    "APPROVED",
    "RETURN_RECEIVED"
  ].includes(issueStatus);

  const isCancelled = cancellationStatus === "CLOSED";

  const pills = [];

  if (isCancelled) {
    pills.push({ label: "Cancelled", tone: "cancel" });
  } else if (hasActiveCancellationRequest) {
    pills.push({ label: "Cancellation Requested", tone: "warning" });
  }

  if (hasActiveExchangeRequest) {
    pills.push({ label: "Exchange Requested", tone: "info" });
  } else if (exchangeStatus === "CLOSED") {
    pills.push({ label: "Exchange Completed", tone: "neutral" });
  } else if (canRequestExchange) {
    pills.push({ label: "Exchange Available", tone: "success" });
  }

  if (hasActiveIssueRequest) {
    pills.push({ label: "Issue Reported", tone: "warning" });
  } else if (issueStatus === "CLOSED") {
    pills.push({ label: "Issue Closed", tone: "neutral" });
  } else if (canReportIssue) {
    pills.push({ label: "Issue Support Available", tone: "success" });
  }

  if (canRequestCancellation && !hasCancellationRequest) {
    pills.push({ label: "Cancellation Available", tone: "info" });
  }

  return {
    isCancelled,
    hasCancellationRequest,
    hasActiveCancellationRequest,
    hasActiveExchangeRequest,
    hasActiveIssueRequest,
    canRequestCancellation,
    canRequestExchange,
    canReportIssue,
    requestLockReason,
    reversePickupLockReason,
requestWindowExpiresAt,
reversePickupWindowExpiresAt,
    pills
  };
}

  function renderStateStrip(order) {
    const state = getOrderActionState(order);
    if (!state.pills.length) return "";

    return `
      <div class="mk-state-strip">
        ${state.pills
          .map(function (pill) {
            return `<span class="mk-state-pill ${escapeHtml(pill.tone)}">${escapeHtml(pill.label)}</span>`;
          })
          .join("")}
      </div>
    `;
  }

  function renderOrderActionList(order) {
  const state = getOrderActionState(order);

  let cancelTile = `
    <button class="mk-order-action-item" type="button">
      <span class="mk-order-action-copy">
        <strong>Cancel Order</strong>
        <small>Request cancellation before shipment.</small>
      </span>
    </button>
  `;

  if (state.isCancelled) {
    cancelTile = `
      <div class="mk-order-action-item is-disabled">
        <span class="mk-order-action-copy">
          <strong>Order Cancelled</strong>
          <small>This order has already been cancelled.</small>
        </span>
      </div>
    `;
  } else if (state.hasActiveCancellationRequest) {
    cancelTile = `
      <div class="mk-order-action-item is-disabled">
        <span class="mk-order-action-copy">
          <strong>Cancellation Requested</strong>
          <small>Your cancellation request is already in progress.</small>
        </span>
      </div>
    `;
  } else if (!state.canRequestCancellation) {
    cancelTile = `
      <div class="mk-order-action-item is-disabled">
        <span class="mk-order-action-copy">
          <strong>Cancellation Locked</strong>
          <small>${escapeHtml(state.requestLockReason || "Cancellation is not available for this order.")}</small>
          
        </span>
      </div>
    `;
  }

  let exchangeTile = "";

if (state.canRequestExchange && !state.hasActiveExchangeRequest) {
  exchangeTile = `
    <button class="mk-order-action-item mk-exchange-action" type="button" data-action="exchange">
      <span class="mk-order-action-copy">
        <strong>Exchange</strong>
        <small>Start a size exchange request.</small>
      </span>
    </button>
  `;
} else if (state.hasActiveExchangeRequest) {
  exchangeTile = `
    <div class="mk-order-action-disabled is-disabled" aria-disabled="true">
      <span class="mk-order-action-copy">
        <strong>Exchange Requested</strong>
        <small>Your exchange request is already in progress.</small>
      </span>
    </div>
  `;
} else {
  exchangeTile = `
    <div class="mk-order-action-disabled is-disabled" aria-disabled="true">
      <span class="mk-order-action-copy">
        <strong>Exchange</strong>
        <small>${escapeHtml(state.requestLockReason || "Exchange requests are allowed only within 2 days of delivery.")}</small>
      </span>
    </div>
  `;
}

let issueTile = "";

if (state.canReportIssue && !state.hasActiveIssueRequest) {
  issueTile = `
    <button class="mk-order-action-item mk-issue-action" type="button" data-action="issue">
      <span class="mk-order-action-copy">
        <strong>Report Issue</strong>
        <small>Received damaged or wrong item?</small>
      </span>
    </button>
  `;
} else if (state.hasActiveIssueRequest) {
  issueTile = `
    <div class="mk-order-action-disabled is-disabled" aria-disabled="true">
      <span class="mk-order-action-copy">
        <strong>Issue Reported</strong>
        <small>Your issue request is already in progress.</small>
      </span>
    </div>
  `;
} else {
  issueTile = `
    <div class="mk-order-action-disabled is-disabled" aria-disabled="true">
      <span class="mk-order-action-copy">
        <strong>Report Issue</strong>
        <small>${escapeHtml(state.requestLockReason || "Issue reporting is allowed only within 2 days of delivery.")}</small>
      </span>
    </div>
  `;
}

  return `
    <div class="mk-order-action-list">
      ${cancelTile}
      ${exchangeTile}
      ${issueTile}

      <button class="mk-order-action-item" type="button">
        <span class="mk-order-action-copy">
          <strong>Refund Status</strong>
          <small>Track refund progress.</small>
        </span>
      </button>
    </div>
  `;
}
    function renderOrderDrawer(order) {
    if (!order) return "";

    return `
      <div class="mk-order-detail-shell">
        <div class="mk-order-detail-head">
          <h2 class="mk-order-detail-title">Order details</h2>
          <button class="mk-order-detail-close" type="button" id="mk-order-drawer-close" aria-label="Close order details">×</button>
        </div>

        <div class="mk-order-detail-body">
          <section class="mk-order-hero">
            ${
              order.displayImage
                ? `<img src="${escapeHtml(order.displayImage)}" alt="${escapeHtml(order.displayTitle || "Order item")}" class="mk-order-hero-image" />`
                : `<div class="mk-order-hero-placeholder" aria-hidden="true"></div>`
            }

            <div class="mk-order-hero-main">
              <div class="mk-order-hero-top">
                <div>
                  <div class="mk-order-hero-name">${escapeHtml(order.displayTitle || "Order item")}</div>
                  <div class="mk-order-hero-meta">${escapeHtml(order.name || "Order")} • ${escapeHtml(formatDate(order.processedAt))}</div>
                  <div class="mk-order-hero-sub">${escapeHtml(String(order.itemsCount || 1))} item(s)</div>
                </div>

                <div class="mk-order-hero-price">
                  ${escapeHtml(currency(order.totalAmount, order.currencyCode || "INR"))}
                </div>
              </div>

              <div class="mk-order-status-row">
                <span class="mk-pill ${escapeHtml(orderPillClass(order.financialStatus))}">
                  ${escapeHtml(order.financialStatus || "Unknown")}
                </span>
                <span class="mk-pill ${escapeHtml(orderPillClass(order.fulfillmentStatus))}">
                  ${escapeHtml(order.fulfillmentStatus || "Unknown")}
                </span>
              </div>

              ${renderStateStrip(order)}
              ${renderTrackingCard(order)}
              ${renderExchangeProgressCard(order)}
              ${renderCancellationCard(order)}
              ${renderRequestDeadlineCard(order)}
            </div>
          </section>

          <section class="mk-order-detail-card">
            <h3 class="mk-order-detail-card-title">Order info</h3>

            <div class="mk-order-info-row">
              <span>Amount</span>
              <strong>${escapeHtml(currency(order.totalAmount, order.currencyCode || "INR"))}</strong>
            </div>

            <div class="mk-order-info-row">
              <span>Items</span>
              <strong>${escapeHtml(String(order.itemsCount || 1))}</strong>
            </div>

            <div class="mk-order-info-row">
              <span>Payment</span>
              <strong>${escapeHtml(order.financialStatus || "Unknown")}</strong>
            </div>

            <div class="mk-order-info-row">
              <span>Delivery</span>
              <strong>${escapeHtml(order.fulfillmentStatus || "Unknown")}</strong>
            </div>
          </section>

          <section class="mk-order-detail-card">
            <h3 class="mk-order-detail-card-title">Need help with this order?</h3>

            ${renderOrderActionList(order)}

            <div class="mk-order-action-note">
              These actions are being prepared and will be connected in the next module phase.
            </div>
          </section>
        </div>
      </div>
    `;
  }

  function closeOrderDrawer() {
    selectedOrderIndex = -1;
    const layer = document.getElementById("mk-order-drawer-layer");
    const drawer = document.getElementById(ORDER_DRAWER_ID);
    if (layer) {
      layer.classList.remove("open");
      layer.setAttribute("aria-hidden", "true");
    }
    if (drawer) {
      drawer.innerHTML = "";
    }
  }

  function openOrderDrawer(index) {
  const order = currentOrders[index];
  if (!order) return;
  selectedOrderIndex = index;

  const layer = document.getElementById("mk-order-drawer-layer");
  const drawer = document.getElementById(ORDER_DRAWER_ID);
  if (!layer || !drawer) return;

  drawer.innerHTML = renderOrderDrawer(order);
  layer.classList.add("open");
  layer.setAttribute("aria-hidden", "false");

  const closeBtn = document.getElementById("mk-order-drawer-close");
  if (closeBtn) closeBtn.addEventListener("click", closeOrderDrawer);
}

  function bindEscapeListener() {
    if (escapeListenerBound) return;
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && selectedOrderIndex !== -1) {
        closeOrderDrawer();
      }
    });
    escapeListenerBound = true;
  }

  function bindOrderInteractions() {
  const orderButtons = document.querySelectorAll(".mk-order-trigger[data-order-index]");

  orderButtons.forEach(function (el) {
    el.addEventListener("click", function (event) {
      if (
        event.target.closest(".mk-order-action-item") ||
        event.target.closest(".mk-exchange-action") ||
        event.target.closest(".mk-issue-action") ||
        event.target.closest(".mk-order-action-disabled")
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      openOrderDrawer(Number(el.getAttribute("data-order-index")));
    });
  });

  const overlay = document.getElementById("mk-order-drawer-overlay");
  if (overlay) overlay.addEventListener("click", closeOrderDrawer);

  bindEscapeListener();
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
        if (typeof window.MegaskaAuth.getSession === "function") {
          const session = await window.MegaskaAuth.getSession();
          if (session && session.token) return session.token;
          if (session && session.sessionToken) return session.sessionToken;
        }
      }
    } catch (e) {}

    try {
      return localStorage.getItem(SESSION_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

    function walletDirectionLabel(direction) {
    return String(direction || "").toUpperCase() === "DEBIT" ? "Debit" : "Credit";
  }

  function walletDirectionClass(direction) {
    return String(direction || "").toUpperCase() === "DEBIT" ? "neutral" : "success";
  }

  function formatWalletReason(txn) {
    return (
      txn.reason ||
      txn.note ||
      txn.transactionType ||
      txn.sourceType ||
      "Wallet transaction"
    );
  }

  function renderWalletTransactions(wallet) {
    const transactions = Array.isArray(wallet?.transactions) ? wallet.transactions : [];

    if (!transactions.length) {
      return `<div class="mk-empty">No wallet transactions yet.</div>`;
    }

    return `
      <div class="mk-wallet-list">
        ${transactions
          .map(function (txn) {
            return `
              <div class="mk-wallet-item">
                <div class="mk-wallet-item-left">
                  <div class="mk-wallet-item-title">${escapeHtml(formatWalletReason(txn))}</div>
                  <div class="mk-wallet-item-meta">
                    ${escapeHtml(formatDate(txn.createdAt))}${
                      txn.orderNumber ? ` • ${escapeHtml(txn.orderNumber)}` : ""
                    }
                  </div>
                </div>

                <div class="mk-wallet-item-right">
                  <span class="mk-state-pill ${escapeHtml(walletDirectionClass(txn.direction))}">
                    ${escapeHtml(walletDirectionLabel(txn.direction))}
                  </span>
                  <div class="mk-wallet-item-amount">
                    ${escapeHtml(currency((Number(txn.amount || 0) / 100), wallet.currency || "INR"))}
                  </div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }  
  function render(data) {
    const customer = data.customer || {};
    const wallet = data.wallet || {};
    const stats = data.stats || {};
    const address = data.address || null;
    const orders = Array.isArray(data.orders) ? data.orders : [];
    currentOrders = orders;
const storeCreditMinor = Number(
  wallet.availableToRedeem ??
  wallet.balance ??
  wallet.currentBalance ??
  0
);

const storeCreditDisplay =
  "₹" + (storeCreditMinor / 100).toFixed(2);
    const root = getRoot();
    if (!root) return;

    root.innerHTML = `
      <div class="mk-wrap">
        <section class="mk-hero">
          <div class="mk-profile">
            <div class="mk-avatar">${escapeHtml(initials(customer.firstName, customer.lastName))}</div>
            <div>
              <h1 class="mk-name">${escapeHtml(((customer.firstName || "") + " " + (customer.lastName || "")).trim() || "My Account")}</h1>
              <div class="mk-sub">
                ${escapeHtml(customer.email || "No email added")}<br>
                ${escapeHtml(customer.phone || "No mobile added")}
              </div>
              <div class="mk-badges">
                <span class="mk-badge ${customer.verified ? "ok" : ""}">${customer.verified ? "Verified Mobile" : "Mobile Not Verified"}</span>
                <span class="mk-badge">Megaska Account</span>
              </div>
            </div>
          </div>

          <div class="mk-actions">
            <a class="mk-btn secondary" href="/pages/contact">Need Help</a>
            <button class="mk-btn primary" id="mk-logout-btn" type="button">Logout</button>
          </div>
        </section>

               <section class="mk-grid4 mk-grid4--summary">
  <div class="mk-stat">
    <div class="mk-stat-label">Total Orders</div>
    <div class="mk-stat-value">${escapeHtml(String(stats.totalOrders || 0))}</div>
  </div>
  <div class="mk-stat">
    <div class="mk-stat-label">Open Requests</div>
    <div class="mk-stat-value">${escapeHtml(String(stats.openRequests || 0))}</div>
  </div>
  <div class="mk-stat">
  <div class="mk-stat-label">Store Credit</div>
  <div class="mk-stat-value">${escapeHtml(storeCreditDisplay)}</div>
  <div class="mk-stat-label">Available Balance</div>
</div>
</section>  <section class="mk-main">
          <div class="mk-card">
            <h2 class="mk-card-title">Recent Orders</h2>
            <div class="mk-list">
              ${
                orders.length
                  ? orders.map(function (order, index) {
                      return `
                        <button class="mk-order-trigger" type="button" data-order-index="${index}" aria-label="Open details for ${escapeHtml(order.name || order.displayTitle || "order")}" aria-controls="${ORDER_DRAWER_ID}" aria-haspopup="dialog">
                          <div style="display:flex; gap:12px; align-items:center;">
                            ${
                              order.displayImage
                                ? `<img src="${escapeHtml(order.displayImage)}" alt="${escapeHtml(order.displayTitle || "Order item")}" style="width:64px;height:64px;border-radius:12px;object-fit:cover;border:1px solid #eee;" />`
                                : `<div style="width:64px;height:64px;border-radius:12px;background:#f3f3f3;" aria-hidden="true"></div>`
                            }

                            <div style="flex:1; min-width:0;">
                              <div style="font-weight:600;font-size:15px;">${escapeHtml(order.displayTitle || "Order items")}</div>
                              <div style="font-size:13px;color:#6b7280;margin-top:4px;">${escapeHtml(order.name || "Order")} • ${escapeHtml(formatDate(order.processedAt))}</div>
                              ${
                                order.itemsCount > 1
                                  ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">+${order.itemsCount - 1} more items</div>`
                                  : ""
                              }
                              ${renderStateStrip(order)}
                              ${
  order.latestCancellationRefundStatus
    ? `<div class="mk-tracking-mini mk-cancellation-mini">
        <span>Refund: ${escapeHtml(order.latestCancellationRefundStatus)}</span>
        ${order.latestCancellationExplanation ? `<small>${escapeHtml(order.latestCancellationExplanation)}</small>` : ""}
      </div>`
    : ""
}
                              ${renderTrackingMini(order)}

                            </div>

                            <div style="font-weight:700; white-space:nowrap;">${escapeHtml(currency(order.totalAmount, order.currencyCode))}</div>
                          </div>

                          <div class="mk-order-meta">
                            <span class="mk-pill ${escapeHtml(orderPillClass(order.financialStatus))}">${escapeHtml(order.financialStatus || "Unknown")}</span>
                            <span class="mk-pill ${escapeHtml(orderPillClass(order.fulfillmentStatus))}">${escapeHtml(order.fulfillmentStatus || "Unknown")}</span>
                          </div>

                          <div class="mk-order-bottom">
                            <span class="mk-footnote">Tap or press Enter to view order details</span>
                            <span class="mk-link">Need support?</span>
                          </div>
                        </button>
                      `;
                    }).join("")
                  : `<div class="mk-empty">No orders yet.</div>`
              }
            </div>
          </div>

          <div style="display:grid;gap:20px;">
            <div class="mk-card">
              <h2 class="mk-card-title">Saved Address</h2>
              ${
                address
  ? `<div class="mk-address">
      <strong>${escapeHtml(
        ((customer.firstName || address.firstName || "") + " " + (customer.lastName || address.lastName || "")).trim() ||
        address.name ||
        "Saved Address"
      )}</strong><br>
      ${escapeHtml(address.line1 || address.address1 || "")}<br>
      ${address.line2 || address.address2 ? `${escapeHtml(address.line2 || address.address2)}<br>` : ""}
      ${escapeHtml(address.city || "")}${address.city && (address.state || address.province) ? ", " : ""}${escapeHtml(address.state || address.province || "")}${address.postalCode || address.zip ? " " + escapeHtml(address.postalCode || address.zip) : ""}<br>
      ${escapeHtml(address.country || "India")}
    </div>`
  : `<div class="mk-empty">No address saved yet.</div>`
              }
            </div>

            
          </div>
        </section>          </div>
      <div class="mk-order-drawer-layer" id="mk-order-drawer-layer" aria-hidden="true">
        <div class="mk-order-drawer-overlay" id="mk-order-drawer-overlay"></div>
        <aside class="mk-order-drawer" id="${ORDER_DRAWER_ID}" role="dialog" aria-modal="true" aria-label="Order details drawer"></aside>
      </div>
    `;

    const logoutBtn = document.getElementById("mk-logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async function () {
        try {
          if (window.MegaskaAuth && typeof window.MegaskaAuth.logout === "function") {
            await window.MegaskaAuth.logout();
          } else {
            localStorage.removeItem(SESSION_STORAGE_KEY);
          }
        } catch (e) {}
        window.location.href = "/";
      });
    }

    bindOrderInteractions();
  }

  async function fetchDashboardSummary() {
  if (window.MegaskaAuth && typeof window.MegaskaAuth.fetchDashboardSummary === "function") {
    return window.MegaskaAuth.fetchDashboardSummary();
  }

  const token = await getSessionToken();

  if (!token) {
    throw new Error("NO_SESSION_TOKEN");
  }

  const shopDomain = getCurrentShopDomain();
  const url = new URL(API_URL);

  url.searchParams.set("token", token);
  if (shopDomain) {
    url.searchParams.set("shop", shopDomain);
  }

  const headers = {
    Authorization: "Bearer " + token,
  };

  if (shopDomain) {
    headers["x-shopify-shop-domain"] = shopDomain;
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers,
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok) {
    const text = await response.text().catch(function () {
      return "";
    });
    throw new Error(text || ("Dashboard request failed with status " + response.status));
  }

  return response.json();
}
  async function boot() {
    showLoading();

    try {
      const data = await fetchDashboardSummary();
      console.log("[MEGASKA ACCOUNT] dashboard data", data);
      render(data);
    } catch (error) {
      if (error && error.message === "NO_SESSION_TOKEN") {
        showUnauthorized();
        return;
      }

      if (error && error.message === "UNAUTHORIZED") {
        showUnauthorized();
        return;
      }

      console.error("[MEGASKA ACCOUNT] dashboard load failed", error);
      showError("We could not load your account data right now. Please refresh the page and try again.");
    }
  }

  boot();
})();
