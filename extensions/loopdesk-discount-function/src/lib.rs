use serde::Deserialize;
use shopify_function::prelude::*;
use shopify_function::Result;

#[typegen("schema.graphql")]
pub mod schema {
    #[query("src/cart_lines_discounts_generate_run.graphql")]
    pub mod cart_lines_discounts_generate_run {}
}

const REWARD_MESSAGE: &str = "LoopDesk reward";

#[derive(Clone, Debug, Default, PartialEq)]
struct CartLine {
    id: String,
    quantity: i64,
    subtotal_amount: f64,
    variant_gid: String,
    product_gid: String,
    product_type: String,
    tags: Vec<String>,
    collection_gids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DiscountConfig {
    enabled: bool,
    rules: Vec<Rule>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Rule {
    id: String,
    enabled: bool,
    #[serde(default)]
    priority: i64,
    trigger_type: String,
    #[serde(default)]
    trigger_value: Option<String>,
    reward_enforcement_type: String,
    reward_variant_gid: String,
    #[serde(default)]
    fixed_price_amount: Option<f64>,
    #[serde(default)]
    percentage_value: Option<f64>,
    #[serde(default)]
    quantity: Option<i64>,
}

#[derive(Clone, Debug, PartialEq)]
enum DiscountValue {
    Percentage(f64),
    FixedAmountEach(f64),
}

#[derive(Clone, Debug, PartialEq)]
struct DiscountOperationSpec {
    cart_line_id: String,
    quantity: i64,
    value: DiscountValue,
}

fn parse_config(raw_value: Option<&str>) -> Vec<Rule> {
    let Some(raw_value) = raw_value.map(str::trim).filter(|value| !value.is_empty()) else {
        return vec![];
    };

    let Ok(config) = serde_json::from_str::<DiscountConfig>(raw_value) else {
        return vec![];
    };

    if !config.enabled {
        return vec![];
    }

    let mut rules: Vec<Rule> = config
        .rules
        .into_iter()
        .filter(|rule| rule.enabled)
        .filter(|rule| !rule.id.trim().is_empty())
        .filter(|rule| !rule.reward_variant_gid.trim().is_empty())
        .filter(is_supported_trigger)
        .filter(is_valid_reward_value)
        .collect();

    rules.sort_by_key(|rule| rule.priority);
    rules
}

fn is_supported_trigger(rule: &Rule) -> bool {
    matches!(
        rule.trigger_type.as_str(),
        "always"
            | "cart_contains_product"
            | "cart_contains_collection"
            | "cart_contains_variant"
            | "cart_contains_product_type"
            | "cart_contains_tag"
            | "cart_subtotal_gte"
            | "cart_quantity_gte"
    )
}

fn is_valid_reward_value(rule: &Rule) -> bool {
    match rule.reward_enforcement_type.as_str() {
        "fixed_price" => rule.fixed_price_amount.is_some_and(f64::is_finite),
        "percentage" => rule.percentage_value.is_some_and(|percentage| {
            percentage.is_finite() && percentage > 0.0 && percentage <= 100.0
        }),
        _ => false,
    }
}

fn trigger_matches(rule: &Rule, cart_lines: &[CartLine]) -> bool {
    if rule.trigger_type == "always" {
        return true;
    }

    let trigger_value = rule.trigger_value.as_deref().unwrap_or("").trim();
    if trigger_value.is_empty() {
        return false;
    }

    match rule.trigger_type.as_str() {
        "cart_contains_product" => cart_lines
            .iter()
            .any(|line| line.product_gid == trigger_value),
        "cart_contains_collection" => cart_lines.iter().any(|line| {
            line.collection_gids
                .iter()
                .any(|collection_gid| collection_gid == trigger_value)
        }),
        "cart_contains_variant" => cart_lines
            .iter()
            .any(|line| line.variant_gid == trigger_value),
        "cart_contains_product_type" => cart_lines
            .iter()
            .any(|line| line.product_type == trigger_value),
        "cart_contains_tag" => cart_lines
            .iter()
            .any(|line| line.tags.iter().any(|tag| tag == trigger_value)),
        "cart_subtotal_gte" => trigger_value.parse::<f64>().is_ok_and(|threshold| {
            cart_lines
                .iter()
                .map(|line| line.subtotal_amount)
                .sum::<f64>()
                >= threshold
        }),
        "cart_quantity_gte" => trigger_value.parse::<i64>().is_ok_and(|threshold| {
            cart_lines.iter().map(|line| line.quantity).sum::<i64>() >= threshold
        }),
        _ => false,
    }
}

fn capped_quantity(line: &CartLine, rule: &Rule) -> i64 {
    let cap = rule.quantity.unwrap_or(0);
    line.quantity
        .min(if cap > 0 { cap } else { line.quantity })
        .max(0)
}

fn create_discount_operation(rule: &Rule, line: &CartLine) -> Option<DiscountOperationSpec> {
    let quantity = capped_quantity(line, rule);
    if line.id.is_empty() || quantity <= 0 {
        return None;
    }

    let value = match rule.reward_enforcement_type.as_str() {
        "percentage" => DiscountValue::Percentage(rule.percentage_value?),
        "fixed_price" => {
            let fixed_price_amount = rule.fixed_price_amount?;
            let unit_price = if line.quantity > 0 {
                line.subtotal_amount / line.quantity as f64
            } else {
                0.0
            };
            let discount_amount = (unit_price - fixed_price_amount).max(0.0);
            if !discount_amount.is_finite() || discount_amount <= 0.0 {
                return None;
            }
            DiscountValue::FixedAmountEach(discount_amount)
        }
        _ => return None,
    };

    Some(DiscountOperationSpec {
        cart_line_id: line.id.clone(),
        quantity,
        value,
    })
}

fn evaluate(cart_lines: &[CartLine], rules: &[Rule]) -> Vec<DiscountOperationSpec> {
    rules
        .iter()
        .filter(|rule| trigger_matches(rule, cart_lines))
        .filter_map(|rule| {
            cart_lines
                .iter()
                .find(|line| line.variant_gid == rule.reward_variant_gid)
                .and_then(|reward_line| create_discount_operation(rule, reward_line))
        })
        .collect()
}

#[shopify_function]
fn cartLinesDiscountsGenerateRun(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<schema::CartLinesDiscountsGenerateRunResult> {
    let raw_config = input
        .discount()
        .metafield()
        .map(|metafield| metafield.value());
    let rules = parse_config(raw_config.map(String::as_str));
    if rules.is_empty() {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    let cart_lines: Vec<CartLine> = input
        .cart()
        .lines()
        .iter()
        .map(|line| CartLine {
            id: line.id().clone(),
            quantity: *line.quantity() as i64,
            subtotal_amount: *line.cost().subtotal_amount().amount(),
            variant_gid: line.merchandise().id().clone(),
            product_gid: String::new(),
            product_type: String::new(),
            tags: vec![],
            collection_gids: vec![],
        })
        .collect();

    Ok(schema::CartLinesDiscountsGenerateRunResult {
        operations: evaluate(&cart_lines, &rules)
            .into_iter()
            .map(to_product_discount_operation)
            .collect(),
    })
}

fn to_product_discount_operation(
    spec: DiscountOperationSpec,
) -> schema::CartLinesDiscountsGenerateRunOperation {
    let value = match spec.value {
        DiscountValue::Percentage(value) => schema::ProductDiscountValue {
            percentage: Some(schema::Percentage {
                value: Decimal(value),
            }),
            fixed_amount: None,
        },
        DiscountValue::FixedAmountEach(amount) => schema::ProductDiscountValue {
            percentage: None,
            fixed_amount: Some(schema::ProductDiscountFixedAmount {
                amount: Decimal((amount * 100.0).round() / 100.0),
                applies_to_each_item: Some(true),
            }),
        },
    };

    schema::CartLinesDiscountsGenerateRunOperation {
        product_discounts_add: Some(schema::AddProductDiscountsOperation {
            selection_strategy: schema::ProductDiscountSelectionStrategy::First,
            candidates: vec![schema::ProductDiscountCandidate {
                targets: vec![schema::ProductDiscountTarget {
                    cart_line: Some(schema::LineDiscountTarget {
                        id: spec.cart_line_id,
                        quantity: Some(spec.quantity),
                    }),
                }],
                message: Some(REWARD_MESSAGE.to_string()),
                value,
                associated_discount_code: None,
                prerequisites: None,
            }],
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REWARD_VARIANT_GID: &str = "gid://shopify/ProductVariant/reward";
    const TRIGGER_VARIANT_GID: &str = "gid://shopify/ProductVariant/trigger";

    fn rule(overrides: impl FnOnce(&mut Rule)) -> Rule {
        let mut rule = Rule {
            id: "rule-1".to_string(),
            enabled: true,
            priority: 1,
            trigger_type: "cart_contains_variant".to_string(),
            trigger_value: Some(TRIGGER_VARIANT_GID.to_string()),
            reward_enforcement_type: "percentage".to_string(),
            reward_variant_gid: REWARD_VARIANT_GID.to_string(),
            fixed_price_amount: None,
            percentage_value: Some(20.0),
            quantity: Some(1),
        };
        overrides(&mut rule);
        rule
    }

    fn cart_line(id: &str, variant_gid: &str, quantity: i64, subtotal_amount: f64) -> CartLine {
        CartLine {
            id: id.to_string(),
            quantity,
            subtotal_amount,
            variant_gid: variant_gid.to_string(),
            product_gid: "gid://shopify/Product/1".to_string(),
            product_type: String::new(),
            tags: vec![],
            collection_gids: vec![],
        }
    }

    fn default_lines() -> Vec<CartLine> {
        vec![
            cart_line("trigger-line", TRIGGER_VARIANT_GID, 1, 100.0),
            cart_line("reward-line", REWARD_VARIANT_GID, 2, 200.0),
        ]
    }

    #[test]
    fn fixed_price_applies_only_to_capped_reward_line() {
        let operations = evaluate(
            &default_lines(),
            &[rule(|rule| {
                rule.reward_enforcement_type = "fixed_price".to_string();
                rule.fixed_price_amount = Some(25.0);
                rule.percentage_value = None;
            })],
        );

        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].cart_line_id, "reward-line");
        assert_eq!(operations[0].quantity, 1);
        assert_eq!(operations[0].value, DiscountValue::FixedAmountEach(75.0));
    }

    #[test]
    fn percentage_applies_to_reward_variant_only() {
        let operations = evaluate(&default_lines(), &[rule(|_| {})]);

        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].cart_line_id, "reward-line");
        assert_eq!(operations[0].quantity, 1);
        assert_eq!(operations[0].value, DiscountValue::Percentage(20.0));
    }

    #[test]
    fn invalid_percentages_are_ignored() {
        for percentage in [0.0, -1.0, 101.0] {
            assert!(!is_valid_reward_value(&rule(|rule| rule
                .percentage_value =
                Some(percentage))));
        }
    }

    #[test]
    fn no_matching_reward_variant_is_ignored() {
        let operations = evaluate(
            &default_lines(),
            &[rule(|rule| {
                rule.reward_variant_gid = "gid://shopify/ProductVariant/missing".to_string()
            })],
        );

        assert!(operations.is_empty());
    }

    #[test]
    fn quantity_cap_is_respected() {
        let operations = evaluate(
            &[
                cart_line("trigger-line", TRIGGER_VARIANT_GID, 1, 100.0),
                cart_line("reward-line", REWARD_VARIANT_GID, 4, 400.0),
            ],
            &[rule(|rule| {
                rule.percentage_value = Some(15.0);
                rule.quantity = Some(2);
            })],
        );

        assert_eq!(operations[0].quantity, 2);
    }

    #[test]
    fn unsupported_reward_types_are_ignored() {
        for reward_type in ["fixed_amount", "free_gift", "bundles"] {
            assert!(!is_valid_reward_value(&rule(|rule| rule
                .reward_enforcement_type =
                reward_type.to_string())));
        }
    }
}
