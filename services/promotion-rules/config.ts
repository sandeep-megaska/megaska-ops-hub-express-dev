import { prisma } from "../db/prisma";

export const PROMOTION_RULES_CONFIG_MODULE_KEY = "promotion_rules_config";

export type PromotionRuleStatus = "draft" | "active" | "paused" | "archived";
export type PromotionTriggerType =
  | "always"
  | "cart_contains_product"
  | "cart_contains_collection"
  | "cart_contains_variant"
  | "cart_contains_product_type"
  | "cart_contains_tag"
  | "cart_subtotal_gte"
  | "cart_quantity_gte";
export type PromotionPlacement = "drawer" | "cart_page" | "both";
export type PromotionConflictStrategy = "priority_first" | "newest_first" | "oldest_first";

export type PromotionResourceMetadata = { id?: string; gid: string; title: string; image?: string | null; imageUrl: string | null; handle: string; resourceType?: "product" | "collection" | "variant"; variantGid?: string; variantTitle?: string };

export type PromotionRule = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  status: PromotionRuleStatus;
  eligibility: {
    match: "all" | "any";
    triggers: Array<{ type: PromotionTriggerType; value?: string; productGid?: string; collectionGid?: string; variantGid?: string; productType?: string; tag?: string; subtotalGte?: number; quantityGte?: number; product?: PromotionResourceMetadata; collection?: PromotionResourceMetadata; variant?: PromotionResourceMetadata }>;
  };
  reward: { type: "offer_product"; productGid: string; variantGid: string; quantity: number; requiresDiscountEnforcement: boolean; product?: PromotionResourceMetadata };
  display: { heading: string; description: string; badge: string; ctaLabel: string; imageOverrideUrl: string | null; offerPriceDisplay: string; comparePriceDisplay: string; placement: PromotionPlacement; hideIfOfferProductAlreadyInCart: boolean };
  limits: { maxQuantityPerCart: number; showOncePerSession: boolean; oneOfferPerRule: boolean };
  schedule: { alwaysActive: boolean; startAt: string | null; endAt: string | null; timezone: string };
  [key: string]: unknown;
};

export type PromotionRulesConfig = {
  schemaVersion: 1;
  enabled: boolean;
  maxVisibleOffers: number;
  conflictStrategy: PromotionConflictStrategy;
  rules: PromotionRule[];
  [key: string]: unknown;
};

