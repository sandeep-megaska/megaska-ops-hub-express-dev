"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildPromotionAdminUrl, promotionEmbeddedContext, verifyPromotionActionTenant, type PromotionEmbeddedContext } from "./admin-context";
import { compilePromotionRule, PromotionCompilationError } from "./compiler.server.ts";
import { safeCompilationFailureMessage } from "./compiler-admin-read-model.server.ts";
import { resolveAdminShopFromSearchParams } from "../shopify/admin-shop-context";

export type PromotionCompileActionState = { ok: boolean; message?: string };
function stringValue(formData: FormData, name: string) { return String(formData.get(name) ?? "").trim(); }
function actionContext(formData: FormData): PromotionEmbeddedContext { return { shop: stringValue(formData, "shop"), shopify_shop: stringValue(formData, "shopify_shop"), host: stringValue(formData, "host"), embedded: stringValue(formData, "embedded") }; }
function actionUrl(formData: FormData, path: string, canonicalShopDomain: string, extra: Record<string, string | undefined> = {}) { return buildPromotionAdminUrl(path, promotionEmbeddedContext(actionContext(formData), canonicalShopDomain), extra); }
function redirectFor(formData: FormData, id: string, marker: string, canonicalShopDomain: string) { redirect(actionUrl(formData, `/admin/promotions/${id}`, canonicalShopDomain, { compile: marker })); }
export async function compilePromotionRuleAction(_previousState: PromotionCompileActionState, formData: FormData): Promise<PromotionCompileActionState> {
  const id = stringValue(formData, "promotionRuleId") || stringValue(formData, "id");
  try {
    const resolved = await resolveAdminShopFromSearchParams(actionContext(formData));
    if (!resolved.shop?.id || !verifyPromotionActionTenant(stringValue(formData, "shopId"), resolved.shop.id)) return { ok: false, message: "Promotion rule was not found." };
    if (!id) return { ok: false, message: "Promotion rule was not found." };
    await compilePromotionRule({ shopId: resolved.shop.id, shopDomain: resolved.shop.shopDomain, promotionRuleId: id, reason: "MANUAL_RECOMPILE" });
    revalidatePath("/admin/promotions"); revalidatePath(`/admin/promotions/${id}`);
    redirectFor(formData, id, "success", resolved.shop.shopDomain);
    throw new Error("Unexpected compile redirect continuation.");
  } catch (error) {
    if ((error as Error & { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw error;
    revalidatePath("/admin/promotions"); if (id) revalidatePath(`/admin/promotions/${id}`);
    if (id) { redirectFor(formData, id, error instanceof PromotionCompilationError ? `failed_${error.code}` : "failed", stringValue(formData, "shop")); throw new Error("Unexpected compile redirect continuation."); }
    return { ok: false, message: error instanceof PromotionCompilationError ? safeCompilationFailureMessage(error.code) : "Compilation could not be completed. Review the latest attempt or try again." };
  }
}
