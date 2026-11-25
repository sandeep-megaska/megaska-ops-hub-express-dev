// Smart-collection rules, modelled on Shopify's so Megaska's 31 collections
// carry over as they are. Pure functions; see rebuild.ts for the database side.

export type RuleField = "tag" | "type" | "title" | "vendor" | "price" | "compare_at_price";
export type RuleRelation =
  | "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "less_than" | "greater_than";

export type RuleCondition = { field: RuleField; relation: RuleRelation; values: string[] };
export type CollectionRules = { match: "all" | "any"; conditions: RuleCondition[] };

export type RuleProduct = {
  title: string;
  tags: string[];
  productType: string;
  vendor: string;
  prices: string[];          // one per variant, decimal strings
  compareAtPrices: string[]; // one per variant that has one
};

const NEGATIVE: RuleRelation[] = ["not_equals", "not_contains"];

function textMatches(subject: string, relation: RuleRelation, value: string): boolean {
  const s = subject.toLowerCase();
  const v = value.toLowerCase();
  switch (relation) {
    case "equals": return s === v;
    case "not_equals": return s !== v;
    case "contains": return s.includes(v);
    case "not_contains": return !s.includes(v);
    case "starts_with": return s.startsWith(v);
    case "ends_with": return s.endsWith(v);
    default: return false;
  }
}

function numberMatches(subject: string, relation: RuleRelation, value: string): boolean {
  const a = Number(subject);
  const b = Number(value);
  switch (relation) {
    case "less_than": return a < b;
    case "greater_than": return a > b;
    case "equals": return a === b;
    case "not_equals": return a !== b;
    default: return false;
  }
}

/**
 * One condition. Several values mean "any of them" (e.g. type is Night Dress
 * or Night Suits); for negative relations, "none of them".
 * Tag and price conditions hold if any tag/variant satisfies them, as in Shopify.
 */
export function conditionMatches(p: RuleProduct, c: RuleCondition): boolean {
  const negative = NEGATIVE.includes(c.relation);
  const test = (value: string): boolean => {
    switch (c.field) {
      case "title": return textMatches(p.title, c.relation, value);
      case "type": return textMatches(p.productType, c.relation, value);
      case "vendor": return textMatches(p.vendor, c.relation, value);
      case "tag":
        return negative
          ? p.tags.every((t) => textMatches(t, c.relation, value))
          : p.tags.some((t) => textMatches(t, c.relation, value));
      case "price": return p.prices.some((x) => numberMatches(x, c.relation, value));
      case "compare_at_price": return p.compareAtPrices.some((x) => numberMatches(x, c.relation, value));
    }
  };
  return negative ? c.values.every(test) : c.values.some(test);
}

export function productMatches(p: RuleProduct, rules: CollectionRules): boolean {
  if (!rules.conditions.length) return false;
  return rules.match === "any"
    ? rules.conditions.some((c) => conditionMatches(p, c))
    : rules.conditions.every((c) => conditionMatches(p, c));
}

export type SortOrder = "best_selling" | "manual" | "alpha_asc" | "alpha_desc" | "price_asc" | "price_desc" | "created_desc";

export type SortableProduct = {
  handle: string;
  title: string;
  minPrice: string | null;
  salesRank: number | null;
  createdAt: Date;
};

/** Order a collection's members. Ties fall back to title so the order is stable. */
export function sortMembers<T extends SortableProduct>(items: T[], order: SortOrder, manualHandles: string[] = []): T[] {
  const byTitle = (a: T, b: T) => a.title.localeCompare(b.title, "en") || a.handle.localeCompare(b.handle);
  const price = (x: T) => (x.minPrice === null ? Number.POSITIVE_INFINITY : Number(x.minPrice));
  const rank = (x: T) => x.salesRank ?? Number.POSITIVE_INFINITY;
  const manualIndex = new Map(manualHandles.map((h, i) => [h, i]));
  const manual = (x: T) => manualIndex.get(x.handle) ?? Number.POSITIVE_INFINITY;
  const compare: Record<SortOrder, (a: T, b: T) => number> = {
    best_selling: (a, b) => rank(a) - rank(b) || byTitle(a, b),
    manual: (a, b) => manual(a) - manual(b) || byTitle(a, b),
    alpha_asc: byTitle,
    alpha_desc: (a, b) => byTitle(b, a),
    price_asc: (a, b) => price(a) - price(b) || byTitle(a, b),
    price_desc: (a, b) => price(b) - price(a) || byTitle(a, b),
    created_desc: (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || byTitle(a, b),
  };
  return [...items].sort((a, b) => {
    const c = compare[order](a, b);
    return Number.isNaN(c) ? 0 : c;
  });
}
