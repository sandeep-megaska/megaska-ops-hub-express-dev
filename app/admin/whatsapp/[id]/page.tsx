import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "../../../../services/db/prisma";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../../services/shopify/admin-shop-context";
import { InboxReplyError, isWithinCustomerWindow, markConversationRead, sendInboxReply } from "../../../../services/whatsapp/inbox";
import AutoRefresh from "../AutoRefresh";

export const dynamic = "force-dynamic";

function formatWhen(value: Date) {
  return new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const TICKS: Record<string, string> = { sent: "✓", delivered: "✓✓", read: "✓✓ read", failed: "failed" };

async function chatControlAction(conversationId: string, shopDomain: string, formData: FormData) {
  "use server";
  const resolved = await resolveAdminShopFromSearchParams({ shop: shopDomain });
  const back = `/admin/whatsapp/${conversationId}?shop=${encodeURIComponent(shopDomain)}`;
  if (!resolved.shop?.id) redirect(`${back}&error=${encodeURIComponent("Unable to resolve shop.")}`);
  const intent = String(formData.get("intent") || "");
  const data =
    intent === "resolve" ? { needsHuman: false, handoffReason: null }
      : intent === "pause_ai" ? { aiPausedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), aiDraft: null, aiDraftAt: null }
        : intent === "resume_ai" ? { aiPausedUntil: null, needsHuman: false, handoffReason: null }
          : intent === "discard_draft" ? { aiDraft: null, aiDraftAt: null }
            : null;
  if (data) await prisma.whatsAppConversation.updateMany({ where: { id: conversationId, shopId: resolved.shop.id }, data });
  revalidatePath(`/admin/whatsapp/${conversationId}`);
  redirect(back);
}

