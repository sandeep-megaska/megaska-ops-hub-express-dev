# Theme extension release quality

## Intentional app-proxy asset

Shopify theme check reports `RemoteAsset` for
`/apps/megaska/megaska-exchange-hook.js`. This warning is accepted rather than
silenced by moving the script into the theme extension.

Although the common exchange-hook implementation is stored in `public/`, the
app-proxy response is runtime and shop specific. Before returning JavaScript,
the route resolves the signed app-proxy request to a shop, verifies that the
shop has the `exchange_hook` module enabled, and prepends that shop's domain and
app-proxy API base. Packaging the common file directly would bypass those
tenant and module checks and would omit the shop-specific bootstrap.

Keep the app-proxy URL and `defer` attribute in both OTP blocks unless a future
implementation provides equivalent tenant resolution and module authorization
without the remote response.
