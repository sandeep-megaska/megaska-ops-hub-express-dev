import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { shopifyAdminGraphql } from "../express-checkout/shopify-admin";
import { LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_KEY, LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_NAMESPACE, type LoopDeskDiscountFunctionConfig } from "./discount-function";
import { compileLoopDeskDiscountFunctionConfig } from "./discount-function-config.server";

const EXTENSION_HANDLE = "loopdesk-discount-function";
const DISCOUNT_TITLE = "LoopDesk Promotions";
const FUNCTION_ARTIFACT_PATH = path.join(process.cwd(), "extensions", "loopdesk-discount-function", "target", "wasm32-unknown-unknown", "release", "loopdesk_discount_function.wasm");
const VALID_STATUSES = new Set(["ACTIVE", "SCHEDULED"]);

type UserError = { field?: string[] | null; message?: string | null };
type AppDiscountType = { functionId: string; functionHandle?: string | null; title: string; description?: string | null; appKey?: string | null; discountClasses?: string[] };
type AutomaticDiscount = { id: string; automaticDiscount?: { __typename?: string; title?: string | null; status?: string | null; discountId?: string | null; appDiscountType?: { functionId?: string | null; functionHandle?: string | null } | null; metafield?: { value?: string | null } | null } | null };
type AutomaticDiscountResult = { discountId?: string | null; title?: string | null; status?: string | null } | null | undefined;

type PublicationDiagnostics = {
  functionFound: boolean;
  functionId: string | null;
  functionHandle: string | null;
  automaticDiscount: "not-run" | "found" | "created" | "updated";
  automaticDiscountId: string | null;
  automaticDiscountTitle: string | null;
  automaticDiscountStatus: string | null;
  duplicateAutomaticDiscountIds: string[];
  metafieldUpdated: boolean;
  rulesCompiledCount: number;
  compiledRewardTypes: string[];
  fixedPriceRulesCompiledCount: number;
  percentageRulesCompiledCount: number;
  fixedAmountRulesCompiledCount: number;
  buildArtifactPresent: boolean;
  activationStatus: "blocked" | "activated";
  configHash: string;
  verification: { ok: boolean; errors: string[]; storedConfigHash: string | null };
};

function userErrorsMessage(errors: UserError[] | undefined) {
  return (errors || []).map((error) => `${error.field?.join(".") || "discount"}: ${error.message || "Unknown Shopify error"}`).join("; ");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function deterministicConfigHash(config: LoopDeskDiscountFunctionConfig) {
  return createHash("sha256").update(stableJson(config)).digest("hex");
}

function configMetafield(config: LoopDeskDiscountFunctionConfig) {
  return [{ namespace: LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_NAMESPACE, key: LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_KEY, type: "json", value: JSON.stringify(config) }];
}

export function validateLoopDeskDiscountFunctionBuildArtifact() {
  if (!existsSync(FUNCTION_ARTIFACT_PATH)) return { ok: false, reason: `Missing Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}. Run the LoopDesk function build before activation.` };
  const size = statSync(FUNCTION_ARTIFACT_PATH).size;
  if (size <= 8) return { ok: false, reason: `Invalid Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}: synthetic/minimal WASM artifacts are not accepted.` };
  const bytes = readFileSync(FUNCTION_ARTIFACT_PATH);
  if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) return { ok: false, reason: `Invalid Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}: file is not a WebAssembly module.` };
  try {
    const wasmModule = new WebAssembly.Module(bytes);
    const exports = WebAssembly.Module.exports(wasmModule);
    const imports = WebAssembly.Module.imports(wasmModule);
    if (!exports.some((item) => item.kind === "function" && item.name === "cart_lines_discounts_generate_run")) return { ok: false, reason: `Invalid Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}: missing cart_lines_discounts_generate_run export.` };
    if (!imports.some((item) => item.module === "shopify_function_v2" || item.module === "shopify_function_v1")) return { ok: false, reason: `Invalid Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}: missing Shopify Function runtime imports.` };
  } catch (error) {
    return { ok: false, reason: `Invalid Shopify Function artifact at ${FUNCTION_ARTIFACT_PATH}: ${error instanceof Error ? error.message : "WebAssembly validation failed"}.` };
  }
  return { ok: true, reason: null };
}

export function loopDeskDiscountFunctionBuildArtifactPresent() { return validateLoopDeskDiscountFunctionBuildArtifact().ok; }

