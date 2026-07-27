import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

export default async () => {
  console.log("[gst-invoice-action] module executing, calling render()");
  render(<Extension />, document.body);
};

const REQUEST_TIMEOUT_MS = 10000;

function withTimeout(promise, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), REQUEST_TIMEOUT_MS)),
  ]);
}

async function fetchShopDomain() {
  console.log("[gst-invoice-action] fetchShopDomain: start");
  const res = await withTimeout(
    fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      body: JSON.stringify({ query: "{ shop { myshopifyDomain } }" }),
    }),
    "Timed out reading shop details from Shopify (shopify:admin/api/graphql.json)"
  );
  console.log("[gst-invoice-action] fetchShopDomain: got response", res.status);
  const json = await res.json().catch(() => null);
  console.log("[gst-invoice-action] fetchShopDomain: parsed json", json);
  return json?.data?.shop?.myshopifyDomain || "";
}

async function fetchOrderStatus({ shopifyOrderGid, shop, generate }) {
  console.log("[gst-invoice-action] fetchOrderStatus: start", { shopifyOrderGid, shop, generate });
  const res = await withTimeout(
    fetch("/api/gst/orders/by-shopify-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopifyOrderGid, shop, generate: Boolean(generate) }),
    }),
    "Timed out reaching the GST app backend (/api/gst/orders/by-shopify-id)"
  );
  console.log("[gst-invoice-action] fetchOrderStatus: got response", res.status);
  const json = await res.json().catch(() => null);
  console.log("[gst-invoice-action] fetchOrderStatus: parsed json", json);
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || "Unable to load GST invoice status");
  }
  return json.data;
}

function Extension() {
  console.log("[gst-invoice-action] Extension() rendering");
  const { close, data, i18n } = shopify;

  const [shopDomain, setShopDomain] = useState("");
  const [status, setStatus] = useState("loading");
  const [orderStatus, setOrderStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [emailAddress, setEmailAddress] = useState("");

  useEffect(() => {
    console.log("[gst-invoice-action] initial useEffect firing");
    let cancelled = false;
    (async () => {
      try {
        const orderGid = data.selected[0].id;
        console.log("[gst-invoice-action] resolved orderGid", orderGid);
        const shop = await fetchShopDomain();
        if (cancelled) return;
        console.log("[gst-invoice-action] resolved shop domain", shop);
        setShopDomain(shop);
        const result = await fetchOrderStatus({ shopifyOrderGid: orderGid, shop, generate: false });
        if (cancelled) return;
        console.log("[gst-invoice-action] resolved order status", result);
        setOrderStatus(result);
        setEmailAddress(result.customerEmail || "");
        setStatus("ready");
      } catch (error) {
        console.error("[gst-invoice-action] initial load failed", error);
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setErrorMessage(null);
    try {
      const orderGid = data.selected[0].id;
      const result = await fetchOrderStatus({ shopifyOrderGid: orderGid, shop: shopDomain, generate: true });
      if (result.error) {
        setErrorMessage(result.error);
      }
      setOrderStatus(result);
      setEmailAddress((prev) => prev || result.customerEmail || "");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopDomain]);

  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    if (!orderStatus?.pdfUrl) return;
    setDownloading(true);
    setErrorMessage(null);
    try {
      // window.open() with a relative path resolves against this extension's
      // own sandboxed origin, not the app. fetch() is what Shopify resolves
      // against the app's application_url and attaches auth to, so the PDF is
      // fetched here and opened from a local blob URL instead.
      const res = await fetch(orderStatus.pdfUrl);
      if (!res.ok) {
        throw new Error(`Failed to download PDF (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(false);
    }
  }, [orderStatus]);

  const handleSend = useCallback(async () => {
    if (!orderStatus?.invoiceId || !emailAddress) return;
    setSending(true);
    setErrorMessage(null);
    setSendResult(null);
    try {
      const res = await fetch(`/api/gst/invoices/${orderStatus.invoiceId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emailAddress }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to send invoice email");
      }
      setSendResult(json.data?.to || emailAddress);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }, [orderStatus, emailAddress]);

  const hasInvoice = Boolean(orderStatus?.invoiceId);
  const readinessCount = Array.isArray(orderStatus?.readinessErrors) ? orderStatus.readinessErrors.length : 0;

  return (
    <s-admin-action heading={i18n.translate("name")}>
      <s-button slot="primary-action" onClick={handleGenerate} loading={generating} disabled={status !== "ready"}>
        {hasInvoice ? i18n.translate("refreshButton") : i18n.translate("generateButton")}
      </s-button>
      <s-button slot="secondary-actions" onClick={close}>
        {i18n.translate("close")}
      </s-button>

      <s-stack direction="block" gap="base">
        {status === "loading" ? <s-text>{i18n.translate("loading")}</s-text> : null}

        {status === "ready" && !hasInvoice ? <s-text>{i18n.translate("notInvoiced")}</s-text> : null}

        {status === "ready" && hasInvoice ? (
          <s-text>
            {i18n.translate("invoiced", { documentNumber: orderStatus.documentNumber || "" })}
          </s-text>
        ) : null}

        {status === "ready" && readinessCount > 0 ? (
          <s-text tone="critical">
            {i18n.translate("readinessWarning", { count: String(readinessCount) })}
          </s-text>
        ) : null}

        {errorMessage ? <s-text tone="critical">{errorMessage}</s-text> : null}

        {hasInvoice ? (
          <s-box padding-block-start="base">
            <s-stack direction="block" gap="base">
              <s-button onClick={handleDownload} loading={downloading}>{i18n.translate("downloadButton")}</s-button>

              <s-text-field
                label={i18n.translate("emailLabel")}
                value={emailAddress}
                onChange={(event) => setEmailAddress(event.currentTarget.value)}
              />
              <s-button onClick={handleSend} loading={sending} disabled={!emailAddress}>
                {i18n.translate("sendButton")}
              </s-button>
              {sendResult ? <s-text>{i18n.translate("sent", { email: sendResult })}</s-text> : null}
            </s-stack>
          </s-box>
        ) : null}
      </s-stack>
    </s-admin-action>
  );
}
