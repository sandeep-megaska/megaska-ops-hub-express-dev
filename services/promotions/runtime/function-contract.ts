import { sha256Hex } from "../compiler-hash.ts";
import type { PromotionRewardType } from "../domain.ts";

export const LOOPDESK_FUNCTION_SCHEMA_VERSION = 1 as const;
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

export type LoopDeskFunctionRule = {
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
  reward: { type: PromotionRewardType; value: string; maximumQuantity: number };
};

export type LoopDeskFunctionConfiguration = {
  schemaVersion: 1;
  configurationVersion: number;
  configurationHash: string;
  rules: LoopDeskFunctionRule[];
};

export type PromotionRuntimeSyncResult =
  | { ok: true; outcome: "CREATED" | "UPDATED" | "UNCHANGED"; automaticDiscountId: string; configurationVersion: number; configurationHash: string; ruleCount: number; verifiedAt: string }
  | { ok: false; code: string; message: string; retryable: boolean };

export function buildConfigurationHash(input: { configurationVersion: number; rules: LoopDeskFunctionRule[] }) {
  return sha256Hex({ schemaVersion: LOOPDESK_FUNCTION_SCHEMA_VERSION, configurationVersion: input.configurationVersion, rules: input.rules });
}

export function assembleFunctionConfiguration(input: { configurationVersion: number; rules: LoopDeskFunctionRule[] }): LoopDeskFunctionConfiguration {
  if (!Number.isInteger(input.configurationVersion) || input.configurationVersion <= 0) throw new Error("Configuration version must be a positive integer.");
  const rules = canonicalizeFunctionRules(input.rules);
  return { schemaVersion: LOOPDESK_FUNCTION_SCHEMA_VERSION, configurationVersion: input.configurationVersion, configurationHash: buildConfigurationHash({ configurationVersion: input.configurationVersion, rules }), rules };
}

export function canonicalizeFunctionRules(rules: LoopDeskFunctionRule[]): LoopDeskFunctionRule[] {
  return rules.map(validateAndCanonicalizeFunctionRule).sort((a, b) => a.priority - b.priority || a.ruleId.localeCompare(b.ruleId));
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
  return { schemaVersion: 1, ruleId: rule.ruleId, compilationVersion: rule.compilationVersion, status: rule.status, priority: rule.priority, trigger: { type: rule.trigger.type, matchMode: rule.trigger.matchMode, minimumQuantity: rule.trigger.minimumQuantity, minimumCartSubtotal: rule.trigger.minimumCartSubtotal, sourceGroups: groups }, offer: { productGid: rule.offer.productGid, handle: typeof rule.offer.handle === "string" && rule.offer.handle.trim() ? rule.offer.handle.trim() : null }, reward: { type: rule.reward.type, value: rule.reward.value, maximumQuantity: rule.reward.maximumQuantity } };
}

export function assertFunctionConfigurationEqual(expected: LoopDeskFunctionConfiguration, actual: unknown) {
  const canonicalActual = assembleFunctionConfiguration({ configurationVersion: (actual as LoopDeskFunctionConfiguration).configurationVersion, rules: (actual as LoopDeskFunctionConfiguration).rules });
  if (JSON.stringify(expected) !== JSON.stringify(canonicalActual)) throw new Error("Shopify read-back Function configuration did not match the intended LoopDesk configuration.");
}
