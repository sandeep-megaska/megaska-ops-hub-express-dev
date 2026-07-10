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
const SUPPORTED_DISCOUNT_CLASSES = new Set(["PRODUCT", "ORDER", "SHIPPING"]);

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
export type AutomaticDiscountTitleCollision = { id: string; typename: string | null; title: string | null; status: string | null; functionId: string | null };
export type AutomaticDiscountDiscoveryCandidate = {
  nodeId: string | null;
  typename: string | null;
  title: string | null;
  status: string | null;
  discountId: string | null;
  functionId: string | null;
  responseShape: {
    nodeId: boolean;
    automaticDiscount: boolean;
    automaticDiscountTypename: boolean;
    automaticDiscountTitle: boolean;
    automaticDiscountStatus: boolean;
    automaticDiscountDiscountId: boolean;
    automaticDiscountAppDiscountTypeFunctionId: boolean;
  };
};
export type DiscountNodesDiscoveryCandidate = AutomaticDiscountDiscoveryCandidate;
export type DiscountNodesDiscoveryDiagnostics = {
  pagesRead: number;
  edgesRead: number;
  candidateNodeIds: string[];
  candidates: DiscountNodesDiscoveryCandidate[];
  queryArgumentSupported: boolean;
  stoppedBecause: "found_identity" | "end_of_connection" | "missing_cursor";
};
export type AutomaticDiscountDiscoveryDiagnostics = {
  exactTitleSearch: {
    queryString: string;
    edgeCount: number;
    pageInfo: AutomaticDiscountConnection["pageInfo"] | null;
    candidates: AutomaticDiscountDiscoveryCandidate[];
  };
  unquotedTitleSearch: {
    queryString: string;
    edgeCount: number;
    pageInfo: AutomaticDiscountConnection["pageInfo"] | null;
    candidates: AutomaticDiscountDiscoveryCandidate[];
  };
  paginationFallback: {
    pagesRead: number;
    totalEdgesRead: number;
    stoppedBecause: "found_exact_title" | "end_of_connection" | "missing_cursor" | "not_run";
    candidates: AutomaticDiscountDiscoveryCandidate[];
  };
  queryRootDiscountFieldNames: string[];
};
type ExactTitleAutomaticDiscountsResult = { selected: AutomaticDiscount | null; duplicates: string[]; titleOnlyCount: number; identityMatches: AutomaticDiscount[]; titleCollisions: AutomaticDiscount[]; automaticDiscountTitleCollisions: AutomaticDiscountTitleCollision[]; automaticDiscountDiscoveryDiagnostics?: AutomaticDiscountDiscoveryDiagnostics; discountNodesDiscoveryDiagnostics?: DiscountNodesDiscoveryDiagnostics };

export type PublicationRecoveryHint = { required: boolean; action: "none" | "publish" | "resolve_duplicates" | "resolve_ambiguity" | "fix_configuration"; message: string };

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
  automaticDiscountTitleCollisions: AutomaticDiscountTitleCollision[];
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
  recoveryHint?: PublicationRecoveryHint;
  verification: { ok: boolean; errors: string[]; storedConfigHash: string | null };
  automaticDiscountDiscoveryDiagnostics?: AutomaticDiscountDiscoveryDiagnostics;
  discountNodesDiscoveryDiagnostics?: DiscountNodesDiscoveryDiagnostics;
};

type PublicationVerificationResult = {
  shopId: string;
  shopDomain: string;
  config: LoopDeskDiscountFunctionConfig;
  compiledConfigHash: string;
  appDiscountTypes: AppDiscountType[];
  selectedResult: ReturnType<typeof selectLoopDeskAppDiscountType>;
  functionType: AppDiscountType | null;
  existing: ExactTitleAutomaticDiscountsResult | null;
  automaticDiscount: AutomaticDiscount | null;
  verification: ReturnType<typeof verifyStoredConfig>;
  blockingReasons: string[];
  synchronized: boolean;
  activeAutomaticDiscount: boolean;
  fixedPriceRulesCompiledCount: number;
  preflightBlockingReasons: string[];
};