export async function queryLoopDeskAppDiscountTypes(shopDomain: string, shopId: string) {
  const data = await shopifyAdminGraphql<{ appDiscountTypes: AppDiscountType[] }>(shopDomain, `query LoopDeskAppDiscountTypes { appDiscountTypes { functionId functionHandle title description appKey discountClasses } }`, {}, { shopId });
  return data.appDiscountTypes || [];
}

export function selectLoopDeskAppDiscountType(types: AppDiscountType[]) {
  const matches = types.filter((type) => type.functionHandle === EXTENSION_HANDLE || String(type.functionId || "").includes(EXTENSION_HANDLE) || type.title === "LoopDesk Discount Function" || type.title === DISCOUNT_TITLE || String(type.description || "").includes("LoopDesk"));
  if (matches.length !== 1) return { selected: null, reason: matches.length > 1 ? "Duplicate LoopDesk app discount function types found." : "LoopDesk app discount function was not found in Shopify appDiscountTypes." };
  const selected = matches[0];
  if (!selected.discountClasses?.includes("PRODUCT")) return { selected: null, reason: "LoopDesk app discount function does not advertise PRODUCT discount class capability." };
  return { selected, reason: null };
}

async function discountInputSupportsFunctionHandle(shopDomain: string, shopId: string) {
  const data = await shopifyAdminGraphql<{ __type?: { inputFields?: Array<{ name?: string | null }> } | null }>(shopDomain, `query LoopDeskDiscountInputSchema { __type(name: "DiscountAutomaticAppInput") { inputFields { name } } }`, {}, { shopId });
  return Boolean(data.__type?.inputFields?.some((field) => field.name === "functionHandle"));
}

async function findExistingLoopDeskDiscounts(shopDomain: string, shopId: string, functionType: AppDiscountType) {
  const data = await shopifyAdminGraphql<{ automaticDiscountNodes: { edges: Array<{ node: AutomaticDiscount }> } }>(shopDomain, `query LoopDeskAutomaticDiscounts($query: String!) { automaticDiscountNodes(first: 100, query: $query) { edges { node { id automaticDiscount { __typename ... on DiscountAutomaticApp { title status discountId appDiscountType { functionId functionHandle } metafield(namespace: "loopdesk", key: "discount_function_config") { value } } } } } } }`, { query: `title:${DISCOUNT_TITLE}` }, { shopId });
  const nodes = data.automaticDiscountNodes?.edges?.map((edge) => edge.node).filter((node) => node.automaticDiscount?.title === DISCOUNT_TITLE) || [];
  const identityMatches = nodes.filter((node) => node.automaticDiscount?.appDiscountType?.functionId === functionType.functionId || (functionType.functionHandle && node.automaticDiscount?.appDiscountType?.functionHandle === functionType.functionHandle));
  return { selected: identityMatches[0] || null, duplicates: identityMatches.length > 1 ? identityMatches.map((node) => node.id) : [], titleOnlyCount: nodes.length - identityMatches.length };
}

function automaticDiscountInput(functionType: AppDiscountType, config: LoopDeskDiscountFunctionConfig, useFunctionHandle: boolean, includeStartsAt = false) {
  return { title: DISCOUNT_TITLE, ...(useFunctionHandle && functionType.functionHandle ? { functionHandle: functionType.functionHandle } : { functionId: functionType.functionId }), ...(includeStartsAt ? { startsAt: new Date().toISOString() } : {}), combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true }, metafields: configMetafield(config) };
}

async function createAutomaticDiscount(shopDomain: string, shopId: string, functionType: AppDiscountType, config: LoopDeskDiscountFunctionConfig, useFunctionHandle: boolean) {
  const data = await shopifyAdminGraphql<{ discountAutomaticAppCreate: { automaticAppDiscount?: AutomaticDiscountResult; userErrors: UserError[] } }>(shopDomain, `mutation LoopDeskDiscountCreate($automaticAppDiscount: DiscountAutomaticAppInput!) { discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) { automaticAppDiscount { discountId title status } userErrors { field message } } }`, { automaticAppDiscount: automaticDiscountInput(functionType, config, useFunctionHandle, true) }, { shopId });
  const errors = data.discountAutomaticAppCreate.userErrors;
  if (errors?.length) throw new Error(`Shopify automatic discount create failed: ${userErrorsMessage(errors)}`);
  return data.discountAutomaticAppCreate.automaticAppDiscount;
}

