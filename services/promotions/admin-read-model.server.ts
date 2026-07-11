import type { PromotionRuleStatus } from "./domain.ts";
import { listPromotionRules, type PromotionRuleRecord } from "./repository.server.ts";

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
  executionLabel: "Not compiled" | "Execution setup pending";
};

export function formatPromotionReward(rule: Pick<PromotionRuleRecord, "rewardType" | "rewardValue">) {
  const value = Number(rule.rewardValue ?? 0);
  if (rule.rewardType === "PERCENTAGE_OFF") return `${value}% off`;
  if (rule.rewardType === "FIXED_AMOUNT_OFF") return `₹${value} off`;
  return `Fixed price ₹${value}`;
}

export function formatPromotionSchedule(rule: Pick<PromotionRuleRecord, "startsAt" | "endsAt">) {
  const start = rule.startsAt ? new Date(rule.startsAt).toLocaleDateString("en-IN") : "Now";
  const end = rule.endsAt ? new Date(rule.endsAt).toLocaleDateString("en-IN") : "No end";
  return `${start} → ${end}`;
}

export function toPromotionAdminListItem(rule: PromotionRuleRecord): PromotionAdminListItem {
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
    executionLabel: rule.currentCompilationId ? "Execution setup pending" : "Not compiled",
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
  return rules
    .filter((rule) => status === "ALL" || rule.status === status)
    .map(toPromotionAdminListItem);
}