export function publicationRecoveryHint(blockingReasons: string[]): PublicationRecoveryHint {
  const uniqueReasons = Array.from(new Set(blockingReasons));
  if (uniqueReasons.includes("duplicate_automatic_discounts")) return { required: true, action: "resolve_duplicates", message: "Multiple LoopDesk automatic app discounts match the deployed function. Deactivate or remove duplicates, then publish again." };
  if (uniqueReasons.includes("automatic_discount_title_collision")) return { required: true, action: "resolve_ambiguity", message: "An automatic discount titled LoopDesk Promotions already exists but is not linked to the deployed LoopDesk Function. Inspect the existing discount in Shopify Admin, then rename, deactivate, or remove it before publishing again." };
  if (uniqueReasons.includes("ambiguous_title_only_discounts")) return { required: true, action: "resolve_ambiguity", message: "A LoopDesk-titled automatic discount exists but is not linked to the deployed function. Resolve the old discount, then publish again." };
  if (uniqueReasons.includes("missing_automatic_discount") || uniqueReasons.includes("stale_metafield") || uniqueReasons.includes("missing_or_invalid_metafield") || uniqueReasons.includes("inactive_discount")) return { required: true, action: "publish", message: "Publish LoopDesk promotions to create or update the Shopify automatic app discount for the deployed function." };
  if (uniqueReasons.length) return { required: true, action: "fix_configuration", message: `Resolve publication blockers first: ${uniqueReasons.join(", ")}.` };
  return { required: false, action: "none", message: "LoopDesk promotions are synchronized." };
}

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
  const productCandidates = candidates.filter((type) => normalizeDiscountClasses(type).includes("PRODUCT"));
  if (!productCandidates.length) return { selected: null, reason: "wrong_discount_class", candidate: candidates[0] };
  if (productCandidates.length > 1) return { selected: null, reason: "ambiguous_function_identity", candidates: productCandidates };
  return { selected: productCandidates[0], reason: null };
}

