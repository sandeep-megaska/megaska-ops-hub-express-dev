import Link from "next/link";
import { prisma } from "../../../services/db/prisma";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";
import { isWithinCustomerWindow } from "../../../services/whatsapp/inbox";
import AutoRefresh from "./AutoRefresh";

export const dynamic = "force-dynamic";

function formatWhen(value: Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function WhatsAppInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const resolved = await resolveAdminShopFromSearchParams(params);
  const shop = resolved.shop;
  if (!shop?.id) {
    return (
      <div className="mk-page">
        <div className="mk-page-header"><div><h1 className="mk-page-title">WhatsApp Inbox</h1></div></div>
        <section className="mk-card"><p className="mk-section-subtitle">{formatAdminShopResolutionError(resolved)}</p></section>
      </div>
    );
  }

  const [account, conversations] = await Promise.all([
    prisma.merchantWhatsAppAccount.findUnique({ where: { shopId: shop.id }, select: { enabled: true, displayPhoneNumber: true } }).catch(() => null),
    prisma.whatsAppConversation.findMany({ where: { shopId: shop.id }, orderBy: { lastMessageAt: "desc" }, take: 200 }).catch(() => []),
  ]);
  const shopParam = `shop=${encodeURIComponent(shop.shopDomain)}`;
  const unread = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);

  return (
    <div className="mk-page">
      <AutoRefresh />
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">WhatsApp Inbox</h1>
          <p className="mk-page-subtitle">
            Customer chats on {account?.displayPhoneNumber || "your WhatsApp number"}. Reply within 24 hours of the customer&apos;s last message. Updates every 15 seconds.
          </p>
        </div>
        <div className="mk-header-actions">
          <Link className="mk-btn" href={`/admin/merchant-settings?${shopParam}#whatsapp`}>WhatsApp settings</Link>
        </div>
      </div>

      {!account?.enabled ? (
        <section className="mk-card" style={{ marginBottom: 16 }}>
          <p className="mk-section-subtitle" style={{ margin: 0 }}>
            Connect your WhatsApp Business number in Merchant Settings → WhatsApp to receive and answer chats here.
          </p>
        </section>
      ) : null}

      <section className="mk-card">
        <h2 className="mk-section-title">Conversations {unread ? <span className="mk-badge mk-badge-warning">{unread} unread</span> : null}</h2>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Last message</th>
                <th>When</th>
                <th>Reply window</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {conversations.length === 0 ? (
                <tr><td colSpan={5}>No WhatsApp conversations yet.</td></tr>
              ) : (
                conversations.map((conversation) => {
                  const open = isWithinCustomerWindow(conversation.lastInboundAt);
                  return (
                    <tr key={conversation.id} style={conversation.unreadCount ? { fontWeight: 600 } : undefined}>
                      <td>
                        {conversation.contactName || `+${conversation.contactPhone}`}
                        {conversation.contactName ? <div className="mk-help">+{conversation.contactPhone}</div> : null}
                      </td>
                      <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conversation.lastMessagePreview || "—"}</td>
                      <td>{formatWhen(conversation.lastMessageAt)}</td>
                      <td><span className={`mk-badge mk-badge-${open ? "success" : "neutral"}`}>{open ? "Open" : "Closed"}</span></td>
                      <td>
                        <Link className="mk-btn mk-btn-sm" href={`/admin/whatsapp/${conversation.id}?${shopParam}`}>
                          {conversation.unreadCount ? `Open (${conversation.unreadCount})` : "Open"}
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
