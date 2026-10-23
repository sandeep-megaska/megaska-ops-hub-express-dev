# megaska-otp theme extension sources

Readable JS/CSS for the storefront theme app extension. Shopify serves theme extension
assets exactly as deployed, so these are minified into `extensions/megaska-otp/assets/`,
which is what `shopify app deploy` uploads.

1. Edit the file here (never the copy in `extensions/megaska-otp/assets/`).
2. Run `npm run build:extension`.
3. Commit both the source and the rebuilt asset.

`npm run check:extension` (also run by `extensions/tests/theme-extension-build.test.mjs`)
fails if an asset is missing, stale, or has no source here. Tests read these sources.
