"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const HOST_STORAGE_PREFIX = "megaska:shopify-host:";

function firstParam(params: URLSearchParams, key: string) {
  return String(params.get(key) || "").trim();
}

function storageKey(shop: string) {
  return `${HOST_STORAGE_PREFIX}${shop.toLowerCase()}`;
}

function readStoredHost(shop: string) {
  if (typeof window === "undefined" || !shop) return "";
  const key = storageKey(shop);
  try {
    return String(window.sessionStorage.getItem(key) || window.localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function writeStoredHost(shop: string, host: string) {
  if (typeof window === "undefined" || !shop || !host) return;
  const key = storageKey(shop);
  try {
    window.sessionStorage.setItem(key, host);
    window.localStorage.setItem(key, host);
  } catch {
    // Storage can be blocked in some embedded/admin browser contexts. URL preservation still works.
  }
}

export function getStoredShopifyHost(shop: string) {
  return readStoredHost(shop);
}

export default function ShopifyHostContext() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname || !searchParams) return;

    const params = new URLSearchParams(searchParams.toString());
    const shop = firstParam(params, "shop") || firstParam(params, "shopify_shop");
    if (!shop) return;

    const host = firstParam(params, "host");
    if (host) {
      writeStoredHost(shop, host);
      return;
    }

    const storedHost = readStoredHost(shop);
    if (!storedHost) return;

    params.set("host", storedHost);
    const nextQuery = params.toString();
    router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}`, { scroll: false });
  }, [pathname, router, searchParams]);

  return null;
}