async function replyAction(conversationId: string, shopDomain: string, formData: FormData) {
  "use server";
  const resolved = await resolveAdminShopFromSearchParams({ shop: shopDomain });
  const back = `/admin/whatsapp/${conversationId}?shop=${encodeURIComponent(shopDomain)}`;
  if (!resolved.shop?.id) redirect(`${back}&error=${encodeURIComponent("Unable to resolve shop.")}`);
  try {
    await sendInboxReply({ shopId: resolved.shop.id, conversationId, text: String(formData.get("text") || "") });
  } catch (error) {
    const message = error instanceof InboxReplyError ? error.message : "Could not send the message.";
    redirect(`${back}&error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/admin/whatsapp/${conversationId}`);
  redirect(back);
}

export default async function WhatsAppConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const resolved = await resolveAdminShopFromSearchParams(query);
  const shop = resolved.shop;
  if (!shop?.id) {
    return <div className="mk-page"><section className="mk-card"><p className="mk-section-subtitle">{formatAdminShopResolutionError(resolved)}</p></section></div>;
  }
  const conversation = await prisma.whatsAppConversation.findFirst({ where: { id, shopId: shop.id } });
  const shopParam = `shop=${encodeURIComponent(shop.shopDomain)}`;
  if (!conversation) {
    return (
      <div className="mk-page">
        <section className="mk-card">
          <p className="mk-section-subtitle">Conversation not found.</p>
          <Link className="mk-btn" href={`/admin/whatsapp?${shopParam}`}>Back to inbox</Link>
        </section>
      </div>
    );
  }
  if (conversation.unreadCount > 0) await markConversationRead({ shopId: shop.id, conversationId: conversation.id }).catch(() => undefined);
  const messages = (await prisma.whatsAppMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, take: 200 })).reverse();
  const windowOpen = isWithinCustomerWindow(conversation.lastInboundAt);
  const windowClosesAt = conversation.lastInboundAt ? new Date(new Date(conversation.lastInboundAt).getTime() + 24 * 60 * 60 * 1000) : null;
  const error = typeof query.error === "string" ? query.error : null;
  const action = replyAction.bind(null, conversation.id, shop.shopDomain);
  const controlAction = chatControlAction.bind(null, conversation.id, shop.shopDomain);
  const assistant = await prisma.merchantWhatsAppAccount.findUnique({ where: { shopId: shop.id }, select: { enabled: true, aiMode: true } }).catch(() => null);
  const assistantOn = Boolean(assistant?.enabled && assistant.aiMode && assistant.aiMode !== "OFF");
  const aiPaused = Boolean(conversation.aiPausedUntil && new Date(conversation.aiPausedUntil).getTime() > Date.now());
  const title = conversation.contactName || `+${conversation.contactPhone}`;

  return (
    <div className="mk-page">
      <AutoRefresh />
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">{title}</h1>
          <p className="mk-page-subtitle">
            +{conversation.contactPhone} · <a href={`https://wa.me/${conversation.contactPhone}`} target="_blank" rel="noopener noreferrer">wa.me link</a>
          </p>
        </div>
        <div className="mk-header-actions">
          <Link className="mk-btn" href={`/admin/whatsapp?${shopParam}`}>Back to inbox</Link>
        </div>
      </div>

      {conversation.needsHuman || assistantOn ? (
        <form action={controlAction} className="mk-card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          {conversation.needsHuman ? (
            <>
              <span className="mk-badge mk-badge-warning">Needs your team</span>
              <span className="mk-help">{conversation.handoffReason || "The AI assistant handed this chat over."}</span>
              <button className="mk-btn mk-btn-sm" type="submit" name="intent" value="resolve">Mark resolved</button>
            </>
          ) : null}
          {assistantOn ? (
            aiPaused ? (
              <>
                <span className="mk-help">AI assistant paused in this chat until {formatWhen(conversation.aiPausedUntil as Date)}.</span>
                <button className="mk-btn mk-btn-sm" type="submit" name="intent" value="resume_ai">Resume AI</button>
              </>
            ) : (
              <>
                <span className="mk-help">AI assistant: {assistant?.aiMode === "AUTO" ? "answering" : "suggesting replies"} in this chat.</span>
                <button className="mk-btn mk-btn-sm" type="submit" name="intent" value="pause_ai">Pause AI for this chat</button>
              </>
            )
          ) : null}
        </form>
      ) : null}

      <section className="mk-card" style={{ display: "grid", gap: 10 }}>
        {messages.length === 0 ? <p className="mk-section-subtitle">No messages yet.</p> : null}
        {messages.map((message) => {
          const inbound = message.direction === "INBOUND";
          return (
            <div key={message.id} style={{ display: "flex", justifyContent: inbound ? "flex-start" : "flex-end" }}>
              <div style={{ maxWidth: "75%", padding: "8px 12px", borderRadius: 12, background: inbound ? "var(--surface-2, #f3f4f6)" : "#dcf8c6", color: "#111", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {message.mediaId && (message.type === "image" || message.type === "sticker") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/admin/whatsapp/media/${encodeURIComponent(message.mediaId)}?${shopParam}`} alt="" style={{ maxWidth: 280, borderRadius: 8, display: "block", marginBottom: 6 }} />
                ) : null}
                {message.mediaId && message.type === "audio" ? (
                  <audio controls src={`/admin/whatsapp/media/${encodeURIComponent(message.mediaId)}?${shopParam}`} style={{ display: "block", marginBottom: 6 }} />
                ) : null}
                {message.mediaId && (message.type === "video" || message.type === "document") ? (
                  <a href={`/admin/whatsapp/media/${encodeURIComponent(message.mediaId)}?${shopParam}`} target="_blank" rel="noopener noreferrer">Open {message.type}</a>
                ) : null}
                <div>{message.body}</div>
                <div className="mk-help" style={{ textAlign: "right", marginTop: 4 }}>
                  {formatWhen(message.createdAt)}
                  {!inbound && message.status ? ` · ${TICKS[message.status] || message.status}` : ""}
                  {message.templateName ? " · automated" : ""}
                  {message.sentByAi ? " · 🤖 AI assistant" : message.sentByEmail ? ` · ${message.sentByEmail}` : ""}
                </div>
                {message.errorMessage ? <div className="mk-help" style={{ color: "#b91c1c" }}>{message.errorMessage}</div> : null}
              </div>
            </div>
          );
        })}
      </section>

      <section className="mk-card" style={{ marginTop: 16 }}>
        {error ? <div className="mk-alert mk-alert-error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {windowOpen ? (
          <form action={action} style={{ display: "grid", gap: 10 }}>
            {conversation.aiDraft ? (
              <div className="mk-help" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="mk-badge mk-badge-info">🤖 Suggested reply</span>
                Written by the AI assistant{conversation.aiDraftAt ? ` at ${formatWhen(conversation.aiDraftAt)}` : ""}. Check and edit it, then send.
                <button className="mk-btn mk-btn-sm mk-btn-ghost" type="submit" formAction={controlAction} name="intent" value="discard_draft" formNoValidate>Discard</button>
              </div>
            ) : null}
            <textarea key={conversation.aiDraftAt ? new Date(conversation.aiDraftAt).getTime() : "empty"} className="mk-textarea" name="text" rows={conversation.aiDraft ? 5 : 3} maxLength={4096} placeholder="Type a reply…" defaultValue={conversation.aiDraft || ""} required />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="mk-help">Reply window open until {windowClosesAt ? formatWhen(windowClosesAt) : "—"}.</span>
              <button className="mk-btn mk-btn-primary" type="submit">Send on WhatsApp</button>
            </div>
          </form>
        ) : (
          <p className="mk-section-subtitle" style={{ margin: 0 }}>
            {conversation.lastInboundAt
              ? "More than 24 hours since the customer's last message, so WhatsApp only allows approved templates. When they message again, you can reply here."
              : "The customer hasn't messaged yet. You can reply once they write to you."}
          </p>
        )}
      </section>
    </div>
  );
}
