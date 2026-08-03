// AES-256-GCM encryption for Shopify gift-card codes at rest. Shopify's Admin API
// never returns a gift card's full code after creation, so to show the code in the
// app dashboard (and let the shopper paste it at checkout) we generate the code
// ourselves and store it encrypted here. Mirrors services/shopify/token-crypto.ts.
import crypto from "crypto";

function getEncryptionKey() {
  const secret = String(
    process.env.GIFT_CARD_ENCRYPTION_KEY ||
      process.env.TOKEN_ENCRYPTION_KEY ||
      process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ||
      process.env.SHOPIFY_API_SECRET ||
      process.env.SHOPIFY_API_SECRET_KEY ||
      "",
  ).trim();
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptGiftCardCode(code: string): string | null {
  const plaintext = String(code || "").trim();
  if (!plaintext) return null;
  const key = getEncryptionKey();
  if (!key) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptGiftCardCode(encrypted: string | null | undefined): string | null {
  const value = String(encrypted || "").trim();
  if (!value) return null;
  const key = getEncryptionKey();
  if (!key) return null;

  const [version, ivValue, tagValue, encryptedValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// A 16-char, unambiguous, uppercase code (no 0/O/1/I) formatted XXXX-XXXX-XXXX-XXXX.
// Shopify accepts a supplied code (>= 8 chars); supplying our own is the only way
// to know it for display, since the API won't hand it back later.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function generateGiftCardCode(): string {
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i % 4 === 3 && i !== 15) out += "-";
  }
  return out;
}
