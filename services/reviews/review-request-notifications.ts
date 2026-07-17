import { sendCustomerEmail } from "../notifications/email.ts";
export type ReviewRequestChannel = "EMAIL" | "SMS" | "WHATSAPP";
export type ReviewRequestSendResult = { ok:true; providerMessageId:string|null } | { ok:false; retryable:boolean; errorCode:string };
export type ReviewRequestNotification = { shopId:string; channel:ReviewRequestChannel; to:string|null; subject?:string; text:string; idempotencyKey:string; requestId:string };
/** Channel boundary: scheduling never imports a provider SDK. SMS/WhatsApp deliberately fail closed until merchant-owned adapters are configured. */
export async function sendReviewRequestNotification(input:ReviewRequestNotification):Promise<ReviewRequestSendResult>{
 if(input.channel==="EMAIL"){const result=await sendCustomerEmail({shopId:input.shopId,to:input.to,eventType:"REVIEW_REQUEST",subject:input.subject??"How was your purchase?",text:input.text,usageContext:{sourceType:"REVIEW_REQUEST",sourceId:input.requestId,idempotencyKey:input.idempotencyKey,metadata:{channel:"EMAIL"}}});
  if(!result.skipped&&result.success)return {ok:true,providerMessageId:result.messageId};
  if(result.skipped)return {ok:false,retryable:false,errorCode:result.reason}; return {ok:false,retryable:true,errorCode:result.errorCode??"REVIEW_EMAIL_PROVIDER_FAILED"};
 }
 return {ok:false,retryable:false,errorCode:input.channel==="SMS"?"REVIEW_REQUEST_SMS_PROVIDER_NOT_CONFIGURED":"REVIEW_REQUEST_WHATSAPP_PROVIDER_NOT_CONFIGURED"};
}
export function classifyReviewRequestFailure(code:string){return /TIMEOUT|429|5\d\d|NETWORK|PROVIDER_FAILED/.test(code)?"RETRYABLE" as const:"PERMANENT" as const;}
export function reviewRequestRetryAt(attemptNumber:number,now=new Date()){const minutes=[15,120,720,1440][attemptNumber-1];return minutes?new Date(now.getTime()+minutes*60_000):null;}
