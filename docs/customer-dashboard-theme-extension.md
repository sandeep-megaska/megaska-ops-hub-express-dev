# DASH-3B Customer Dashboard Theme App Extension

DASH-3B adds explicit Online Store 2.0 app blocks in the existing `extensions/megaska-otp` Theme App Extension. Merchants can expose the LoopDesk mobile/OTP customer account without editing theme code and without enabling Shopify customer accounts.

## Blocks

### LoopDesk account launcher

File: `extensions/megaska-otp/blocks/loopdesk-account-launcher.liquid`.

- Renders a theme-isolated account link with `ld-account-launcher-*` classes.
- Starts in a neutral loading state and resolves the LoopDesk OTP session asynchronously through `window.MegaskaAuth`.
- Shows **Login** when no LoopDesk session exists and **My Account** when the OTP session is valid.
- Logged-out clicks hand off to the existing OTP login APIs in this order: `openLogin`, `openOtpModal`, `openAuthModal`, `login`, then a safe same-origin redirect fallback.
- Logged-in clicks navigate to the configured App Proxy dashboard URL. The default is `/apps/megaska/account`.
- The launcher never uses Shopify `customer` or `/account/login` as the authority.

Recommended placement options:

1. Add the launcher app block to a compatible header section.
2. Add the launcher app block to another section such as announcement bar, navigation area, or account page shell.
3. For themes that cannot place app blocks in headers, use a future opt-in App Embed/injection strategy. DASH-3B intentionally ships the explicit app block first and does not rewrite theme headers globally.

### LoopDesk customer dashboard mount

File: `extensions/megaska-otp/blocks/loopdesk-customer-dashboard.liquid`.

- Outputs the portable mount element: `<div id="loopdesk-customer-dashboard-root" data-loopdesk-customer-dashboard>`.
- Emits safe JSON runtime configuration only; no tokens, customer identifiers, app secrets, or executable inline JavaScript are rendered.
- Loads the DASH-3A dashboard CSS and JS assets by Theme App Extension asset filters.
- Supports inline mounting for merchant-branded account pages and migration from the legacy Megaska dashboard page.
- Uses the same `loopdesk-customer-dashboard.js` implementation as the app-owned dashboard route.

## Modes

- **Navigate to dashboard (recommended):** launcher sends verified customers to `/apps/megaska/account`.
- **Inline mount:** merchant adds the dashboard block to a page. The dashboard asset reads the block JSON config and mounts inside the current page.

## Session and return-path behavior

The session source is the existing OTP auth layer, `window.MegaskaAuth`. The launcher listens for `megaska:auth-state-changed` and refreshes on storage changes. Return paths are validated client-side and must be same-origin paths, preventing open redirects. Inline page return is represented by a safe path only.

## Theme Editor preview

When `window.Shopify.designMode` is detected, the dashboard block displays a preview card:

- LoopDesk Customer Dashboard
- Login required on storefront
- Dashboard will load for verified customers

No fake customer, wallet, or order data is displayed in the theme editor.

## Security and isolation

- Liquid settings are escaped or serialized with `json`.
- Settings feed presentation/runtime configuration only and do not override server eligibility, wallet balances, request states, or payment values.
- URLs are validated before navigation.
- Class names use `ld-account-launcher-*`, `ld-account-mount-*`, and existing `ld-account-*` dashboard namespaces.
- No request-submission endpoints are introduced.

## Migration from legacy Megaska dashboard

Merchants can create or reuse an existing theme page, add the LoopDesk customer dashboard block, and test it independently. Keep the old Megaska dashboard page and `megaska-dashboard`/legacy auth behavior in place during UAT. Remove old theme scripts only after merchant approval.

## Deployment

Because Theme App Extension files and assets changed, a Vercel deployment alone is not sufficient. After merge, run:

```sh
shopify app deploy
```

If server routes or runtime configuration also change in a later phase, deploy Vercel as well.

## DASH-3B UAT checklist

- Logged out launcher shows Login.
- Login opens LoopDesk OTP.
- OTP success changes launcher to My Account.
- My Account opens `/apps/megaska/account` or the configured same-store dashboard path.
- Logout returns launcher to Login.
- Verified customer loads dashboard block.
- Unverified customer sees login-required state.
- Duplicate dashboard mount is safely no-op after the first root.
- Mobile layout remains usable.
- Support and continue-shopping links work.
- Legacy dashboard remains functional and route-compatible.
- No duplicate customer-dashboard API requests are observed for a single mount.

## Known limitations

- DASH-3B does not add the optional account-link injection App Embed. Some themes may require placing the launcher outside the header until DASH-3C or a later embed phase.
- Cancellation, exchange, and issue request submission flows remain out of scope.

## Next phase

DASH-3C — Merchant Dashboard Configuration & Branding.

## DASH-3C settings and branding UAT

Verify admin settings persist per shop, neutral defaults appear for shops without saved config, branding CSS variables render in the app-owned shell, hidden sections remain hidden, disabled dashboards do not expose customer data, launcher/mount presentation overrides do not enable server-hidden modules, support/continue-shopping/logout links are safe, “Show more” respects the configured initial order limit, and mobile layout remains usable. Deploy server changes to Vercel and Theme App Extension asset/block changes with `shopify app deploy`.
