import { Prisma } from "../../../../generated/prisma/index.js";
import { adminGraphql } from "../../../shopify/admin.ts";
import { prisma } from "../../../db/prisma.ts";
import type { BillingProviderAdapter, CreateProviderSubscriptionInput, CreateProviderSubscriptionResult, CreateProviderUsageChargeInput, CreateProviderUsageChargeResult } from "../billing-adapter.types.ts";

export class BillingProviderError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, message: string) { super(message); this.name = "BillingProviderError"; }
}
export class ShopifyBillingProviderError extends BillingProviderError { constructor(code: string, retryable: boolean, message: string) { super(code, retryable, message); this.name = "ShopifyBillingProviderError"; } }
export class BillingProviderValidationError extends BillingProviderError { constructor(code: string, message: string) { super(code, false, message); this.name = "BillingProviderValidationError"; } }

export type ShopifyGraphqlExecutor = <T>(query: string, variables: Record<string, unknown>, options: { shopDomain: string }) => Promise<T>;
type Logger = Pick<Console, "info" | "warn">;
type ShopDomainResolver = (shopId: string) => Promise<string | null>;
type SubscriptionMutationResponse = { appSubscriptionCreate: { appSubscription: { id: string; status: string | null; lineItems: Array<{ id: string; plan: { pricingDetails: { __typename: string } } }> } | null; confirmationUrl: string | null; userErrors: Array<{ message?: string; code?: string }> } };
type UsageMutationResponse = { appUsageRecordCreate: { appUsageRecord: { id: string } | null; userErrors: Array<{ message?: string; code?: string }> } };

const CREATE_SUBSCRIPTION = `
mutation CreateAppSubscription($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!, $trialDays: Int, $test: Boolean) {
  appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems, trialDays: $trialDays, test: $test) {
    appSubscription { id status lineItems { id plan { pricingDetails { __typename } } } }
    confirmationUrl
    userErrors { field message code }
  }
}`;
const CREATE_USAGE = `
mutation CreateAppUsageRecord($subscriptionLineItemId: ID!, $price: MoneyInput!, $description: String!) {
  appUsageRecordCreate(subscriptionLineItemId: $subscriptionLineItemId, price: $price, description: $description) {
    appUsageRecord { id }
    userErrors { field message code }
  }
}`;

function decimal(value: string, field: string) {
  try { const parsed = new Prisma.Decimal(value); if (parsed.isNegative() || !parsed.isFinite()) throw new Error(); return parsed; }
  catch { throw new BillingProviderValidationError("INVALID_AMOUNT", `${field} must be a non-negative decimal.`); }
}
function currency(value: string) { const result = value.trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(result)) throw new BillingProviderValidationError("INVALID_CURRENCY", "currency must be an ISO 4217 code."); return result; }
function userError(errors: Array<{ message?: string | null; code?: string | null }> | undefined) {
  const error = errors?.[0];
  if (!error) return;
  const code = String(error.code || "SHOPIFY_USER_ERROR");
  throw new ShopifyBillingProviderError(code, false, String(error.message || "Shopify rejected the billing request."));
}
function normalize(error: unknown): never {
  if (error instanceof BillingProviderError) throw error;
  const message = error instanceof Error ? error.message : "Shopify billing request failed.";
  const retryable = /timeout|network|fetch failed|429|5\d\d|rate limit/i.test(message);
  throw new ShopifyBillingProviderError(retryable ? "SHOPIFY_TRANSPORT_RETRYABLE" : "SHOPIFY_GRAPHQL_ERROR", retryable, message);
}

/** Shopify-only transport translation; persistence and retry orchestration stay above this class. */
export class ShopifyBillingAdapter implements BillingProviderAdapter {
  constructor(
    private readonly execute: ShopifyGraphqlExecutor = (query, variables, options) => adminGraphql(query, variables, options),
    private readonly logger: Logger = console,
    private readonly resolveShopDomain: ShopDomainResolver = async (shopId) => (await prisma.shop.findUnique({ where: { id: shopId }, select: { shopDomain: true } }))?.shopDomain ?? null,
  ) {}

