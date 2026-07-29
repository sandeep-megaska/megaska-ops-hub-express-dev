'use client'

// Shared session-token attachment for embedded-admin client components.
// Every secured /api/admin/** route verifies a Shopify App Bridge session token
// and derives the shop from it (never from ?shop=). Client components must
// attach the token to their fetches via `await adminAuthHeaders()`.
//
// App Bridge v4 exposes `shopify.idToken()`. Returns {} outside the embedded
// context, in which case the route answers 401 (and the UI surfaces the error).
export async function adminAuthHeaders(): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {}
  try {
    const bridge = (window as unknown as { shopify?: { idToken?: () => Promise<string> } }).shopify
    if (bridge && typeof bridge.idToken === 'function') {
      const token = await bridge.idToken()
      if (token) return { Authorization: `Bearer ${token}` }
    }
  } catch {
    // Fall through: the request goes out tokenless and the route answers 401.
  }
  return {}
}
