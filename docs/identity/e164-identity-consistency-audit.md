# Canonical E.164 identity consistency audit

## Locked rule

`shopId + phoneE164` is the LoopDesk customer identity. Different E.164 numbers are different LoopDesk customers. The system must never merge or match identities by a national number, suffix, stripped country code, name, address, or implicit email fallback.

The canonical boundary accepts storage-form E.164 (`+` followed by 8–15 digits, with a non-zero calling-code start). This is a format assertion, not a claim that a number is globally assigned. Local Shopify input is normalized before identity resolution and only when an ISO country context is present.

## Findings and disposition

| Location | Current behavior | Risk | Action |
| --- | --- | --- | --- |
| `services/auth/otp.ts` and OTP verify | Country policy produces canonical E.164 before profile resolution | Safe | Keep; resolver now validates canonical storage format |
| Customer resolver/repository | Tenant-scoped exact verified-phone query; previously defaulted ambiguous input to India | Critical | Removed country guessing at the domain boundary; preserve exact E.164 |
| Identity reconciliation | Exact phone grouping; previously only conflicting *verified* phones blocked a merge | Critical | Any two different stored E.164 values now block reconciliation |
| Order-create webhook | India normalizer and an unscoped profile lookup | High | Deterministic country-aware candidates, exact tenant lookup, and unresolved local numbers fail closed |
| Shopify Admin lookup | India normalization on every input and email fallback after phone | High | Preserve canonical international input; legacy variants only for `+91`; email is not fallback when phone identity is supplied |
| Dashboard lookup | Re-normalized every phone as India and combined phone/email searches | High | Linked Shopify customer ID remains primary; otherwise exact canonical phone, with `+91`-only compatibility variants |
| `services/phone.ts` | Legacy India normalization plus India-only identity comparison | High | Preserve `normalizeIndianPhone`; comparison now accepts exact canonical values only |
| Checkout phone Function | Address-country validation, independent of identity and OTP session state | Safe | Delivery country wins over billing country; missing country defers validation; explicit international numbers must match the address country |
| OTP modal extension | Input/display behavior, not server identity resolution | Safe | Keep unchanged |
| Storefront formatting and masking | Digit cleanup/slicing for presentation | Not identity-related | No change |

## Checkout phone validation boundary

The checkout Function now derives country context from the first delivery address, then the billing address. It never reads OTP policy or session state and does not infer India when address context is absent. A phone entered before Shopify supplies a country is therefore deferred, while a missing phone after the country is known remains an error.

Indian validation retains the established mobile-leading-digit rule and accepts national, `0`, `91`, `091`, and `0091` prefixes. The prior verified-phone cart-attribute comparison and temporary unconditional test block are removed: checkout validation now concerns address-relative delivery contact quality, not authentication. Other countries use the Function-local lightweight phone metadata parser, accept valid national or E.164 formatting, and reject an explicit international number that resolves to a different country.

## Schema audit

`CustomerProfile.phoneE164` is a nullable Prisma `String`, scoped by nullable `shopId`, and supported by the exact lookup index `@@index([shopId, phoneE164])`. Shopify customer uniqueness is tenant scoped. There is no numeric phone column or India-length constraint. Phone uniqueness is not currently declared, so this phase does not add a potentially destructive constraint before the read-only data audit is run.

## Existing-data audit

Run `node --experimental-strip-types scripts/audit-customer-phone-identities.mts` with a read-only database credential. It reports canonical/non-canonical counts, exact duplicates, formatting-equivalent groups, and cross-country suffix collisions per shop. Phone samples are SHA-256 fingerprints truncated for correlation; full numbers are never printed. The script performs no writes, normalization, or merges.

## Deferred work and UAT

Checkout validation globalization, provider routing, billing, and deliberate multi-number account linking are outside this phase. Manual UAT requires two authentications in one shop (`+919539180257` and `+9656046445`) to produce separate profiles/sessions and separate owned data. Kuwait formatting variants must first normalize with `KW` context and then resolve to the same profile; a local number without country context must remain unresolved.
