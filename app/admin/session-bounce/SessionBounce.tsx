"use client";

import { useEffect, useState } from "react";

type ShopifyBridge = { idToken?: () => Promise<string> };

// Waits for App Bridge, asks it for a fresh session token and reloads the page the
// merchant was on with that token, which the server can verify. Only same-origin
// paths are accepted as the return target.
function returnPath(raw: string | null) {
  const value = String(raw || "");
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

async function waitForIdToken(timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const bridge = (window as unknown as { shopify?: ShopifyBridge }).shopify;
    if (bridge && typeof bridge.idToken === "function") return bridge.idToken();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return "";
}

export default function SessionBounce() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const target = returnPath(new URLSearchParams(window.location.search).get("return"));
    if (!target || window.top === window.self) {
      setFailed(true);
      return;
    }
    waitForIdToken(5000)
      .then((token) => {
        if (cancelled) return;
        if (!token) {
          setFailed(true);
          return;
        }
        const url = new URL(target, window.location.origin);
        url.searchParams.set("id_token", token);
        url.searchParams.set("loopd2c_bounce", String(Date.now()));
        window.location.replace(`${url.pathname}${url.search}${url.hash}`);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mk-page mx-auto max-w-3xl">
      {failed ? (
        <div className="mk-alert mk-alert-error" role="alert">
          Open LoopD2C from your Shopify admin to continue.
        </div>
      ) : (
        <p className="mk-section-subtitle" role="status">Reconnecting to Shopify…</p>
      )}
    </main>
  );
}
