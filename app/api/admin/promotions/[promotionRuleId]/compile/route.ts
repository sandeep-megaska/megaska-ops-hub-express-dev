import { NextRequest, NextResponse } from "next/server";
import {
  formatAdminShopResolutionError,
  resolveAdminShopFromRequest,
} from "../../../../../../services/shopify/admin-shop-context.ts";
import { compilePromotionRule, PromotionCompilationError } from "../../../../../../services/promotions/compiler.server.ts";
import { safeCompilationFailureMessage } from "../../../../../../services/promotions/compiler-admin-read-model.server.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { promotionRuleId: string };

export async function POST(request: NextRequest, context: { params: Promise<Params> }) {
  const resolved = await resolveAdminShopFromRequest(request);

  if (!resolved.shop?.id) {
    return NextResponse.json(
      {
        ok: false,
        code: "UNAUTHORIZED",
        message: formatAdminShopResolutionError(resolved),
        retryable: false,
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { promotionRuleId } = await context.params;
  if (!promotionRuleId) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", message: "Promotion rule was not found.", retryable: false },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await compilePromotionRule({
      shopId: resolved.shop.id,
      shopDomain: resolved.shop.shopDomain,
      promotionRuleId,
      reason: "MANUAL_RECOMPILE",
    });

    return NextResponse.json(
      { ok: true, code: result.status, result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PromotionCompilationError) {
      const status = error.code === "DUPLICATE_ACTIVE_COMPILATION" ? 409 : error.code === "RULE_NOT_COMPILABLE" || error.code === "RULE_VALIDATION_FAILED" ? 422 : 500;
      return NextResponse.json(
        {
          ok: false,
          code: error.code,
          message: safeCompilationFailureMessage(error.code),
          retryable: error.code !== "RULE_NOT_COMPILABLE" && error.code !== "RULE_VALIDATION_FAILED",
        },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { ok: false, code: "COMPILATION_FAILED", message: "Compilation could not be completed. Review the latest attempt or try again.", retryable: true },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
