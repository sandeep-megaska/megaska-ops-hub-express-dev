import type { PromotionRuleStatus } from "./domain.ts";
import { compilePromotionRule } from "./compiler.server.ts";
import { synchronizePromotionFunctionConfiguration } from "./runtime/synchronization.server.ts";
import { prisma } from "../db/prisma.ts";

type SavedPromotion = { id: string; status: PromotionRuleStatus };
type PublicationDeps = { compiler?: typeof compilePromotionRule; synchronizer?: typeof synchronizePromotionFunctionConfiguration };
type CompilationStatus = Awaited<ReturnType<typeof compilePromotionRule>>["status"];

export class PromotionPublicationSyncError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PromotionPublicationSyncError";
    this.code = code;
  }
}

async function synchronizeRuntime(shopId: string, deps: PublicationDeps) {
  const synchronizer = deps.synchronizer ?? synchronizePromotionFunctionConfiguration;
  const synced = await synchronizer({ shopId });
  if (!synced.ok) throw new PromotionPublicationSyncError(synced.code || "SYNC_FAILED", synced.message || "Promotion Shopify synchronization failed.");
  return "SYNCED" as const;
}

export async function publishSavedPromotion(shopId: string, shopDomain: string | null | undefined, rule: SavedPromotion, reason: "RULE_CREATED" | "RULE_UPDATED", deps: PublicationDeps = {}) {
  if (rule.status !== "ACTIVE" && rule.status !== "PAUSED") return { compile: "SKIPPED" as const, sync: "SKIPPED" as const };
  const compiler = deps.compiler ?? compilePromotionRule;
  const compiled = await compiler({ shopId, shopDomain, promotionRuleId: rule.id, reason });
  const sync = await synchronizeRuntime(shopId, deps);
  return { compile: compiled.status, sync };
}

export async function publishPromotionStatusChange(shopId: string, shopDomain: string | null | undefined, rule: SavedPromotion, deps: PublicationDeps = {}) {
  let compile: "SKIPPED" | CompilationStatus = "SKIPPED";
  if (rule.status === "ACTIVE" || rule.status === "PAUSED") {
    const compiler = deps.compiler ?? compilePromotionRule;
    const compiled = await compiler({ shopId, shopDomain, promotionRuleId: rule.id, reason: "RULE_UPDATED" });
    compile = compiled.status;
  }
  const sync = await synchronizeRuntime(shopId, deps);
  return { compile, sync };
}

/** Manual repair always recompiles every publishable shop rule before invoking the one shop-level synchronizer. */
export async function manuallySynchronizePromotionConfiguration(shopId: string, shopDomain: string | null | undefined, deps: PublicationDeps & { ruleReader?: { findMany(args: object): Promise<Array<{ id: string }>> } } = {}) {
  const compiler = deps.compiler ?? compilePromotionRule;
  const ruleReader = deps.ruleReader ?? prisma.promotionRule;
  const rules = await ruleReader.findMany({ where: { shopId, status: { in: ["ACTIVE", "PAUSED"] }, archivedAt: null }, select: { id: true }, orderBy: { id: "asc" } });
  for (const rule of rules) await compiler({ shopId, shopDomain, promotionRuleId: rule.id, reason: "MANUAL_RECOMPILE" });
  const synchronizer = deps.synchronizer ?? synchronizePromotionFunctionConfiguration;
  return synchronizer({ shopId });
}
