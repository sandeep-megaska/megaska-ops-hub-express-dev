import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../../services/shopify/admin-shop-context";
import {
  getWhatsAppAssistantAdmin,
  previewWhatsAppAssistant,
  saveWhatsAppAssistant,
  WhatsAppAssistantSettingsError,
} from "../../../../services/settings/whatsapp-assistant";
import { MAX_KNOWLEDGE_CHARS } from "../../../../services/whatsapp/assistant/policy";

export const dynamic = "force-dynamic";

const MODES = [
  { value: "OFF", label: "Off", help: "Nothing automatic. Chats wait for your team." },
  { value: "DRAFT", label: "Suggest replies", help: "The assistant writes a suggested reply into each chat. Your team checks, edits and sends it. Nothing reaches customers on its own. Start here." },
  { value: "AUTO", label: "Answer automatically", help: "The assistant answers product, size, order-status and policy questions from your store data. Complaints, refunds, exchanges, photos and anything it is not sure about go to your team with one short holding message, and you get an email." },
];

const KNOWLEDGE_PLACEHOLDER = `Write what your team would tell a customer. For example:
- Delivery: 3–7 working days across India. Free shipping above ₹999.
- COD available. Prepaid orders get 15% off automatically at checkout.
- Exchanges: within 7 days of delivery for size issues, unused with tags. Start from your account → Orders.
- Size help: our products run true to size; between sizes, pick the larger one. Size chart on every product page.
- Support hours: Mon–Sat 10am–7pm IST.`;

function back(shopDomain: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ shop: shopDomain, ...extra });
  return `/admin/whatsapp/assistant?${params.toString()}`;
}

async function saveAction(shopDomain: string, formData: FormData) {
  "use server";
  const resolved = await resolveAdminShopFromSearchParams({ shop: shopDomain });
  if (!resolved.shop?.id) redirect(back(shopDomain, { error: "Unable to resolve shop." }));
  try {
    const mode = await saveWhatsAppAssistant(resolved.shop.id, { mode: formData.get("mode"), knowledge: formData.get("knowledge") });
    revalidatePath("/admin/whatsapp/assistant");
    redirect(back(shopDomain, { notice: mode === "OFF" ? "Saved. The assistant is off." : mode === "DRAFT" ? "Saved. The assistant will suggest replies in the inbox." : "Saved. The assistant now answers chats on its own." }));
  } catch (error) {
    if (!(error instanceof WhatsAppAssistantSettingsError)) throw error;
    redirect(back(shopDomain, { error: error.message }));
  }
}

async function previewAction(shopDomain: string, formData: FormData) {
  "use server";
  const resolved = await resolveAdminShopFromSearchParams({ shop: shopDomain });
  if (!resolved.shop?.id) redirect(back(shopDomain, { error: "Unable to resolve shop." }));
  const question = String(formData.get("question") || "").slice(0, 500);
  const testPhone = String(formData.get("testPhone") || "").slice(0, 20);
  let target: string;
  try {
    const settings = await getWhatsAppAssistantAdmin(resolved.shop.id);
    const result = await previewWhatsAppAssistant({ shopDomain: resolved.shop.shopDomain, knowledge: settings.knowledge || null, question, testPhone });
    target = result
      ? back(shopDomain, { q: question, tp: testPhone, a: result.reply || "(no reply)", intent: result.intent, conf: result.confidence.toFixed(2), human: result.needsHuman ? "1" : "0", why: result.handoffReason || "" }) + "#try"
      : back(shopDomain, { q: question, error: "The AI did not return an answer. Try again." }) + "#try";
  } catch (error) {
    target = back(shopDomain, { q: question, error: error instanceof Error ? error.message : "Preview failed." }) + "#try";
  }
  redirect(target);
}

