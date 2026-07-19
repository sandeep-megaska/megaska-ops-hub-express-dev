import { createHash, randomUUID } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma transaction clients and introspected FK rows are deliberately structural. */

export type ReconciliationClassification = "SAFE_AUTOMATIC" | "MANUAL_REVIEW" | "BLOCKED_CONFLICT" | "ALREADY_CANONICAL";
export type ReconciliationProfile = {
  id: string; shopId: string | null; shopifyCustomerId: string | null; phoneE164: string | null;
  phoneVerifiedAt: Date | null; email: string | null; createdAt: Date; updatedAt: Date;
  activeSessionCount?: number; ownershipCount?: number;
};
export type DiscoveryFilters = { shopId: string; customerProfileId?: string; phoneHash?: string; shopifyCustomerId?: string; limit?: number };
type Db = any;

const RAW_OWNERSHIP_TABLES = ["ExpressCheckoutIntent", "ExpressCheckoutAddressSnapshot"] as const;
const TRUSTED_FIELDS = ["shopifyCustomerId", "phoneE164"] as const;

function normalizeShopifyCustomerId(value: unknown): string | null {
  const match = String(value ?? "").trim().match(/^(?:gid:\/\/shopify\/Customer\/)?(\d+)$/);
  if (!match && value) throw new Error("Shopify customer ID is malformed");
  return match?.[1] ?? null;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

export function reconciliationChecksum(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function phoneHash(phone: string): string { return createHash("sha256").update(phone).digest("hex"); }
function shopify(profile: ReconciliationProfile): string | null {
  try { return normalizeShopifyCustomerId(profile.shopifyCustomerId); } catch { return null; }
}

export function trustedConflicts(profiles: ReconciliationProfile[]) {
  const conflicts: string[] = [];
  const shopifyIds = new Set(profiles.map(shopify).filter(Boolean));
  const phones = new Set(profiles.filter((p) => p.phoneVerifiedAt && p.phoneE164).map((p) => p.phoneE164));
  if (shopifyIds.size > 1) conflicts.push("CONFLICTING_SHOPIFY_CUSTOMER_IDS");
  if (phones.size > 1) conflicts.push("CONFLICTING_VERIFIED_PHONES");
  return conflicts;
}

export function selectCanonicalProfile(profiles: ReconciliationProfile[]) {
  if (!profiles.length) throw new Error("A duplicate group is required");
  const ranked = [...profiles].sort((a, b) => {
    const score = (p: ReconciliationProfile) => [Number((p.activeSessionCount ?? 0) > 0), Number(Boolean(shopify(p))), Number(Boolean(p.phoneVerifiedAt && p.phoneE164)), p.ownershipCount ?? 0];
    const aa = score(a), bb = score(b);
    for (let i = 0; i < aa.length; i += 1) if (aa[i] !== bb[i]) return bb[i] - aa[i];
    return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  });
  const canonical = ranked[0];
  const reason = (canonical.activeSessionCount ?? 0) > 0 ? "CURRENT_AUTH_SESSION" : shopify(canonical) ? "TRUSTED_SHOPIFY_CUSTOMER_ID" : canonical.phoneVerifiedAt ? "VERIFIED_PHONE" : (canonical.ownershipCount ?? 0) > 0 ? "WIDEST_VALID_OWNERSHIP" : "OLDEST_STABLE_PROFILE";
  return { canonical, reason };
}

export function fillOnlyEnrichment(canonical: ReconciliationProfile, duplicates: ReconciliationProfile[]) {
  const enrichment: Record<string, string> = {};
  for (const field of TRUSTED_FIELDS) {
    if (canonical[field]) continue;
    const values = [...new Set(duplicates.map((p) => p[field]).filter(Boolean))] as string[];
    if (values.length === 1 && (field !== "phoneE164" || duplicates.some((p) => p.phoneE164 === values[0] && p.phoneVerifiedAt))) enrichment[field] = field === "shopifyCustomerId" ? normalizeShopifyCustomerId(values[0])! : values[0];
  }
  return enrichment;
}

export function groupCandidates(profiles: ReconciliationProfile[]) {
  const parent = new Map(profiles.map((p) => [p.id, p.id]));
  const find = (id: string): string => parent.get(id) === id ? id : find(parent.get(id)!);
  const union = (a: string, b: string) => { const aa = find(a), bb = find(b); if (aa !== bb) parent.set(bb, aa); };
  const keys = new Map<string, string>();
  for (const profile of [...profiles].sort((a, b) => a.id.localeCompare(b.id))) {
    const identifiers = [shopify(profile) && `shopify:${shopify(profile)}`, profile.phoneVerifiedAt && profile.phoneE164 && `phone:${profile.phoneE164}`].filter(Boolean) as string[];
    for (const key of identifiers) { const existing = keys.get(key); if (existing) union(existing, profile.id); else keys.set(key, profile.id); }
  }
  const groups = new Map<string, ReconciliationProfile[]>();
  for (const p of profiles) { const root = find(p.id); groups.set(root, [...(groups.get(root) ?? []), p]); }
  return [...groups.values()].filter((group) => group.length > 1).map((group) => group.sort((a, b) => a.id.localeCompare(b.id)));
}

async function dependencies(db: Db, ids: string[]) {
  const foreignKeys = await db.$queryRawUnsafe(`SELECT DISTINCT tc.table_name AS "tableName", kcu.column_name AS "columnName" FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.constraint_schema=kcu.constraint_schema JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.constraint_schema=ccu.constraint_schema WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='CustomerProfile' AND ccu.column_name='id' ORDER BY tc.table_name,kcu.column_name`);
  const refs = [...foreignKeys, ...RAW_OWNERSHIP_TABLES.map((tableName) => ({ tableName, columnName: "customerProfileId" }))]
    .filter((ref, index, all) => all.findIndex((x) => x.tableName === ref.tableName && x.columnName === ref.columnName) === index);
  const rows = [];
  for (const ref of refs) {
    const found = await db.$queryRawUnsafe(`SELECT "id", "${ref.columnName}" AS "customerProfileId" FROM "${ref.tableName}" WHERE "${ref.columnName}" = ANY($1::text[]) ORDER BY "id"`, ids);
    rows.push({ ...ref, ids: found.map((r: any) => r.id), count: found.length });
  }
  return rows;
}

async function sourceState(db: Db, shopId: string, profileIds: string[]) {
  const profiles = await db.customerProfile.findMany({ where: { shopId, id: { in: profileIds } }, orderBy: { id: "asc" } });
  const movements = await dependencies(db, profileIds);
  const wallets = await db.walletAccount.findMany({ where: { shopId, customerProfileId: { in: profileIds } }, orderBy: [{ currency: "asc" }, { id: "asc" }], include: { transactions: { orderBy: { id: "asc" } }, reservations: { orderBy: { id: "asc" } } } });
  return { profiles, movements, wallets };
}

export async function discoverDuplicateCustomerProfiles(db: Db, filters: DiscoveryFilters) {
  if (!filters.shopId?.trim()) throw new Error("shopId is required; cross-tenant discovery is prohibited");
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 1000);
  const rows: ReconciliationProfile[] = await db.customerProfile.findMany({ where: { shopId: filters.shopId, ...(filters.customerProfileId ? { id: filters.customerProfileId } : {}), ...(filters.shopifyCustomerId ? { shopifyCustomerId: { in: [String(filters.shopifyCustomerId), `gid://shopify/Customer/${normalizeShopifyCustomerId(filters.shopifyCustomerId)}`] } } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit });
  const filtered = filters.phoneHash ? rows.filter((p) => p.phoneE164 && phoneHash(p.phoneE164) === filters.phoneHash) : rows;
  const enriched = await Promise.all(filtered.map(async (p) => ({ ...p, activeSessionCount: await db.authSession.count({ where: { customerProfileId: p.id, revokedAt: null, expiresAt: { gt: new Date() } } }), ownershipCount: (await dependencies(db, [p.id])).reduce((sum: number, x: any) => sum + x.count, 0) })));
  return groupCandidates(enriched).map((profiles) => ({ profiles, conflicts: trustedConflicts(profiles) }));
}

export async function createReconciliationPlan(db: Db, input: { shopId: string; profileIds: string[]; createdBy: string }) {
  if (!input.shopId || input.profileIds.length < 2) throw new Error("shopId and at least two profile IDs are required");
  const state = await sourceState(db, input.shopId, [...new Set(input.profileIds)].sort());
  if (state.profiles.length !== new Set(input.profileIds).size) throw new Error("Every profile must exist in the specified shop");
  const conflicts = trustedConflicts(state.profiles);
  const rankedProfiles = await Promise.all(state.profiles.map(async (p: any) => ({
    ...p,
    activeSessionCount: await db.authSession.count({ where: { customerProfileId: p.id, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ownershipCount: (await dependencies(db, [p.id])).reduce((n: number, movement: any) => n + movement.count, 0),
  })));
  const { canonical, reason } = selectCanonicalProfile(rankedProfiles);
  const duplicates = state.profiles.filter((p: any) => p.id !== canonical.id);
  const currencyOwners = new Map<string, Set<string>>();
  for (const wallet of state.wallets) currencyOwners.set(wallet.currency, new Set([...(currencyOwners.get(wallet.currency) ?? []), wallet.customerProfileId]));
  const walletCollision = [...currencyOwners.values()].some((owners) => owners.size > 1);
  const evidence = [...new Set([shopify(canonical) && "NORMALIZED_SHOPIFY_CUSTOMER_ID", canonical.phoneVerifiedAt && "VERIFIED_E164_PHONE"].filter(Boolean))];
  const classification: ReconciliationClassification = conflicts.length ? "BLOCKED_CONFLICT" : walletCollision ? "MANUAL_REVIEW" : evidence.length ? "SAFE_AUTOMATIC" : "MANUAL_REVIEW";
  const sourceStateChecksum = reconciliationChecksum(state);
  const plan = { version: 1, shopId: input.shopId, canonicalCustomerProfileId: canonical.id, canonicalSelectionReason: reason, duplicateCustomerProfileIds: duplicates.map((p: any) => p.id).sort(), matchingEvidence: evidence, classification, conflicts: [...conflicts, ...(walletCollision ? ["MULTIPLE_WALLETS_SAME_CURRENCY_REQUIRES_FINANCIAL_REVIEW"] : [])], proposedFieldEnrichment: fillOnlyEnrichment(canonical, duplicates), dependentRecordMovements: state.movements.filter((x: any) => x.count).map(({ tableName, columnName, count, ids }: any) => ({ tableName, columnName, count, recordIds: ids })), walletStrategy: walletCollision ? "BLOCKED_MANUAL_LEDGER_MERGE" : "REPOINT_SINGLE_ACCOUNT_AND_PRESERVE_LEDGER", sessionStrategy: "REPOINT_NON_CONFLICTING_SESSIONS_PRESERVE_EXPIRY", orderStrategy: "OWNERSHIP_REFERENCE_ONLY", reviewStrategy: "OWNERSHIP_REFERENCE_ONLY", sourceStateChecksum };
  const checksum = reconciliationChecksum(plan);
  return db.customerIdentityReconciliationPlan.create({ data: { id: randomUUID(), shopId: input.shopId, canonicalCustomerProfileId: canonical.id, sourceCustomerProfileIds: plan.duplicateCustomerProfileIds, classification, createdBy: input.createdBy, checksum, sourceStateChecksum, plan } });
}

export async function approveReconciliationPlan(db: Db, input: { shopId: string; planId: string; checksum: string; actor: string }) {
  const plan = await db.customerIdentityReconciliationPlan.findFirst({ where: { id: input.planId, shopId: input.shopId } });
  if (!plan || plan.checksum !== input.checksum) throw new Error("Plan/checksum not found in this shop");
  if (plan.status !== "DRAFT") throw new Error(`Plan cannot be approved from ${plan.status}`);
  if (plan.classification !== "SAFE_AUTOMATIC") throw new Error(`${plan.classification} plans require a separately implemented manual resolution; approval is blocked`);
  return db.customerIdentityReconciliationPlan.update({ where: { id: plan.id }, data: { status: "APPROVED", approvedBy: input.actor, approvedAt: new Date() } });
}

export async function applyReconciliationPlan(db: Db, input: { shopId: string; planId: string; checksum: string; actor: string }) {
  return db.$transaction(async (tx: Db) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `identity-reconcile:${input.shopId}`);
    const found = await tx.$queryRawUnsafe(`SELECT * FROM "CustomerIdentityReconciliationPlan" WHERE "id"=$1 AND "shopId"=$2 FOR UPDATE`, input.planId, input.shopId);
    const plan = found[0];
    if (!plan || plan.checksum !== input.checksum) throw new Error("Plan/checksum not found in this shop");
    if (plan.status === "APPLIED") return { status: "ALREADY_APPLIED", planId: plan.id };
    if (plan.status !== "APPROVED" || plan.classification !== "SAFE_AUTOMATIC") throw new Error("Only explicitly approved SAFE_AUTOMATIC plans may be applied");
    const ids = [plan.canonicalCustomerProfileId, ...plan.sourceCustomerProfileIds];
    await tx.$queryRawUnsafe(`SELECT "id" FROM "CustomerProfile" WHERE "shopId"=$1 AND "id"=ANY($2::text[]) ORDER BY "id" FOR UPDATE`, input.shopId, ids);
    const state = await sourceState(tx, input.shopId, ids);
    if (reconciliationChecksum(state) !== plan.sourceStateChecksum) return { status: "PLAN_STALE", planId: plan.id };
    const payload = plan.plan as any;
    await tx.customerIdentityReconciliationPlan.update({ where: { id: plan.id }, data: { status: "APPLYING" } });
    const enrichment = payload.proposedFieldEnrichment ?? {};
    await tx.customerProfile.update({ where: { id: plan.canonicalCustomerProfileId }, data: enrichment });
    for (const movement of payload.dependentRecordMovements) {
      if (["CustomerIdentityReconciliationAudit", "CustomerIdentityReconciliationPlan"].includes(movement.tableName)) continue;
      const sql = `UPDATE "${movement.tableName}" SET "${movement.columnName}"=$1 WHERE "${movement.columnName}"=ANY($2::text[])${movement.tableName.includes("ExpressCheckout") ? ' AND "shopId"=$3' : ""}`;
      if (movement.tableName.includes("ExpressCheckout")) await tx.$executeRawUnsafe(sql, plan.canonicalCustomerProfileId, plan.sourceCustomerProfileIds, input.shopId);
      else await tx.$executeRawUnsafe(sql, plan.canonicalCustomerProfileId, plan.sourceCustomerProfileIds);
    }
    await tx.customerIdentityMerge.createMany({ data: plan.sourceCustomerProfileIds.map((sourceCustomerProfileId: string) => ({ id: randomUUID(), shopId: input.shopId, sourceCustomerProfileId, targetCustomerProfileId: plan.canonicalCustomerProfileId, planId: plan.id, mergedAt: new Date() })) });
    const remaining = await dependencies(tx, plan.sourceCustomerProfileIds);
    if (remaining.some((x: any) => x.count)) throw new Error("VERIFICATION_FAILED: active dependent references remain");
    const afterState = await sourceState(tx, input.shopId, [plan.canonicalCustomerProfileId]);
    for (const wallet of afterState.wallets) {
      if (wallet.transactions.some((t: any) => t.customerProfileId !== plan.canonicalCustomerProfileId) || wallet.reservations.some((r: any) => r.customerProfileId !== plan.canonicalCustomerProfileId)) throw new Error("VERIFICATION_FAILED: wallet ownership mismatch");
    }
    const afterHash = reconciliationChecksum(afterState);
    await tx.customerIdentityReconciliationAudit.create({ data: { id: randomUUID(), planId: plan.id, shopId: input.shopId, canonicalCustomerProfileId: plan.canonicalCustomerProfileId, sourceCustomerProfileIds: plan.sourceCustomerProfileIds, classification: plan.classification, affectedRecordCounts: Object.fromEntries(payload.dependentRecordMovements.map((x: any) => [x.tableName, x.count])), result: "VERIFIED", actor: input.actor, beforeIntegrityHash: plan.sourceStateChecksum, afterIntegrityHash: afterHash } });
    await tx.customerIdentityReconciliationPlan.update({ where: { id: plan.id }, data: { status: "APPLIED", appliedAt: new Date() } });
    return { status: "VERIFIED", planId: plan.id, checksum: plan.checksum };
  }, { isolationLevel: "Serializable" });
}
