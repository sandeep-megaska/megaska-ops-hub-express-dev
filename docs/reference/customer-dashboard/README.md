# Legacy Megaska Customer Dashboard Reference

This folder contains documentation-only snapshots of the legacy Megaska customer dashboard JavaScript and CSS:

- `legacy-megaska-dashboard.js`
- `legacy-megaska-dashboard.css`

Future dashboard implementation tasks should use these files as the authoritative functional and visual references for the first app-owned dashboard implementation. They document the existing dashboard behavior for session lookup, summary loading, customer profile, Store Credit, recent orders, tracking, cancellation status, exchange progress, issue status, order details, and logout.

These files are reference snapshots only. Do not import, serve, register as extension assets, or couple runtime code directly to them.

When implementing or refining the portable dashboard, preserve the working behavior while removing legacy coupling such as hardcoded origins, theme-owned assumptions, inline styles, broad/global selectors, and legacy root identifiers. Runtime code should use the app-owned mount root, same-origin App Proxy paths, isolated CSS, escaped output, and safe runtime configuration.
