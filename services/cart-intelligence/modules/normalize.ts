import {
  CART_DRAWER_MODULE_KEYS,
  CART_DRAWER_MODULE_SLOTS,
  type CartDrawerModuleKey,
  type CartDrawerModulesRuntime,
  type CartDrawerModuleSlot,
} from "./types";

const DEFAULT_SORT_ORDER = 100;
const keys = new Set<string>(CART_DRAWER_MODULE_KEYS);
const slots = new Set<string>(CART_DRAWER_MODULE_SLOTS);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeCartDrawerModules(input: unknown): CartDrawerModulesRuntime {
  if (!record(input) || !Array.isArray(input.modules)) return { schemaVersion: 1, modules: [] };
  const seen = new Set<CartDrawerModuleKey>();
  const modules: CartDrawerModulesRuntime["modules"] = [];

  for (const value of input.modules) {
    if (!record(value) || !keys.has(String(value.key)) || !slots.has(String(value.slot))) continue;
    const key = value.key as CartDrawerModuleKey;
    if (seen.has(key)) continue;
    seen.add(key);
    const numericOrder = typeof value.sortOrder === "number" ? value.sortOrder : Number(value.sortOrder);
    const sortOrder = Number.isFinite(numericOrder) ? Math.round(numericOrder) : DEFAULT_SORT_ORDER;
    const normalizedModule = {
      key,
      enabled: value.enabled === true,
      slot: value.slot as CartDrawerModuleSlot,
      sortOrder,
      ...(record(value.settings) ? { settings: { ...value.settings } } : {}),
    };
    modules.push(normalizedModule);
  }

  return { schemaVersion: 1, modules };
}
