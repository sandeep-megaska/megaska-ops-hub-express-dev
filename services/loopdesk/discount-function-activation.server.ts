import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { shopifyAdminGraphql } from "../express-checkout/shopify-admin";
import { getPromotionRulesConfig } from "../promotion-rules/config";
import { LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_KEY, LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_NAMESPACE, type LoopDeskDiscountFunctionConfig } from "./discount-function";
import { canonicalizeProductVariantGid, compileLoopDeskDiscountFunctionConfig, isRustFunctionSupportedTriggerType } from "./discount-function-config.server";

const DISCOUNT_TITLE = "LoopDesk Promotions";
const FUNCTION_ARTIFACT_PATH = path.join(process.cwd(), "extensions", "loopdesk-discount-function", "target", "wasm32-unknown-unknown", "release", "loopdesk_discount_function.wasm");
const VALID_STATUSES = new Set(["ACTIVE", "SCHEDULED"]);

type UserError = { field?: string[] | null; message?: string | null };
type DiscountMetafieldSchemaType = { name?: string | null; fields?: Array<{ name?: string | null }> | null } | null;
export type AppDiscountType = { functionId: string; title: string; description?: string | null; appKey?: string | null; discountClasses?: string[] };
export type AutomaticDiscount = {
  id: string;
  metafield?: { value?: string | null } | null;
  automaticDiscount?: {
    __typename?: string;
    title?: string | null;
    status?: string | null;
    discountId?: string | null;
    appDiscountType?: { functionId?: string | null } | null;
  } | null;
};
type AutomaticDiscountResult = { discountId?: string | null; title?: string | null; status?: string | null } | null | undefined;

class DiscountMetafieldReadUnsupportedError extends Error {
  constructor() {
    super("discount_metafield_read_unsupported");
    this.name = "DiscountMetafieldReadUnsupportedError";
  }
}

type PublicationDiagnostics = {
  localCompiledConfig: LoopDeskDiscountFunctionConfig;
  functionFound: boolean;
  functionId: string | null;
  functionHandle: string | null;
  deployedFunction: AppDiscountType | null;
  functionIdentityMatch: boolean;
  automaticDiscount: "not-run" | "found" | "created" | "updated";
  automaticDiscountId: string | null;
  automaticDiscountTitle: string | null;
  automaticDiscountStatus: string | null;
  duplicateAutomaticDiscountIds: string[];
  titleOnlyAutomaticDiscountCount: number;
  metafieldRawValue: string | null;
  metafieldParsed: LoopDeskDiscountFunctionConfig | null;
  metafieldUpdated: boolean;
  rulesCompiledCount: number;
  compiledRewardTypes: string[];
  fixedPriceRulesCompiledCount: number;
  percentageRulesCompiledCount: number;
  fixedAmountRulesCompiledCount: number;
  buildArtifactPresent: boolean;
  activationStatus: "blocked" | "activated";
  synchronized: boolean;
  compiledConfigHash: string;
  storedConfigHash: string | null;
  blockingReasons: string[];
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
  const data = await shopifyAdminGraphql<{ appDiscountTypes: AppDiscountType[] }>(shopDomain, `query LoopDeskAppDiscountTypes { appDiscountTypes { functionId title description appKey discountClasses } }`, {}, { shopId });
  return data.appDiscountTypes || [];
}

export function selectLoopDeskAppDiscountType(types: AppDiscountType[]) {
  const exactFunctionTitle = types.filter((type) => type.title === "LoopDesk Discount Function");
  const exactDiscountTitle = types.filter((type) => type.title === DISCOUNT_TITLE);
  const broadLoopDesk = types.filter((type) => /LoopDesk/i.test(`${type.title} ${type.description || ""}`));
  const candidates = exactFunctionTitle.length ? exactFunctionTitle : exactDiscountTitle.length ? exactDiscountTitle : broadLoopDesk;
  if (!candidates.length) return { selected: null, reason: "missing_function" };
  const productCandidates = candidates.filter((type) => type.discountClasses?.includes("PRODUCT"));
  if (!productCandidates.length) return { selected: null, reason: "wrong_discount_class", candidate: candidates[0] };
  if (productCandidates.length > 1) return { selected: null, reason: "ambiguous_function_identity", candidates: productCandidates };
  return { selected: productCandidates[0], reason: null };
}

