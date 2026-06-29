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

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
