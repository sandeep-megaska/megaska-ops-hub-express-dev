// No Preact, no JSX, no hooks - confirmed via a stripped-down diagnostic
// build that Preact's render() was never actually mounting content in
// this environment, even though it reported success with no errors.
// Everything here is built and updated with plain DOM APIs instead.

async function fetchShopDomain() {
  const res = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query: "{ shop { myshopifyDomain } }" }),
  });
  const json = await res.json().catch(() => null);
  return json?.data?.shop?.myshopifyDomain || "";
}

// The app backend now verifies a Shopify session token and derives the shop
// from it (it no longer trusts the client-supplied `shop`). Admin UI extensions
// expose the session token via the global `shopify.idToken()`. Kept defensive so
// a missing API degrades to a clear 401 from the backend rather than a crash.
async function getIdToken() {
  try {
    if (typeof shopify !== "undefined" && shopify && typeof shopify.idToken === "function") {
      return (await shopify.idToken()) || "";
    }
  } catch (error) {
    // fall through — request goes out tokenless and the backend answers 401
  }
  return "";
}

async function authHeaders(extra) {
  const token = await getIdToken();
  return Object.assign(
    { "Content-Type": "application/json" },
    token ? { Authorization: `Bearer ${token}` } : {},
    extra || {},
  );
}

async function fetchOrderStatus({ shopifyOrderGid, shop, generate }) {
  const res = await fetch("/api/gst/orders/by-shopify-id", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ shopifyOrderGid, shop, generate: Boolean(generate) }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || "Unable to load GST invoice status");
  }
  return json.data;
}

// i18n.translate's placeholder interpolation does not fire in this environment
// (same class of silent framework failure that forced the vanilla-DOM rewrite:
// translate returns the raw "{token}" string instead of substituting values).
// We translate without options and substitute the {token} placeholders here so
// the result is deterministic regardless of the runtime's interpolation quirks.
function translateWith(i18n, key, replacements) {
  const template = i18n.translate(key);
  const text = typeof template === "string" ? template : String(template);
  return text.replace(/\{(\w+)\}/g, (match, token) =>
    Object.prototype.hasOwnProperty.call(replacements, token) ? String(replacements[token]) : match,
  );
}

