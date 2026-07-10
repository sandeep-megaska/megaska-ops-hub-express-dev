use serde::Deserialize;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::{BTreeMap, BTreeSet};

#[typegen("schema.graphql")]
pub mod schema {
    #[query("src/cart_lines_discounts_generate_run.graphql")]
    pub mod cart_lines_discounts_generate_run {}
}

const REWARD_MESSAGE: &str = "LoopDesk reward";

#[derive(Clone, Debug, Default, PartialEq)]
struct CartLine {
    quantity: i64,
    subtotal_amount: f64,
    variant_gid: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DiscountConfig {
    enabled: bool,
    #[serde(default)]
    rules: Vec<Rule>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
enum TriggerValue {
    String(String),
    Number(f64),
}

impl TriggerValue {
    fn as_trimmed_string(&self) -> String {
        match self {
            TriggerValue::String(value) => value.trim().to_string(),
            TriggerValue::Number(value) => {
                if value.fract() == 0.0 {
                    format!("{value:.0}")
                } else {
                    value.to_string()
                }
            }
        }
    }
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
    trigger_value: Option<TriggerValue>,
    reward_enforcement_type: String,
    #[serde(default)]
    reward_variant_gid: Option<String>,
    #[serde(default)]
    fixed_price_amount: Option<f64>,
    #[serde(default)]
    percentage_value: Option<f64>,
    #[serde(default)]
    fixed_amount_value: Option<f64>,
    #[serde(default)]
    quantity: Option<i64>,
}

#[derive(Clone, Debug, PartialEq)]
enum DiscountValue {
    Percentage(f64),
    FixedAmountEach(f64),
}

#[derive(Clone, Debug, PartialEq)]
struct DiscountCandidateSpec {
    variant_gid: String,
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
        .filter(|rule| {
            rule.reward_variant_gid
                .as_deref()
                .is_some_and(|gid| !gid.trim().is_empty())
        })
        .filter(is_supported_trigger)
        .filter(is_valid_reward_value)
        .collect();

    rules.sort_by_key(|rule| rule.priority);
    rules
}

fn is_supported_trigger(rule: &Rule) -> bool {
    matches!(
        rule.trigger_type.as_str(),
        "always" | "cart_contains_variant" | "cart_subtotal_gte" | "cart_quantity_gte"
    )
}

fn is_valid_reward_value(rule: &Rule) -> bool {
    match rule.reward_enforcement_type.as_str() {
        "fixed_price" => rule.fixed_price_amount.is_some_and(f64::is_finite),
        "percentage" => rule.percentage_value.is_some_and(|percentage| {
            percentage.is_finite() && percentage > 0.0 && percentage <= 100.0
        }),
        "fixed_amount" => rule
            .fixed_amount_value
            .is_some_and(|amount| amount.is_finite() && amount > 0.0),
        _ => false,
    }
}

fn trigger_matches(rule: &Rule, cart_lines: &[CartLine]) -> bool {
    if rule.trigger_type == "always" {
        return true;
    }

    let trigger_value = rule
        .trigger_value
        .as_ref()
        .map(TriggerValue::as_trimmed_string)
        .unwrap_or_default();
    let trigger_value = trigger_value.trim();
    if trigger_value.is_empty() {
        return false;
    }

    match rule.trigger_type.as_str() {
        "cart_contains_variant" => cart_lines
            .iter()
            .any(|line| line.variant_gid == trigger_value),
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

fn create_discount_candidate(rule: &Rule, line: &CartLine) -> Option<DiscountCandidateSpec> {
    let quantity = capped_quantity(line, rule);
    if line.variant_gid.is_empty() || quantity <= 0 {
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
        "fixed_amount" => {
            let fixed_amount = rule.fixed_amount_value?;
            let unit_price = if line.quantity > 0 {
                line.subtotal_amount / line.quantity as f64
            } else {
                0.0
            };
            let discount_amount = fixed_amount.min(unit_price).max(0.0);
            if !discount_amount.is_finite() || discount_amount <= 0.0 {
                return None;
            }
            DiscountValue::FixedAmountEach(discount_amount)
        }
        _ => return None,
    };

    Some(DiscountCandidateSpec {
        variant_gid: line.variant_gid.clone(),
        quantity,
        value,
    })
}

fn evaluate(cart_lines: &[CartLine], rules: &[Rule]) -> Vec<DiscountCandidateSpec> {
    let mut discounted_variants = BTreeSet::new();
    let mut candidates = Vec::new();

    for rule in rules
        .iter()
        .filter(|rule| trigger_matches(rule, cart_lines))
    {
        let Some(reward_variant_gid) = rule.reward_variant_gid.as_deref() else {
            continue;
        };
        if discounted_variants.contains(reward_variant_gid) {
            continue;
        }
        let Some(reward_line) = cart_lines
            .iter()
            .find(|line| line.variant_gid == reward_variant_gid)
        else {
            continue;
        };
        let Some(candidate) = create_discount_candidate(rule, reward_line) else {
            continue;
        };
        discounted_variants.insert(reward_variant_gid.to_string());
        candidates.push(candidate);
    }

    candidates
}

#[shopify_function]
fn cart_lines_discounts_generate_run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<JsonValue> {
    let raw_config = input
        .discount()
        .metafield()
        .map(|metafield| metafield.value());
    let rules = parse_config(raw_config.map(String::as_str));
    if rules.is_empty() {
        return Ok(empty_result());
    }

    let cart_lines: Vec<CartLine> = input
        .cart()
        .lines()
        .iter()
        .filter_map(|line| {
            let variant_gid = match line.merchandise() {
                schema::cart_lines_discounts_generate_run::input::cart::lines::Merchandise::ProductVariant(variant) => variant.id().clone(),
                schema::cart_lines_discounts_generate_run::input::cart::lines::Merchandise::Other => return None,
            };

            Some(CartLine {
                quantity: *line.quantity() as i64,
                subtotal_amount: **line.cost().subtotal_amount().amount(),
                variant_gid,
            })
        })
        .collect();

    let candidates: Vec<JsonValue> = evaluate(&cart_lines, &rules)
        .into_iter()
        .map(to_product_discount_candidate)
        .collect();

    if candidates.is_empty() {
        return Ok(empty_result());
    }

    Ok(object(vec![(
        "operations",
        array(vec![object(vec![(
            "productDiscountsAdd",
            object(vec![
                ("selectionStrategy", string("FIRST")),
                ("candidates", array(candidates)),
            ]),
        )])]),
    )]))
}

fn to_product_discount_candidate(spec: DiscountCandidateSpec) -> JsonValue {
    let value = match spec.value {
        DiscountValue::Percentage(value) => {
            object(vec![("percentage", object(vec![("value", number(value))]))])
        }
        DiscountValue::FixedAmountEach(amount) => object(vec![(
            "fixedAmount",
            object(vec![
                ("amount", number((amount * 100.0).round() / 100.0)),
                ("appliesToEachItem", boolean(true)),
            ]),
        )]),
    };

    object(vec![
        (
            "targets",
            array(vec![object(vec![(
                "productVariant",
                object(vec![
                    ("id", string(spec.variant_gid)),
                    ("quantity", number(spec.quantity as f64)),
                ]),
            )])]),
        ),
        ("message", string(REWARD_MESSAGE)),
        ("value", value),
        ("associatedDiscountCode", JsonValue::Null),
    ])
}

fn empty_result() -> JsonValue {
    object(vec![("operations", array(vec![]))])
}

fn object(entries: Vec<(&str, JsonValue)>) -> JsonValue {
    JsonValue::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect::<BTreeMap<_, _>>(),
    )
}

fn array(values: Vec<JsonValue>) -> JsonValue {
    JsonValue::Array(values)
}

fn string(value: impl Into<String>) -> JsonValue {
    JsonValue::String(value.into())
}

fn number(value: f64) -> JsonValue {
    JsonValue::Number(value)
}

fn boolean(value: bool) -> JsonValue {
    JsonValue::Boolean(value)
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
            trigger_value: Some(TriggerValue::String(TRIGGER_VARIANT_GID.to_string())),
            reward_enforcement_type: "percentage".to_string(),
            reward_variant_gid: Some(REWARD_VARIANT_GID.to_string()),
            fixed_price_amount: None,
            percentage_value: Some(20.0),
            fixed_amount_value: None,
            quantity: Some(1),
        };
        overrides(&mut rule);
        rule
    }

    fn cart_line(variant_gid: &str, quantity: i64, subtotal_amount: f64) -> CartLine {
        CartLine {
            quantity,
            subtotal_amount,
            variant_gid: variant_gid.to_string(),
        }
    }

    fn default_lines() -> Vec<CartLine> {
        vec![
            cart_line(TRIGGER_VARIANT_GID, 1, 100.0),
            cart_line(REWARD_VARIANT_GID, 2, 200.0),
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
        assert_eq!(operations[0].variant_gid, REWARD_VARIANT_GID);
        assert_eq!(operations[0].quantity, 1);
        assert_eq!(operations[0].value, DiscountValue::FixedAmountEach(75.0));
    }


    #[test]
    fn fixed_price_three_hundred_on_six_hundred_rupee_reward_line_discounts_three_hundred() {
        let operations = evaluate(
            &[
                cart_line(TRIGGER_VARIANT_GID, 1, 600.0),
                cart_line(REWARD_VARIANT_GID, 1, 600.0),
            ],
            &[rule(|rule| {
                rule.reward_enforcement_type = "fixed_price".to_string();
                rule.fixed_price_amount = Some(300.0);
                rule.percentage_value = None;
                rule.quantity = Some(1);
            })],
        );

        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].variant_gid, REWARD_VARIANT_GID);
        assert_eq!(operations[0].quantity, 1);
        assert_eq!(operations[0].value, DiscountValue::FixedAmountEach(300.0));
    }

