"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PromotionRewardType, PromotionRuleStatus, PromotionTriggerMatchMode, PromotionTriggerReferenceInput, PromotionTriggerType } from "./domain.ts";
import { buildPromotionAdminUrl, promotionEmbeddedContext, verifyPromotionActionTenant, type PromotionEmbeddedContext } from "./admin-context";
import { archivePromotionRule, changePromotionRuleStatus, createPromotionRule, getPromotionRuleById, PromotionRuleNotFoundError, PromotionRuleTransitionError, PromotionRuleValidationError, updatePromotionRule, type PromotionRuleWriteInput } from "./repository.server.ts";
import { resolveAdminShopFromSearchParams } from "../shopify/admin-shop-context";
import { PromotionCompilationError } from "./compiler.server.ts";
import { PromotionPublicationSyncError, publishSavedPromotion } from "./publication-orchestration.server.ts";

export type PromotionActionState = { ok: boolean; message?: string; errors?: { field: string; message: string }[] };
const SHOP_ERROR = "Unable to resolve shop context for this promotion action.";

function stringValue(formData: FormData, name: string) { return String(formData.get(name) ?? "").trim(); }
function integerValue(formData: FormData, name: string, fallback: number | undefined) {
  const raw = stringValue(formData, name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) ? value : Number.NaN;
}
function decimalValue<T extends number | null | undefined>(formData: FormData, name: string, blankValue: T): number | T {
  const raw = stringValue(formData, name);
  if (!raw) return blankValue;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}
function optionalUtcDate(formData: FormData, utcName: string, legacyName: string) {
  const raw = formData.has(utcName) ? stringValue(formData, utcName) : stringValue(formData, legacyName);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}
