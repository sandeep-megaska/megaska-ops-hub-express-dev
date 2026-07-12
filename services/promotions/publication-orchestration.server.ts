import type { PromotionRuleStatus } from "./domain.ts";
import { compilePromotionRule } from "./compiler.server.ts";
import { synchronizePromotionFunctionConfiguration } from "./runtime/synchronization.server.ts";

type SavedPromotion = { id: string; status: PromotionRuleStatus };
type PublicationDeps = { compiler?: typeof compilePromotionRule; synchronizer?: typeof synchronizePromotionFunctionConfiguration };

export class PromotionPublicationSyncError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PromotionPublicationSyncError";
    this.code = code;
  }
}

export async function publishSavedPromotion(shopId: string, shopDomain: string | null | undefined, rule: SavedPromotion, reason: "RULE_CREATED" | "RULE_UPDATED", deps: PublicationDeps = {}) {
  if (rule.status !== "ACTIVE" && rule.status !== "PAUSED") return { compile: "SKIPPED" as const, sync: "SKIPPED" as const };
  const compiler = deps.compiler ?? compilePromotionRule;
  const synchronizer = deps.synchronizer ?? synchronizePromotionFunctionConfiguration;
  const compiled = await compiler({ shopId, shopDomain, promotionRuleId: rule.id, reason });
  const synced = await synchronizer({ shopId });
  if (!synced.ok) throw new PromotionPublicationSyncError(synced.code || "SYNC_FAILED", synced.message || "Promotion Shopify synchronization failed.");
  return { compile: compiled.status, sync: "SYNCED" as const };
}
