import { prisma } from "../db/prisma.ts";
import type { DashboardModulesDto } from "./contract.ts";
import type { CustomerDashboardContext } from "./context.ts";

type Row = { moduleKey: string; enabled: boolean };
type Deps = { findMany: (args: unknown) => Promise<Row[]> };
const defaultDeps: Deps = { findMany: (args) => prisma.shopModuleConfig.findMany(args as never) as Promise<Row[]> };
let deps = defaultDeps;
export function setDashboardModuleDependenciesForTest(overrides: Partial<Deps>) { deps = { ...defaultDeps, ...overrides } as Deps; }
export function resetDashboardModuleDependenciesForTest() { deps = defaultDeps; }

const defaults: DashboardModulesDto = { wallet: true, cancellation: true, exchange: true, issueReporting: true, shipmentTracking: true, partialCod: true, loyalty: false, memberships: false, referrals: false };
const keyMap: Record<string, keyof DashboardModulesDto> = { wallet: "wallet", cancellations: "cancellation", cancellation: "cancellation", exchanges: "exchange", exchange: "exchange", issues: "issueReporting", issue_reporting: "issueReporting", shipment_tracking: "shipmentTracking", partial_cod: "partialCod", fixed_cod_advance: "partialCod", loyalty: "loyalty", memberships: "memberships", referrals: "referrals" };
export async function loadDashboardModules(context: CustomerDashboardContext): Promise<DashboardModulesDto> {
  const rows = await deps.findMany({ where: { shopId: context.shopId, moduleKey: { in: Object.keys(keyMap) } }, select: { moduleKey: true, enabled: true } });
  const out = { ...defaults };
  for (const row of rows) { const key = keyMap[row.moduleKey]; if (key) out[key] = Boolean(row.enabled); }
  return out;
}