  async createSubscription(input: CreateProviderSubscriptionInput): Promise<CreateProviderSubscriptionResult> {
    const basePrice = decimal(input.monthlyBasePrice, "monthlyBasePrice"); const code = currency(input.currency);
    if (!input.shopId || !input.merchantSubscriptionId || !input.returnUrl) throw new BillingProviderValidationError("INVALID_SUBSCRIPTION_INPUT", "shop, subscription, and server return URL are required.");
    const lineItems: unknown[] = [{ plan: { appRecurringPricingDetails: { price: { amount: basePrice.toString(), currencyCode: code }, interval: "EVERY_30_DAYS" } } }];
    if (input.cappedUsageAmount !== undefined) {
      const cap = decimal(input.cappedUsageAmount, "cappedUsageAmount");
      lineItems.push({ plan: { appUsagePricingDetails: { cappedAmount: { amount: cap.toString(), currencyCode: code }, terms: "Rated LoopD2C feature usage" } } });
    }
    const shopDomain = await this.resolveShopDomain(input.shopId);
    if (!shopDomain) throw new BillingProviderValidationError("SHOP_NOT_FOUND", "Shop was not found.");
    try {
      const data = await this.execute<SubscriptionMutationResponse>(CREATE_SUBSCRIPTION, { name: input.planName, returnUrl: input.returnUrl, lineItems, trialDays: input.trialDays ?? null, test: input.test ?? false }, { shopDomain });
      userError(data.appSubscriptionCreate.userErrors);
      const subscription = data.appSubscriptionCreate.appSubscription; const confirmationUrl = data.appSubscriptionCreate.confirmationUrl;
      if (!subscription || !confirmationUrl) throw new ShopifyBillingProviderError("SHOPIFY_RESPONSE_INVALID", true, "Shopify did not return a subscription confirmation URL.");
      const recurring = subscription.lineItems.find((item) => item.plan.pricingDetails.__typename === "AppRecurringPricingDetails")?.id ?? null;
      const usage = subscription.lineItems.find((item) => item.plan.pricingDetails.__typename === "AppUsagePricingDetails")?.id ?? null;
      this.logger.info("billing_provider_submission_succeeded", { shopId: input.shopId, merchantSubscriptionId: input.merchantSubscriptionId, provider: "SHOPIFY", operation: "CREATE_SUBSCRIPTION" });
      return { provider: "SHOPIFY", externalSubscriptionId: subscription.id, confirmationUrl, status: "PENDING_CONFIRMATION", recurringLineItemId: recurring, usageLineItemId: usage, providerPayload: { status: subscription.status } };
    } catch (error) { return normalize(error); }
  }

  async getAppSubscriptionStatus(input: { shopId: string; externalSubscriptionId: string }): Promise<{ id: string; status: string } | null> {
    const shopDomain = await this.resolveShopDomain(input.shopId);
    if (!shopDomain) throw new BillingProviderValidationError("SHOP_NOT_FOUND", "Shop was not found.");
    try {
      const data = await this.execute<{ node: { id: string; status: string } | null }>(`query GetAppSubscription($id: ID!) { node(id: $id) { ... on AppSubscription { id status } } }`, { id: input.externalSubscriptionId }, { shopDomain });
      return data.node ? { id: data.node.id, status: data.node.status } : null;
    } catch (error) { return normalize(error); }
  }

  async getUsageRecord(input: { shopId: string; externalUsageRecordId: string }): Promise<ShopifyUsageRecord | null> {
    const shopDomain = await this.resolveShopDomain(input.shopId);
    if (!shopDomain) throw new BillingProviderValidationError("SHOP_NOT_FOUND", "Shop was not found.");
    try {
      const data = await this.execute<UsageRecordQueryResponse>(GET_USAGE_RECORD, { id: input.externalUsageRecordId }, { shopDomain });
      const record = data.node;
      return record ? { id: record.id, amount: record.price.amount, currency: record.price.currencyCode } : null;
    } catch (error) { return normalize(error); }
  }

  async createUsageCharge(input: CreateProviderUsageChargeInput): Promise<CreateProviderUsageChargeResult> {
    const amount = decimal(input.amount, "amount"); const code = currency(input.currency);
    if (amount.isZero()) return { provider: "SHOPIFY", status: "SKIPPED_ZERO_AMOUNT", externalUsageRecordId: null };
    if (!input.usageLineItemId) throw new BillingProviderValidationError("USAGE_LINE_ITEM_MISSING", "An active Shopify usage line item is required.");
    const shopDomain = await this.resolveShopDomain(input.shopId);
    if (!shopDomain) throw new BillingProviderValidationError("SHOP_NOT_FOUND", "Shop was not found.");
    try {
      const data = await this.execute<UsageMutationResponse>(CREATE_USAGE, { subscriptionLineItemId: input.usageLineItemId, price: { amount: amount.toString(), currencyCode: code }, description: input.description }, { shopDomain });
      userError(data.appUsageRecordCreate.userErrors);
      const record = data.appUsageRecordCreate.appUsageRecord;
      if (!record) throw new ShopifyBillingProviderError("SHOPIFY_RESPONSE_INVALID", true, "Shopify did not return a usage record.");
      return { provider: "SHOPIFY", status: "SUCCEEDED", externalUsageRecordId: record.id, providerPayload: { id: record.id } };
    } catch (error) { return normalize(error); }
  }
}

export type ShopifyUsageRecord = { id: string; amount: string; currency: string };
type UsageRecordQueryResponse = { node: { id: string; price: { amount: string; currencyCode: string } } | null };
const GET_USAGE_RECORD = `query GetAppUsageRecord($id: ID!) { node(id: $id) { ... on AppUsageRecord { id price { amount currencyCode } } } }`;

/** Read-only, server-authenticated Shopify usage record lookup for billing reconciliation. */
export async function getShopifyUsageRecord(input: { shopId: string; externalUsageRecordId: string }, adapter = new ShopifyBillingAdapter()): Promise<ShopifyUsageRecord | null> {
  if (!input.shopId || !input.externalUsageRecordId) throw new BillingProviderValidationError("INVALID_USAGE_RECORD_LOOKUP", "A shop and provider reference are required.");
  return adapter.getUsageRecord(input);
}
