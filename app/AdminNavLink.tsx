"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";

type AdminNavLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
};

function hrefWithShop(href: string, shop: string | null) {
  if (!shop) return href;
  const [pathAndQuery, hash = ""] = href.split("#", 2);
  const [pathname, query = ""] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(query);
  if (!params.has("shop")) params.set("shop", shop);
  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
}

export default function AdminNavLink({ href, ...props }: AdminNavLinkProps) {
  const searchParams = useSearchParams();
  const shop = searchParams?.get("shop") || searchParams?.get("shopify_shop") || null;

  return <Link href={hrefWithShop(href, shop)} {...props} />;
}