function isMetafieldSchemaError(error: unknown) {
  return error instanceof Error && /\bField 'metafield' doesn't exist\b/.test(error.message);
}

function fieldNames(type: DiscountMetafieldSchemaType) {
  return type?.fields?.map((field) => field.name).filter((name): name is string => Boolean(name)) || [];
}

async function assertAutomaticDiscountNodeMetafieldReadable(shopDomain: string, shopId: string) {
  const data = await shopifyAdminGraphql<{
    discountAutomaticNode: DiscountMetafieldSchemaType;
    discountAutomaticApp: DiscountMetafieldSchemaType;
  }>(shopDomain, `query LoopDeskDiscountMetafieldSchema { discountAutomaticNode: __type(name: "DiscountAutomaticNode") { name fields { name } } discountAutomaticApp: __type(name: "DiscountAutomaticApp") { name fields { name } } }`, {}, { shopId });
  const nodeFields = fieldNames(data.discountAutomaticNode);
  const appFields = fieldNames(data.discountAutomaticApp);
  if (!nodeFields.includes("metafield") && !nodeFields.includes("metafields") && !appFields.includes("metafield") && !appFields.includes("metafields")) {
    console.warn("[LOOPDESK DISCOUNT METAFIELD SCHEMA] read_unsupported", {
      discountAutomaticNodeFields: nodeFields,
      discountAutomaticAppFields: appFields,
    });
    throw new DiscountMetafieldReadUnsupportedError();
  }
}

async function findExistingLoopDeskDiscounts(shopDomain: string, shopId: string, functionType: AppDiscountType) {
  const data = await shopifyAdminGraphql<{ automaticDiscountNodes: { edges: Array<{ node: AutomaticDiscount }> } }>(shopDomain, `query LoopDeskAutomaticDiscounts { automaticDiscountNodes(first: 100) { edges { node { id metafield(namespace: "loopdesk", key: "discount_function_config") { value } automaticDiscount { __typename ... on DiscountAutomaticApp { title status discountId appDiscountType { functionId } } } } } } }`, {}, { shopId }).catch(async (error: unknown) => {
    if (isMetafieldSchemaError(error)) await assertAutomaticDiscountNodeMetafieldReadable(shopDomain, shopId);
    throw error;
  });
  const nodes = data.automaticDiscountNodes?.edges?.map((edge) => edge.node).filter((node) => node.automaticDiscount?.__typename === "DiscountAutomaticApp") || [];
  const identityMatches = nodes.filter((node) => node.automaticDiscount?.appDiscountType?.functionId === functionType.functionId);
  const titleOnly = nodes.filter((node) => node.automaticDiscount?.title === DISCOUNT_TITLE && !identityMatches.includes(node));
  return { selected: identityMatches[0] || null, duplicates: identityMatches.length > 1 ? identityMatches.map((node) => node.id) : [], titleOnlyCount: titleOnly.length };
}

function automaticDiscountInput(functionType: AppDiscountType, config: LoopDeskDiscountFunctionConfig, includeStartsAt = false) {
  return { title: DISCOUNT_TITLE, functionId: functionType.functionId, ...(includeStartsAt ? { startsAt: new Date().toISOString() } : {}), combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true }, metafields: configMetafield(config) };
}

async function createAutomaticDiscount(shopDomain: string, shopId: string, functionType: AppDiscountType, config: LoopDeskDiscountFunctionConfig) {
  const data = await shopifyAdminGraphql<{ discountAutomaticAppCreate: { automaticAppDiscount?: AutomaticDiscountResult; userErrors: UserError[] } }>(shopDomain, `mutation LoopDeskDiscountCreate($automaticAppDiscount: DiscountAutomaticAppInput!) { discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) { automaticAppDiscount { discountId title status } userErrors { field message } } }`, { automaticAppDiscount: automaticDiscountInput(functionType, config, true) }, { shopId });
  const errors = data.discountAutomaticAppCreate.userErrors;
  if (errors?.length) throw new Error(`Shopify automatic discount create failed: ${userErrorsMessage(errors)}`);
  return data.discountAutomaticAppCreate.automaticAppDiscount;
}

