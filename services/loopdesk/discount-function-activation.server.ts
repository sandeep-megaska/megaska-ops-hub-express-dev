import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { shopifyAdminGraphql } from "../express-checkout/shopify-admin";
import { LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_KEY, LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_NAMESPACE, type LoopDeskDiscountFunctionConfig } from "./discount-function";
import { compileLoopDeskDiscountFunctionConfig } from "./discount-function-config.server";

const EXTENSION_HANDLE = "loopdesk-discount-function";
const DISCOUNT_TITLE = "LoopDesk Promotions";
const FUNCTION_ARTIFACT_PATH = path.join(process.cwd(), "extensions", "loopdesk-discount-function", "dist", "function.wasm");

type UserError = { field?: string[] | null; message?: string | null };
type AppDiscountType = { functionId: string; title: string; description?: string | null; appKey?: string | null; discountClasses?: string[] };
type AutomaticDiscount = { id: string; automaticDiscount?: { __typename?: string; title?: string | null; status?: string | null; discountId?: string | null; appDiscountType?: { functionId?: string | null } | null } | null };

function userErrorsMessage(errors: UserError[] | undefined) {
  return (errors || []).map((error) => `${error.field?.join(".") || "discount"}: ${error.message || "Unknown Shopify error"}`).join("; ");
}

function configMetafield(config: LoopDeskDiscountFunctionConfig) {
  return [{ namespace: LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_NAMESPACE, key: LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_KEY, type: "json", value: JSON.stringify(config) }];
}

export function validateLoopDeskDiscountFunctionBuildArtifact() {
  if (!existsSync(FUNCTION_ARTIFACT_PATH)) {
    return { ok: false, reason: `Missing Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}. Run the LoopDesk function build before activation.` };
  }

  const size = statSync(FUNCTION_ARTIFACT_PATH).size;
  if (size <= 8) {
    return { ok: false, reason: `Invalid Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}: synthetic/minimal WASM artifacts are not accepted.` };
  }

  const bytes = readFileSync(FUNCTION_ARTIFACT_PATH);
  if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    return { ok: false, reason: `Invalid Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}: file is not a WebAssembly module.` };
  }

  let module: WebAssembly.Module;
  try {
    module = new WebAssembly.Module(bytes);
  } catch (error) {
    return { ok: false, reason: `Invalid Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}: ${error instanceof Error ? error.message : "WebAssembly validation failed"}.` };
  }

  const exports = WebAssembly.Module.exports(module);
  const imports = WebAssembly.Module.imports(module);
  const hasTargetExport = exports.some((item) => item.kind === "function" && item.name === "cartLinesDiscountsGenerateRun");
  const usesShopifyFunctionRuntime = imports.some((item) => item.module === "shopify_function_v2" || item.module === "shopify_function_v1");

  if (!hasTargetExport) {
    return { ok: false, reason: `Invalid Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}: missing cartLinesDiscountsGenerateRun export.` };
  }

  if (!usesShopifyFunctionRuntime) {
    return { ok: false, reason: `Invalid Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}: missing Shopify Function runtime imports.` };
  }

  return { ok: true, reason: null };
}

export function loopDeskDiscountFunctionBuildArtifactPresent() {
  return validateLoopDeskDiscountFunctionBuildArtifact().ok;
}

export async function queryLoopDeskAppDiscountTypes(shopDomain: string, shopId: string) {
  const data = await shopifyAdminGraphql<{ appDiscountTypes: AppDiscountType[] }>(shopDomain, `query LoopDeskAppDiscountTypes { appDiscountTypes { functionId title description appKey discountClasses } }`, {}, { shopId });
  return data.appDiscountTypes || [];
}

export function selectLoopDeskAppDiscountType(types: AppDiscountType[]) {
  return types.find((type) => type.title === "LoopDesk Discount Function" || type.title === "LoopDesk Promotions" || String(type.description || "").includes("LoopDesk") || String(type.functionId || "").includes(EXTENSION_HANDLE)) || null;
}

