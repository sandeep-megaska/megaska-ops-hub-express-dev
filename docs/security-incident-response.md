# Security incident response policy

**Owner:** BIGONBUY Technologies Private Limited (operator of LoopD2C)
**Applies to:** the LoopD2C Shopify app, its database, hosting, integrations and
the people who can access them.
**Review:** at least once a year, and after every incident.

## 1. What counts as an incident

Any event that does or could compromise the confidentiality, integrity or
availability of merchant or customer data, or of the systems that process it.
For example:

- Someone gets unauthorised access to Supabase, Vercel, GitHub, the Shopify
  Partner organization, Meta (WhatsApp), Razorpay, Delhivery, Resend or MSG91.
- A secret, access token or encryption key leaks (committed to git, pasted into
  chat or a ticket, shown in logs).
- Personal data is exposed through an app bug: one store or customer sees
  another's data, or an endpoint returns data without authentication.
- Data is lost or corrupted, including a failed or missing backup.
- A staff laptop or phone with access is lost or stolen.
- A sub-processor reports a breach that affects our data.

When in doubt, treat it as an incident. A false alarm costs little.

## 2. Roles

| Role | Who | Responsibility |
|---|---|---|
| Incident lead | A director of BIGONBUY Technologies | Decides severity, coordinates the response, handles notifications |
| Technical responder | Whoever has production access and is available | Contains, investigates and fixes |

Anyone who notices a possible incident reports it to the incident lead at once,
by phone, and then in writing to support@loopd2c.com. Don't wait to be sure.

## 3. Severity

| Level | Meaning | Response |
|---|---|---|
| **High** | Personal data exposed or likely exposed; a production secret leaked; an attacker in a production account | Start immediately, at any hour |
| **Medium** | Vulnerability that could expose data but there's no sign it was used; a non-production secret leaked | Within one working day |
| **Low** | Policy or hygiene problem with no data at risk | Fix in normal work |

## 4. Response steps

### 4.1 Contain (first hour for High)

- **Account compromise:**
  - Sign out the user's sessions, reset their password and second factor, and
    remove the account if it shouldn't exist.
  - Review the account's recent activity in the provider's audit log.
- **Leaked secret:** rotate it at the provider first, then update Vercel (all
  affected projects) and redeploy. Examples:
  - `SHOPIFY_API_SECRET`: rotate in the Dev Dashboard. Set the old value as
    `SHOPIFY_API_SECRET_PREVIOUS` only while values encrypted with it still
    need reading.
  - `SUPABASE_SERVICE_ROLE_KEY` and the database password (`DATABASE_URL`,
    `DIRECT_URL`).
  - `WHATSAPP_META_ACCESS_TOKEN`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
    `DELHIVERY_API_TOKEN`, `RESEND_API_KEY`, `MSG91_AUTH_KEY`, `TWILIO_AUTH_TOKEN`.
  - `LOOPDESK_SESSION_SECRET`, `CRON_SECRET`, `ADMIN_OPS_KEY` and the
    `INTERNAL_*` / `*_DIAGNOSTIC_SECRET` values. Rotating the session secret
    signs everyone out, which is intended.
  - A leaked encryption key (`SHOPIFY_TOKEN_ENCRYPTION_KEY`,
    `TOKEN_ENCRYPTION_KEY`, `REFUND_PAYOUT_ENCRYPTION_KEY`) also means
    re-encrypting the stored values. Ask affected merchants to reinstall, so
    their Shopify tokens are reissued.
- **App bug exposing data:** disable the route or feature at once (revert the
  deploy in Vercel or turn the feature off), even if that interrupts service.
- **Leaked in git:** rotate first, then remove the value from the repository.
  Treat the secret as public even after removal.

### 4.2 Investigate

- Work out what happened, when it started, which systems, stores and data
  categories were affected, and roughly how many customers.
- Sources:
  - Vercel request logs
  - Supabase logs and audit trail
  - GitHub audit log
  - Shopify Partner and Dev Dashboard activity
  - the app's AuditEvent records
- Export the relevant logs and keep them with the incident record, since
  hosted logs expire.
- Note who did what and when as you go.

### 4.3 Fix and recover

- Fix the root cause, test it, and deploy.
- Restore lost or corrupted data from Supabase backups. Check what was restored
  before reopening the feature.

### 4.4 Notify

Where personal data is or may be affected:

| Who | When | How |
|---|---|---|
| **CERT-In** (Indian Computer Emergency Response Team) | Within **6 hours** of noticing a reportable cyber incident (including data breaches and unauthorised access) | incident@cert-in.org.in, using CERT-In's incident reporting form |
| **Data Protection Board of India** and affected people, under the Digital Personal Data Protection Act, 2023 and its Rules | Without delay; a detailed report within the period the Rules set (currently 72 hours) | As the Board prescribes |
| **Affected merchants** | Without undue delay, and no later than 72 hours | Email to the store's contact address, saying what happened, what data, what we've done and what they should do |
| **Shopify** | Without undue delay where Shopify merchant or customer data is involved, as the Shopify Partner Program Agreement and API Terms require | Shopify Partner support |

Merchants are the controllers of their customers' data. We give them the facts
they need to meet their own obligations, and we help them notify customers if
asked.

### 4.5 Review

Within two weeks of closing a High or Medium incident:
- Write a short record: timeline, cause, data affected, notifications sent,
  and fixes made.
- Note what will stop it happening again.
- Keep records for at least 5 years.

## 5. Prevention we maintain

- Two-factor authentication on every account with production access: Shopify
  Partners, GitHub, Vercel, Supabase, Meta, Razorpay.
- Production access only for people who need it. Access lists are reviewed
  every quarter and when someone leaves.
- Secrets live only in Vercel environment variables and GitHub Actions secrets:
  never in code, chat or tickets.
- Shopify tokens and gift-card codes are encrypted with AES-256-GCM at the
  application level. The database and its backups are encrypted at rest, and
  all traffic uses TLS.
- Webhooks are verified with HMAC. Destructive webhooks are accepted only from
  this app.
- Customer and shop deletion requests (`customers/redact`, `shop/redact`) are
  processed automatically.
- Logs are kept long enough to investigate. CERT-In expects ICT logs to be kept
  for 180 days; export or extend retention where the provider's default is
  shorter.
