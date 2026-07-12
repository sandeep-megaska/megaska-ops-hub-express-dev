import { validateAndCanonicalizeFunctionRule, type LoopDeskFunctionRule } from "./function-contract.ts";

type CompiledRuleRecord = {
  id: string;
  status: "ACTIVE" | "PAUSED";
  priority: number;
  currentCompilation?: { version: number; status: string; functionPayload?: unknown } | null;
};

type CompilerFunctionPayload = Omit<LoopDeskFunctionRule, "compilationVersion"> & { compilationVersion?: number };

export function mapCompilationToFunctionRule(rule: CompiledRuleRecord): LoopDeskFunctionRule {
  const compilation = rule.currentCompilation;
  if (!compilation || compilation.status !== "READY") throw new Error(`Rule ${rule.id} does not have a READY compilation.`);
  if (!Number.isInteger(compilation.version) || compilation.version <= 0) throw new Error(`Rule ${rule.id} compilationVersion must be a positive integer.`);
  const payload = compilation.functionPayload as CompilerFunctionPayload | null;
  if (!payload || typeof payload !== "object") throw new Error(`Rule ${rule.id} compilation is missing Function payload.`);
  return validateAndCanonicalizeFunctionRule({
    schemaVersion: 1,
    ruleId: String(payload.ruleId ?? rule.id),
    compilationVersion: compilation.version,
    status: rule.status,
    priority: Number(payload.priority ?? rule.priority),
    trigger: {
      type: String(payload.trigger.type),
      matchMode: payload.trigger.matchMode,
      minimumQuantity: Number(payload.trigger.minimumQuantity),
      minimumCartSubtotal: payload.trigger.minimumCartSubtotal,
      sourceGroups: payload.trigger.sourceGroups.map((group) => ({ sourceReferenceId: String(group.sourceReferenceId), sourceType: String(group.sourceType), sourceGid: String(group.sourceGid || ""), productGids: group.productGids, unresolved: group.unresolved })),
    },
    offer: { productGid: String(payload.offer.productGid) },
    reward: { type: payload.reward.type, value: String(payload.reward.value), maximumQuantity: Number(payload.reward.maximumQuantity) },
  });
}
