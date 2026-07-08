"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getStoredShopifyHost } from "./ShopifyHostContext";

type ShopifyPickerVariant = { id?: string; title?: string; displayName?: string; image?: { url?: string; originalSrc?: string } };
type ShopifyPickerResource = { id?: string; title?: string; handle?: string; image?: { url?: string; originalSrc?: string; altText?: string }; images?: Array<{ url?: string; originalSrc?: string }>; variants?: ShopifyPickerVariant[] };
type ShopifyResourcePicker = (options: Record<string, unknown>) => Promise<ShopifyPickerResource[] | ShopifyPickerResource | undefined>;
type ShopifyGlobal = {
  resourcePicker?: ShopifyResourcePicker;
  config?: Record<string, unknown>;
};

declare global {
  interface Window {
    shopify?: ShopifyGlobal;
    __shopifyAppBridgeScriptLoaded?: boolean;
    __shopifyAppBridgeScriptError?: string;
    __shopifyAppBridgeScriptEvents?: Array<Record<string, unknown>>;
  }
}

type EmbeddedAdminStatus = {
  apiKeyPresent: boolean;
  appBridgeInitialized: boolean;
  currentRoute: string;
  embedded: string;
  host: string;
  hostPresent: boolean;
  resourcePickerAvailable: boolean;
  apiKeyMetaPresent: boolean;
  apiKeyMetaContentLength: number;
  appBridgeScriptTagPresent: boolean;
  appBridgeScriptLoadedEventFired: boolean;
  appBridgeScriptError: string;
  appBridgeScriptDiagnostics: string;
  shopifyGlobalPresent: boolean;
  resourcePickerType: string;
  shop: string;
  shopPresent: boolean;
};

const EMBEDDED_CONTEXT_PARAMS = new Set(["shop", "shopify_shop", "host", "embedded"]);
const AdminEmbeddedContext = createContext<EmbeddedAdminStatus | null>(null);

function firstParam(params: URLSearchParams | null, key: string) {
  return String(params?.get(key) || "").trim();
}

function getResourcePicker() {
  if (typeof window === "undefined") return undefined;
  return window.shopify?.resourcePicker;
}

function isAdminHref(anchor: HTMLAnchorElement) {
  if (!anchor.href || anchor.target || anchor.hasAttribute("download")) return false;
  const url = new URL(anchor.href);
  if (url.origin !== window.location.origin) return false;
  return url.pathname === "/" || url.pathname.startsWith("/admin/");
}

function mergeEmbeddedContext(href: string, currentSearch: string) {
  const current = new URLSearchParams(currentSearch);
  const url = new URL(href, window.location.origin);
  current.forEach((value, key) => {
    if (EMBEDDED_CONTEXT_PARAMS.has(key) && !url.searchParams.has(key)) url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}${url.hash}`;
}

export function useEmbeddedAdminStatus() {
  return useContext(AdminEmbeddedContext);
}

export function AdminEmbeddedProvider({ apiKey, children }: { apiKey: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<EmbeddedAdminStatus>({
    apiKeyPresent: Boolean(apiKey),
    appBridgeInitialized: false,
    currentRoute: "",
    embedded: "",
    host: "",
    hostPresent: false,
    resourcePickerAvailable: false,
    apiKeyMetaPresent: false,
    apiKeyMetaContentLength: 0,
    appBridgeScriptTagPresent: false,
    appBridgeScriptLoadedEventFired: false,
    appBridgeScriptError: "",
    appBridgeScriptDiagnostics: "",
    shopifyGlobalPresent: false,
    resourcePickerType: "undefined",
    shop: "",
    shopPresent: false,
  });

  const shop = firstParam(searchParams, "shop") || firstParam(searchParams, "shopify_shop");
  const hostFromUrl = firstParam(searchParams, "host");
  const host = hostFromUrl || getStoredShopifyHost(shop);
  const embedded = firstParam(searchParams, "embedded") || (host ? "1" : "");
  const currentRoute = `${pathname || ""}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;

  useEffect(() => {
    function refresh() {
      const apiKeyMeta = document.querySelector<HTMLMetaElement>('meta[name="shopify-api-key"]');
      const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src="https://cdn.shopify.com/shopifycloud/app-bridge.js"]'));
      const script = scripts[0];
      const shopifyGlobalPresent = Boolean(window.shopify);
      const resourcePickerType = typeof window.shopify?.resourcePicker;
      const appBridgeInitialized = shopifyGlobalPresent;
      const diagnostics = [
        `script count: ${scripts.length}`,
        `script readyState: ${(script as (HTMLScriptElement & { readyState?: string }) | undefined)?.readyState || "unknown"}`,
        `events: ${JSON.stringify(window.__shopifyAppBridgeScriptEvents || [])}`,
      ].join("; ");
      setStatus({
        apiKeyPresent: Boolean(apiKey),
        apiKeyMetaPresent: Boolean(apiKeyMeta),
        apiKeyMetaContentLength: apiKeyMeta?.content.length || 0,
        appBridgeScriptTagPresent: scripts.length > 0,
        appBridgeScriptLoadedEventFired: Boolean(window.__shopifyAppBridgeScriptLoaded || shopifyGlobalPresent),
        appBridgeScriptError: window.__shopifyAppBridgeScriptError || (scripts.length > 1 ? "Duplicate App Bridge CDN script tags detected." : ""),
        appBridgeScriptDiagnostics: diagnostics,
        shopifyGlobalPresent,
        resourcePickerType,
        appBridgeInitialized,
        currentRoute,
        embedded,
        host,
        hostPresent: Boolean(host),
        resourcePickerAvailable: Boolean(getResourcePicker()),
        shop,
        shopPresent: Boolean(shop),
      });
    }

    refresh();
    const timers = [100, 400, 1000, 2500].map((delay) => window.setTimeout(refresh, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [apiKey, currentRoute, embedded, host, shop]);

  useEffect(() => {
    const script = document.querySelector<HTMLScriptElement>('script[src="https://cdn.shopify.com/shopifycloud/app-bridge.js"]');
    if (!script) return;
    const markLoaded = () => { window.__shopifyAppBridgeScriptLoaded = true; };
    const markError = () => { window.__shopifyAppBridgeScriptError = "App Bridge CDN script failed to load or was blocked."; };
    script.addEventListener("load", markLoaded);
    script.addEventListener("error", markError);
    return () => {
      script.removeEventListener("load", markLoaded);
      script.removeEventListener("error", markError);
    };
  }, []);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || !isAdminHref(anchor)) return;
      const nextHref = mergeEmbeddedContext(anchor.href, window.location.search);
      if (nextHref === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
      event.preventDefault();
      router.push(nextHref);
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [router]);

  const value = useMemo(() => status, [status]);

  return (
    <AdminEmbeddedContext.Provider value={value}>
      {children}
    </AdminEmbeddedContext.Provider>
  );
}
