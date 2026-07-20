import { sha256Hex } from "../compiler-hash.ts";
import type { CanonicalPromotionReward } from "../reward-strategy.ts";
import { normalizePromotionReward } from "../reward-strategy.ts";
import { canonicalizeTieredOrderReward, validateTieredOrderReward, type TieredOrderPercentageReward } from "../tiered-order-discount.ts";

export const LOOPDESK_FUNCTION_SCHEMA_VERSION = 1 as const;
export const LOOPDESK_FUNCTION_CONTRACT_VERSION = 2 as const;
export const LOOPDESK_FUNCTION_HANDLE = "loopdesk-discount-function" as const;
export const LOOPDESK_FUNCTION_METAFIELD_NAMESPACE = "$app:loopdesk-promotions" as const;
export const LOOPDESK_FUNCTION_METAFIELD_KEY = "function-config" as const;
export const LOOPDESK_FUNCTION_METAFIELD_TYPE = "json" as const;
export const LOOPDESK_AUTOMATIC_DISCOUNT_TITLE = "LoopDesk Universal Promotions" as const;

export function isLoopDeskFunctionMetafieldNamespace(namespace: string | null | undefined): boolean {
  if (!namespace) return false;
  if (namespace === LOOPDESK_FUNCTION_METAFIELD_NAMESPACE) return true;
  return /^app--[A-Za-z0-9][A-Za-z0-9_-]*--loopdesk-promotions$/.test(namespace);
}

export type LoopDeskFunctionSourceGroup = {
  sourceReferenceId: string;
  sourceType: string;
  sourceGid: string;
  productGids: string[];
  unresolved: boolean;
};

type LoopDeskFunctionRuleBase = {
  schemaVersion: 1;
  ruleId: string;
  compilationVersion: number;
  status: "ACTIVE" | "PAUSED";
  priority: number;
  trigger: {
    type: string;
    matchMode: "ANY" | "ALL";
    minimumQuantity: number;
    minimumCartSubtotal: string | null;
    sourceGroups: LoopDeskFunctionSourceGroup[];
  };
  offer: { productGid: string; handle: string | null };
};
export type LoopDeskProductFunctionRule = LoopDeskFunctionRuleBase & { reward: CanonicalPromotionReward & { scope: "product" } };
export type LoopDeskOrderFunctionRule = LoopDeskFunctionRuleBase & { reward: TieredOrderPercentageReward };
export type LoopDeskFunctionRule = LoopDeskProductFunctionRule | LoopDeskOrderFunctionRule;

export type LoopDeskFunctionConfiguration = {
  functionContractVersion?: 1 | 2;
  schemaVersion: 1;
  configurationVersion: number;
  configurationHash: string;
  rules: LoopDeskFunctionRule[];
};

export type PromotionFunctionCapabilities = { contractVersion: "V1" | "V2"; supportsProductDiscounts: boolean; supportsOrderDiscounts: boolean };

/** Capability is owned by the canonical configuration being published, not stale Shopify or browser state. */
export function resolveFunctionCapabilities(compilation: Pick<LoopDeskFunctionConfiguration, "functionContractVersion">): PromotionFunctionCapabilities {
  return compilation.functionContractVersion === 2
    ? { contractVersion: "V2", supportsProductDiscounts: true, supportsOrderDiscounts: true }
    : { contractVersion: "V1", supportsProductDiscounts: true, supportsOrderDiscounts: false };
}

export type OrderPublicationBlockingReason =
  | "order_function_contract_unsupported" | "order_discount_class_missing" | "order_reward_invalid"
  | "order_runtime_not_synchronized" | "order_combination_state_unverified" | "order_contract_hash_unverified";
export type OrderPublicationGateInput = { deployedFunctionContractVersion?: number | null; discountClasses?: readonly string[] | null; runtimeValidation: boolean; synchronizationStatus: "SYNCED" | string; combinationStateVerified: boolean; contractHashVerified: boolean };
export function canPublishOrderRewards(input: OrderPublicationGateInput): { allowed: boolean; blockingReasons: OrderPublicationBlockingReason[] } {
  const blockingReasons: OrderPublicationBlockingReason[] = [];
  if (input.deployedFunctionContractVersion !== LOOPDESK_FUNCTION_CONTRACT_VERSION) blockingReasons.push("order_function_contract_unsupported");
  if (!input.discountClasses?.includes("ORDER")) blockingReasons.push("order_discount_class_missing");
  if (!input.runtimeValidation) blockingReasons.push("order_reward_invalid");
  if (input.synchronizationStatus !== "SYNCED") blockingReasons.push("order_runtime_not_synchronized");
  if (!input.combinationStateVerified) blockingReasons.push("order_combination_state_unverified");
  if (!input.contractHashVerified) blockingReasons.push("order_contract_hash_unverified");
  return { allowed: blockingReasons.length === 0, blockingReasons };
}

export type PromotionRuntimeSyncResult =
  | { ok: true; outcome: "CREATED" | "UPDATED" | "UNCHANGED"; automaticDiscountId: string; configurationVersion: number; configurationHash: string; ruleCount: number; verifiedAt: string; diagnostics?: PromotionSynchronizationDiagnostics }
  | { ok: false; code: string; message: string; retryable: boolean };