async function updateAutomaticDiscount(shopDomain: string, shopId: string, discountId: string, functionType: AppDiscountType, config: LoopDeskDiscountFunctionConfig) {
  const data = await shopifyAdminGraphql<{ discountAutomaticAppUpdate: { automaticAppDiscount?: AutomaticDiscountResult; userErrors: UserError[] } }>(shopDomain, `mutation LoopDeskDiscountUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) { discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) { automaticAppDiscount { discountId title status } userErrors { field message } } }`, { id: discountId, automaticAppDiscount: automaticDiscountInput(functionType, config) }, { shopId });
  const errors = data.discountAutomaticAppUpdate.userErrors;
  if (errors?.length) throw new Error(`Shopify automatic discount update failed: ${userErrorsMessage(errors)}`);
  return data.discountAutomaticAppUpdate.automaticAppDiscount;
}

export function verifyStoredConfig(node: AutomaticDiscount | null, functionType: AppDiscountType, config: LoopDeskDiscountFunctionConfig) {
  const errors: string[] = [];
  if (!node?.automaticDiscount) errors.push("missing_automatic_discount");
  const discount = node?.automaticDiscount;
  if (discount?.status && !VALID_STATUSES.has(discount.status)) errors.push("inactive_discount");
  if (discount?.appDiscountType?.functionId !== functionType.functionId) errors.push("function_identity_mismatch");
  let storedHash: string | null = null;
  let parsed: LoopDeskDiscountFunctionConfig | null = null;
  const raw = node?.metafield?.value || null;
  try {
    parsed = JSON.parse(raw || "");
    storedHash = deterministicConfigHash(parsed as LoopDeskDiscountFunctionConfig);
    if (storedHash !== deterministicConfigHash(config)) errors.push("stale_metafield");
  } catch {
    errors.push("missing_or_invalid_metafield");
  }
  return { ok: errors.length === 0, errors, storedConfigHash: storedHash, metafieldRawValue: raw, metafieldParsed: parsed };
}

async function queryAutomaticDiscountById(shopDomain: string, shopId: string, id: string) {
  const data = await shopifyAdminGraphql<{ node?: AutomaticDiscount | null }>(shopDomain, `query LoopDeskAutomaticDiscountById($id: ID!) { node(id: $id) { id ... on DiscountAutomaticNode { metafield(namespace: "loopdesk", key: "discount_function_config") { value } automaticDiscount { __typename ... on DiscountAutomaticApp { title status discountId appDiscountType { functionId } } } } } }`, { id }, { shopId }).catch(async (error: unknown) => {
    if (isMetafieldSchemaError(error)) await assertAutomaticDiscountNodeMetafieldReadable(shopDomain, shopId);
    throw error;
  });
  return data.node || null;
}

