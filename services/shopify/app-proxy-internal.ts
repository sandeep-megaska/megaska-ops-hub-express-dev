import crypto from "node:crypto";

const MAX_PROXY_HOP_AGE_MS = 5 * 60 * 1000;

function internalProxySecret(): string {
  return String(process.env.SHOPIFY_API_SECRET || "").trim();
}

function signingMessage(input: {
  shopDomain: string;
  timestamp: string;
  method: string;
  pathname: string;
}): string {
  return [input.shopDomain, input.timestamp, input.method.toUpperCase(), input.pathname].join("\n");
}

/**
 * Attests the trusted app-proxy hop before it enters an internal API route.
 * The public `x-megaska-app-proxy` marker is deliberately not authorization.
 */
export function createInternalAppProxySignature(input: {
  shopDomain: string;
  timestamp: string;
  method: string;
  pathname: string;
}): string | null {
  const secret = internalProxySecret();
  if (!secret) return null;

  return crypto.createHmac("sha256", secret).update(signingMessage(input)).digest("hex");
}

export function isValidInternalAppProxySignature(input: {
  shopDomain: string | null;
  timestamp: string | null;
  signature: string | null;
  method: string;
  pathname: string;
  now?: number;
}): boolean {
  if (!input.shopDomain || !input.timestamp || !input.signature || !/^[a-f0-9]{64}$/i.test(input.signature)) {
    return false;
  }

  const timestamp = Number(input.timestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs((input.now ?? Date.now()) - timestamp) > MAX_PROXY_HOP_AGE_MS) {
    return false;
  }

  const expected = createInternalAppProxySignature({
    shopDomain: input.shopDomain,
    timestamp: input.timestamp,
    method: input.method,
    pathname: input.pathname,
  });
  if (!expected) return false;

  const actualBuffer = Buffer.from(input.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
