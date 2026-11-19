import crypto from "crypto";

function getEncryptionKey() {
  const secret = String(
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ||
      process.env.TOKEN_ENCRYPTION_KEY ||
      process.env.SHOPIFY_API_SECRET ||
      process.env.SHOPIFY_API_SECRET_KEY ||
      ""
  ).trim();

  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

// After the app moves to a new Shopify app (new client secret), values encrypted
// with a key derived from the old SHOPIFY_API_SECRET stay readable when
// SHOPIFY_API_SECRET_PREVIOUS holds it. Only used to decrypt; new values always use
// the current key. (A dedicated encryption key env var avoids this entirely.)
function previousSecretKey() {
  const previous = String(process.env.SHOPIFY_API_SECRET_PREVIOUS || "").trim();
  return previous ? crypto.createHash("sha256").update(previous).digest() : null;
}

function decryptWith(key: Buffer, ivValue: string, tagValue: string, encryptedValue: string): string | null {
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function encryptShopifyToken(token: string) {
  const plaintext = String(token || "").trim();
  if (!plaintext) return null;

  const key = getEncryptionKey();
  if (!key) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptShopifyToken(encryptedToken: string | null | undefined) {
  const value = String(encryptedToken || "").trim();
  if (!value) return null;

  const key = getEncryptionKey();
  if (!key) return null;

  const [version, ivValue, tagValue, encryptedValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) return null;

  const current = decryptWith(key, ivValue, tagValue, encryptedValue);
  if (current !== null) return current;
  const previous = previousSecretKey();
  return previous && !previous.equals(key) ? decryptWith(previous, ivValue, tagValue, encryptedValue) : null;
}
