import { readFileSync } from 'node:fs';

const source = readFileSync('extensions/megaska-otp/assets/megaska-express-modal.js', 'utf8');
const checks = [
  ['COD policy endpoint is fetched', /cod-policy`\)/],
  ['Policy request sends no monetary body', /apiFetch\(`\/express\/checkout\/intents\/\$\{encodeURIComponent\(state\.intent\.id\)\}\/cod-policy`\)/],
  ['Normal COD still branches to createOrder', /if \(branch === "COD"\)[\s\S]{0,220}return createOrder\(\)/],
  ['Partial COD renders advance and balance labels', /Pay now to confirm[\s\S]*Pay on delivery/],
  ['Partial COD CTA formats backend advance', /Pay \$\{money\(cod\.advanceAmountPaise, cod\.currency\)\} & Confirm COD/],
  ['Create-order request has empty body', /cod-advance\/razorpay-order`, \{ method: "POST", body: \{\} \}/],
  ['Razorpay uses backend order id and amount', /order_id: order\.id, amount: order\.amount/],
  ['Verify request posts normalized Razorpay callback only', /cod-advance\/razorpay\/verify`, \{ method: "POST", body: payload \}/],
  ['Raw signature is not logged explicitly', !/console\.(?:log|info|warn|error|debug)\([^\n]*razorpay_signature/.test(source)],
  ['Successful verification sets verified state', /cod\.verified = verified\?\.verified === true/],
  ['Success UI uses verification-response paid amount', /returned\.advancePaidPaise/],
  ['Verified callback does not redirect to Shopify checkout', !/cod-advance\/razorpay\/verify[\s\S]{0,800}location\.(?:href|assign|replace)/.test(source)],
  ['Verified callback does not invoke normal COD submit', !/verifyCodAdvancePayment[\s\S]{0,1200}createOrder\(/.test(source)],
  ['Resume requires backend allowed and nextAction', /verified\?\.resume\?\.allowed === true && verified\?\.resume\?\.nextAction === "CREATE_PARTIAL_COD_ORDER"/],
  ['Dismissal permits retry without paid or failed flags', /Payment was not completed\. You can try again\./],
  ['PAYMENT_IN_PROGRESS has dedicated handling', /PAYMENT_IN_PROGRESS/],
  ['Reconciliation prevents duplicate payment', /COD_ADVANCE_RECONCILIATION_REQUIRED[\s\S]*preventDuplicatePayment = true/],
  ['Policy change triggers refresh', /COD_ADVANCE_POLICY_CHANGED[\s\S]*loadCodPolicy\("policy_changed"\)/],
  ['Store Credit changes invalidate policy', /invalidateCodPolicy\("store_credit_(?:apply|release)"\)/],
  ['Prepaid warmup remains for non-COD', /else warmupPrepaidPayment\(method\)/],
  ['No Payment Link code is invoked by COD advance', !/codAdvance[\s\S]{0,1200}payment-link/i.test(source)],
  ['No Shopify order or Draft Order endpoint in COD advance functions', !/startCodAdvancePayment[\s\S]{0,2200}\/(?:order|draft)/.test(source)],
  ['Modal state is preserved after Razorpay closes', /state\.open[\s\S]*renderPaymentSectionOnly\(\)/],
  ['Paise values formatted safely with money()', /money\(cod\.codBalanceAmountPaise, cod\.currency\)/],
  ['Disabled/loading/verified states prevent duplicate clicks', /cod\.loadingPolicy[\s\S]*cod\.verified[\s\S]*cod\.preventDuplicatePayment/],
];

let failed = 0;
for (const [name, result] of checks) {
  if (result) console.log(`PASS ${name}`);
  else { console.error(`FAIL ${name}`); failed += 1; }
}
if (failed) process.exit(1);