function boolValue(formData: FormData, name: string) { return formData.get(name) === "on"; }
function actionContext(formData: FormData): PromotionEmbeddedContext { return { shop: stringValue(formData, "shop"), shopify_shop: stringValue(formData, "shopify_shop"), host: stringValue(formData, "host"), embedded: stringValue(formData, "embedded") }; }
function actionUrl(formData: FormData, path: string, extra: Record<string, string | undefined> = {}) { return buildPromotionAdminUrl(path, promotionEmbeddedContext(actionContext(formData), stringValue(formData, "shop")), extra); }
function references(formData: FormData): PromotionTriggerReferenceInput[] {
  const triggerType = stringValue(formData, "triggerType") as PromotionTriggerType;
  const raw = stringValue(formData, "triggerReferences");
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as PromotionTriggerReferenceInput[];
      if (Array.isArray(parsed)) return parsed.filter((reference) => reference.sourceType === triggerType);
    } catch {
      // Fall back to the legacy newline format below so validation remains authoritative.
    }
  }
  return raw.split(/\r?\n/).map((v) => v.trim()).filter(Boolean).map((value) => triggerType === "PRODUCT_TYPE" ? { sourceType: triggerType, referenceValue: value, normalizedValue: value.toLowerCase() } : { sourceType: triggerType, referenceGid: value });
}
async function shop(formData: FormData) {
  const resolved = await resolveAdminShopFromSearchParams(actionContext(formData));
  if (!resolved.shop?.id) throw new Error(SHOP_ERROR);
  const claimedShopId = stringValue(formData, "shopId");
  if (!verifyPromotionActionTenant(claimedShopId, resolved.shop.id)) throw new Error(SHOP_ERROR);
  return resolved.shop;
}
function input(formData: FormData): Omit<PromotionRuleWriteInput, "shopId"> {
  return { name: stringValue(formData, "name"), description: stringValue(formData, "description") || null, triggerType: stringValue(formData, "triggerType") as PromotionTriggerType, triggerMatchMode: stringValue(formData, "triggerMatchMode") as PromotionTriggerMatchMode, minimumTriggerQuantity: integerValue(formData, "minimumTriggerQuantity", 1) as number, minimumCartSubtotal: decimalValue(formData, "minimumCartSubtotal", null), offerProductGid: stringValue(formData, "offerProductGid"), offerProductTitle: stringValue(formData, "offerProductTitle") || null, offerProductHandle: stringValue(formData, "offerProductHandle") || null, offerProductImageUrl: stringValue(formData, "offerProductImageUrl") || null, rewardType: stringValue(formData, "rewardType") as PromotionRewardType, rewardValue: decimalValue(formData, "rewardValue", Number.NaN), maximumRewardQuantity: integerValue(formData, "maximumRewardQuantity", 1) as number, priority: integerValue(formData, "priority", 0) as number, startsAt: optionalUtcDate(formData, "startsAtUtc", "startsAt") as unknown as Date | null, endsAt: optionalUtcDate(formData, "endsAtUtc", "endsAt") as unknown as Date | null, combinesWithProductDiscounts: boolValue(formData, "combinesWithProductDiscounts"), combinesWithOrderDiscounts: boolValue(formData, "combinesWithOrderDiscounts"), combinesWithShippingDiscounts: boolValue(formData, "combinesWithShippingDiscounts"), heading: stringValue(formData, "heading") || null, badgeText: stringValue(formData, "badgeText") || null, customerMessage: stringValue(formData, "customerMessage") || null, ctaText: stringValue(formData, "ctaText") || null, triggerReferences: references(formData), actor: { actorType: "ADMIN" } };
}
function safeErrorMarker(value: string) { return value.toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").slice(0, 80) || "sync_failed"; }
function publicationErrorParam(error: unknown) { if (error instanceof PromotionCompilationError) return `compile_${error.code}`; if (error instanceof PromotionPublicationSyncError) return `sync_${safeErrorMarker(error.code)}`; return "sync_failed"; }
function state(error: unknown): PromotionActionState { if (error instanceof PromotionRuleValidationError) return { ok: false, errors: error.errors, message: "Fix the promotion fields and try again." }; if (error instanceof PromotionRuleTransitionError) return { ok: false, message: error.message }; return { ok: false, message: error instanceof Error ? error.message : "Promotion action failed." }; }

export async function createPromotionDraftAction(_prev: PromotionActionState, formData: FormData): Promise<PromotionActionState> { try { const s = await shop(formData); const created = await createPromotionRule({ shopId: s.id, ...input(formData), status: "DRAFT" }); let extra: Record<string, string | undefined> = { saved: "1" }; try { const publication = await publishSavedPromotion(s.id, s.shopDomain, created, "RULE_CREATED"); extra = { ...extra, compile: publication.compile, sync: publication.sync }; } catch (e) { extra = { ...extra, publication: "failed", error: publicationErrorParam(e) }; } revalidatePath("/admin/promotions"); redirect(actionUrl(formData, `/admin/promotions/${created.id}`, extra)); } catch (e) { if ((e as Error & { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e; return state(e); } }
export async function updatePromotionDraftAction(_prev: PromotionActionState, formData: FormData): Promise<PromotionActionState> { try { const s = await shop(formData); const id = stringValue(formData, "id"); const updated = await updatePromotionRule(s.id, id, input(formData)); let extra: Record<string, string | undefined> = { saved: "1" }; try { const publication = await publishSavedPromotion(s.id, s.shopDomain, updated, "RULE_UPDATED"); extra = { ...extra, compile: publication.compile, sync: publication.sync }; } catch (e) { extra = { ...extra, publication: "failed", error: publicationErrorParam(e) }; } revalidatePath(`/admin/promotions/${id}`); redirect(actionUrl(formData, `/admin/promotions/${id}`, extra)); } catch (e) { if ((e as Error & { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e; return state(e); } }
export async function changePromotionStatusAction(_prev: PromotionActionState, formData: FormData): Promise<PromotionActionState> { try { const s = await shop(formData); const id = stringValue(formData, "id"); await getPromotionRuleById(s.id, id); await changePromotionRuleStatus(s.id, id, stringValue(formData, "status") as PromotionRuleStatus, { actor: { actorType: "ADMIN" } }); revalidatePath(`/admin/promotions/${id}`); redirect(actionUrl(formData, `/admin/promotions/${id}`, { saved: "status" })); } catch (e) { if ((e as Error & { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e; if (e instanceof PromotionRuleNotFoundError) return { ok: false, message: "Promotion rule was not found." }; return state(e); } }
export async function archivePromotionRuleAction(_prev: PromotionActionState, formData: FormData): Promise<PromotionActionState> { try { const s = await shop(formData); const id = stringValue(formData, "id"); await archivePromotionRule(s.id, id, { actor: { actorType: "ADMIN" } }); revalidatePath("/admin/promotions"); redirect(actionUrl(formData, "/admin/promotions", { status: "ARCHIVED" })); } catch (e) { if ((e as Error & { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e; return state(e); } }
