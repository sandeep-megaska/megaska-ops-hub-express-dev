import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { automaticDiscountDiscoveryCandidates, automaticDiscountInput, classifyExactTitleAutomaticDiscounts, deterministicConfigHash, discountNodeNormalizationComparison, discountNodeRawShapeDiagnostics, publicationRecoveryHint, selectLoopDeskAppDiscountType, verifyStoredConfig, type AppDiscountType, type AutomaticDiscount } from "./discount-function-activation.server.ts";
import type { LoopDeskDiscountFunctionConfig } from "./discount-function.ts";

const config: LoopDeskDiscountFunctionConfig = { schemaVersion: 1, enabled: true, rules: [{ id: "a", enabled: true, priority: 1, triggerType: "always", rewardEnforcementType: "fixed_price", rewardVariantGid: "gid://shopify/ProductVariant/1", rewardProductGid: "gid://shopify/Product/1", fixedPriceAmount: 300 }] };
const metafield = { value: JSON.stringify(config) };
const functionType: AppDiscountType = { functionId: "gid://shopify/ShopifyFunction/selected", title: "LoopDesk Discount Function", discountClasses: ["PRODUCT"] };
const productOrderFunctionType: AppDiscountType = { ...functionType, discountClasses: ["PRODUCT", "ORDER"] };

test("deterministic config hashes ignore object key ordering", () => {
  const left: LoopDeskDiscountFunctionConfig = config;
  const right: LoopDeskDiscountFunctionConfig = { rules: [{ fixedPriceAmount: 300, rewardProductGid: "gid://shopify/Product/1", rewardVariantGid: "gid://shopify/ProductVariant/1", rewardEnforcementType: "fixed_price", triggerType: "always", priority: 1, enabled: true, id: "a" }], enabled: true, schemaVersion: 1 };
  assert.equal(deterministicConfigHash(left), deterministicConfigHash(right));
});

test("selects a single exact-title PRODUCT candidate using functionId", () => {
  const result = selectLoopDeskAppDiscountType([
    { functionId: "other", title: "Other Function", discountClasses: ["PRODUCT"] },
    functionType,
  ]);
  assert.equal(result.reason, null);
  assert.equal(result.selected?.functionId, functionType.functionId);
});

test("candidate without PRODUCT returns wrong_discount_class", () => {
  const result = selectLoopDeskAppDiscountType([{ functionId: "order-only", title: "LoopDesk Discount Function", discountClasses: ["ORDER"] }]);
  assert.equal(result.selected, null);
  assert.equal(result.reason, "wrong_discount_class");
});

test("candidate with missing discount classes returns wrong_discount_class", () => {
  const result = selectLoopDeskAppDiscountType([{ functionId: "missing-classes", title: "LoopDesk Discount Function" }]);
  assert.equal(result.selected, null);
  assert.equal(result.reason, "wrong_discount_class");
});

test("no candidate returns missing_function", () => {
  const result = selectLoopDeskAppDiscountType([{ functionId: "other", title: "Other Function", description: "No match", discountClasses: ["PRODUCT"] }]);
  assert.equal(result.selected, null);
  assert.equal(result.reason, "missing_function");
});

test("multiple broad LoopDesk candidates return ambiguous_function_identity", () => {
  const result = selectLoopDeskAppDiscountType([
    { functionId: "one", title: "Custom", description: "LoopDesk helper", discountClasses: ["PRODUCT"] },
    { functionId: "two", title: "Legacy", description: "LoopDesk helper", discountClasses: ["PRODUCT"] },
  ]);
  assert.equal(result.selected, null);
  assert.equal(result.reason, "ambiguous_function_identity");
});

test("selection does not depend on functionHandle", () => {
  const result = selectLoopDeskAppDiscountType([{ functionId: "no-handle", title: "LoopDesk Promotions", discountClasses: ["PRODUCT"] }]);
  assert.equal(result.reason, null);
  assert.equal(result.selected?.functionId, "no-handle");
});

