import SessionBounce from "./SessionBounce";

export const dynamic = "force-dynamic";

// Admin pages and server actions land here when their Shopify session can't be
// verified (a reload without a fresh id_token, or a direct visit). It holds no shop
// data; it only gets a new session token from App Bridge and goes back.
export default function SessionBouncePage() {
  return <SessionBounce />;
}