async function updateAutomaticDiscount(shopDomain: string, shopId: string, discountId: string, functionType: AppDiscountType, config: LoopDeskDiscountFunctionConfig, useFunctionHandle: boolean) {
  const data = await shopifyAdminGraphql<{ discountAutomaticAppUpdate: { automaticAppDiscount?: AutomaticDiscountResult; userErrors: UserError[] } }>(shopDomain, `mutation LoopDeskDiscountUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) { discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) { automaticAppDiscount { discountId title status } userErrors { field message } } }`, { id: discountId, automaticAppDiscount: automaticDiscountInput(functionType, config, useFunctionHandle) }, { shopId });
  const errors = data.discountAutomaticAppUpdate.userErrors;
  if (errors?.length) throw new Error(`Shopify automatic discount update failed: ${userErrorsMessage(errors)}`);
  return data.discountAutomaticAppUpdate.automaticAppDiscount;
}

function verifyStoredConfig(node: AutomaticDiscount | null, functionType: AppDiscountType, config: LoopDeskDiscountFunctionConfig) {
  const errors: string[] = [];
  if (!node?.automaticDiscount) errors.push("LoopDesk automatic app discount was not found after publication.");
  const discount = node?.automaticDiscount;
  if (discount?.status && !VALID_STATUSES.has(discount.status)) errors.push(`LoopDesk automatic discount has invalid status ${discount.status}.`);
  if (discount?.appDiscountType?.functionId !== functionType.functionId && (!functionType.functionHandle || discount?.appDiscountType?.functionHandle !== functionType.functionHandle)) errors.push("LoopDesk automatic discount is attached to the wrong Function identity.");
  let storedHash: string | null = null;
  try {
    const parsed = JSON.parse(discount?.metafield?.value || "");
    storedHash = deterministicConfigHash(parsed);
    if (storedHash !== deterministicConfigHash(config)) errors.push("Stored Shopify metafield config does not semantically match compiled config.");
  } catch {
    errors.push("loopdesk.discount_function_config metafield is missing or invalid JSON.");
  }
  return { ok: errors.length === 0, errors, storedConfigHash: storedHash };
}

async function queryAutomaticDiscountById(shopDomain: string, shopId: string, id: string) {
  const data = await shopifyAdminGraphql<{ node?: AutomaticDiscount | null }>(shopDomain, `query LoopDeskAutomaticDiscountById($id: ID!) { node(id: $id) { id ... on DiscountAutomaticNode { automaticDiscount { __typename ... on DiscountAutomaticApp { title status discountId appDiscountType { functionId functionHandle } metafield(namespace: "loopdesk", key: "discount_function_config") { value } } } } } }`, { id }, { shopId });
  return data.node || null;
}