type Delegate = {
  findUnique(args: { where: { shopId_moduleKey: { shopId: string; moduleKey: string } }; select: { config: true; enabled: true } }): Promise<{ config: unknown; enabled: boolean } | null>;
  upsert(args: { where: { shopId_moduleKey: { shopId: string; moduleKey: string } }; create: { shopId: string; moduleKey: string; enabled: boolean; config: PromotionRulesConfig }; update: { enabled: boolean; config: PromotionRulesConfig } }): Promise<{ id: string }>;
};
function db() { return prisma as unknown as { shopModuleConfig: Delegate }; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function cleanText(value: unknown, fallback = "", max = 240) { return (typeof value === "string" ? value.replace(/[<>]/g, "").replace(/javascript:/gi, "").trim().slice(0, max) : "") || fallback; }
function bool(value: unknown, fallback = false) { return typeof value === "boolean" ? value : fallback; }
function num(value: unknown, fallback: number, min = 0, max = 1000000) { const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function nullableUrl(value: unknown) { const next = cleanText(value, "", 800); if (!next) return null; try { const parsed = new URL(next); return parsed.protocol === "http:" || parsed.protocol === "https:" ? next : null; } catch { return null; } }
function resourceType(value: unknown) { return value === "product" || value === "collection" || value === "variant" ? value : undefined; }
function metadata(value: unknown, fallbackGid = ""): PromotionResourceMetadata {
  const raw = isRecord(value) ? value : {};
  const imageUrl = nullableUrl(raw.imageUrl ?? raw.image);
  return { id: cleanText(raw.id, fallbackGid, 300), gid: cleanText(raw.gid ?? raw.id, fallbackGid, 300), title: cleanText(raw.title, "", 240), image: imageUrl, imageUrl, handle: cleanText(raw.handle, "", 240), resourceType: resourceType(raw.resourceType), variantGid: cleanText(raw.variantGid, "", 300), variantTitle: cleanText(raw.variantTitle, "", 240) };
}
function stableId(value: unknown) { const next = cleanText(value, "", 80).replace(/[^a-zA-Z0-9_-]/g, "_"); return next || `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
function status(value: unknown): PromotionRuleStatus { return value === "active" || value === "paused" || value === "archived" || value === "draft" ? value : "draft"; }
function triggerType(value: unknown): PromotionTriggerType { return value === "cart_contains_product" || value === "cart_contains_collection" || value === "cart_contains_variant" || value === "cart_contains_product_type" || value === "cart_contains_tag" || value === "cart_subtotal_gte" || value === "cart_quantity_gte" ? value : "always"; }
function placement(value: unknown): PromotionPlacement { return value === "drawer" || value === "cart_page" || value === "both" ? value : "drawer"; }
function conflict(value: unknown): PromotionConflictStrategy { return value === "newest_first" || value === "oldest_first" || value === "priority_first" ? value : "priority_first"; }

export function normalizePromotionRule(input: unknown): PromotionRule {
  const raw = isRecord(input) ? input : {};
  const eligibility = isRecord(raw.eligibility) ? raw.eligibility : {};
  const triggerRaw = Array.isArray(eligibility.triggers) && isRecord(eligibility.triggers[0]) ? eligibility.triggers[0] : {};
  const type = triggerType(triggerRaw.type ?? raw.triggerType);
  const value = cleanText(triggerRaw.value ?? raw.triggerValue, "", 300);
  const reward = isRecord(raw.reward) ? raw.reward : {};
  const display = isRecord(raw.display) ? raw.display : {};
  const limits = isRecord(raw.limits) ? raw.limits : {};
  const schedule = isRecord(raw.schedule) ? raw.schedule : {};
  const normalizedTrigger: Record<string, unknown> & { type: PromotionTriggerType; value: string } = { ...triggerRaw, type, value };
  if (type === "cart_contains_product") { normalizedTrigger.productGid = cleanText(triggerRaw.productGid, value, 300); normalizedTrigger.product = metadata(triggerRaw.product, normalizedTrigger.productGid as string); }
  if (type === "cart_contains_collection") { normalizedTrigger.collectionGid = cleanText(triggerRaw.collectionGid, value, 300); normalizedTrigger.collection = metadata(triggerRaw.collection, normalizedTrigger.collectionGid as string); }
  if (type === "cart_contains_variant") { normalizedTrigger.variantGid = cleanText(triggerRaw.variantGid, value, 300); normalizedTrigger.variant = metadata(triggerRaw.variant, normalizedTrigger.variantGid as string); }
  if (type === "cart_contains_product_type") normalizedTrigger.productType = value;
  if (type === "cart_contains_tag") normalizedTrigger.tag = value;
  if (type === "cart_subtotal_gte") normalizedTrigger.subtotalGte = num(value, 0);
  if (type === "cart_quantity_gte") normalizedTrigger.quantityGte = num(value, 0);
  return {
    ...raw,
    id: stableId(raw.id),
    name: cleanText(raw.name, "Untitled promotion rule", 120),
    enabled: bool(raw.enabled, false),
    priority: num(raw.priority, 100, -100000, 100000),
    status: status(raw.status),
    eligibility: { ...eligibility, match: eligibility.match === "all" ? "all" : "any", triggers: [normalizedTrigger] },
    reward: { ...reward, type: "offer_product", productGid: cleanText(reward.productGid, "", 300), variantGid: cleanText(reward.variantGid, "", 300), quantity: num(reward.quantity, 1, 1, 999), requiresDiscountEnforcement: bool(reward.requiresDiscountEnforcement, false), product: metadata(reward.product, cleanText(reward.productGid, "", 300)) },
    display: { ...display, heading: cleanText(display.heading, "", 120), description: cleanText(display.description, "", 500), badge: cleanText(display.badge, "", 80), ctaLabel: cleanText(display.ctaLabel, "Add offer", 80), imageOverrideUrl: nullableUrl(display.imageOverrideUrl), offerPriceDisplay: cleanText(display.offerPriceDisplay, "", 80), comparePriceDisplay: cleanText(display.comparePriceDisplay, "", 80), placement: placement(display.placement), hideIfOfferProductAlreadyInCart: bool(display.hideIfOfferProductAlreadyInCart, true) },
    limits: { ...limits, maxQuantityPerCart: num(limits.maxQuantityPerCart, 1, 1, 999), showOncePerSession: bool(limits.showOncePerSession, false), oneOfferPerRule: bool(limits.oneOfferPerRule, true) },
    schedule: { ...schedule, alwaysActive: bool(schedule.alwaysActive, true), startAt: cleanText(schedule.startAt, "", 80) || null, endAt: cleanText(schedule.endAt, "", 80) || null, timezone: cleanText(schedule.timezone, "Asia/Kolkata", 80) },
  };
}

export function normalizePromotionRulesConfig(input: unknown, enabledOverride?: boolean): PromotionRulesConfig {
  const raw = isRecord(input) ? input : {};
  return { ...raw, schemaVersion: 1, enabled: typeof enabledOverride === "boolean" ? enabledOverride : bool(raw.enabled, false), maxVisibleOffers: num(raw.maxVisibleOffers, 1, 1, 20), conflictStrategy: conflict(raw.conflictStrategy), rules: Array.isArray(raw.rules) ? raw.rules.map(normalizePromotionRule) : [] };
}

function containsSecretLikeKey(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => /secret|password|token|private/i.test(key) || containsSecretLikeKey(child));
}

export function validatePromotionRulesConfig(config: PromotionRulesConfig): string[] {
  const errors: string[] = [];
  if (containsSecretLikeKey(config)) errors.push("Promotion Rules config cannot store secrets, tokens, passwords, or private values.");
  if (config.maxVisibleOffers < 1) errors.push("Max visible offers must be at least 1.");
  for (const rule of config.rules) {
    const prefix = rule.name ? `Rule \"${rule.name}\"` : "Rule";
    if (!rule.name.trim()) errors.push(`${prefix}: rule name is required.`);
    if (!Number.isFinite(rule.priority)) errors.push(`${prefix}: priority must be numeric.`);
    if (!rule.display.heading.trim()) errors.push(`${prefix}: display heading is required.`);
    if (!rule.display.ctaLabel.trim()) errors.push(`${prefix}: CTA label is required.`);
    const start = rule.schedule.startAt ? Date.parse(rule.schedule.startAt) : NaN;
    const end = rule.schedule.endAt ? Date.parse(rule.schedule.endAt) : NaN;
    if (!rule.schedule.alwaysActive && rule.schedule.startAt && rule.schedule.endAt && Number.isFinite(start) && Number.isFinite(end) && end <= start) errors.push(`${prefix}: schedule end must be after start.`);
    if (rule.status === "active") {
      const trigger = rule.eligibility.triggers[0];
      if (trigger.type === "cart_contains_product" && !String(trigger.productGid || trigger.value || "").trim()) errors.push(`${prefix}: active product trigger rules require a selected product.`);
      else if (trigger.type === "cart_contains_collection" && !String(trigger.collectionGid || trigger.value || "").trim()) errors.push(`${prefix}: active collection trigger rules require a selected collection.`);
      else if (trigger.type === "cart_contains_variant" && !String(trigger.variantGid || trigger.value || "").trim()) errors.push(`${prefix}: active variant trigger rules require a selected variant.`);
      else if (trigger.type !== "always" && !String(trigger.value || "").trim()) errors.push(`${prefix}: active rules must have a valid trigger value.`);
      if (!rule.reward.productGid.trim() || !rule.reward.variantGid.trim()) errors.push(`${prefix}: active offer product rules require a selected product and variant.`);
    }
  }
  return errors;
}

export async function getPromotionRulesConfig(shopId: string) {
  const stored = await db().shopModuleConfig.findUnique({ where: { shopId_moduleKey: { shopId, moduleKey: PROMOTION_RULES_CONFIG_MODULE_KEY } }, select: { config: true, enabled: true } });
  return normalizePromotionRulesConfig(stored?.config, Boolean(stored?.enabled));
}

export async function savePromotionRulesConfig(shopId: string, nextConfig: PromotionRulesConfig) {
  const next = normalizePromotionRulesConfig(nextConfig, nextConfig.enabled);
  const errors = validatePromotionRulesConfig(next);
  if (errors.length) throw new Error(errors.join(" "));
  await db().shopModuleConfig.upsert({ where: { shopId_moduleKey: { shopId, moduleKey: PROMOTION_RULES_CONFIG_MODULE_KEY } }, create: { shopId, moduleKey: PROMOTION_RULES_CONFIG_MODULE_KEY, enabled: next.enabled, config: next }, update: { enabled: next.enabled, config: next } });
  return next;
}

export function promotionRulesSetupStatus(config: PromotionRulesConfig) {
  if (!config.rules.length) return "Not configured" as const;
  if (!config.enabled) return "Configured but disabled" as const;
  return config.rules.some((rule) => rule.enabled && rule.status === "active") ? "Enabled with active rules" as const : "Configured but disabled" as const;
}
