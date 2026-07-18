import { syncCanonicalShopifyOrder } from "../orders/shopify-order-sync.ts";

export class DevOrderImportError extends Error {
  readonly code: "DEV_HELPER_DISABLED" | "DEV_HELPER_NOT_ALLOWED_IN_ENVIRONMENT";
  constructor(code: "DEV_HELPER_DISABLED" | "DEV_HELPER_NOT_ALLOWED_IN_ENVIRONMENT") { super(code); this.code = code; this.name = "DevOrderImportError"; }
}

type Environment = Record<string, string | undefined>;
export function assertDevelopmentOrderImportEnabled(env: Environment = process.env) {
  if (env.LOOPDESK_DEV_ORDER_IMPORT_HELPER_ENABLED !== "true") throw new DevOrderImportError("DEV_HELPER_DISABLED");
  if (env.VERCEL_ENV?.toLowerCase() === "production" || env.LOOPDESK_ENV?.toLowerCase() === "production") {
    throw new DevOrderImportError("DEV_HELPER_NOT_ALLOWED_IN_ENVIRONMENT");
  }
}

export async function importShopifyOrderForDevelopment(
  input: { shopId: string; shopDomain: string; orderIdentifier: string },
  dependencies: { env?: Environment; sync?: typeof syncCanonicalShopifyOrder } = {},
) {
  assertDevelopmentOrderImportEnabled(dependencies.env);
  return (dependencies.sync ?? syncCanonicalShopifyOrder)(input);
}