async function findExistingLoopDeskDiscount(shopDomain: string, shopId: string, functionId: string) {
  const data = await shopifyAdminGraphql<{ automaticDiscountNodes: { edges: Array<{ node: AutomaticDiscount }> } }>(shopDomain, `query LoopDeskAutomaticDiscounts($query: String!) { automaticDiscountNodes(first: 50, query: $query) { edges { node { id automaticDiscount { __typename ... on DiscountAutomaticApp { title status discountId appDiscountType { functionId } } } } } } }`, { query: `title:${DISCOUNT_TITLE}` }, { shopId });
  const nodes = data.automaticDiscountNodes?.edges?.map((edge) => edge.node) || [];
  return nodes.find((node) => node.automaticDiscount?.title === DISCOUNT_TITLE && node.automaticDiscount?.appDiscountType?.functionId === functionId) || nodes.find((node) => node.automaticDiscount?.title === DISCOUNT_TITLE) || null;
}

async function createAutomaticDiscount(shopDomain: string, shopId: string, functionId: string, config: LoopDeskDiscountFunctionConfig) {
  const data = await shopifyAdminGraphql<{ discountAutomaticAppCreate: { automaticAppDiscount?: { discountId?: string; title?: string; status?: string } | null; userErrors: UserError[] } }>(shopDomain, `mutation LoopDeskDiscountCreate($automaticAppDiscount: DiscountAutomaticAppInput!) { discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) { automaticAppDiscount { discountId title status } userErrors { field message } } }`, { automaticAppDiscount: { title: DISCOUNT_TITLE, functionId, startsAt: new Date().toISOString(), combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true }, metafields: configMetafield(config) } }, { shopId });
  const errors = data.discountAutomaticAppCreate.userErrors;
  if (errors?.length) throw new Error(`Shopify automatic discount create failed: ${userErrorsMessage(errors)}`);
  return data.discountAutomaticAppCreate.automaticAppDiscount;
}

async function updateAutomaticDiscount(shopDomain: string, shopId: string, discountId: string, functionId: string, config: LoopDeskDiscountFunctionConfig) {
  const data = await shopifyAdminGraphql<{ discountAutomaticAppUpdate: { automaticAppDiscount?: { discountId?: string; title?: string; status?: string } | null; userErrors: UserError[] } }>(shopDomain, `mutation LoopDeskDiscountUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) { discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) { automaticAppDiscount { discountId title status } userErrors { field message } } }`, { id: discountId, automaticAppDiscount: { title: DISCOUNT_TITLE, functionId, combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true }, metafields: configMetafield(config) } }, { shopId });
  const errors = data.discountAutomaticAppUpdate.userErrors;
  if (errors?.length) throw new Error(`Shopify automatic discount update failed: ${userErrorsMessage(errors)}`);
  return data.discountAutomaticAppUpdate.automaticAppDiscount;
}

export async function activateLoopDeskDiscountFunction(input: { shopId: string; shopDomain: string }) {
  const buildArtifactValidation = validateLoopDeskDiscountFunctionBuildArtifact();
  const buildArtifactPresent = buildArtifactValidation.ok;
  const config = await compileLoopDeskDiscountFunctionConfig(input.shopId, input.shopDomain);
  const diagnostics = { functionFound: false, functionId: null as string | null, automaticDiscount: "not-run" as "not-run" | "found" | "created" | "updated", metafieldUpdated: false, rulesCompiledCount: config.rules.length, buildArtifactPresent, activationStatus: "blocked" as "blocked" | "activated" };

  if (!buildArtifactValidation.ok) return { ok: false, diagnostics, config, message: buildArtifactValidation.reason };

  const functionType = selectLoopDeskAppDiscountType(await queryLoopDeskAppDiscountTypes(input.shopDomain, input.shopId));
  diagnostics.functionFound = Boolean(functionType?.functionId);
  diagnostics.functionId = functionType?.functionId || null;
  if (!functionType?.functionId) return { ok: false, diagnostics, config, message: "LoopDesk app discount function was not found in Shopify appDiscountTypes." };

  const existing = await findExistingLoopDeskDiscount(input.shopDomain, input.shopId, functionType.functionId);
  if (existing?.id) {
    await updateAutomaticDiscount(input.shopDomain, input.shopId, existing.id, functionType.functionId, config);
    diagnostics.automaticDiscount = "updated";
  } else {
    await createAutomaticDiscount(input.shopDomain, input.shopId, functionType.functionId, config);
    diagnostics.automaticDiscount = "created";
  }
  diagnostics.metafieldUpdated = true;
  diagnostics.activationStatus = "activated";
  return { ok: true, diagnostics, config, message: existing?.id ? "LoopDesk automatic discount updated idempotently." : "LoopDesk automatic discount created." };
}
