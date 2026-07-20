import type { PromotionRuleStatus } from "./domain.ts";
import { listPromotionRules, type PromotionRuleRecord } from "./repository.server.ts";
import { getPromotionListCompilationReadModels, type PromotionAdminExecutionCode, type PromotionAdminTone } from "./compiler-admin-read-model.server.ts";
import { normalizePromotionReward, productRewardStrategy } from "./reward-strategy.ts";

export type PromotionAdminStatusFilter = PromotionRuleStatus | "ALL";

export type PromotionAdminListItem = {
  id: string;
  name: string;
  triggerTypeLabel: string;
  offerProductTitle: string;
  rewardLabel: string;
  status: PromotionRuleStatus;
  priority: number;
  scheduleLabel: string;
  updatedLabel: string;
  executionLabel: string;
  executionStatus: PromotionAdminExecutionCode;
  executionTone: PromotionAdminTone;
  executionSecondaryText?: string;
};

export function formatPromotionReward(rule: Pick<PromotionRuleRecord, "rewardType" | "rewardValue">) {
  const normalized = normalizePromotionReward({ type: rule.rewardType, value: rule.rewardValue, maximumQuantity: 1 }, { productGid: "gid://shopify/Product/1", quantityCap: 1 });
  if (!normalized.ok || !productRewardStrategy.supports(normalized.reward)) return "Invalid reward";
  const value = Number(normalized.reward.configuration.value);
  if (normalized.reward.method === "percentage") return `${value}% off`;
  if (normalized.reward.method === "fixed_amount") return `₹${value} off`;
  return `Fixed price ₹${value}`;
}

export function formatPromotionSchedule(rule: Pick<PromotionRuleRecord, "startsAt" | "endsAt">) {
  const start = rule.startsAt ? new Date(rule.startsAt).toLocaleDateString("en-IN") : "Now";
  const end = rule.endsAt ? new Date(rule.endsAt).toLocaleDateString("en-IN") : "No end";
  return `${start} → ${end}`;
}

export function toPromotionAdminListItem(rule: PromotionRuleRecord, execution?: { code: PromotionAdminExecutionCode; label: string; tone: PromotionAdminTone; secondaryText?: string }): PromotionAdminListItem {
  return {
    id: rule.id,
    name: rule.name || "Untitled promotion",
    triggerTypeLabel: rule.triggerType.replaceAll("_", " ").toLowerCase(),
    offerProductTitle: rule.offerProductTitle || rule.offerProductHandle || rule.offerProductGid || "Offer product not selected",
    rewardLabel: formatPromotionReward(rule),
    status: rule.status,
    priority: rule.priority,
    scheduleLabel: formatPromotionSchedule(rule),
    updatedLabel: rule.updatedAt ? new Date(rule.updatedAt).toLocaleString("en-IN") : "Not updated yet",
    executionLabel: execution?.label ?? "Not compiled",
    executionStatus: execution?.code ?? "NOT_COMPILED",
    executionTone: execution?.tone ?? "neutral",
    executionSecondaryText: execution?.secondaryText,
  };
}

export async function getPromotionAdminListReadModel(
  shopId: string,
  options: { status?: PromotionAdminStatusFilter } = {},
  database?: Parameters<typeof listPromotionRules>[2],
) {
  const status = options.status ?? "ALL";
  const includeArchived = status === "ARCHIVED";
  const rules = await listPromotionRules(shopId, { includeArchived }, database as never);
  const filtered = rules.filter((rule) => status === "ALL" || rule.status === status);
  const executions = await getPromotionListCompilationReadModels(shopId, filtered.map((rule) => rule.id), database as never);
  return filtered.map((rule) => toPromotionAdminListItem(rule, executions.get(rule.id)));
}