export default async () => {
  const { close, data, i18n } = shopify;

  let orderStatus = null;
  let shopDomain = "";

  const action = document.createElement("s-admin-action");
  action.heading = i18n.translate("name");

  const generateButton = document.createElement("s-button");
  generateButton.slot = "primary-action";
  generateButton.disabled = true;
  generateButton.textContent = i18n.translate("generateButton");

  const closeButton = document.createElement("s-button");
  closeButton.slot = "secondary-actions";
  closeButton.textContent = i18n.translate("close");
  closeButton.addEventListener("click", () => close());

  const bodyStack = document.createElement("s-stack");
  bodyStack.direction = "block";
  bodyStack.gap = "base";

  const statusText = document.createElement("s-text");
  statusText.textContent = i18n.translate("loading");

  // Lists the count header plus each actual readiness message, so a merchant
  // can see exactly which check failed (e.g. the amount sanity check) instead
  // of only a bare count.
  const readinessStack = document.createElement("s-stack");
  readinessStack.direction = "block";
  readinessStack.gap = "base";


  const errorText = document.createElement("s-text");
  errorText.tone = "critical";

  const actionsBox = document.createElement("s-box");
  actionsBox.paddingBlockStart = "base";
  const actionsStack = document.createElement("s-stack");
  actionsStack.direction = "block";
  actionsStack.gap = "base";

  const downloadButton = document.createElement("s-button");
  downloadButton.textContent = i18n.translate("downloadButton");

  const emailField = document.createElement("s-text-field");
  emailField.label = i18n.translate("emailLabel");

  const sendButton = document.createElement("s-button");
  sendButton.textContent = i18n.translate("sendButton");
  sendButton.disabled = true;

  const sentText = document.createElement("s-text");

  actionsStack.appendChild(downloadButton);
  actionsStack.appendChild(emailField);
  actionsStack.appendChild(sendButton);
  actionsBox.appendChild(actionsStack);

  bodyStack.appendChild(statusText);

  action.appendChild(generateButton);
  action.appendChild(closeButton);
  action.appendChild(bodyStack);
  document.body.appendChild(action);

  function setError(message) {
    if (message) {
      errorText.textContent = message;
      if (!errorText.isConnected) bodyStack.appendChild(errorText);
    } else if (errorText.isConnected) {
      errorText.remove();
    }
  }

  function renderStatus() {
    const hasInvoice = Boolean(orderStatus?.invoiceId);
    const readinessErrors = Array.isArray(orderStatus?.readinessErrors)
      ? orderStatus.readinessErrors.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    statusText.textContent = hasInvoice
      ? translateWith(i18n, "invoiced", { documentNumber: orderStatus.documentNumber || "" })
      : i18n.translate("notInvoiced");

    if (readinessErrors.length > 0) {
      while (readinessStack.firstChild) readinessStack.removeChild(readinessStack.firstChild);

      const headerText = document.createElement("s-text");
      headerText.tone = "critical";
      headerText.textContent = translateWith(i18n, "readinessWarning", { count: String(readinessErrors.length) });
      readinessStack.appendChild(headerText);

      for (const message of readinessErrors) {
        const itemText = document.createElement("s-text");
        itemText.tone = "critical";
        itemText.textContent = `• ${message}`;
        readinessStack.appendChild(itemText);
      }

      if (!readinessStack.isConnected) bodyStack.appendChild(readinessStack);
    } else if (readinessStack.isConnected) {
      readinessStack.remove();
    }

    generateButton.textContent = hasInvoice ? i18n.translate("refreshButton") : i18n.translate("generateButton");
    generateButton.disabled = false;

    if (hasInvoice) {
      if (!actionsBox.isConnected) bodyStack.appendChild(actionsBox);
      if (!emailField.value) emailField.value = orderStatus.customerEmail || "";
      sendButton.disabled = !emailField.value;
    } else if (actionsBox.isConnected) {
      actionsBox.remove();
    }
  }

  async function loadInitialStatus() {
    try {
      const orderGid = data.selected[0].id;
      shopDomain = await fetchShopDomain();
      const result = await fetchOrderStatus({ shopifyOrderGid: orderGid, shop: shopDomain, generate: false });
      orderStatus = result;
      renderStatus();
    } catch (error) {
      statusText.textContent = "";
      generateButton.disabled = false;
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  generateButton.addEventListener("click", async () => {
    generateButton.loading = true;
    setError(null);
    try {
      const orderGid = data.selected[0].id;
      const result = await fetchOrderStatus({ shopifyOrderGid: orderGid, shop: shopDomain, generate: true });
      if (result.error) setError(result.error);
      orderStatus = result;
      renderStatus();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      generateButton.loading = false;
    }
  });

  downloadButton.addEventListener("click", () => {
    if (!orderStatus?.pdfUrl) return;
    setError(null);
    // orderStatus.pdfUrl is an ABSOLUTE app URL and the route responds with
    // Content-Disposition: attachment. Open it synchronously in this click
    // handler so the browser keeps the user-activation: the earlier
    // fetch()->blob()->window.open() approach lost activation on the await and
    // the sandbox-origin blob URL would not open, so nothing happened.
    window.open(orderStatus.pdfUrl, "_blank");
  });

  const syncSendButtonState = (event) => {
    sendButton.disabled = !event.currentTarget.value;
  };
  emailField.addEventListener("change", syncSendButtonState);
  emailField.addEventListener("input", syncSendButtonState);

  sendButton.addEventListener("click", async () => {
    const emailAddress = emailField.value;
    if (!orderStatus?.invoiceId || !emailAddress) return;
    sendButton.loading = true;
    setError(null);
    if (sentText.isConnected) sentText.remove();
    try {
      const res = await fetch(`/api/gst/invoices/${orderStatus.invoiceId}/send-email`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ to: emailAddress }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to send invoice email");
      }
      sentText.textContent = translateWith(i18n, "sent", { email: json.data?.to || emailAddress });
      actionsStack.appendChild(sentText);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      sendButton.loading = false;
    }
  });

  await loadInitialStatus();
};
