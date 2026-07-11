pub mod cart_lines_discounts_generate_run;
pub mod config;
pub mod decimal;
pub mod eligibility;
pub mod rewards;
pub mod schema;

pub use cart_lines_discounts_generate_run::run;
#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::*;
    fn cfg(reward: &str) -> String {
        format!(
            r#"{{"schemaVersion":1,"configurationVersion":1,"configurationHash":"h","rules":[{{"schemaVersion":1,"ruleId":"r1","compilationVersion":7,"status":"ACTIVE","priority":1,"trigger":{{"type":"PRODUCT","matchMode":"ANY","minimumQuantity":2,"minimumCartSubtotal":null,"sourceGroups":[{{"sourceReferenceId":"s","sourceType":"PRODUCT","sourceGid":"gid://shopify/Product/1","productGids":["gid://shopify/Product/1"],"unresolved":false}}]}},"offer":{{"productGid":"gid://shopify/Product/2"}},"reward":{reward}}}]}}"#
        )
    }
    fn input(config: Option<String>, classes: Vec<DiscountClass>, offer_qty: i64) -> Input {
        Input {
            cart: Cart {
                cost: CartCost {
                    subtotal_amount: MoneyV2 {
                        amount: "100.00".into(),
                    },
                },
                lines: vec![
                    CartLine {
                        id: "t".into(),
                        quantity: 2,
                        cost: CartLineCost {
                            amount_per_quantity: MoneyV2 {
                                amount: "50.00".into(),
                            },
                        },
                        promotion_rule_id: None,
                        promotion_compilation_version: None,
                        merchandise: Merchandise::ProductVariant {
                            id: "gid://shopify/ProductVariant/1".into(),
                            product: Product {
                                id: "gid://shopify/Product/1".into(),
                            },
                        },
                    },
                    CartLine {
                        id: "o".into(),
                        quantity: offer_qty,
                        cost: CartLineCost {
                            amount_per_quantity: MoneyV2 {
                                amount: "20.00".into(),
                            },
                        },
                        promotion_rule_id: Some(Attribute {
                            value: Some("r1".into()),
                        }),
                        promotion_compilation_version: Some(Attribute {
                            value: Some("7".into()),
                        }),
                        merchandise: Merchandise::ProductVariant {
                            id: "gid://shopify/ProductVariant/2".into(),
                            product: Product {
                                id: "gid://shopify/Product/2".into(),
                            },
                        },
                    },
                ],
            },
            discount: Discount {
                discount_classes: classes,
                configuration: config.map(|value| Metafield { value }),
            },
        }
    }
    fn candidates(r: CartLinesDiscountsGenerateRunResult) -> Vec<ProductDiscountCandidate> {
        match r.operations.into_iter().next() {
            Some(Operation::ProductDiscountsAdd(o)) => o.candidates,
            _ => vec![],
        }
    }
    #[test]
    fn product_class_absent_returns_empty() {
        assert!(run(input(
            Some(cfg(
                r#"{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":1}"#
            )),
            vec![DiscountClass::Order],
            1
        ))
        .operations
        .is_empty())
    }
    #[test]
    fn percentage_success() {
        assert_eq!(
            candidates(run(input(
                Some(cfg(
                    r#"{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":1}"#
                )),
                vec![DiscountClass::Product],
                1
            )))
            .len(),
            1
        )
    }
    #[test]
    fn fixed_amount_success() {
        let c = candidates(run(input(
            Some(cfg(
                r#"{"type":"FIXED_AMOUNT_OFF","value":"5.50","maximumQuantity":1}"#,
            )),
            vec![DiscountClass::Product],
            1,
        )));
        assert!(matches!(
            c[0].value,
            ProductDiscountCandidateValue::FixedAmount(_)
        ))
    }
    #[test]
    fn fixed_price_success() {
        let c = candidates(run(input(
            Some(cfg(
                r#"{"type":"FIXED_PRICE","value":"15","maximumQuantity":1}"#,
            )),
            vec![DiscountClass::Product],
            1,
        )));
        if let ProductDiscountCandidateValue::FixedAmount(f) = &c[0].value {
            assert_eq!(f.amount, "5")
        } else {
            panic!("wrong")
        }
    }
    #[test]
    fn quantity_cap() {
        let c = candidates(run(input(
            Some(cfg(
                r#"{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":2}"#,
            )),
            vec![DiscountClass::Product],
            5,
        )));
        let ProductDiscountCandidateTarget::CartLine(t) = &c[0].targets[0];
        assert_eq!(t.quantity, Some(2))
    }
    #[test]
    fn malformed_config_empty() {
        assert!(
            run(input(Some("{bad".into()), vec![DiscountClass::Product], 1))
                .operations
                .is_empty()
        )
    }
    #[test]
    fn missing_compilation_version_empty() {
        let config = cfg(r#"{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":1}"#)
            .replace(r#","compilationVersion":7"#, "");
        assert!(run(input(Some(config), vec![DiscountClass::Product], 1))
            .operations
            .is_empty())
    }
    #[test]
    fn wrong_compilation_empty() {
        let mut i = input(
            Some(cfg(
                r#"{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":1}"#,
            )),
            vec![DiscountClass::Product],
            1,
        );
        i.cart.lines[1].promotion_compilation_version = Some(Attribute {
            value: Some("8".into()),
        });
        assert!(run(i).operations.is_empty())
    }
    #[test]
    fn unmarked_offer_empty() {
        let mut i = input(
            Some(cfg(
                r#"{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":1}"#,
            )),
            vec![DiscountClass::Product],
            1,
        );
        i.cart.lines[1].promotion_rule_id = None;
        assert!(run(i).operations.is_empty())
    }
}