export async function publishLoopDeskPromotions(input: { shopId: string; shopDomain: string }) {
  const buildArtifactValidation = validateLoopDeskDiscountFunctionBuildArtifact();
  const config = await compileLoopDeskDiscountFunctionConfig(input.shopId, input.shopDomain);
  const preflight = await promotionPublicationPreflight(input.shopId, input.shopDomain, config);
  const diagnostics: PublicationDiagnostics = { localCompiledConfig: config, functionFound: false, functionId: null, functionHandle: null, deployedFunction: null, functionIdentityMatch: false, automaticDiscount: "not-run", automaticDiscountId: null, automaticDiscountTitle: null, automaticDiscountStatus: null, duplicateAutomaticDiscountIds: [], titleOnlyAutomaticDiscountCount: 0, metafieldRawValue: null, metafieldParsed: null, metafieldUpdated: false, rulesCompiledCount: config.rules.length, compiledRewardTypes: Array.from(new Set(config.rules.map((rule) => rule.rewardEnforcementType))).sort(), fixedPriceRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_price").length, percentageRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "percentage").length, fixedAmountRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_amount").length, buildArtifactPresent: buildArtifactValidation.ok, activationStatus: "blocked", synchronized: false, compiledConfigHash: deterministicConfigHash(config), storedConfigHash: null, blockingReasons: [...preflight.blockingReasons], verification: { ok: false, errors: [], storedConfigHash: null } };
  // Publication validates the deployed Shopify Function identity via Admin GraphQL.
  // A local WASM artifact is diagnostic-only because Vercel/Next.js runtime deployments do not own Shopify Function publication.

  const selectedResult = selectLoopDeskAppDiscountType(await queryLoopDeskAppDiscountTypes(input.shopDomain, input.shopId));
  const functionType = selectedResult.selected;
  diagnostics.functionFound = Boolean(functionType?.functionId);
  diagnostics.functionId = functionType?.functionId || null;
  diagnostics.functionHandle = null;
  diagnostics.deployedFunction = functionType || ("candidate" in selectedResult ? selectedResult.candidate || null : null);
  diagnostics.functionIdentityMatch = false;
  if (selectedResult.reason) diagnostics.blockingReasons.push(selectedResult.reason);
  if (preflight.blockingReasons.length) return { ok: false, diagnostics, config, message: `Publication blocked: ${diagnostics.blockingReasons.join(", ")}` };
  if (!functionType) return { ok: false, diagnostics, config, message: `Publication blocked: ${diagnostics.blockingReasons.join(", ")}` };

  const existing = await findExistingLoopDeskDiscounts(input.shopDomain, input.shopId, functionType).catch((error: unknown) => {
    if (error instanceof DiscountMetafieldReadUnsupportedError) return null;
    throw error;
  });
  if (!existing) {
    diagnostics.blockingReasons.push("discount_metafield_read_unsupported");
    return { ok: false, diagnostics, config, message: `Publication blocked: ${diagnostics.blockingReasons.join(", ")}` };
  }
  diagnostics.duplicateAutomaticDiscountIds = existing.duplicates;
  diagnostics.titleOnlyAutomaticDiscountCount = existing.titleOnlyCount;
  if (existing.duplicates.length) diagnostics.blockingReasons.push("duplicate_automatic_discounts");
  if (!existing.selected && existing.titleOnlyCount > 0) diagnostics.blockingReasons.push("ambiguous_title_only_discounts");
  if (diagnostics.blockingReasons.length) return { ok: false, diagnostics, config, message: `Publication blocked: ${diagnostics.blockingReasons.join(", ")}` };

  let automaticDiscount: AutomaticDiscountResult;
  if (existing.selected?.id) {
    automaticDiscount = await updateAutomaticDiscount(input.shopDomain, input.shopId, existing.selected.id, functionType, config);
    diagnostics.automaticDiscount = "updated";
  } else {
    automaticDiscount = await createAutomaticDiscount(input.shopDomain, input.shopId, functionType, config);
    diagnostics.automaticDiscount = "created";
  }
  diagnostics.automaticDiscountId = automaticDiscount?.discountId || existing.selected?.automaticDiscount?.discountId || existing.selected?.id || null;
  diagnostics.automaticDiscountTitle = automaticDiscount?.title || existing.selected?.automaticDiscount?.title || DISCOUNT_TITLE;
  diagnostics.automaticDiscountStatus = automaticDiscount?.status || existing.selected?.automaticDiscount?.status || null;
  diagnostics.metafieldUpdated = true;

  const verifyNodeId = existing.selected?.id || diagnostics.automaticDiscountId;
  const verifyNode = verifyNodeId ? await queryAutomaticDiscountById(input.shopDomain, input.shopId, verifyNodeId).catch((error: unknown) => {
    if (error instanceof DiscountMetafieldReadUnsupportedError) return null;
    throw error;
  }) : null;
  if (verifyNodeId && !verifyNode) {
    diagnostics.blockingReasons.push("discount_metafield_read_unsupported");
    return { ok: false, diagnostics, config, message: `LoopDesk automatic discount saved but verification failed: discount_metafield_read_unsupported` };
  }
  const verified = verifyNode ? verifyStoredConfig(verifyNode, functionType, config) : { ok: false, errors: ["missing_verification_discount_id"], storedConfigHash: null, metafieldRawValue: null, metafieldParsed: null };
  diagnostics.functionIdentityMatch = Boolean(functionType && verifyNode?.automaticDiscount?.appDiscountType?.functionId === functionType.functionId);
  diagnostics.verification = verified;
  diagnostics.metafieldRawValue = verified.metafieldRawValue || null;
  diagnostics.metafieldParsed = verified.metafieldParsed || null;
  diagnostics.storedConfigHash = verified.storedConfigHash;
  diagnostics.blockingReasons.push(...verified.errors);
  diagnostics.synchronized = verified.ok;
  diagnostics.activationStatus = verified.ok ? "activated" : "blocked";
  return { ok: verified.ok, diagnostics, config, message: verified.ok ? (existing.selected?.id ? "LoopDesk automatic discount updated idempotently." : "LoopDesk automatic discount created.") : `LoopDesk automatic discount saved but verification failed: ${verified.errors.join(", ")}` };
}

