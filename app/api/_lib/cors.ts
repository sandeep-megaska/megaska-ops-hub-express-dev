import { NextRequest, NextResponse } from "next/server";

function getAllowedOrigin(req: NextRequest) {
  const origin = String(req.headers.get("origin") || "").trim();

  if (!origin) {
    return "*";
  }

  return origin;
}

function getRequestedHeaders(req: NextRequest) {
  const requested = String(
    req.headers.get("access-control-request-headers") || ""
  ).trim();

  if (!requested) {
    return "Content-Type, Authorization, x-shopify-shop-domain";
  }

  const normalized = requested
    .split(",")
    .map((header) => header.trim())
    .filter(Boolean);

  const required = [
    "Content-Type",
    "Authorization",
    "x-shopify-shop-domain",
  ];

  const merged = Array.from(
    new Set([
      ...required.map((h) => h.toLowerCase()),
      ...normalized.map((h) => h.toLowerCase()),
    ])
  );

  return merged.join(", ");
}

export function withCors(req: NextRequest, res: NextResponse) {
  const origin = getAllowedOrigin(req);
  const allowHeaders = getRequestedHeaders(req);

  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Vary", "Origin, Access-Control-Request-Headers");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", allowHeaders);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Max-Age", "86400");

  return res;
}

export function handleOptions(req: NextRequest) {
  return withCors(req, new NextResponse(null, { status: 204 }));
}
