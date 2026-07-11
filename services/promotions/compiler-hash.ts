import { createHash } from "node:crypto";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortValue(v)]));
  return value;
}
export function deterministicSerialize(value: unknown): string { return JSON.stringify(sortValue(value)); }
export function sha256Hex(value: unknown): string { return createHash("sha256").update(deterministicSerialize(value)).digest("hex"); }