async function promotionPublicationPreflight(shopId: string, shopDomain: string, config: LoopDeskDiscountFunctionConfig) {
  const promotionConfig = await getPromotionRulesConfig(shopId, shopDomain);
  const blockingReasons: string[] = [];
  if (promotionConfig.enabled && promotionConfig.rules.some((rule) => rule.enabled && rule.status === "active") && config.rules.length === 0) blockingReasons.push("empty_compiled_config");
  for (const rule of promotionConfig.rules.filter((rule) => rule.enabled && rule.status === "active")) {
    const trigger = rule.eligibility.triggers[0] || { type: "always" as const };
    if (!isRustFunctionSupportedTriggerType(trigger.type)) blockingReasons.push(`unsupported_trigger:${rule.id}:${trigger.type}`);
    try { canonicalizeProductVariantGid(rule.reward.variantGid); } catch { blockingReasons.push(`malformed_reward_variant_gid:${rule.id}`); }
  }
  return { blockingReasons: Array.from(new Set(blockingReasons)) };
}

export async function getLoopDeskPromotionPublicationStatus(input: { shopId: string; shopDomain: string }) {
  const config = await compileLoopDeskDiscountFunctionConfig(input.shopId, input.shopDomain);
  const selectedResult = selectLoopDeskAppDiscountType(await queryLoopDeskAppDiscountTypes(input.shopDomain, input.shopId));
  const functionType = selectedResult.selected;
  if (!functionType) {
    const blockingReasons = [selectedResult.reason || "missing_function"];
    return { ok: false, synchronized: false, message: blockingReasons.join(", "), compiledConfigHash: deterministicConfigHash(config), storedConfigHash: null, functionHandle: null, functionId: null, automaticDiscountId: null, activeAutomaticDiscount: false, automaticDiscountStatus: null, blockingReasons, fixedPriceRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_price").length };
  }
  const existing = await findExistingLoopDeskDiscounts(input.shopDomain, input.shopId, functionType).catch((error: unknown) => {
    if (error instanceof DiscountMetafieldReadUnsupportedError) return null;
    throw error;
  });
  if (!existing) {
    const blockingReasons = ["discount_metafield_read_unsupported"];
    return { ok: false, synchronized: false, message: blockingReasons.join(", "), compiledConfigHash: deterministicConfigHash(config), storedConfigHash: null, functionHandle: null, functionId: functionType.functionId || null, automaticDiscountId: null, activeAutomaticDiscount: false, automaticDiscountStatus: null, blockingReasons, fixedPriceRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_price").length };
  }
  const verified = existing.selected ? verifyStoredConfig(existing.selected, functionType, config) : { ok: false, errors: ["missing_automatic_discount"], storedConfigHash: null, metafieldRawValue: null, metafieldParsed: null };
  const activeAutomaticDiscount = Boolean(existing.selected?.automaticDiscount?.status && VALID_STATUSES.has(existing.selected.automaticDiscount.status));
  const fixedPriceRulesCompiledCount = config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_price").length;
  const blockingReasons = [...verified.errors];
  if (existing.duplicates.length) blockingReasons.push("duplicate_automatic_discounts");
  if (!activeAutomaticDiscount) blockingReasons.push("inactive_discount");
  if (fixedPriceRulesCompiledCount <= 0) blockingReasons.push("no_fixed_price_rules");
  const synchronized = Boolean(verified.ok && activeAutomaticDiscount && fixedPriceRulesCompiledCount > 0 && !existing.duplicates.length);
  return { ok: synchronized, synchronized, message: synchronized ? "LoopDesk automatic discount is synchronized." : blockingReasons.join(", "), compiledConfigHash: deterministicConfigHash(config), storedConfigHash: verified.storedConfigHash, functionHandle: null, functionId: functionType.functionId || null, productCapability: functionType.discountClasses?.includes("PRODUCT") || false, automaticDiscountId: existing.selected?.automaticDiscount?.discountId || existing.selected?.id || null, activeAutomaticDiscount, automaticDiscountStatus: existing.selected?.automaticDiscount?.status || null, blockingReasons, fixedPriceRulesCompiledCount };
}

export async function getLoopDeskPromotionPublicationDiagnostics(input: { shopId: string; shopDomain: string }) {
  const config = await compileLoopDeskDiscountFunctionConfig(input.shopId, input.shopDomain);
  const preflight = await promotionPublicationPreflight(input.shopId, input.shopDomain, config);
  const appDiscountTypes = await queryLoopDeskAppDiscountTypes(input.shopDomain, input.shopId);
  const selectedResult = selectLoopDeskAppDiscountType(appDiscountTypes);
  const functionType = selectedResult.selected;
  const blockingReasons = [...preflight.blockingReasons];
  if (selectedResult.reason) blockingReasons.push(selectedResult.reason);
  let automaticDiscount: AutomaticDiscount | null = null;
  let duplicates: string[] = [];
  let titleOnlyAutomaticDiscountCount = 0;
  let verified = { ok: false, errors: functionType ? ["missing_automatic_discount"] : blockingReasons, storedConfigHash: null as string | null, metafieldRawValue: null as string | null, metafieldParsed: null as LoopDeskDiscountFunctionConfig | null };
  if (functionType) {
    const existing = await findExistingLoopDeskDiscounts(input.shopDomain, input.shopId, functionType).catch((error: unknown) => {
      if (error instanceof DiscountMetafieldReadUnsupportedError) return null;
      throw error;
    });
    if (!existing) {
      blockingReasons.push("discount_metafield_read_unsupported");
      const uniqueBlockingReasons = Array.from(new Set(blockingReasons));
      return {
        ok: false,
        shopDomain: input.shopDomain,
        localCompiledConfig: config,
        compiledConfigHash: deterministicConfigHash(config),
        deployedFunction: functionType,
        appDiscountTypes,
        functionIdentityMatch: false,
        matchingAutomaticDiscount: null,
        duplicateAutomaticDiscountIds: [],
        titleOnlyAutomaticDiscountCount: 0,
        metafieldRawValue: null,
        metafieldParsed: null,
        storedConfigHash: null,
        synchronized: false,
        automaticDiscountStatus: null,
        blockingReasons: uniqueBlockingReasons,
      };
    }
    automaticDiscount = existing.selected;
    duplicates = existing.duplicates;
    titleOnlyAutomaticDiscountCount = existing.titleOnlyCount;
    if (duplicates.length) blockingReasons.push("duplicate_automatic_discounts");
    if (!existing.selected && existing.titleOnlyCount > 0) blockingReasons.push("ambiguous_title_only_discounts");
    verified = existing.selected ? verifyStoredConfig(existing.selected, functionType, config) : verified;
    blockingReasons.push(...verified.errors);
  }
  const activeAutomaticDiscount = Boolean(automaticDiscount?.automaticDiscount?.status && VALID_STATUSES.has(automaticDiscount.automaticDiscount.status));
  if (automaticDiscount && !activeAutomaticDiscount) blockingReasons.push("inactive_discount");
  const uniqueBlockingReasons = Array.from(new Set(blockingReasons));
  const synchronized = Boolean(functionType && verified.ok && activeAutomaticDiscount && !duplicates.length && preflight.blockingReasons.length === 0);
  return {
    ok: synchronized,
    shopDomain: input.shopDomain,
    localCompiledConfig: config,
    compiledConfigHash: deterministicConfigHash(config),
    deployedFunction: functionType || ("candidate" in selectedResult ? selectedResult.candidate || null : null),
    appDiscountTypes,
    functionIdentityMatch: Boolean(functionType && automaticDiscount?.automaticDiscount?.appDiscountType?.functionId === functionType.functionId),
    matchingAutomaticDiscount: automaticDiscount,
    duplicateAutomaticDiscountIds: duplicates,
    titleOnlyAutomaticDiscountCount,
    metafieldRawValue: verified.metafieldRawValue,
    metafieldParsed: verified.metafieldParsed,
    storedConfigHash: verified.storedConfigHash,
    synchronized,
    automaticDiscountStatus: automaticDiscount?.automaticDiscount?.status || null,
    blockingReasons: uniqueBlockingReasons,
  };
}

export const activateLoopDeskDiscountFunction = publishLoopDeskPromotions;
