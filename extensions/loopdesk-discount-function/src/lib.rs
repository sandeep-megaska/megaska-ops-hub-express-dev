pub mod cart_lines_discounts_generate_run;
pub mod config;
pub mod decimal;
pub mod eligibility;
pub mod rewards;
pub mod schema;

pub use cart_lines_discounts_generate_run::run;

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use crate::{
        config::{
            parse_config, FunctionRule, LegacyRewardConfig, MatchMode, OfferConfig, RewardConfig, RewardType,
            RuleStatus, SourceGroup, TriggerConfig,
        },
        decimal::Decimal,
        eligibility::{allocations, conditions_met, Cart, Line},
        rewards,
        schema::{ProductDiscountCandidateTarget, ProductDiscountCandidateValue},
    };

    fn rule(reward_type: RewardType, value: &str, maximum_quantity: i64) -> FunctionRule {
        FunctionRule {
            schema_version: 1,
            rule_id: "r1".into(),
            compilation_version: 7,
            status: RuleStatus::Active,
            priority: 1,
            trigger: TriggerConfig {
                trigger_type: "PRODUCT".into(),
                match_mode: MatchMode::Any,
                minimum_quantity: 2,
                minimum_cart_subtotal: None,
                source_groups: vec![SourceGroup {
                    source_reference_id: "s".into(),
                    source_type: "PRODUCT".into(),
                    source_gid: "gid://shopify/Product/1".into(),
                    product_gids: vec!["gid://shopify/Product/1".into()],
                    unresolved: false,
                }],
            },
            offer: OfferConfig {
                product_gid: "gid://shopify/Product/2".into(),
                handle: None,
            },
            reward: RewardConfig::Legacy(LegacyRewardConfig {
                reward_type,
                value: value.into(),
                maximum_quantity,
            }),
        }
    }

    fn trigger_line() -> Line {
        Line {
            id: "trigger".into(),
            quantity: 2,
            unit_amount: Decimal::parse("50.00").unwrap(),
            product_gid: "gid://shopify/Product/1".into(),
            marker_rule: None,
            marker_version: None,
            index: 0,
        }
    }

    fn offer_line(quantity: i64, version: &str) -> Line {
        Line {
            id: "offer".into(),
            quantity,
            unit_amount: Decimal::parse("20.00").unwrap(),
            product_gid: "gid://shopify/Product/2".into(),
            marker_rule: Some("r1".into()),
            marker_version: Some(version.into()),
            index: 1,
        }
    }

    fn cart(offer_quantity: i64, version: &str) -> Cart {
        Cart {
            subtotal: Decimal::parse("100.00"),
            lines: vec![trigger_line(), offer_line(offer_quantity, version)],
        }
    }

    #[test]
    fn malformed_config_fails_closed() {
        assert!(parse_config("{bad").is_err());
    }

    #[test]
    fn shared_typescript_fixture_parses() {
        let raw = include_str!("../../../shared/fixtures/loopdesk-function-configuration.json");
        let cfg =
            parse_config(raw).expect("shared fixture should satisfy the strict Function parser");
        assert_eq!(cfg.schema_version, 1);
        assert_eq!(cfg.configuration_version, 1);
        assert_eq!(cfg.rules.len(), 1);
        assert_eq!(cfg.rules[0].compilation_version, 3);
    }

    #[test]
    fn offer_handle_string_and_null_parse() {
        let with_handle = r#"{
            "schemaVersion":1,
            "configurationVersion":1,
            "configurationHash":"h",
            "rules":[{
                "schemaVersion":1,
                "ruleId":"r1",
                "compilationVersion":1,
                "status":"ACTIVE",
                "priority":1,
                "trigger":{
                    "type":"PRODUCT",
                    "matchMode":"ANY",
                    "minimumQuantity":2,
                    "minimumCartSubtotal":null,
                    "sourceGroups":[]
                },
                "offer":{"productGid":"gid://shopify/Product/2","handle":"sample-product"},
                "reward":{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":1}
            }]
        }"#;
        let cfg = parse_config(with_handle).expect("offer handle string should parse");
        assert_eq!(cfg.rules[0].offer.handle.as_deref(), Some("sample-product"));

        let with_null_handle =
            with_handle.replace(r#""handle":"sample-product""#, r#""handle":null"#);
        let cfg = parse_config(&with_null_handle).expect("offer handle null should parse");
        assert_eq!(cfg.rules[0].offer.handle, None);
    }

    #[test]
    fn missing_compilation_version_fails_closed() {
        let raw = r#"{
            "schemaVersion":1,
            "configurationVersion":1,
            "configurationHash":"h",
            "rules":[{
                "schemaVersion":1,
                "ruleId":"r1",
                "status":"ACTIVE",
                "priority":1,
                "trigger":{
                    "type":"PRODUCT",
                    "matchMode":"ANY",
                    "minimumQuantity":2,
                    "minimumCartSubtotal":null,
                    "sourceGroups":[]
                },
                "offer":{"productGid":"gid://shopify/Product/2"},
                "reward":{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":1}
            }]
        }"#;
        assert!(parse_config(raw).is_err());
    }

    #[test]
    fn matching_trigger_conditions_pass() {
        let rule = rule(RewardType::PercentageOff, "10", 1);
        assert!(conditions_met(&rule, &cart(1, "7")));
    }

    #[test]
    fn wrong_compilation_version_produces_no_allocation() {
        let rule = rule(RewardType::PercentageOff, "10", 1);
        assert!(allocations(&rule, &cart(1, "8"), &BTreeSet::new()).is_empty());
    }

    #[test]
    fn reward_quantity_is_capped() {
        let rule = rule(RewardType::PercentageOff, "10", 2);
        let cart = cart(5, "7");
        let allocations = allocations(&rule, &cart, &BTreeSet::new());
        assert_eq!(allocations.len(), 1);
        assert_eq!(allocations[0].quantity, 2);
    }

    #[test]
    fn percentage_reward_builds_candidate() {
        let rule = rule(RewardType::PercentageOff, "10", 1);
        let line = offer_line(1, "7");
        let candidate = rewards::candidate(&rule, &line, 1).unwrap();
        assert!(matches!(
            candidate.value,
            ProductDiscountCandidateValue::Percentage(_)
        ));
    }

    #[test]
    fn fixed_amount_reward_builds_candidate() {
        let rule = rule(RewardType::FixedAmountOff, "5.50", 1);
        let line = offer_line(1, "7");
        let candidate = rewards::candidate(&rule, &line, 1).unwrap();
        assert!(matches!(
            candidate.value,
            ProductDiscountCandidateValue::FixedAmount(_)
        ));
    }

    #[test]
    fn fixed_price_reward_builds_capped_target() {
        let rule = rule(RewardType::FixedPrice, "15", 1);
        let line = offer_line(3, "7");
        let candidate = rewards::candidate(&rule, &line, 1).unwrap();
        assert!(matches!(
            candidate.value,
            ProductDiscountCandidateValue::FixedAmount(_)
        ));
        let ProductDiscountCandidateTarget::CartLine(target) = &candidate.targets[0];
        assert_eq!(target.quantity, Some(1));
    }
}