test("automatic discount create input includes Shopify Function discount classes and startsAt", () => {
  const input = automaticDiscountInput(productOrderFunctionType, config, true);
  assert.deepEqual(input.discountClasses, ["PRODUCT", "ORDER"]);
  assert.equal(input.functionId, productOrderFunctionType.functionId);
  assert.equal(typeof input.startsAt, "string");
  assert.deepEqual(input.combinesWith, { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true });
  assert.deepEqual(input.metafields, [{ namespace: "loopdesk", key: "discount_function_config", type: "json", value: JSON.stringify(config) }]);
});

test("automatic discount update input includes Shopify Function discount classes without startsAt", () => {
  const input = automaticDiscountInput(productOrderFunctionType, config);
  assert.deepEqual(input.discountClasses, ["PRODUCT", "ORDER"]);
  assert.equal(input.functionId, productOrderFunctionType.functionId);
  assert.equal("startsAt" in input, false);
  assert.deepEqual(input.combinesWith, { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true });
  assert.deepEqual(input.metafields, [{ namespace: "loopdesk", key: "discount_function_config", type: "json", value: JSON.stringify(config) }]);
});

test("automatic discount input blocks Function classes without PRODUCT", () => {
  assert.throws(() => automaticDiscountInput({ ...functionType, discountClasses: ["ORDER"] }, config), /wrong_discount_class/);
});

test("automatic discount input does not send empty or missing class lists to Shopify", () => {
  assert.throws(() => automaticDiscountInput({ ...functionType, discountClasses: [] }, config), /wrong_discount_class/);
  assert.throws(() => automaticDiscountInput({ ...functionType, discountClasses: undefined }, config), /wrong_discount_class/);
  assert.throws(() => automaticDiscountInput({ ...functionType, discountClasses: ["UNSUPPORTED"] }, config), /wrong_discount_class/);
});

