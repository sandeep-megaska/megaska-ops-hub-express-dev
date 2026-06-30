import {
  findCheckoutRecoveryCandidates,
  findPaymentRecoveryCandidates,
} from "../express-checkout/recovery/candidates";
import { dispatchRecoveryMessage } from "./recovery-dispatch";

export type ManualRecoveryDispatchSummary = {
  checkoutCandidates: number;
  paymentCandidates: number;
  sent: number;
  suppressed: number;
  failed: number;
};

export async function dispatchManualCheckoutRecovery(
  now = new Date(),
): Promise<ManualRecoveryDispatchSummary> {
  const checkoutCandidates = await findCheckoutRecoveryCandidates(now);
  const paymentCandidates = await findPaymentRecoveryCandidates(now);
  const summary: ManualRecoveryDispatchSummary = {
    checkoutCandidates: checkoutCandidates.length,
    paymentCandidates: paymentCandidates.length,
    sent: 0,
    suppressed: 0,
    failed: 0,
  };

  for (const candidate of [...checkoutCandidates, ...paymentCandidates]) {
    const result = await dispatchRecoveryMessage(candidate);
    if (result.sent) {
      summary.sent += 1;
    } else if (result.ok && "suppressed" in result && result.suppressed) {
      summary.suppressed += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}
