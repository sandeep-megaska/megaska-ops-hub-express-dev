"use client";

import { useActionState, useRef, useState } from "react";
import { compilePromotionRuleAction, type PromotionCompileActionState } from "../../../services/promotions/compiler-admin-actions.server";
import type { PromotionRuleStatus } from "../../../services/promotions/domain";
import type { PromotionEmbeddedContext } from "../../../services/promotions/admin-context";
import type { PromotionExecutionReadModel } from "../../../services/promotions/compiler-admin-read-model.server";
import PromotionConfirmationDialog from "./PromotionConfirmationDialog";
import { promotionCompileControlState } from "../../../services/promotions/compiler-admin-ui-state";

const initial: PromotionCompileActionState = { ok: true };
function EmbeddedInputs({ shopId, context }: { shopId: string; context: PromotionEmbeddedContext }) { return <><input type="hidden" name="shopId" value={shopId} /><input type="hidden" name="shop" value={String(context.shop || "")} /><input type="hidden" name="shopify_shop" value={String(context.shopify_shop || "")} /><input type="hidden" name="host" value={String(context.host || "")} /><input type="hidden" name="embedded" value={String(context.embedded || "")} /></>; }

export default function PromotionCompilationControls({ shopId, embeddedContext, promotionRuleId, status, execution, dirty = false }: { shopId: string; embeddedContext: PromotionEmbeddedContext; promotionRuleId: string; status: PromotionRuleStatus; execution: PromotionExecutionReadModel; dirty?: boolean }) {
  const [state, action] = useActionState(compilePromotionRuleAction, initial); const [confirm, setConfirm] = useState(false); const submit = useRef<HTMLButtonElement>(null); const confirmed = useRef(false);
  const control = promotionCompileControlState(status, execution);
  if (!control.renderButton) return <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{control.message}</p>;
  const message = status === "PAUSED" ? "Compile this paused promotion? Its execution data may change, but the rule will remain paused." : execution.currentCompilation ? "Compile this promotion again? A successful result will replace the current compilation. If it fails, the existing working compilation will be preserved." : "Compile this promotion? LoopDesk will resolve qualifying products and generate versioned execution data. Save normally publishes eligible promotions automatically; this manual control only rebuilds compilation data.";
  const disabled = dirty || control.disabled;
  return <div className="space-y-2"><p className="text-sm text-gray-500">Save automatically validates, compiles, and publishes eligible active or paused promotions. Use this manual compile control only for internal recovery.</p>{control.activeStatus ? <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">Compilation status: {control.activeStatus}</p> : null}{status === "PAUSED" ? <p className="text-sm text-amber-700">This rule remains paused after compilation.</p> : null}{dirty ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Save your changes before compiling.</p> : null}{!state.ok && state.message ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{state.message}</p> : null}<form action={action} onSubmit={(e) => { if (confirmed.current) { confirmed.current = false; return; } e.preventDefault(); if (!disabled) setConfirm(true); }}><EmbeddedInputs shopId={shopId} context={embeddedContext} /><input type="hidden" name="promotionRuleId" value={promotionRuleId} /><button type="submit" disabled={disabled} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300">{control.label}</button><button hidden ref={submit} type="submit">confirm</button></form><PromotionConfirmationDialog open={confirm} title={`${control.label}?`} message={message} confirmLabel={control.label} onCancel={() => setConfirm(false)} onConfirm={() => { const button = submit.current; if (!button?.form) return; confirmed.current = true; setConfirm(false); button.form.requestSubmit(button); }} /></div>;
}
