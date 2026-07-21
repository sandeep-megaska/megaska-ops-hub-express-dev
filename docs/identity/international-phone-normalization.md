# International phone normalization foundation

`services/phone-international.ts` is a pure, tenant-agnostic boundary for converting a phone
number and a selected two-letter country code to canonical E.164 form. Phone numbers are
identifiers, so callers must supply strings; numeric input is rejected to avoid losing leading
zeroes. Inputs are trimmed and bounded before parsing.

Local-format input requires a selected country. Explicit international input beginning with `+`
is parsed independently and accepted only when the parser resolves its ISO country to the selected
country. Comparing the resolved country rather than only the calling code prevents guessing for
territories that share a calling code. Ambiguous or unresolved international numbers fail closed.

India remains a compatibility corridor: acceptance delegates to the existing
`normalizeIndianPhone()` function. The international phone library is used after that legacy
normalization only to derive safe output metadata; it does not redefine accepted Indian input.

This module validates one number against one selected country. Merchant country allow-list
enforcement remains outside the module, and it does not load merchant settings, a tenant, or a
database.

The OTP API boundary in `services/auth/otp-phone-policy.ts` now composes this normalizer with the
resolved merchant settings. OTP requests default an omitted country to `IN`, authorize that exact
country against the merchant allow-list before normalizing the phone, and never infer another
country from a `+` number. Verification uses the same strict country/phone normalization but does
not re-authorize the current allow-list, so a pending challenge remains verifiable after a merchant
policy change. The storefront submits the national-number input together with the selected `countryCode`. It preserves legacy ten-digit India input behavior, while other configured countries use generic digit sanitization and explicit OTP submission without guessed client-side length validation. After a successful request, verification and resend use the frozen phone/country snapshot; canonical E.164 normalization remains authoritative on the server.
