pub mod cart_lines_discounts_generate_run;
pub mod config;
pub mod decimal;
pub mod eligibility;
pub mod prepaid;
pub mod rewards;
pub mod schema;

pub use cart_lines_discounts_generate_run::run;

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use crate::{
        config::{
            parse_config, CanonicalRewardConfig, CanonicalRewardConfiguration, FunctionRule,
            LegacyRewardConfig, MatchMode, OfferConfig, OrderDiscountTier, RewardConfig,
            RewardMethod, RewardScope, RewardType, RuleStatus, SourceGroup,
            TieredOrderPercentageConfiguration, TriggerConfig,
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

    fn order_rule(id: &str, priority: i64, tiers: Vec<OrderDiscountTier>) -> FunctionRule {
        let mut value = rule(RewardType::PercentageOff, "10", 1);
        value.rule_id = id.into();
        value.priority = priority;
        value.reward = RewardConfig::Canonical(CanonicalRewardConfig {
            scope: RewardScope::Order,
            method: RewardMethod::Percentage,
            configuration: CanonicalRewardConfiguration::Order(
                TieredOrderPercentageConfiguration {
                    selection_mode: "highest_eligible".into(),
                    continuity_mode: "allow_gaps".into(),
                    basis: "eligible_merchandise_subtotal".into(),
                    tiers,
                },
            ),
        });
        value
    }

    fn tier(id: &str, minimum: &str, maximum: Option<&str>, percentage: &str) -> OrderDiscountTier {
        OrderDiscountTier {
            id: id.into(),
            minimum_subtotal: minimum.into(),
            maximum_subtotal: maximum.map(Into::into),
            percentage: percentage.into(),
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
            payment_intent: None,
        }
    }

    #[test]
    fn prepaid_percentage_offer_computes_the_amount() {
        let offer =
            crate::prepaid::parse(r#"{"schemaVersion":1,"type":"PERCENTAGE","percent":"15"}"#)
                .unwrap();
        let subtotal = Decimal::parse("1390.00").unwrap();
        // 15% of 1390.00 = 208.50
        assert_eq!(
            crate::prepaid::discount_amount(&offer, &subtotal)
                .unwrap()
                .to_shopify(),
            "208.5"
        );
    }

    #[test]
    fn prepaid_offer_respects_cap_and_minimum() {
        // Cap binds: 15% of 1390 = 208.50, capped at 100.
        let capped = crate::prepaid::parse(
            r#"{"schemaVersion":1,"type":"PERCENTAGE","percent":"15","maxAmount":"100"}"#,
        )
        .unwrap();
        assert_eq!(
            crate::prepaid::discount_amount(&capped, &Decimal::parse("1390.00").unwrap())
                .unwrap()
                .to_shopify(),
            "100"
        );
        // Below minimum subtotal: no discount.
        let gated = crate::prepaid::parse(
            r#"{"schemaVersion":1,"type":"PERCENTAGE","percent":"15","minSubtotal":"2000"}"#,
        )
        .unwrap();
        assert!(
            crate::prepaid::discount_amount(&gated, &Decimal::parse("1390.00").unwrap()).is_none()
        );
    }

    #[test]
    fn prepaid_fixed_amount_offer() {
        let offer =
            crate::prepaid::parse(r#"{"schemaVersion":1,"type":"FIXED_AMOUNT","amount":"50"}"#)
                .unwrap();
        assert_eq!(
            crate::prepaid::discount_amount(&offer, &Decimal::parse("1390.00").unwrap())
                .unwrap()
                .to_shopify(),
            "50"
        );
    }

    #[test]
    fn prepaid_malformed_or_wrong_schema_is_ignored() {
        assert!(crate::prepaid::parse("{bad").is_none());
        assert!(crate::prepaid::parse(r#"{"schemaVersion":2,"type":"PERCENTAGE","percent":"15"}"#)
            .is_none());
    }

    #[test]
    fn decimal_add_and_mul_percent() {
        let a = Decimal::parse("139.00").unwrap();
        let b = Decimal::parse("208.50").unwrap();
        assert_eq!(a.add(&b).unwrap().to_shopify(), "347.5");
        assert_eq!(
            Decimal::parse("1390.00")
                .unwrap()
                .mul_percent(&Decimal::parse("10").unwrap())
                .unwrap()
                .to_shopify(),
            "139"
        );
    }

    #[test]
    fn malformed_config_fails_closed() {
        assert!(parse_config("{bad").is_err());
    }

    #[test]
    fn contract_versions_are_explicit_and_unknown_versions_fail_closed() {
        let legacy = include_str!("../../../shared/fixtures/loopdesk-function-configuration.json");
        assert_eq!(parse_config(legacy).unwrap().function_contract_version, 1);
        let v2 = legacy.replacen("{", "{\"functionContractVersion\":2,", 1);
        assert_eq!(parse_config(&v2).unwrap().function_contract_version, 2);
        assert!(parse_config(&v2.replace(
            "\"functionContractVersion\":2",
            "\"functionContractVersion\":3"
        ))
        .is_err());
    }

    #[test]
    fn order_tiers_use_inclusive_minimum_exclusive_maximum_and_gaps() {
        let rule = order_rule(
            "order",
            1,
            vec![
                tier("a", "100", Some("200"), "10"),
                tier("b", "250", None, "20"),
            ],
        );
        assert_eq!(
            rewards::order_candidate(&rule, &Decimal::parse("100").unwrap())
                .unwrap()
                .source_tier_id,
            "a"
        );
        assert!(rewards::order_candidate(&rule, &Decimal::parse("200").unwrap()).is_none());
        assert_eq!(
            rewards::order_candidate(&rule, &Decimal::parse("250").unwrap())
                .unwrap()
                .source_tier_id,
            "b"
        );
    }

    #[test]
    fn malformed_overlapping_and_invalid_percentage_tiers_fail_closed() {
        for tiers in [
            vec![],
            vec![
                tier("a", "0", Some("20"), "10"),
                tier("b", "10", None, "20"),
            ],
            vec![tier("a", "bad", None, "10")],
            vec![tier("a", "0", None, "101")],
        ] {
            assert!(rewards::order_candidate(
                &order_rule("order", 1, tiers),
                &Decimal::parse("10").unwrap()
            )
            .is_none());
        }
    }

    #[test]
    fn order_conflicts_use_priority_benefit_then_public_id() {
        let subtotal = Decimal::parse("100").unwrap();
        let low = order_rule("z", 9, vec![tier("t", "0", None, "50")]);
        let first = order_rule("b", 10, vec![tier("t", "0", None, "10")]);
        let benefit = order_rule("a", 10, vec![tier("t", "0", None, "20")]);
        assert_eq!(
            rewards::resolve_order_candidate([&low, &first, &benefit].into_iter(), &subtotal)
                .unwrap()
                .source_rule_id,
            "a"
        );
        let stable = order_rule("0", 10, vec![tier("t", "0", None, "20")]);
        assert_eq!(
            rewards::resolve_order_candidate([&benefit, &stable].into_iter(), &subtotal)
                .unwrap()
                .source_rule_id,
            "0"
        );
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
