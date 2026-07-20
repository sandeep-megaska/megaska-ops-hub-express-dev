import { validateAndCanonicalizeFunctionRule, type LoopDeskFunctionRule, type LoopDeskOrderFunctionRule, type LoopDeskProductFunctionRule } from "./function-contract.ts";

type CompiledRuleRecord = {
  id: string;
  status: "ACTIVE" | "PAUSED";
  priority: number;
  currentCompilation?: { version: number; status: string; functionPayload?: unknown } | null;
};

type CompilerFunctionPayload = Omit<LoopDeskFunctionRule, "compilationVersion" | "reward"> & { compilationVersion?: number; reward: unknown };

export function compilationContractVersion(rule: CompiledRuleRecord): 1 | 2 {
  const payload = rule.currentCompilation?.functionPayload as { functionContractVersion?: unknown } | null;
  return payload?.functionContractVersion === 2 ? 2 : 1;
}

export function mapCompilationToFunctionRule(rule: CompiledRuleRecord): LoopDeskFunctionRule {
  const compilation = rule.currentCompilation;
  if (!compilation || compilation.status !== "READY") throw new Error(`Rule ${rule.id} does not have a READY compilation.`);
  if (!Number.isInteger(compilation.version) || compilation.version <= 0) throw new Error(`Rule ${rule.id} compilationVersion must be a positive integer.`);
  const payload = compilation.functionPayload as CompilerFunctionPayload | null;
  if (!payload || typeof payload !== "object") throw new Error(`Rule ${rule.id} compilation is missing Function payload.`);
  const mappedRule = {
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
    offer: { productGid: String(payload.offer.productGid), handle: typeof payload.offer.handle === "string" ? payload.offer.handle : null },
  } satisfies Omit<LoopDeskFunctionRule, "reward">;
  if ((payload.reward as { scope?: unknown } | null)?.scope === "order") {
    return validateAndCanonicalizeFunctionRule({ ...mappedRule, reward: payload.reward as LoopDeskOrderFunctionRule["reward"] });
  }
  return validateAndCanonicalizeFunctionRule({ ...mappedRule, reward: payload.reward as LoopDeskProductFunctionRule["reward"] });
}
