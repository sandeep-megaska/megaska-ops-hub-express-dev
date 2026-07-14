import { ISSUE_STATUS_DESCRIPTIONS } from "../../../exchange/issue.ts";
import type { CustomerDashboardActionResult, IssueActionPayload } from "../contract.ts";
import type { CustomerDashboardActionContext } from "../context.ts";
import type { CustomerOwnedOrderSnapshot } from "../ownership.ts";
import { createIssueRequest, validateIssueRequest } from "../issue-domain.ts";
function statusLabel(status:string){return ISSUE_STATUS_DESCRIPTIONS[status]||"Issue request received";}
export async function executeIssueAction(input:{context:CustomerDashboardActionContext;order:CustomerOwnedOrderSnapshot;payload:IssueActionPayload;idempotencyKey:string}):Promise<CustomerDashboardActionResult>{const validation=await validateIssueRequest(input); const created=await createIssueRequest({context:input.context,order:input.order,payload:input.payload,validation}); const statusCode=String(created.status||"OPEN").toUpperCase(); return {ok:true,actionType:"ISSUE",requestId:created.id,statusCode,statusLabel:statusLabel(statusCode),customerMessage:"Your issue report has been submitted.",orderId:input.order.id,orderNumber:input.order.orderNumber,createdAt:(created.requestedAt??input.context.now).toISOString(),nextAction:{type:"REFRESH_DASHBOARD",url:null}};}
