// Theme editor deep links for onboarding (Shopify App Store 5.1.3). The app embed
// link opens App embeds with LoopD2C's embed switched on, ready to save; without
// the client ID it still opens the App embeds panel.
const APP_EMBED_HANDLE = "megaska-otp-embed";

export function appEmbedDeepLink(shopDomain: string, clientId = String(process.env.SHOPIFY_API_KEY || "").trim()) {
  const base = `https://${shopDomain}/admin/themes/current/editor?context=apps`;
  return clientId ? `${base}&activateAppId=${encodeURIComponent(clientId)}/${APP_EMBED_HANDLE}` : base;
}
