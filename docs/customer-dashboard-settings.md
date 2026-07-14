# Customer dashboard settings (DASH-3C)

DASH-3C stores merchant-controlled customer dashboard configuration in the existing `ShopModuleConfig.config` JSON column with `moduleKey = customer_dashboard_settings`; no Prisma migration or settings table is required. The public model is normalized by `services/customer-dashboard/settings.ts` and `settings-shared.ts` before any admin or storefront use.

Defaults are SaaS-neutral: enabled dashboard, “My Account” labels, same-origin account/logout/shopping paths, `/pages/contact`, all presentation sections visible, 10 initial orders, safe customer copy, and version `1`.

Admin API: `GET` and `PUT /api/admin/customer-dashboard/settings` resolve the embedded admin shop server-side and never accept tenant identity from the request body. Invalid input returns `400` with validation messages; internal failures return generic errors. Writes increment version and emit audit events for viewed, updated, enabled/disabled, and branding updates.

Validation trims text, rejects control characters/HTML/script-like text, enforces length caps, accepts same-origin paths, accepts HTTPS support/logo URLs, rejects `javascript:`, `data:`, protocol-relative and malformed URLs, accepts only `#RGB`/`#RRGGBB` colors, caps radius to `0–40`, and caps initial order limit to `1–50`.

The embedded admin page at `/admin/customer-dashboard` provides explicit Save, loading/saving states, inline errors, saved confirmation, unsaved indicator, reset to defaults, disabled controls where relevant, and a local sample-data preview. The preview never calls customer dashboard APIs or exposes customer data.

Runtime precedence is: Theme App Extension presentation override → saved settings → safe defaults. Theme overrides can hide sections and adjust presentation labels but cannot enable a server-disabled/hidden module. Section visibility affects presentation only; order, wallet, tracking, and request eligibility logic are unchanged. When the dashboard is disabled, the app-owned shell renders an unavailable state without loading customer data.

Deployment: server/admin changes require a Vercel deployment. Because extension blocks/assets changed, publish the Theme App Extension with `shopify app deploy`; Vercel alone will not publish extension assets.
