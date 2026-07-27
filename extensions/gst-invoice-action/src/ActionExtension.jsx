import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

async function fetchShopDomain() {
  const res = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query: "{ shop { myshopifyDomain } }" }),
  });
  const json = await res.json().catch(() => null);
  return json?.data?.shop?.myshopifyDomain || "";
}

async function fetchOrderStatus({ shopifyOrderGid, shop, generate }) {
  const res = await fetch("/api/gst/orders/by-shopify-id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shopifyOrderGid, shop, generate: Boolean(generate) }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || "Unable to load GST invoice status");
  }
  return json.data;
}

function Extension() {
  const { close, data, i18n } = shopify;
  const shopifyOrderGid = data.selected[0].id;

  const [shopDomain, setShopDomain] = useState("");
  const [status, setStatus] = useState("loading");
  const [orderStatus, setOrderStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [emailAddress, setEmailAddress] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const shop = await fetchShopDomain();
        if (cancelled) return;
        setShopDomain(shop);
        const result = await fetchOrderStatus({ shopifyOrderGid, shop, generate: false });
        if (cancelled) return;
        setOrderStatus(result);
        setEmailAddress(result.customerEmail || "");
        setStatus("ready");
      } catch (error) {
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
      const result = await fetchOrderStatus({ shopifyOrderGid, shop: shopDomain, generate: true });
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
  }, [shopifyOrderGid, shopDomain]);

  const handleDownload = useCallback(() => {
    if (orderStatus?.pdfUrl) {
      window.open(orderStatus.pdfUrl, "_blank");
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
              <s-button onClick={handleDownload}>{i18n.translate("downloadButton")}</s-button>

              <s-text-field
                label={i18n.translate("emailLabel")}
                value={emailAddress}
                onChange={(event) => setEmailAddress(event.target.value)}
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