test("automatic discount with matching functionId passes Function identity verification", () => {
  const node: AutomaticDiscount = { id: "node", metafield, automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: "discount", appDiscountType: { functionId: functionType.functionId } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("mismatched automatic-discount functionId returns function_identity_mismatch", () => {
  const node: AutomaticDiscount = { id: "node", metafield, automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: "discount", appDiscountType: { functionId: "gid://shopify/ShopifyFunction/other" } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("function_identity_mismatch"));
});

test("metafield verification reads from the automatic-discount node", () => {
  const node: AutomaticDiscount = {
    id: "node",
    metafield,
    automaticDiscount: {
      __typename: "DiscountAutomaticApp",
      title: "LoopDesk Promotions",
      status: "ACTIVE",
      discountId: "discount",
      appDiscountType: { functionId: functionType.functionId },
    },
  };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.metafieldRawValue, metafield.value);
  assert.deepEqual(result.metafieldParsed, config);
});

test("valid JSON produces a stored config hash", () => {
  const node: AutomaticDiscount = { id: "node", metafield, automaticDiscount: { __typename: "DiscountAutomaticApp", status: "ACTIVE", appDiscountType: { functionId: functionType.functionId } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.storedConfigHash, deterministicConfigHash(config));
});

test("semantically matching JSON passes verification", () => {
  const semanticallyMatchingConfig: LoopDeskDiscountFunctionConfig = {
    rules: [{ fixedPriceAmount: 300, rewardProductGid: "gid://shopify/Product/1", rewardVariantGid: "gid://shopify/ProductVariant/1", rewardEnforcementType: "fixed_price", triggerType: "always", priority: 1, enabled: true, id: "a" }],
    enabled: true,
    schemaVersion: 1,
  };
  const node: AutomaticDiscount = { id: "node", metafield: { value: JSON.stringify(semanticallyMatchingConfig) }, automaticDiscount: { __typename: "DiscountAutomaticApp", status: "ACTIVE", appDiscountType: { functionId: functionType.functionId } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("missing node-level metafield returns missing_or_invalid_metafield", () => {
  const node: AutomaticDiscount = { id: "node", automaticDiscount: { __typename: "DiscountAutomaticApp", status: "ACTIVE", appDiscountType: { functionId: functionType.functionId } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("missing_or_invalid_metafield"));
});

test("different compiled and stored hashes return stale_metafield", () => {
  const staleConfig: LoopDeskDiscountFunctionConfig = { ...config, enabled: false };
  const node: AutomaticDiscount = { id: "node", metafield: { value: JSON.stringify(staleConfig) }, automaticDiscount: { __typename: "DiscountAutomaticApp", status: "ACTIVE", appDiscountType: { functionId: functionType.functionId } } };
  const result = verifyStoredConfig(node, functionType, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("stale_metafield"));
});


test("automatic discount GraphQL fragments do not request metafield from DiscountAutomaticApp", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  for (const occurrence of source.matchAll(/\.\.\.\s+on\s+DiscountAutomaticApp\s*\{/g)) {
    const followingTemplateSource = source.slice(occurrence.index, source.indexOf("`", occurrence.index));
    assert.equal(followingTemplateSource.includes("metafield("), false);
  }
});


test("publication recovery hint recommends publish for missing automatic discounts", () => {
  const hint = publicationRecoveryHint(["missing_automatic_discount"]);
  assert.equal(hint.required, true);
  assert.equal(hint.action, "publish");
  assert.match(hint.message, /create or update/);
});

test("publication recovery hint prioritizes duplicate discount cleanup", () => {
  const hint = publicationRecoveryHint(["missing_automatic_discount", "duplicate_automatic_discounts"]);
  assert.equal(hint.required, true);
  assert.equal(hint.action, "resolve_duplicates");
});


test("classifies exact-title app discount with the same functionId as an identity match for update", () => {
  const node: AutomaticDiscount = { id: "node-match", metafield, automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: "discount-match", appDiscountType: { functionId: functionType.functionId } } };
  const result = classifyExactTitleAutomaticDiscounts([node], functionType);
  assert.equal(result.selected?.id, "node-match");
  assert.equal(result.identityMatches.length, 1);
  assert.equal(result.titleCollisions.length, 0);
});

test("classification ignores non-exact title matches so create remains eligible only with no exact records", () => {
  const partial: AutomaticDiscount = { id: "node-partial", automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions Legacy", status: "ACTIVE", discountId: "discount-partial", appDiscountType: { functionId: "other" } } };
  const result = classifyExactTitleAutomaticDiscounts([partial], functionType);
  assert.equal(result.selected, null);
  assert.equal(result.identityMatches.length, 0);
  assert.equal(result.titleCollisions.length, 0);
  assert.equal(result.titleOnlyCount, 0);
});

test("exact-title app discount with a different functionId is a title collision", () => {
  const node: AutomaticDiscount = { id: "node-other-function", automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: "discount-other", appDiscountType: { functionId: "gid://shopify/ShopifyFunction/other" } } };
  const result = classifyExactTitleAutomaticDiscounts([node], functionType);
  assert.equal(result.selected, null);
  assert.equal(result.titleCollisions.length, 1);
  assert.deepEqual(result.automaticDiscountTitleCollisions, [{ id: "node-other-function", typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", functionId: "gid://shopify/ShopifyFunction/other" }]);
});

test("exact-title non-app automatic discount is a title collision and is not discarded", () => {
  const node: AutomaticDiscount = { id: "node-basic", automaticDiscount: { __typename: "DiscountAutomaticBasic", title: "LoopDesk Promotions", status: "ACTIVE" } };
  const result = classifyExactTitleAutomaticDiscounts([node], functionType);
  assert.equal(result.selected, null);
  assert.equal(result.titleCollisions.length, 1);
  assert.deepEqual(result.automaticDiscountTitleCollisions, [{ id: "node-basic", typename: "DiscountAutomaticBasic", title: "LoopDesk Promotions", status: "ACTIVE", functionId: null }]);
});

test("multiple exact-title identity matches are duplicates", () => {
  const nodes: AutomaticDiscount[] = ["one", "two"].map((id) => ({ id, automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: `discount-${id}`, appDiscountType: { functionId: functionType.functionId } } }));
  const result = classifyExactTitleAutomaticDiscounts(nodes, functionType);
  assert.deepEqual(result.duplicates, ["one", "two"]);
});

test("publication recovery hint for title collision instructs Shopify Admin inspection", () => {
  const hint = publicationRecoveryHint(["missing_automatic_discount", "automatic_discount_title_collision"]);
  assert.equal(hint.required, true);
  assert.equal(hint.action, "resolve_ambiguity");
  assert.match(hint.message, /Shopify Admin/);
});

test("GraphQL uses exact-title search and bounded pagination fallback", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  assert.match(source, /discountNodes\(first: 100, after: \$after, query: \$query\)/);
  assert.match(source, /discountNodes\(first: 100, after: \$after\)/);
  assert.match(source, /queryLoopDeskDiscountNodes/);
});

test("discountNodes discovery is authoritative before legacy automaticDiscountNodes diagnostics", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  const finderSource = source.slice(source.indexOf("async function findExistingLoopDeskDiscounts"), source.indexOf("export function automaticDiscountInput"));
  assert.match(finderSource, /queryLoopDeskDiscountNodes/);
  assert.match(finderSource, /queryAutomaticDiscountsByExactTitle/);
  assert.ok(finderSource.indexOf("queryLoopDeskDiscountNodes") < finderSource.indexOf("queryAutomaticDiscountsByExactTitle"));
});

test("discountNodes query reads node metafield and app Function identity fields", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  assert.match(source, /LoopDeskDiscountNodesSchema/);
  assert.match(source, /metafield\(namespace: "loopdesk", key: "discount_function_config"\)/);
  assert.match(source, /\.\.\. on DiscountAutomaticApp \{ title status discountId appDiscountType \{ functionId \} \}/);
});

test("discountNodes queries never spread DiscountAutomaticNode fragments", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  for (const occurrence of source.matchAll(/discountNodes\(first: 100, after: \$after(?:, query: \$query)?\)/g)) {
    const querySource = source.slice(occurrence.index, source.indexOf("`", occurrence.index));
    assert.doesNotMatch(querySource, /\.\.\.\s+on\s+DiscountAutomaticNode\b/);
  }
});

test("discountNodes pagination does not stop on title collision before an identity match is possible", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  const discoverySource = source.slice(source.indexOf("export async function queryLoopDeskDiscountNodes"), source.indexOf("function isIdentityMatch"));
  assert.match(discoverySource, /classified\.identityMatches\.length/);
  assert.doesNotMatch(discoverySource, /classified\.titleCollisions\.length/);
});

test("publish updates an identity match and creates only after discountNodes has no match or collision", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  const publishSource = source.slice(source.indexOf("export async function publishLoopDeskPromotions"), source.indexOf("async function promotionPublicationPreflight"));
  assert.match(publishSource, /existing\.selected\?\.id/);
  assert.match(publishSource, /updateAutomaticDiscount/);
  assert.match(publishSource, /createAutomaticDiscount/);
  assert.ok(publishSource.indexOf("automatic_discount_title_collision") < publishSource.indexOf("createAutomaticDiscount"));
});

test("discovery diagnostics record raw candidates before exact-title filtering", () => {
  const nodes: AutomaticDiscount[] = [
    { id: "node-legacy", metafield: { value: "secret-metafield" }, automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions Legacy", status: "ACTIVE", discountId: "discount-legacy", appDiscountType: { functionId: "other" } } },
    { id: "node-match", automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: "discount-match", appDiscountType: { functionId: functionType.functionId } } },
  ];
  const candidates = automaticDiscountDiscoveryCandidates(nodes);
  assert.deepEqual(candidates.map((candidate) => candidate.title), ["LoopDesk Promotions Legacy", "LoopDesk Promotions"]);
  const classified = classifyExactTitleAutomaticDiscounts(nodes, functionType);
  assert.equal(classified.selected?.id, "node-match");
});

test("discovery diagnostics include quoted and unquoted title search strings", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  assert.match(source, /title:\"\$\{title\.replace/);
  assert.match(source, /return `title:\$\{title\}`/);
  assert.match(source, /LoopDeskAutomaticDiscountsByUnquotedTitle/);
});

test("pagination diagnostics retain page and edge counts", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  assert.match(source, /pagesRead \+= 1/);
  assert.match(source, /totalEdgesRead \+= rawNodes\.length/);
  assert.match(source, /stoppedBecause = "found_exact_title"/);
});

test("discovery diagnostics tolerate missing nested response fields", () => {
  const [candidate] = automaticDiscountDiscoveryCandidates([{ id: "node-missing", automaticDiscount: { __typename: "DiscountAutomaticApp" } } as AutomaticDiscount]);
  assert.equal(candidate.nodeId, "node-missing");
  assert.equal(candidate.title, null);
  assert.equal(candidate.discountId, null);
  assert.equal(candidate.functionId, null);
  assert.equal(candidate.responseShape.nodeId, true);
  assert.equal(candidate.responseShape.automaticDiscountTitle, false);
  assert.equal(candidate.responseShape.automaticDiscountAppDiscountTypeFunctionId, false);
});

test("discovery diagnostics exclude raw metafield values", () => {
  const [candidate] = automaticDiscountDiscoveryCandidates([{ id: "node", metafield: { value: "do-not-leak" }, automaticDiscount: { title: "LoopDesk Promotions" } } as AutomaticDiscount]);
  assert.equal(JSON.stringify(candidate).includes("do-not-leak"), false);
  assert.equal("metafield" in candidate, false);
});


test("raw discountNodes diagnostics identify node.discount shape", () => {
  const node = { id: "node-discount", discount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: "discount", appDiscountType: { functionId: functionType.functionId } } };
  const shape = discountNodeRawShapeDiagnostics(node, "discount");
  assert.equal(shape.nodeId, "node-discount");
  assert.equal(shape.hasDiscountProperty, true);
  assert.deepEqual(shape.dynamicDiscountFieldKeys, ["__typename", "appDiscountType", "discountId", "status", "title"]);
});

test("raw discountNodes diagnostics identify node.automaticDiscount shape", () => {
  const node = { id: "node-automatic", automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions" } };
  const shape = discountNodeRawShapeDiagnostics(node, "discount");
  assert.equal(shape.hasAutomaticDiscountProperty, true);
  assert.equal(shape.dynamicDiscountFieldPresent, false);
});

test("raw discountNodes diagnostics identify dynamic nested automaticDiscount shape", () => {
  const node = { id: "node-nested", discountNode: { __typename: "DiscountAutomaticNode", automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE" } } };
  const shape = discountNodeRawShapeDiagnostics(node, "discountNode");
  assert.equal(shape.dynamicDiscountFieldPresent, true);
  assert.equal(shape.dynamicDiscountTypename, "DiscountAutomaticNode");
  assert.deepEqual(shape.nestedAutomaticDiscountKeys, ["__typename", "status", "title"]);
  assert.equal(shape.nestedAutomaticDiscountTypename, "DiscountAutomaticApp");
  const comparison = discountNodeNormalizationComparison(node, { id: "node-nested", automaticDiscount: null }, "discountNode");
  assert.equal(comparison.rawDetectedTitlePresent, true);
  assert.equal(comparison.rawDetectedStatusPresent, true);
});

test("raw normalization comparison detects fields even when current normalization loses them", () => {
  const rawNode = { id: "node-lost", automaticDiscount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions", status: "ACTIVE", discountId: "discount-lost", appDiscountType: { functionId: functionType.functionId } } };
  const normalized: AutomaticDiscount = { id: "node-lost", automaticDiscount: null };
  const comparison = discountNodeNormalizationComparison(rawNode, normalized, "discount");
  assert.equal(comparison.rawDetectedTitlePresent, true);
  assert.equal(comparison.rawDetectedStatusPresent, true);
  assert.equal(comparison.rawDetectedDiscountIdPresent, true);
  assert.equal(comparison.rawDetectedFunctionIdPresent, true);
  assert.equal(comparison.normalizedTitlePresent, false);
  assert.equal(comparison.normalizedFunctionIdPresent, false);
});

test("raw discountNodes diagnostics do not include metafield values or token fields", () => {
  const node = { id: "node-sensitive", token: "secret-token", metafield: { value: "secret-metafield" }, discount: { __typename: "DiscountAutomaticApp", title: "LoopDesk Promotions" } };
  const shape = discountNodeRawShapeDiagnostics(node, "discount");
  const serialized = JSON.stringify(shape);
  assert.equal(serialized.includes("secret-metafield"), false);
  assert.equal(serialized.includes("secret-token"), false);
  assert.equal(serialized.includes("value"), false);
});

test("publication diagnostics audit does not invoke create or update mutations", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  const diagnosticsSource = source.slice(source.indexOf("export async function getLoopDeskPromotionPublicationDiagnostics"), source.indexOf("export const activateLoopDeskDiscountFunction"));
  assert.equal(diagnosticsSource.includes("createAutomaticDiscount("), false);
  assert.equal(diagnosticsSource.includes("updateAutomaticDiscount("), false);
  assert.equal(diagnosticsSource.includes("mutation "), false);
  assert.match(diagnosticsSource, /automaticDiscountDiscoveryDiagnostics/);
});

test("discountNodes discovery has filtered fast path and unfiltered fallback diagnostics", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  const discoverySource = source.slice(source.indexOf("export async function queryLoopDeskDiscountNodes"), source.indexOf("async function hydrateSelectedDiscountMetafield"));
  assert.match(discoverySource, /runStage\("filteredSearch", automaticDiscountTitleQuery\(DISCOUNT_TITLE\)\)/);
  assert.match(discoverySource, /runStage\("unfilteredFallback", null\)/);
  assert.match(source, /filteredSearch:\s*\{ attempted: false, pagesRead: 0, edgesRead: 0, candidateNodeIds: \[\], rawShapeCounts: \{\} \}/);
  assert.match(source, /unfilteredFallback:\s*\{ attempted: false, pagesRead: 0, edgesRead: 0, candidateNodeIds: \[\], rawShapeCounts: \{\} \}/);
  assert.match(source, /selectedAutomaticDiscountId: null/);
  assert.match(source, /rawShapeCounts: \{\}/);
  assert.match(source, /rawNodeShapes: \[\]/);
  assert.match(source, /normalizationComparisons: \[\]/);
  assert.match(source, /totalCandidatesInspected/);
});

test("discountNodes filtered identity match skips unfiltered fallback", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  const discoverySource = source.slice(source.indexOf("const filteredMatch"), source.indexOf("const unfilteredMatch"));
  assert.match(discoverySource, /if \(filteredMatch\)/);
  assert.match(discoverySource, /return \{ \.\.\.hydrated, discountNodesDiscoveryDiagnostics: diagnostics \}/);
});

test("discountNodes fallback remains bounded and reports page limit", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  assert.match(source, /const MAX_DISCOUNT_NODE_PAGES = 20/);
  assert.match(source, /pagesRead >= MAX_DISCOUNT_NODE_PAGES/);
  assert.match(source, /diagnostics\.stoppedBecause = "page_limit"/);
});


test("production discountNodes normalization and matching remain unchanged", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  const normalizeSource = source.slice(source.indexOf("function normalizeDiscountNode"), source.indexOf("function sortedKeys"));
  assert.match(normalizeSource, /node\.discount \|\|/);
  assert.match(normalizeSource, /\[discountFieldName\] \|\| null/);
  assert.doesNotMatch(normalizeSource, /automaticDiscount\}\s*\)/);
  const identitySource = source.slice(source.indexOf("function isIdentityMatch"), source.indexOf("function exactTitleNodes"));
  assert.match(identitySource, /__typename === "DiscountAutomaticApp"/);
  assert.match(identitySource, /discount\.title === DISCOUNT_TITLE/);
  assert.match(identitySource, /appDiscountType\?\.functionId === functionType\.functionId/);
});

test("discountNodes identity matching requires app discount, exact title, and function id", () => {
  const source = readFileSync(new URL("./discount-function-activation.server.ts", import.meta.url), "utf8");
  const identitySource = source.slice(source.indexOf("function isIdentityMatch"), source.indexOf("function exactTitleNodes"));
  assert.match(identitySource, /__typename === "DiscountAutomaticApp"/);
  assert.match(identitySource, /discount\.title === DISCOUNT_TITLE/);
  assert.match(identitySource, /appDiscountType\?\.functionId === functionType\.functionId/);
});