export type PromotionSynchronizationDiagnostics = {
  compiledContractVersion: "V1" | "V2"; configuredFunctionContractVersion: "V1" | "V2";
  productRuleCount: number; orderRuleCount: number; requiredDiscountClasses: string[]; actualDiscountClasses: string[];
  automaticDiscountId: string; configurationHashMatched: boolean; synchronization: "healthy"; publicationBlockers: string[];
};

export function buildConfigurationHash(input: { configurationVersion: number; rules: LoopDeskFunctionRule[]; functionContractVersion?: 1 | 2 }) {
  return sha256Hex({ ...(input.functionContractVersion === 2 ? { functionContractVersion: 2 } : {}), schemaVersion: LOOPDESK_FUNCTION_SCHEMA_VERSION, configurationVersion: input.configurationVersion, rules: input.rules });
}

export function assembleFunctionConfiguration(input: { configurationVersion: number; rules: LoopDeskFunctionRule[]; functionContractVersion?: 1 | 2 }): LoopDeskFunctionConfiguration {
  if (!Number.isInteger(input.configurationVersion) || input.configurationVersion <= 0) throw new Error("Configuration version must be a positive integer.");
  const rules = canonicalizeFunctionRules(input.rules);
  const contractVersion = input.functionContractVersion ?? 1;
  if (contractVersion === 1 && rules.some((rule) => rule.reward.scope !== "product")) throw new Error("Function contract V1 cannot contain order rewards.");
  return { ...(contractVersion === 2 ? { functionContractVersion: 2 } : {}), schemaVersion: LOOPDESK_FUNCTION_SCHEMA_VERSION, configurationVersion: input.configurationVersion, configurationHash: buildConfigurationHash({ configurationVersion: input.configurationVersion, rules, functionContractVersion: contractVersion }), rules };
}

export function canonicalizeFunctionRules(rules: LoopDeskFunctionRule[]): LoopDeskFunctionRule[] {
  const normalized = rules.map(validateAndCanonicalizeFunctionRule);
  return [...normalized.filter((rule) => rule.reward.scope === "product").sort((a, b) => a.priority - b.priority || a.ruleId.localeCompare(b.ruleId)), ...normalized.filter((rule) => rule.reward.scope === "order").sort((a, b) => b.priority - a.priority || a.ruleId.localeCompare(b.ruleId))];
}

export function validateAndCanonicalizeFunctionRule(rule: LoopDeskFunctionRule): LoopDeskFunctionRule {
  if (rule.schemaVersion !== 1) throw new Error("Function rule schemaVersion must be 1.");
  if (!rule.ruleId) throw new Error("Function ruleId is required.");
  if (!Number.isInteger(rule.compilationVersion) || rule.compilationVersion <= 0) throw new Error("Function compilationVersion must be a positive integer.");
  if (rule.status !== "ACTIVE" && rule.status !== "PAUSED") throw new Error("Function rule status must be ACTIVE or PAUSED.");
  const groups = rule.trigger.sourceGroups.map((group) => {
    if (typeof group.sourceGid !== "string" || !group.sourceGid.trim()) throw new Error(`Function sourceGid is required for rule ${rule.ruleId}.`);
    return { sourceReferenceId: group.sourceReferenceId, sourceType: group.sourceType, sourceGid: group.sourceGid, productGids: [...new Set(group.productGids)].sort(), unresolved: Boolean(group.unresolved) };
  }).sort((a, b) => `${a.sourceType}:${a.sourceReferenceId}:${a.sourceGid}`.localeCompare(`${b.sourceType}:${b.sourceReferenceId}:${b.sourceGid}`));
  let reward: LoopDeskFunctionRule["reward"];
  if (rule.reward.scope === "order") {
    if (!validateTieredOrderReward(rule.reward).valid) throw new Error(`Function order reward is not executable for rule ${rule.ruleId}.`);
    reward = canonicalizeTieredOrderReward(rule.reward);
  } else {
    const normalizedReward = normalizePromotionReward(rule.reward, { productGid: rule.offer.productGid, quantityCap: 1 });
    if (!normalizedReward.ok || !normalizedReward.validation.executable) throw new Error(`Function reward is not executable for rule ${rule.ruleId}.`);
    reward = normalizedReward.reward as LoopDeskProductFunctionRule["reward"];
  }
  return { schemaVersion: 1, ruleId: rule.ruleId, compilationVersion: rule.compilationVersion, status: rule.status, priority: rule.priority, trigger: { type: rule.trigger.type, matchMode: rule.trigger.matchMode, minimumQuantity: rule.trigger.minimumQuantity, minimumCartSubtotal: rule.trigger.minimumCartSubtotal, sourceGroups: groups }, offer: { productGid: rule.offer.productGid, handle: typeof rule.offer.handle === "string" && rule.offer.handle.trim() ? rule.offer.handle.trim() : null }, reward } as LoopDeskFunctionRule;
}

export function assertFunctionConfigurationEqual(expected: LoopDeskFunctionConfiguration, actual: unknown) {
  const canonicalActual = assembleFunctionConfiguration({ configurationVersion: (actual as LoopDeskFunctionConfiguration).configurationVersion, rules: (actual as LoopDeskFunctionConfiguration).rules, functionContractVersion: (actual as LoopDeskFunctionConfiguration).functionContractVersion });
  if (JSON.stringify(expected) !== JSON.stringify(canonicalActual)) throw new Error("Shopify read-back Function configuration did not match the intended LoopDesk configuration.");
}
