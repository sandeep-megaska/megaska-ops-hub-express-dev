import type { PromotionRuleStatus } from "./domain.ts";
import type { PromotionExecutionReadModel } from "./compiler-admin-read-model.server.ts";

export function promotionCompileControlState(status: PromotionRuleStatus, execution: Pick<PromotionExecutionReadModel, "code" | "currentCompilation">) {
  if (status === "DRAFT") return { renderButton: false, disabled: true, label: "Compile promotion", message: "Activate this rule before compiling it." };
  if (status === "ARCHIVED") return { renderButton: false, disabled: true, label: "Compile promotion", message: "Archived promotions cannot be compiled." };
  if (execution.code === "PENDING" || execution.code === "COMPILING") return { renderButton: true, disabled: true, label: execution.currentCompilation ? "Compile again" : "Compile promotion", activeStatus: execution.code === "PENDING" ? "Queued" : "Compiling" };
  return { renderButton: true, disabled: false, label: execution.currentCompilation ? "Compile again" : "Compile promotion" };
}