export async function publishLoopDeskPromotions(input: { shopId: string; shopDomain: string }) {
  const buildArtifactValidation = validateLoopDeskDiscountFunctionBuildArtifact();
  const config = await compileLoopDeskDiscountFunctionConfig(input.shopId, input.shopDomain);
  const diagnostics: PublicationDiagnostics = { functionFound: false, functionId: null, functionHandle: null, automaticDiscount: "not-run", automaticDiscountId: null, automaticDiscountTitle: null, automaticDiscountStatus: null, duplicateAutomaticDiscountIds: [], metafieldUpdated: false, rulesCompiledCount: config.rules.length, compiledRewardTypes: Array.from(new Set(config.rules.map((rule) => rule.rewardEnforcementType))).sort(), fixedPriceRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_price").length, percentageRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "percentage").length, fixedAmountRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_amount").length, buildArtifactPresent: buildArtifactValidation.ok, activationStatus: "blocked", configHash: deterministicConfigHash(config), verification: { ok: false, errors: [], storedConfigHash: null } };
  // Publication validates the deployed Shopify Function identity via Admin GraphQL.
  // A local WASM artifact is diagnostic-only because Vercel/Next.js runtime deployments do not own Shopify Function publication.

  const selectedResult = selectLoopDeskAppDiscountType(await queryLoopDeskAppDiscountTypes(input.shopDomain, input.shopId));
  const functionType = selectedResult.selected;
  diagnostics.functionFound = Boolean(functionType?.functionId);
  diagnostics.functionId = functionType?.functionId || null;
  diagnostics.functionHandle = functionType?.functionHandle || null;
  if (!functionType) return { ok: false, diagnostics, config, message: selectedResult.reason };

  const existing = await findExistingLoopDeskDiscounts(input.shopDomain, input.shopId, functionType);
  diagnostics.duplicateAutomaticDiscountIds = existing.duplicates;
  if (existing.duplicates.length) return { ok: false, diagnostics, config, message: `Duplicate LoopDesk automatic app discounts found for the same Function identity: ${existing.duplicates.join(", ")}. Resolve duplicates before publishing.` };
  if (!existing.selected && existing.titleOnlyCount > 0) return { ok: false, diagnostics, config, message: "Found title-only LoopDesk Promotions discounts that do not match the LoopDesk Function identity; refusing ambiguous update." };

  const useFunctionHandle = Boolean(functionType.functionHandle) && await discountInputSupportsFunctionHandle(input.shopDomain, input.shopId).catch(() => false);
  let automaticDiscount: AutomaticDiscountResult;
  if (existing.selected?.id) {
    automaticDiscount = await updateAutomaticDiscount(input.shopDomain, input.shopId, existing.selected.id, functionType, config, useFunctionHandle);
    diagnostics.automaticDiscount = "updated";
  } else {
    automaticDiscount = await createAutomaticDiscount(input.shopDomain, input.shopId, functionType, config, useFunctionHandle);
    diagnostics.automaticDiscount = "created";
  }
  diagnostics.automaticDiscountId = automaticDiscount?.discountId || existing.selected?.automaticDiscount?.discountId || existing.selected?.id || null;
  diagnostics.automaticDiscountTitle = automaticDiscount?.title || existing.selected?.automaticDiscount?.title || DISCOUNT_TITLE;
  diagnostics.automaticDiscountStatus = automaticDiscount?.status || existing.selected?.automaticDiscount?.status || null;
  diagnostics.metafieldUpdated = true;

  const verifyNodeId = existing.selected?.id || diagnostics.automaticDiscountId;
  const verified = verifyNodeId ? verifyStoredConfig(await queryAutomaticDiscountById(input.shopDomain, input.shopId, verifyNodeId), functionType, config) : { ok: false, errors: ["Shopify did not return a discount id for verification."], storedConfigHash: null };
  diagnostics.verification = verified;
  diagnostics.activationStatus = verified.ok ? "activated" : "blocked";
  return { ok: verified.ok, diagnostics, config, message: verified.ok ? (existing.selected?.id ? "LoopDesk automatic discount updated idempotently." : "LoopDesk automatic discount created.") : `LoopDesk automatic discount saved but verification failed: ${verified.errors.join(" ")}` };
}

export async function getLoopDeskPromotionPublicationStatus(input: { shopId: string; shopDomain: string }) {
  const config = await compileLoopDeskDiscountFunctionConfig(input.shopId, input.shopDomain);
  const selectedResult = selectLoopDeskAppDiscountType(await queryLoopDeskAppDiscountTypes(input.shopDomain, input.shopId));
  const functionType = selectedResult.selected;
  if (!functionType) {
    return { ok: false, synchronized: false, message: selectedResult.reason || "LoopDesk Function unavailable.", configHash: deterministicConfigHash(config), functionHandle: null, functionId: null, automaticDiscountId: null, activeAutomaticDiscount: false, fixedPriceRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_price").length };
  }
  const existing = await findExistingLoopDeskDiscounts(input.shopDomain, input.shopId, functionType);
  const verified = existing.selected ? verifyStoredConfig(existing.selected, functionType, config) : { ok: false, errors: ["LoopDesk automatic app discount was not found."], storedConfigHash: null };
  const activeAutomaticDiscount = Boolean(existing.selected?.automaticDiscount?.status && VALID_STATUSES.has(existing.selected.automaticDiscount.status));
  const fixedPriceRulesCompiledCount = config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_price").length;
  const synchronized = Boolean(verified.ok && activeAutomaticDiscount && fixedPriceRulesCompiledCount > 0);
  return { ok: synchronized, synchronized, message: synchronized ? "LoopDesk automatic discount is synchronized." : verified.errors.join(" "), configHash: deterministicConfigHash(config), storedConfigHash: verified.storedConfigHash, functionHandle: functionType.functionHandle || null, functionId: functionType.functionId || null, productCapability: functionType.discountClasses?.includes("PRODUCT") || false, automaticDiscountId: existing.selected?.automaticDiscount?.discountId || existing.selected?.id || null, activeAutomaticDiscount, automaticDiscountStatus: existing.selected?.automaticDiscount?.status || null, fixedPriceRulesCompiledCount };
}

export const activateLoopDeskDiscountFunction = publishLoopDeskPromotions;
