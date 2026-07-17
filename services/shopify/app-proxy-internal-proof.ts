import crypto from "crypto";

const INTERNAL_PROXY_PROOF_TTL_MS = 30_000;

function proofValue(secret: string, timestamp: string, method: string, pathname: string, shopDomain: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${method.toUpperCase()}.${pathname}.${shopDomain}`)
    .digest("hex");
}

export function createInternalAppProxyProof(input: {
  secret: string;
  timestamp: string;
  method: string;
  pathname: string;
  shopDomain: string;
}) {
  if (!input.secret) return null;
  return proofValue(input.secret, input.timestamp, input.method, input.pathname, input.shopDomain);
}

export function verifyInternalAppProxyProof(input: {
  secret: string;
  timestamp: string | null;
  proof: string | null;
  method: string;
  pathname: string;
  shopDomain: string;
  now?: number;
}) {
  if (!input.secret || !input.timestamp || !input.proof || !input.shopDomain) return false;
  const timestamp = Number(input.timestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs((input.now ?? Date.now()) - timestamp) > INTERNAL_PROXY_PROOF_TTL_MS) return false;
  const expected = proofValue(input.secret, input.timestamp, input.method, input.pathname, input.shopDomain);
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(input.proof, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
