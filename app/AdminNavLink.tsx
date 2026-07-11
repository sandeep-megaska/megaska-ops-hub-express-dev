"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";

type AdminNavLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
};

const EMBEDDED_CONTEXT_PARAMS = new Set(["shop", "shopify_shop", "host", "embedded"]);

export function hrefWithEmbeddedContext(href: string, currentParams: URLSearchParams | null) {
  if (!currentParams) return href;
  const [pathAndQuery, hash = ""] = href.split("#", 2);
  const [pathname, query = ""] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(query);
  currentParams.forEach((value, key) => {
    if (!EMBEDDED_CONTEXT_PARAMS.has(key) || params.has(key)) return;
    params.set(key, value);
  });
  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
}

export default function AdminNavLink({ href, ...props }: AdminNavLinkProps) {
  const searchParams = useSearchParams();
  return <Link href={hrefWithEmbeddedContext(href, searchParams)} {...props} />;
}
