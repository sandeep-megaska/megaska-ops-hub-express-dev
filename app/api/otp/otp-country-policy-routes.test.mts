import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const requestSource = readFileSync(new URL("./request/route.ts", import.meta.url), "utf8");
const verifySource = readFileSync(new URL("./verify/route.ts", import.meta.url), "utf8");

test("request route resolves policy before provider delivery and challenge creation", () => {
  const policy = requestSource.indexOf("await resolveOtpPhoneForShop");
  const provider = requestSource.indexOf("await resolveOtpProviderForShop", policy);
  const delivery = requestSource.indexOf("await createProviderChallenge", provider);
  assert.ok(policy > 0 && provider > policy && delivery > provider);
  assert.match(requestSource, /phone: body\?\.phone/);
  assert.match(requestSource, /countryCode: body\?\.countryCode/);
  assert.match(requestSource, /\{ error: error\.message, code: error\.code \}/);
});

test("verification uses policy normalization in the existing pending challenge lookup", () => {
  const normalization = verifySource.indexOf("await normalizeOtpPhoneForVerification");
  const lookup = verifySource.indexOf("prisma.oTPChallenge.findFirst", normalization);
  assert.ok(normalization > 0 && lookup > normalization);
  assert.match(
    verifySource.slice(lookup),
    /shopId: shop\.id,[\s\S]*phoneE164,[\s\S]*status: "pending"/,
  );
  assert.doesNotMatch(verifySource, /resolveOtpPhoneForShop/);
});

test("session, customer resolution, expiry, cookies, and provider signatures remain intact", () => {
  assert.match(requestSource, /Date\.now\(\) \+ 5 \* 60 \* 1000/);
  assert.match(verifySource, /verifyOtpWithTwilio\(phoneE164, otpRaw\)/);
  assert.match(verifySource, /verifyOtpWithMsg91\(phoneE164, otpRaw\)/);
  assert.match(verifySource, /new CanonicalCustomerResolver\(\)\.resolveFromOTP\(\{ shopId: shop\.id, phone: phoneE164 \}\)/);
  assert.match(verifySource, /const sessionToken = generateSessionToken\(\)/);
  assert.match(verifySource, /hashSessionToken\(sessionToken\)/);
  assert.match(verifySource, /CUSTOMER_SESSION_COOKIE_NAME,[\s\S]*sessionToken,[\s\S]*getCustomerSessionCookieOptions/);
});
