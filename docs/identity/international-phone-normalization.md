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
database. No OTP request or verification route consumes this service yet, and international OTP
delivery is **not active**.