export default async function WhatsAppAssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const value = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");
  const resolved = await resolveAdminShopFromSearchParams(query);
  const shop = resolved.shop;
  if (!shop?.id) {
    return <div className="mk-page"><section className="mk-card"><p className="mk-section-subtitle">{formatAdminShopResolutionError(resolved)}</p></section></div>;
  }
  const settings = await getWhatsAppAssistantAdmin(shop.id);
  const shopParam = `shop=${encodeURIComponent(shop.shopDomain)}`;
  const answer = value("a");
  const handedOver = value("human") === "1";

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">WhatsApp AI assistant</h1>
          <p className="mk-page-subtitle">
            Answers customer chats on your WhatsApp number using only your store&apos;s own data: products, prices and sizes in stock, the customer&apos;s orders and tracking, and your notes below. It never invents offers, never pushes urgency and never asks for payment details.
          </p>
        </div>
        <div className="mk-header-actions">
          <Link className="mk-btn" href={`/admin/whatsapp?${shopParam}`}>Back to inbox</Link>
        </div>
      </div>

      {value("notice") ? <div className="mk-alert mk-alert-success" style={{ marginBottom: 16 }}>{value("notice")}</div> : null}
      {value("error") ? <div className="mk-alert mk-alert-error" style={{ marginBottom: 16 }}>{value("error")}</div> : null}
      {!settings.numberConnected ? (
        <div className="mk-alert mk-alert-warning" style={{ marginBottom: 16 }}>Connect your WhatsApp number first in <Link href={`/admin/merchant-settings?${shopParam}#whatsapp`}>Merchant Settings → WhatsApp</Link>.</div>
      ) : !settings.numberEnabled ? (
        <div className="mk-alert mk-alert-warning" style={{ marginBottom: 16 }}>Your WhatsApp number is switched off in Merchant Settings, so the assistant will not run.</div>
      ) : null}
      {!settings.aiConfigured ? <div className="mk-alert mk-alert-warning" style={{ marginBottom: 16 }}>AI is not configured on the server (OPENAI_API_KEY). The assistant stays off until it is.</div> : null}

      <form action={saveAction.bind(null, shop.shopDomain)} className="mk-card" style={{ display: "grid", gap: 16 }}>
        <h2 className="mk-section-title" style={{ margin: 0 }}>Mode</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {MODES.map((mode) => (
            <label key={mode.value} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <input type="radio" name="mode" value={mode.value} defaultChecked={settings.mode === mode.value} style={{ marginTop: 4 }} />
              <span><strong>{mode.label}</strong><div className="mk-help">{mode.help}</div></span>
            </label>
          ))}
        </div>

        <h2 className="mk-section-title" style={{ margin: "8px 0 0" }}>Store notes</h2>
        <p className="mk-help" style={{ margin: 0 }}>
          Facts the assistant may quote: delivery times, COD and prepaid offers, exchange and refund rules, size advice, support hours. It also reads your products and the customer&apos;s orders live from Shopify. If something is not here or in Shopify, it hands the chat to your team instead of guessing. Up to {MAX_KNOWLEDGE_CHARS.toLocaleString("en-IN")} characters.
        </p>
        <textarea className="mk-textarea" name="knowledge" rows={14} maxLength={MAX_KNOWLEDGE_CHARS} defaultValue={settings.knowledge} placeholder={KNOWLEDGE_PLACEHOLDER} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="mk-help">Model: {settings.model}. At most 6 AI replies per chat per hour and 300 per day; a team reply pauses the assistant in that chat for 12 hours.</span>
          <button className="mk-btn mk-btn-primary" type="submit">Save assistant settings</button>
        </div>
      </form>

      <form id="try" action={previewAction.bind(null, shop.shopDomain)} className="mk-card" style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <h2 className="mk-section-title" style={{ margin: 0 }}>Try it</h2>
        <p className="mk-help" style={{ margin: 0 }}>Ask what a customer would ask. Uses your saved notes and live store data; nothing is sent to anyone.</p>
        <textarea className="mk-textarea" name="question" rows={2} maxLength={500} defaultValue={value("q")} placeholder="Do you have the black swim dress in XL? / Where is my order? / Can I exchange for a bigger size?" required />
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input className="mk-input" name="testPhone" defaultValue={value("tp")} placeholder="Optional: a customer's mobile, to test order questions" style={{ maxWidth: 360 }} />
          <button className="mk-btn" type="submit">Ask the assistant</button>
        </div>
        {answer ? (
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ padding: "10px 14px", borderRadius: 12, background: "#dcf8c6", color: "#111", whiteSpace: "pre-wrap", maxWidth: 560 }}>{answer}</div>
            <div className="mk-help">
              Topic: {value("intent") || "—"} · confidence {value("conf") || "—"} ·{" "}
              {handedOver ? <span className="mk-badge mk-badge-warning">would hand over to your team{value("why") ? `: ${value("why")}` : ""}</span> : <span className="mk-badge mk-badge-success">would answer</span>}
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}