export function normalizeDiscountClasses(functionType: Pick<AppDiscountType, "discountClasses">) {
  return Array.from(new Set((functionType.discountClasses || []).filter((discountClass): discountClass is string => SUPPORTED_DISCOUNT_CLASSES.has(discountClass))));
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

function automaticDiscountTitleQuery(title: string) {
  return `title:"${title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function automaticDiscountUnquotedTitleQuery(title: string) {
  return `title:${title}`;
}

const AUTOMATIC_DISCOUNT_NODE_FIELDS = `
  edges {
    node {
      id
      metafield(namespace: "loopdesk", key: "discount_function_config") { value }
      automaticDiscount {
        __typename
        ... on DiscountAutomaticApp { title status discountId appDiscountType { functionId } }
        ... on DiscountAutomaticBasic { title status }
        ... on DiscountAutomaticBxgy { title status }
        ... on DiscountAutomaticFreeShipping { title status }
      }
    }
  }
  pageInfo { hasNextPage endCursor }
`;

type AutomaticDiscountConnection = { edges?: Array<{ node: AutomaticDiscount }>; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } };

function sanitizeAutomaticDiscountCandidate(node: AutomaticDiscount | null | undefined): AutomaticDiscountDiscoveryCandidate {
  const discount = node?.automaticDiscount || null;
  return {
    nodeId: node?.id || null,
    typename: discount?.__typename || null,
    title: discount?.title || null,
    status: discount?.status || null,
    discountId: discount?.discountId || null,
    functionId: discount?.appDiscountType?.functionId || null,
    responseShape: {
      nodeId: Boolean(node && Object.prototype.hasOwnProperty.call(node, "id")),
      automaticDiscount: Boolean(node && Object.prototype.hasOwnProperty.call(node, "automaticDiscount") && node.automaticDiscount),
      automaticDiscountTypename: Boolean(discount && Object.prototype.hasOwnProperty.call(discount, "__typename")),
      automaticDiscountTitle: Boolean(discount && Object.prototype.hasOwnProperty.call(discount, "title")),
      automaticDiscountStatus: Boolean(discount && Object.prototype.hasOwnProperty.call(discount, "status")),
      automaticDiscountDiscountId: Boolean(discount && Object.prototype.hasOwnProperty.call(discount, "discountId")),
      automaticDiscountAppDiscountTypeFunctionId: Boolean(discount?.appDiscountType && Object.prototype.hasOwnProperty.call(discount.appDiscountType, "functionId")),
    },
  };
}

export function automaticDiscountDiscoveryCandidates(nodes: Array<AutomaticDiscount | null | undefined>) {
  return nodes.map(sanitizeAutomaticDiscountCandidate);
}

function emptyAutomaticDiscountDiscoveryDiagnostics(): AutomaticDiscountDiscoveryDiagnostics {
  return {
    exactTitleSearch: { queryString: automaticDiscountTitleQuery(DISCOUNT_TITLE), edgeCount: 0, pageInfo: null, candidates: [] },
    unquotedTitleSearch: { queryString: automaticDiscountUnquotedTitleQuery(DISCOUNT_TITLE), edgeCount: 0, pageInfo: null, candidates: [] },
    paginationFallback: { pagesRead: 0, totalEdgesRead: 0, stoppedBecause: "not_run", candidates: [] },
    queryRootDiscountFieldNames: [],
  };
}

async function queryRootDiscountFieldNames(shopDomain: string, shopId: string) {
  const data = await shopifyAdminGraphql<{ __schema?: { queryType?: { fields?: Array<{ name?: string | null }> | null } | null } }>(shopDomain, `query LoopDeskDiscountQueryRootFields { __schema { queryType { fields { name } } } }`, {}, { shopId });
  return (data.__schema?.queryType?.fields || []).map((field) => field.name).filter((name): name is string => typeof name === "string" && /discount/i.test(name)).sort();
}

type GraphqlTypeRef = { kind?: string | null; name?: string | null; ofType?: GraphqlTypeRef | null };
type GraphqlField = { name?: string | null; args?: Array<{ name?: string | null; type?: GraphqlTypeRef | null }> | null; type?: GraphqlTypeRef | null };
type GraphqlType = { kind?: string | null; name?: string | null; fields?: GraphqlField[] | null; possibleTypes?: Array<{ name?: string | null } | null> | null };
type DiscountNode = {
  id: string;
  metafield?: { value?: string | null } | null;
  discount?: AutomaticDiscount["automaticDiscount"];
};
type DiscountNodesSchema = { schema?: { mutationType?: { fields?: GraphqlField[] | null } | null } | null; queryRoot?: { fields?: GraphqlField[] | null } | null; discountNode?: GraphqlType | null; discountNodeDiscount?: GraphqlType | null; discountAutomaticApp?: GraphqlType | null; appDiscountType?: GraphqlType | null };

async function introspectDiscountNodesSchema(shopDomain: string, shopId: string) {
  return shopifyAdminGraphql<DiscountNodesSchema>(shopDomain, `query LoopDeskDiscountNodesSchema {
    schema: __schema { mutationType { fields { name args { name type { kind name ofType { kind name ofType { kind name } } } } type { kind name ofType { kind name ofType { kind name } } } } } }
    queryRoot: __type(name: "QueryRoot") { fields { name args { name type { kind name ofType { kind name ofType { kind name } } } } type { kind name ofType { kind name ofType { kind name } } } } }
    discountNode: __type(name: "DiscountNode") { fields { name type { kind name ofType { kind name ofType { kind name } } } } }
    discountNodeDiscount: __type(name: "Discount") { kind name possibleTypes { name } fields { name type { kind name ofType { kind name ofType { kind name } } } } }
    discountAutomaticApp: __type(name: "DiscountAutomaticApp") { fields { name type { kind name ofType { kind name ofType { kind name } } } } }
    appDiscountType: __type(name: "AppDiscountType") { fields { name type { kind name ofType { kind name ofType { kind name } } } } }
  }`, {}, { shopId });
}

function hasField(type: { fields?: GraphqlField[] | null } | null | undefined, name: string) {
  return Boolean(type?.fields?.some((field) => field.name === name));
}

function hasDiscountNodesQueryArgument(schema: DiscountNodesSchema) {
  return Boolean(schema.queryRoot?.fields?.find((field) => field.name === "discountNodes")?.args?.some((arg) => arg.name === "query"));
}

function namedTypeName(type: GraphqlTypeRef | null | undefined): string | null {
  let current = type || null;
  while (current?.ofType) current = current.ofType;
  return current?.name || null;
}

function discountNodeDiscountFieldName(schema: DiscountNodesSchema) {
  return schema.discountNode?.fields?.find((field) => {
    const returnTypeName = namedTypeName(field.type);
    return returnTypeName === "Discount" || returnTypeName === "DiscountAutomaticApp";
  })?.name || null;
}

function discountNodeFields(discountFieldName: string, includeMetafield: boolean) {
  return `
  edges {
    node {
      id
      ${includeMetafield ? 'metafield(namespace: "loopdesk", key: "discount_function_config") { value }' : ""}
      ${discountFieldName} {
        __typename
        ... on DiscountAutomaticApp { title status discountId appDiscountType { functionId } }
      }
    }
  }
  pageInfo { hasNextPage endCursor }
`;
}

type DiscountNodesConnection = { edges?: Array<{ node?: DiscountNode | null } | null> | null; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null };

function normalizeDiscountNode(node: DiscountNode, discountFieldName: string): AutomaticDiscount {
  const discount = node.discount || (node as DiscountNode & Record<string, AutomaticDiscount["automaticDiscount"]>)[discountFieldName] || null;
  return { id: node.id, metafield: node.metafield || null, automaticDiscount: discount };
}

export async function queryLoopDeskDiscountNodes(shopDomain: string, shopId: string, functionType: AppDiscountType): Promise<ExactTitleAutomaticDiscountsResult> {
  const schema = await introspectDiscountNodesSchema(shopDomain, shopId);
  const queryField = schema.queryRoot?.fields?.find((field) => field.name === "discountNodes");
  const discountFieldName = discountNodeDiscountFieldName(schema);
  const discountNodeHasMetafield = hasField(schema.discountNode, "metafield");
  const discountReturnTypeName = namedTypeName(schema.discountNode?.fields?.find((field) => field.name === discountFieldName)?.type);
  const discountReturnTypeSupportsAutomaticApp = discountReturnTypeName === "DiscountAutomaticApp" || Boolean(schema.discountNodeDiscount?.possibleTypes?.some((type) => type?.name === "DiscountAutomaticApp"));
  const updateMutationAcceptsId = Boolean(schema.schema?.mutationType?.fields?.find((field) => field.name === "discountAutomaticAppUpdate")?.args?.some((arg) => arg.name === "id" && namedTypeName(arg.type) === "ID"));
  const nodeQueryAcceptsId = Boolean(schema.queryRoot?.fields?.find((field) => field.name === "node")?.args?.some((arg) => arg.name === "id" && namedTypeName(arg.type) === "ID"));
  if (!queryField || !hasField(schema.discountNode, "id") || !discountFieldName || !discountReturnTypeSupportsAutomaticApp || !hasField(schema.discountAutomaticApp, "title") || !hasField(schema.discountAutomaticApp, "status") || !hasField(schema.discountAutomaticApp, "discountId") || !hasField(schema.discountAutomaticApp, "appDiscountType") || !hasField(schema.appDiscountType, "functionId") || !updateMutationAcceptsId || !nodeQueryAcceptsId) {
    throw new DiscountMetafieldReadUnsupportedError();
  }
  const discountNodesNodeFields = discountNodeFields(discountFieldName, discountNodeHasMetafield);
  const queryArgumentSupported = hasDiscountNodesQueryArgument(schema);
  const diagnostics: DiscountNodesDiscoveryDiagnostics = { pagesRead: 0, edgesRead: 0, candidateNodeIds: [], candidates: [], queryArgumentSupported, stoppedBecause: "end_of_connection" };
  const nodes: AutomaticDiscount[] = [];
  let after: string | null = null;
  do {
    const data: { discountNodes: DiscountNodesConnection } = await shopifyAdminGraphql<{ discountNodes: DiscountNodesConnection }>(shopDomain, queryArgumentSupported
      ? `query LoopDeskDiscountNodes($after: String, $query: String!) { discountNodes(first: 100, after: $after, query: $query) { ${discountNodesNodeFields} } }`
      : `query LoopDeskDiscountNodes($after: String) { discountNodes(first: 100, after: $after) { ${discountNodesNodeFields} } }`, { after, ...(queryArgumentSupported ? { query: automaticDiscountTitleQuery(DISCOUNT_TITLE) } : {}) }, { shopId }).catch(async (error: unknown) => {
        if (isMetafieldSchemaError(error)) await assertAutomaticDiscountNodeMetafieldReadable(shopDomain, shopId);
        throw error;
      });
    diagnostics.pagesRead += 1;
    const connection: DiscountNodesConnection = data.discountNodes;
    const pageNodes = (connection?.edges || []).map((edge) => edge?.node).filter((node): node is DiscountNode => Boolean(node)).map((node) => normalizeDiscountNode(node, discountFieldName));
    diagnostics.edgesRead += pageNodes.length;
    const pageCandidates = automaticDiscountDiscoveryCandidates(pageNodes);
    diagnostics.candidates.push(...pageCandidates);
    diagnostics.candidateNodeIds.push(...pageCandidates.map((candidate) => candidate.nodeId).filter((id): id is string => Boolean(id)));
    nodes.push(...exactTitleNodes(pageNodes));
    const classified = classifyExactTitleAutomaticDiscounts(nodes, functionType);
    if (classified.identityMatches.length) {
      diagnostics.stoppedBecause = "found_identity";
      const hydrated = discountNodeHasMetafield ? classified : await hydrateSelectedDiscountMetafield(shopDomain, shopId, classified);
      return { ...hydrated, discountNodesDiscoveryDiagnostics: diagnostics };
    }
    after = connection?.pageInfo?.endCursor || null;
    if (!connection?.pageInfo?.hasNextPage) { diagnostics.stoppedBecause = "end_of_connection"; break; }
    if (!after) { diagnostics.stoppedBecause = "missing_cursor"; break; }
  } while (after);
  const classified = classifyExactTitleAutomaticDiscounts(nodes, functionType);
  const hydrated = discountNodeHasMetafield ? classified : await hydrateSelectedDiscountMetafield(shopDomain, shopId, classified);
  return { ...hydrated, discountNodesDiscoveryDiagnostics: diagnostics };
}

async function hydrateSelectedDiscountMetafield(shopDomain: string, shopId: string, result: ExactTitleAutomaticDiscountsResult) {
  if (!result.selected?.id) return result;
  const hydratedSelected = await queryAutomaticDiscountById(shopDomain, shopId, result.selected.id);
  if (!hydratedSelected) return result;
  return {
    ...result,
    selected: hydratedSelected,
    identityMatches: result.identityMatches.map((node) => node.id === hydratedSelected.id ? hydratedSelected : node),
  };
}

function isIdentityMatch(node: AutomaticDiscount, functionType: AppDiscountType) {
  const discount = node.automaticDiscount;
  return discount?.__typename === "DiscountAutomaticApp" && discount.title === DISCOUNT_TITLE && discount.appDiscountType?.functionId === functionType.functionId;
}

function exactTitleNodes(nodes: AutomaticDiscount[]) {
  return nodes.filter((node) => node.automaticDiscount?.title === DISCOUNT_TITLE);
}

export function classifyExactTitleAutomaticDiscounts(nodes: AutomaticDiscount[], functionType: AppDiscountType): ExactTitleAutomaticDiscountsResult {
  const exactMatches = exactTitleNodes(nodes);
  const identityMatches = exactMatches.filter((node) => isIdentityMatch(node, functionType));
  const titleCollisions = exactMatches.filter((node) => !identityMatches.includes(node));
  return {
    selected: identityMatches[0] || null,
    duplicates: identityMatches.length > 1 ? identityMatches.map((node) => node.id) : [],
    titleOnlyCount: titleCollisions.length,
    identityMatches,
    titleCollisions,
    automaticDiscountTitleCollisions: titleCollisions.map((node) => ({
      id: node.id,
      typename: node.automaticDiscount?.__typename || null,
      title: node.automaticDiscount?.title || null,
      status: node.automaticDiscount?.status || null,
      functionId: node.automaticDiscount?.appDiscountType?.functionId || null,
    })),
  };
}

export async function queryAutomaticDiscountsByExactTitle(shopDomain: string, shopId: string, functionType: AppDiscountType) {
  const diagnostics = emptyAutomaticDiscountDiscoveryDiagnostics();
  const query = automaticDiscountTitleQuery(DISCOUNT_TITLE);
  const searched = await shopifyAdminGraphql<{ automaticDiscountNodes: AutomaticDiscountConnection }>(shopDomain, `query LoopDeskAutomaticDiscountsByExactTitle($query: String!) { automaticDiscountNodes(first: 50, query: $query) { ${AUTOMATIC_DISCOUNT_NODE_FIELDS} } }`, { query }, { shopId }).catch(async (error: unknown) => {
    if (isMetafieldSchemaError(error)) await assertAutomaticDiscountNodeMetafieldReadable(shopDomain, shopId);
    throw error;
  });
  const rawSearchedNodes = searched.automaticDiscountNodes?.edges?.map((edge) => edge.node) || [];
  diagnostics.exactTitleSearch = { queryString: query, edgeCount: rawSearchedNodes.length, pageInfo: searched.automaticDiscountNodes?.pageInfo || null, candidates: automaticDiscountDiscoveryCandidates(rawSearchedNodes) };

  const unquotedQuery = automaticDiscountUnquotedTitleQuery(DISCOUNT_TITLE);
  const unquotedSearched = await shopifyAdminGraphql<{ automaticDiscountNodes: AutomaticDiscountConnection }>(shopDomain, `query LoopDeskAutomaticDiscountsByUnquotedTitle($query: String!) { automaticDiscountNodes(first: 50, query: $query) { ${AUTOMATIC_DISCOUNT_NODE_FIELDS} } }`, { query: unquotedQuery }, { shopId }).catch(async (error: unknown) => {
    if (isMetafieldSchemaError(error)) await assertAutomaticDiscountNodeMetafieldReadable(shopDomain, shopId);
    throw error;
  });
  const rawUnquotedNodes = unquotedSearched.automaticDiscountNodes?.edges?.map((edge) => edge.node) || [];
  diagnostics.unquotedTitleSearch = { queryString: unquotedQuery, edgeCount: rawUnquotedNodes.length, pageInfo: unquotedSearched.automaticDiscountNodes?.pageInfo || null, candidates: automaticDiscountDiscoveryCandidates(rawUnquotedNodes) };

  let nodes = exactTitleNodes(rawSearchedNodes);
  if (!nodes.length) {
    const fallback = await queryAutomaticDiscountsByExactTitleFallback(shopDomain, shopId);
    nodes = fallback.exactMatches;
    diagnostics.paginationFallback = fallback.diagnostics;
  }
  diagnostics.queryRootDiscountFieldNames = await queryRootDiscountFieldNames(shopDomain, shopId);
  return { ...classifyExactTitleAutomaticDiscounts(nodes, functionType), automaticDiscountDiscoveryDiagnostics: diagnostics };
}

async function queryAutomaticDiscountsByExactTitleFallback(shopDomain: string, shopId: string) {
  const exactMatches: AutomaticDiscount[] = [];
  const candidates: AutomaticDiscountDiscoveryCandidate[] = [];
  let pagesRead = 0;
  let totalEdgesRead = 0;
  let stoppedBecause: AutomaticDiscountDiscoveryDiagnostics["paginationFallback"]["stoppedBecause"] = "end_of_connection";
  let after: string | null = null;
  do {
    const data: { automaticDiscountNodes: AutomaticDiscountConnection } = await shopifyAdminGraphql<{ automaticDiscountNodes: AutomaticDiscountConnection }>(shopDomain, `query LoopDeskAutomaticDiscountsByExactTitleFallback($after: String) { automaticDiscountNodes(first: 100, after: $after) { ${AUTOMATIC_DISCOUNT_NODE_FIELDS} } }`, { after }, { shopId }).catch(async (error: unknown) => {
      if (isMetafieldSchemaError(error)) await assertAutomaticDiscountNodeMetafieldReadable(shopDomain, shopId);
      throw error;
    });
    pagesRead += 1;
    const connection: AutomaticDiscountConnection = data.automaticDiscountNodes;
    const rawNodes = connection?.edges?.map((edge) => edge.node) || [];
    totalEdgesRead += rawNodes.length;
    candidates.push(...automaticDiscountDiscoveryCandidates(rawNodes));
    exactMatches.push(...exactTitleNodes(rawNodes));
    if (exactMatches.length) { stoppedBecause = "found_exact_title"; break; }
    after = connection?.pageInfo?.endCursor || null;
    if (!connection?.pageInfo?.hasNextPage) { stoppedBecause = "end_of_connection"; break; }
    if (!after) { stoppedBecause = "missing_cursor"; break; }
  } while (after);
  return { exactMatches, diagnostics: { pagesRead, totalEdgesRead, stoppedBecause, candidates } };
}

async function findExistingLoopDeskDiscounts(shopDomain: string, shopId: string, functionType: AppDiscountType) {
  const result = await queryLoopDeskDiscountNodes(shopDomain, shopId, functionType);
  result.automaticDiscountDiscoveryDiagnostics = await queryAutomaticDiscountsByExactTitle(shopDomain, shopId, functionType).then((legacy) => legacy.automaticDiscountDiscoveryDiagnostics).catch(() => undefined);
  return result;
}

function shouldLogPublicationVerification() {
  return process.env.LOOPDESK_PUBLICATION_DEBUG === "1" || process.env.LOOPDESK_PUBLICATION_DEBUG === "true";
}

function logPublicationVerificationProjection(label: "admin_diagnostics" | "storefront_runtime", result: PublicationVerificationResult) {
  if (!shouldLogPublicationVerification()) return;
  console.info("[LoopDesk Publication Verification]", {
    caller: label,
    shopId: result.shopId,
    shopDomain: result.shopDomain,
    compiledConfigHash: result.compiledConfigHash,
    functionId: result.functionType?.functionId || null,
    automaticDiscountId: result.automaticDiscount?.automaticDiscount?.discountId || result.automaticDiscount?.id || null,
    synchronized: result.synchronized,
    blockingReasons: result.blockingReasons,
  });
}

export function projectLoopDeskPromotionPublicationVerification(input: {
  shopId?: string;
  shopDomain?: string;
  config: LoopDeskDiscountFunctionConfig;
  functionType: AppDiscountType | null;
  selectedReason?: string | null;
  selectedCandidate?: AppDiscountType | null;
  appDiscountTypes?: AppDiscountType[];
  existing: ExactTitleAutomaticDiscountsResult | null;
  preflightBlockingReasons?: string[];
}) {
  const compiledConfigHash = deterministicConfigHash(input.config);
  const selectedResult: ReturnType<typeof selectLoopDeskAppDiscountType> = input.functionType
    ? { selected: input.functionType, reason: null }
    : input.selectedCandidate
      ? { selected: null, reason: input.selectedReason || "missing_function", candidate: input.selectedCandidate }
      : { selected: null, reason: input.selectedReason || "missing_function" };
  const automaticDiscount = input.existing?.selected || null;
  const verification = input.functionType && automaticDiscount
    ? verifyStoredConfig(automaticDiscount, input.functionType, input.config)
    : { ok: false, errors: input.functionType ? ["missing_automatic_discount"] : [selectedResult.reason || "missing_function"], storedConfigHash: null, metafieldRawValue: null, metafieldParsed: null };
  const blockingReasons = [...(input.preflightBlockingReasons || [])];
  if (!input.functionType && selectedResult.reason) blockingReasons.push(selectedResult.reason);
  if (!input.existing && input.functionType) blockingReasons.push("discount_metafield_read_unsupported");
  if (input.existing?.duplicates.length) blockingReasons.push("duplicate_automatic_discounts");
  if (input.existing && !input.existing.selected && input.existing.titleOnlyCount > 0) blockingReasons.push("automatic_discount_title_collision");
  blockingReasons.push(...verification.errors);
  const activeAutomaticDiscount = Boolean(automaticDiscount?.automaticDiscount?.status && VALID_STATUSES.has(automaticDiscount.automaticDiscount.status));
  if (automaticDiscount && !activeAutomaticDiscount) blockingReasons.push("inactive_discount");
  const uniqueBlockingReasons = Array.from(new Set(blockingReasons));
  const synchronized = Boolean(input.functionType && verification.ok && activeAutomaticDiscount && !input.existing?.duplicates.length && !(input.preflightBlockingReasons || []).length);
  return {
    shopId: input.shopId || "",
    shopDomain: input.shopDomain || "",
    config: input.config,
    compiledConfigHash,
    appDiscountTypes: input.appDiscountTypes || (input.functionType ? [input.functionType] : []),
    selectedResult,
    functionType: input.functionType,
    existing: input.existing,
    automaticDiscount,
    verification,
    blockingReasons: uniqueBlockingReasons,
    synchronized,
    activeAutomaticDiscount,
    fixedPriceRulesCompiledCount: input.config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_price").length,
    preflightBlockingReasons: input.preflightBlockingReasons || [],
  };
}

async function resolveLoopDeskPromotionPublicationVerification(input: { shopId: string; shopDomain: string }): Promise<PublicationVerificationResult> {
  const config = await compileLoopDeskDiscountFunctionConfig(input.shopId, input.shopDomain);
  const preflight = await promotionPublicationPreflight(input.shopId, input.shopDomain, config);
  const appDiscountTypes = await queryLoopDeskAppDiscountTypes(input.shopDomain, input.shopId);
  const selectedResult = selectLoopDeskAppDiscountType(appDiscountTypes);
  const functionType = selectedResult.selected;
  const existing = functionType ? await findExistingLoopDeskDiscounts(input.shopDomain, input.shopId, functionType).catch((error: unknown) => {
    if (error instanceof DiscountMetafieldReadUnsupportedError) return null;
    throw error;
  }) : null;
  return projectLoopDeskPromotionPublicationVerification({
    shopId: input.shopId,
    shopDomain: input.shopDomain,
    config,
    functionType,
    selectedReason: selectedResult.reason,
    selectedCandidate: "candidate" in selectedResult ? selectedResult.candidate || null : null,
    appDiscountTypes,
    existing,
    preflightBlockingReasons: preflight.blockingReasons,
  });
}

function compactPublicationStatus(result: PublicationVerificationResult) {
  return {
    ok: result.synchronized,
    synchronized: result.synchronized,
    message: result.synchronized ? "LoopDesk automatic discount is synchronized." : result.blockingReasons.join(", "),
    compiledConfigHash: result.compiledConfigHash,
    storedConfigHash: result.verification.storedConfigHash,
    functionHandle: null,
    functionId: result.functionType?.functionId || null,
    productCapability: Boolean(result.functionType?.discountClasses?.includes("PRODUCT")),
    automaticDiscountId: result.automaticDiscount?.automaticDiscount?.discountId || result.automaticDiscount?.id || null,
    activeAutomaticDiscount: result.activeAutomaticDiscount,
    automaticDiscountStatus: result.automaticDiscount?.automaticDiscount?.status || null,
    blockingReasons: result.blockingReasons,
    fixedPriceRulesCompiledCount: result.fixedPriceRulesCompiledCount,
    recoveryHint: publicationRecoveryHint(result.blockingReasons),
  };
}

export function automaticDiscountInput(functionType: AppDiscountType, config: LoopDeskDiscountFunctionConfig, includeStartsAt = false) {
  const discountClasses = normalizeDiscountClasses(functionType);
  if (!discountClasses.includes("PRODUCT")) throw new Error("wrong_discount_class");
  return { title: DISCOUNT_TITLE, functionId: functionType.functionId, discountClasses, ...(includeStartsAt ? { startsAt: new Date().toISOString() } : {}), combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true }, metafields: configMetafield(config) };
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
  const diagnostics: PublicationDiagnostics = { localCompiledConfig: config, functionFound: false, functionId: null, functionHandle: null, deployedFunction: null, functionIdentityMatch: false, automaticDiscount: "not-run", automaticDiscountId: null, automaticDiscountTitle: null, automaticDiscountStatus: null, duplicateAutomaticDiscountIds: [], titleOnlyAutomaticDiscountCount: 0, automaticDiscountTitleCollisions: [], metafieldRawValue: null, metafieldParsed: null, metafieldUpdated: false, rulesCompiledCount: config.rules.length, compiledRewardTypes: Array.from(new Set(config.rules.map((rule) => rule.rewardEnforcementType))).sort(), fixedPriceRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_price").length, percentageRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "percentage").length, fixedAmountRulesCompiledCount: config.rules.filter((rule) => rule.rewardEnforcementType === "fixed_amount").length, buildArtifactPresent: buildArtifactValidation.ok, activationStatus: "blocked", synchronized: false, compiledConfigHash: deterministicConfigHash(config), storedConfigHash: null, blockingReasons: [...preflight.blockingReasons], verification: { ok: false, errors: [], storedConfigHash: null } };
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
  diagnostics.automaticDiscountTitleCollisions = existing.automaticDiscountTitleCollisions;
  diagnostics.automaticDiscountDiscoveryDiagnostics = existing.automaticDiscountDiscoveryDiagnostics;
  diagnostics.discountNodesDiscoveryDiagnostics = existing.discountNodesDiscoveryDiagnostics;
  if (existing.duplicates.length) diagnostics.blockingReasons.push("duplicate_automatic_discounts");
  if (!existing.selected && existing.titleOnlyCount > 0) diagnostics.blockingReasons.push("automatic_discount_title_collision");
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
  diagnostics.recoveryHint = publicationRecoveryHint(diagnostics.blockingReasons);
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
  const result = await resolveLoopDeskPromotionPublicationVerification(input);
  logPublicationVerificationProjection("storefront_runtime", result);
  return compactPublicationStatus(result);
}

export async function getLoopDeskPromotionPublicationDiagnostics(input: { shopId: string; shopDomain: string }) {
  const result = await resolveLoopDeskPromotionPublicationVerification(input);
  logPublicationVerificationProjection("admin_diagnostics", result);
  return {
    ok: result.synchronized,
    shopDomain: input.shopDomain,
    localCompiledConfig: result.config,
    compiledConfigHash: result.compiledConfigHash,
    deployedFunction: result.functionType || ("candidate" in result.selectedResult ? result.selectedResult.candidate || null : null),
    appDiscountTypes: result.appDiscountTypes,
    functionIdentityMatch: Boolean(result.functionType && result.automaticDiscount?.automaticDiscount?.appDiscountType?.functionId === result.functionType.functionId),
    matchingAutomaticDiscount: result.automaticDiscount,
    duplicateAutomaticDiscountIds: result.existing?.duplicates || [],
    titleOnlyAutomaticDiscountCount: result.existing?.titleOnlyCount || 0,
    automaticDiscountTitleCollisions: result.existing?.automaticDiscountTitleCollisions || [],
    automaticDiscountDiscoveryDiagnostics: result.existing?.automaticDiscountDiscoveryDiagnostics,
    discountNodesDiscoveryDiagnostics: result.existing?.discountNodesDiscoveryDiagnostics,
    metafieldRawValue: result.verification.metafieldRawValue,
    metafieldParsed: result.verification.metafieldParsed,
    storedConfigHash: result.verification.storedConfigHash,
    synchronized: result.synchronized,
    automaticDiscountStatus: result.automaticDiscount?.automaticDiscount?.status || null,
    blockingReasons: result.blockingReasons,
    recoveryHint: publicationRecoveryHint(result.blockingReasons),
  };
}

export const activateLoopDeskDiscountFunction = publishLoopDeskPromotions;
