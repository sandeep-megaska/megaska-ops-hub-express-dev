/* eslint-disable @typescript-eslint/no-explicit-any */
import { validateCodAdvanceSettingsInput, type CodAdvanceSettingsInput } from "./settings-shared.ts";
export type { CodAdvanceSettingsInput } from "./settings-shared.ts";
export { buildCodAdvancePreview, CodAdvanceSettingsValidationError, DEFAULT_CUSTOMER_MESSAGE, DEFAULT_CUSTOMER_TITLE, parsePercentageToBasisPoints, parseRupeesToPaise, validateCodAdvanceSettingsInput } from "./settings-shared.ts";
export type CodAdvanceSettingsDTO = {
  id?: string;
  enabled: boolean;
  advanceType: "FIXED" | "PERCENTAGE";
  fixedAdvanceAmountPaise: number;
  percentageBasisPoints: number | null;
  minimumAdvanceAmountPaise: number | null;
  maximumAdvanceAmountPaise: number | null;
  minOrderAmountPaise: number | null;
  maxOrderAmountPaise: number | null;
  customerTitle: string | null;
  customerMessage: string | null;
  version: number;
};


export const DEFAULT_COD_ADVANCE_SETTINGS: CodAdvanceSettingsDTO = {
  enabled: false,
  advanceType: "FIXED",
  fixedAdvanceAmountPaise: 30000,
  percentageBasisPoints: null,
  minimumAdvanceAmountPaise: null,
  maximumAdvanceAmountPaise: null,
  minOrderAmountPaise: null,
  maxOrderAmountPaise: null,
  customerTitle: null,
  customerMessage: null,
  version: 0,
};

function dto(row: any | null): CodAdvanceSettingsDTO {
  if (!row) return { ...DEFAULT_COD_ADVANCE_SETTINGS };
  return {
    id: row.id,
    enabled: Boolean(row.enabled),
    advanceType: row.advanceType === "PERCENTAGE" ? "PERCENTAGE" : "FIXED",
    fixedAdvanceAmountPaise: Number(row.fixedAdvanceAmountPaise || 0),
    percentageBasisPoints: row.percentageBasisPoints == null ? null : Number(row.percentageBasisPoints),
    minimumAdvanceAmountPaise: row.minimumAdvanceAmountPaise == null ? null : Number(row.minimumAdvanceAmountPaise),
    maximumAdvanceAmountPaise: row.maximumAdvanceAmountPaise == null ? null : Number(row.maximumAdvanceAmountPaise),
    minOrderAmountPaise: row.minOrderAmountPaise == null ? null : Number(row.minOrderAmountPaise),
    maxOrderAmountPaise: row.maxOrderAmountPaise == null ? null : Number(row.maxOrderAmountPaise),
    customerTitle: row.customerTitle ?? null,
    customerMessage: row.customerMessage ?? null,
    version: Number(row.version || 1),
  };
}

type Db = any;
type Audit = (eventType: string, entityType: string, entityId: string | null, payload?: unknown) => Promise<void>;

async function defaultDb(): Promise<Db> {
  const mod = await import("../db/prisma");
  return mod.prisma;
}

async function latest(db: Db, shopId: string) {
  return db.codAdvanceSettings.findFirst({ where: { shopId }, orderBy: { updatedAt: "desc" } });
}

export async function getCodAdvanceSettingsForShop(shopId: string, deps: { db?: Db; audit?: Audit } = {}) {
  const db = deps.db || await defaultDb();
  const settings = dto(await latest(db, shopId));
  await deps.audit?.("cod_advance.settings.viewed", "CodAdvanceSettings", settings.id || null, { shopId, version: settings.version });
  return settings;
}

export async function updateCodAdvanceSettingsForShop(input: CodAdvanceSettingsInput & { shopId: string }, deps: { db?: Db; audit?: Audit } = {}) {
  validateCodAdvanceSettingsInput(input);
  const db = deps.db || await defaultDb();
  const audit = deps.audit;
  const saved = await db.$transaction(async (tx: any) => {
    const existing = await latest(tx, input.shopId);
    const data = {
      enabled: input.enabled,
      advanceType: input.advanceType,
      fixedAdvanceAmountPaise: input.fixedAdvanceAmountPaise,
      percentageBasisPoints: input.advanceType === "FIXED" ? null : input.percentageBasisPoints,
      minimumAdvanceAmountPaise: input.minimumAdvanceAmountPaise,
      maximumAdvanceAmountPaise: input.maximumAdvanceAmountPaise,
      minOrderAmountPaise: input.minOrderAmountPaise,
      maxOrderAmountPaise: input.maxOrderAmountPaise,
      customerTitle: input.customerTitle,
      customerMessage: input.customerMessage,
      version: existing ? Number(existing.version || 0) + 1 : 1,
    };
    return existing
      ? tx.codAdvanceSettings.update({ where: { id: existing.id }, data })
      : tx.codAdvanceSettings.create({ data: { shopId: input.shopId, currency: "INR", ...data } });
  });
  const settings = dto(saved);
  await audit?.("cod_advance.settings.updated", "CodAdvanceSettings", settings.id || null, { shopId: input.shopId, newVersion: settings.version, enabled: settings.enabled, advanceType: settings.advanceType, fixedAdvanceAmountPaise: settings.fixedAdvanceAmountPaise, percentageBasisPoints: settings.percentageBasisPoints, minimumAdvanceAmountPaise: settings.minimumAdvanceAmountPaise, maximumAdvanceAmountPaise: settings.maximumAdvanceAmountPaise, minOrderAmountPaise: settings.minOrderAmountPaise, maxOrderAmountPaise: settings.maxOrderAmountPaise });
  await audit?.(settings.enabled ? "cod_advance.settings.enabled" : "cod_advance.settings.disabled", "CodAdvanceSettings", settings.id || null, { shopId: input.shopId, version: settings.version });
  return settings;
}
