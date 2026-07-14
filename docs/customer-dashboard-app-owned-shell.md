# DASH-3A App-owned customer dashboard shell

## Route and delivery

The app-owned customer dashboard is served at `/apps/megaska/account` through the existing Shopify App Proxy route-handler architecture. The route resolves the storefront shop, verifies that the dashboard module is enabled, returns a minimal HTML shell, and marks the customer page as `private, no-store`.

Static dashboard assets are exposed through `/apps/megaska/account/assets/:asset` and backed by the theme-extension asset files:

- `extensions/megaska-otp/assets/loopdesk-customer-dashboard.js`
- `extensions/megaska-otp/assets/loopdesk-customer-dashboard.css`
- `extensions/megaska-otp/assets/megaska-auth.js`

## OTP session authority

The shell depends on the LoopDesk/Megaska OTP storefront session. It reuses `window.MegaskaAuth.getSessionToken`, `getToken`, `getSession`/`fetchSession`, and `logout` where available, with storage fallback only for compatibility. Shopify customer-account login and customer-account cookies are not required.

When no valid session exists, the asset renders a sign-in-required state and sends the customer to the configured login URL with `return_to` preserving the current App Proxy dashboard path.

## Canonical API dependency

The dashboard client calls only the canonical `dashboard.v1` endpoint through the App Proxy:

```js
/apps/megaska/api/customer-dashboard/v1
```

Requests use `Authorization: Bearer <session token>`, `x-shopify-shop-domain`, and `cache: "no-store"`. The legacy `/api/dashboard/summary` compatibility endpoint remains untouched and is not used by this shell.

## Mount and runtime configuration contract

The shell mounts into either:

```html
<div id="loopdesk-customer-dashboard-root" data-loopdesk-customer-dashboard></div>
```

The script has a once-only guard: `window.__LOOPDESK_CUSTOMER_DASHBOARD_INITIALIZED__`.

The server emits `window.LoopDeskCustomerDashboardConfig` before assets load. Supported fields are `apiUrl`, `loginUrl`, `logoutRedirectUrl`, `shopDomain`, `accountLabel`, `supportUrl`, `continueShoppingUrl`, and `logoUrl`. No secrets or session tokens are included.

## Shell capabilities

DASH-3A is read-only. It renders profile information, summary cards, recent orders, order details, tracking, saved address, and Store Credit/wallet information when the canonical DTO enables it. Request actions render as status or “Coming in next phase” controls only; cancellation, exchange, issue, address editing, profile editing, wallet redemption, and request submission workflows are intentionally out of scope.

## Legacy coexistence

The existing Megaska theme dashboard and `megaska-dashboard.js` remain active as the production fallback. DASH-3A is separately testable at `/apps/megaska/account` for development and UAT.

## Theme App Extension readiness

The asset is portable: it does not assume ownership of `document.body`, uses the SaaS-neutral mount contract, isolates styles with `ld-account-` classes and `--ld-account-*` variables, and can later be mounted from an App Proxy page, Theme App Extension block, or merchant custom page.

## UAT URL

Use `/apps/megaska/account?shop=<shop-domain>&signature=<shopify-app-proxy-signature>` in App Proxy environments. In local allowed-shop development, use the repository’s existing App Proxy bypass settings.

## DASH-3B Theme App Extension integration

DASH-3B adds explicit Theme App Extension blocks for the app-owned shell: a LoopDesk account launcher and a portable customer dashboard mount. The launcher uses the OTP-backed `window.MegaskaAuth` state and navigates to `/apps/megaska/account` by default; the mount block reuses the DASH-3A `loopdesk-customer-dashboard.js` and CSS assets with safe JSON configuration. Deploy Theme App Extension changes with `shopify app deploy`; Vercel deployment alone does not publish theme extension assets.

## DASH-3C settings and branding UAT

Verify admin settings persist per shop, neutral defaults appear for shops without saved config, branding CSS variables render in the app-owned shell, hidden sections remain hidden, disabled dashboards do not expose customer data, launcher/mount presentation overrides do not enable server-hidden modules, support/continue-shopping/logout links are safe, “Show more” respects the configured initial order limit, and mobile layout remains usable. Deploy server changes to Vercel and Theme App Extension asset/block changes with `shopify app deploy`.
