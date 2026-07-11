use crate::schema::cart_lines_discounts_generate_run::input::cart::lines::Merchandise;
use crate::{config::*, decimal::Decimal, schema};

#[derive(Clone, Debug)]
pub struct Line {
    pub id: String,
    pub quantity: i64,
    pub unit_amount: Decimal,
    pub product_gid: String,
    pub marker_rule: Option<String>,
    pub marker_version: Option<String>,
    pub index: usize,
}

pub struct Cart {
    pub subtotal: Option<Decimal>,
    pub lines: Vec<Line>,
}

pub struct Allocation<'a> {
    pub line: &'a Line,
    pub quantity: i64,
}

pub fn product_gid(s: &str) -> bool {
    s.strip_prefix("gid://shopify/Product/")
        .is_some_and(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()))
}

impl Cart {
    pub fn from_input(input: &schema::cart_lines_discounts_generate_run::Input) -> Self {
        let subtotal = Decimal::parse_shopify(input.cart().cost().subtotal_amount().amount());
        let lines = input
            .cart()
            .lines()
            .iter()
            .enumerate()
            .filter_map(|(index, l)| {
                if *l.quantity() <= 0 {
                    return None;
                }
                let (parent_product_gid, _variant) = match l.merchandise() {
                    Merchandise::ProductVariant(variant) => (variant.product().id(), variant.id()),
                    _ => return None,
                };
                if !product_gid(parent_product_gid) {
                    return None;
                }
                Some(Line {
                    id: l.id().clone(),
                    quantity: i64::from(*l.quantity()),
                    unit_amount: Decimal::parse_shopify(
                        l.cost().amount_per_quantity().amount(),
                    )?,
                    product_gid: parent_product_gid.to_string(),
                    marker_rule: l
                        .promotion_rule_id()
                        .as_ref()
                        .and_then(|a| a.value().as_ref())
                        .filter(|v| !v.trim().is_empty())
                        .map(|v| (*v).clone()),
                    marker_version: l
                        .promotion_compilation_version()
                        .as_ref()
                        .and_then(|a| a.value().as_ref())
                        .filter(|v| !v.trim().is_empty())
                        .map(|v| (*v).clone()),
                    index,
                })
            })
            .collect();
        Self { subtotal, lines }
    }
}

pub fn conditions_met(rule: &FunctionRule, cart: &Cart) -> bool {
    if rule.trigger.minimum_quantity <= 0 {
        return false;
    }
    let members = members(rule);
    if members.is_empty() {
        return false;
    }
    let qty: i64 = cart
        .lines
        .iter()
        .filter(|l| l.marker_rule.is_none() && members.contains(&l.product_gid))
        .map(|l| l.quantity)
        .sum();
    if qty < rule.trigger.minimum_quantity {
        return false;
    }
    if let Some(t) = &rule.trigger.minimum_cart_subtotal {
        let Some(th) = Decimal::parse(t) else {
            return false;
        };
        if th.is_negative() {
            return false;
        }
        let Some(sub) = &cart.subtotal else {
            return false;
        };
        if sub < &th {
            return false;
        }
    }
    true
}

fn members(rule: &FunctionRule) -> std::collections::BTreeSet<String> {
    let mut s = std::collections::BTreeSet::new();
    for g in &rule.trigger.source_groups {
        if g.unresolved || g.product_gids.is_empty() {
            continue;
        }
        if g.product_gids.iter().all(|p| product_gid(p)) {
            for p in &g.product_gids {
                s.insert(p.clone());
            }
        }
    }
    s
}

pub fn allocations<'a>(
    rule: &FunctionRule,
    cart: &'a Cart,
    claimed: &std::collections::BTreeSet<String>,
) -> Vec<Allocation<'a>> {
    if rule.reward.maximum_quantity <= 0 {
        return vec![];
    }
    let mut remain = rule.reward.maximum_quantity;
    let mut out = Vec::new();
    let mut lines: Vec<_> = cart.lines.iter().collect();
    lines.sort_by_key(|l| l.index);
    for l in lines {
        if remain <= 0 {
            break;
        }
        if claimed.contains(&l.id) {
            continue;
        }
        if l.marker_rule.as_deref() != Some(rule.rule_id.as_str()) {
            continue;
        }
        let Some(v) = &l.marker_version else {
            continue;
        };
        if v.parse::<u64>().ok() != Some(rule.compilation_version) {
            continue;
        }
        if l.product_gid != rule.offer.product_gid {
            continue;
        }
        let q = l.quantity.min(remain);
        if q > 0 {
            out.push(Allocation {
                line: l,
                quantity: q,
            });
            remain -= q;
        }
    }
    out
}