    #[test]
    fn fixed_amount_applies_correct_amount_to_capped_reward_line() {
        let operations = evaluate(
            &default_lines(),
            &[rule(|rule| {
                rule.reward_enforcement_type = "fixed_amount".to_string();
                rule.fixed_amount_value = Some(30.0);
                rule.percentage_value = None;
                rule.quantity = Some(1);
            })],
        );

        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].variant_gid, REWARD_VARIANT_GID);
        assert_eq!(operations[0].quantity, 1);
        assert_eq!(operations[0].value, DiscountValue::FixedAmountEach(30.0));
    }

    #[test]
    fn fixed_amount_caps_at_unit_price() {
        let operations = evaluate(
            &default_lines(),
            &[rule(|rule| {
                rule.reward_enforcement_type = "fixed_amount".to_string();
                rule.fixed_amount_value = Some(150.0);
                rule.percentage_value = None;
            })],
        );

        assert_eq!(operations[0].value, DiscountValue::FixedAmountEach(100.0));
    }

    #[test]
    fn invalid_fixed_amount_values_are_ignored() {
        for amount in [0.0, -1.0, f64::NAN] {
            assert!(!is_valid_reward_value(&rule(|rule| {
                rule.reward_enforcement_type = "fixed_amount".to_string();
                rule.percentage_value = None;
                rule.fixed_amount_value = Some(amount);
            })));
        }
    }

    #[test]
    fn percentage_applies_to_reward_variant_only() {
        let operations = evaluate(&default_lines(), &[rule(|_| {})]);

        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].variant_gid, REWARD_VARIANT_GID);
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
                rule.reward_variant_gid = Some("gid://shopify/ProductVariant/missing".to_string())
            })],
        );

        assert!(operations.is_empty());
    }

    #[test]
    fn quantity_cap_is_respected() {
        let operations = evaluate(
            &[
                cart_line(TRIGGER_VARIANT_GID, 1, 100.0),
                cart_line(REWARD_VARIANT_GID, 4, 400.0),
            ],
            &[rule(|rule| {
                rule.percentage_value = Some(15.0);
                rule.quantity = Some(2);
            })],
        );

        assert_eq!(operations[0].quantity, 2);
    }

    #[test]
    fn reward_without_trigger_does_not_apply() {
        let operations = evaluate(&[cart_line(REWARD_VARIANT_GID, 2, 200.0)], &[rule(|_| {})]);
        assert!(operations.is_empty());
    }

    #[test]
    fn trigger_without_reward_does_not_apply() {
        let operations = evaluate(&[cart_line(TRIGGER_VARIANT_GID, 1, 100.0)], &[rule(|_| {})]);
        assert!(operations.is_empty());
    }

    #[test]
    fn disabled_and_malformed_config_produce_no_rules() {
        assert!(parse_config(Some("not json")).is_empty());
        assert!(parse_config(Some(r#"{"enabled":false,"rules":[]}"#)).is_empty());
        assert!(parse_config(Some(
            r#"{"enabled":true,"rules":[{"id":"missing-reward"}]}"#
        ))
        .is_empty());
    }

    #[test]
    fn numeric_trigger_values_parse_safely() {
        let parsed = parse_config(Some(
            r#"{"schemaVersion":1,"enabled":true,"rules":[{"id":"subtotal","enabled":true,"priority":1,"triggerType":"cart_subtotal_gte","triggerValue":250,"rewardEnforcementType":"percentage","rewardVariantGid":"gid://shopify/ProductVariant/reward","percentageValue":10,"quantity":1}]}"#,
        ));
        assert_eq!(parsed.len(), 1);
        assert!(trigger_matches(
            &parsed[0],
            &[cart_line(REWARD_VARIANT_GID, 1, 300.0)]
        ));
    }

    #[test]
    fn multiple_rules_do_not_double_discount_same_reward_variant() {
        let operations = evaluate(
            &default_lines(),
            &[
                rule(|rule| {
                    rule.priority = 1;
                    rule.percentage_value = Some(10.0);
                }),
                rule(|rule| {
                    rule.id = "rule-2".to_string();
                    rule.priority = 2;
                    rule.percentage_value = Some(20.0);
                }),
            ],
        );

        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].value, DiscountValue::Percentage(10.0));
    }

    #[test]
    fn unsupported_reward_types_are_ignored() {
        for reward_type in ["free_gift", "bundles"] {
            assert!(!is_valid_reward_value(&rule(|rule| {
                rule.reward_enforcement_type = reward_type.to_string()
            })));
        }
    }

    #[test]
    fn unsupported_non_variant_triggers_are_ignored() {
        for trigger_type in [
            "cart_contains_product",
            "cart_contains_collection",
            "cart_contains_product_type",
            "cart_contains_tag",
        ] {
            assert!(!is_supported_trigger(&rule(|rule| {
                rule.trigger_type = trigger_type.to_string()
            })));
        }
    }
}
