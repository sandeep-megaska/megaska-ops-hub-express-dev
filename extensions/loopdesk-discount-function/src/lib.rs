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
    use serde_json::json;

    fn cfg(reward: &str) -> String {
        format!(
            r#"{{"schemaVersion":1,"configurationVersion":1,"configurationHash":"h","rules":[{{"schemaVersion":1,"ruleId":"r1","compilationVersion":7,"status":"ACTIVE","priority":1,"trigger":{{"type":"PRODUCT","matchMode":"ANY","minimumQuantity":2,"minimumCartSubtotal":null,"sourceGroups":[{{"sourceReferenceId":"s","sourceType":"PRODUCT","sourceGid":"gid://shopify/Product/1","productGids":["gid://shopify/Product/1"],"unresolved":false}}]}},"offer":{{"productGid":"gid://shopify/Product/2"}},"reward":{reward}}}]}}"#
        )
    }

    fn input_json(
        config: Option<String>,
        classes: Vec<&str>,
        offer_qty: i64,
        version: Option<&str>,
    ) -> serde_json::Value {
        json!({
            "cart": {
                "cost": { "subtotalAmount": { "amount": "100.00" } },
                "lines": [
                    {
                        "id": "t",
                        "quantity": 2,
                        "cost": { "amountPerQuantity": { "amount": "50.00" } },
                        "promotionRuleId": null,
                        "promotionCompilationVersion": null,
                        "merchandise": {
                            "__typename": "ProductVariant",
                            "id": "gid://shopify/ProductVariant/1",
                            "product": { "id": "gid://shopify/Product/1" }
                        }
                    },
                    {
                        "id": "o",
                        "quantity": offer_qty,
                        "cost": { "amountPerQuantity": { "amount": "20.00" } },
                        "promotionRuleId": { "value": "r1" },
                        "promotionCompilationVersion": version.map(|value| json!({ "value": value })),
                        "merchandise": {
                            "__typename": "ProductVariant",
                            "id": "gid://shopify/ProductVariant/2",
                            "product": { "id": "gid://shopify/Product/2" }
                        }
                    }
                ]
            },
            "discount": {
                "discountClasses": classes,
                "configuration": config.map(|value| json!({ "value": value }))
            }
        })
    }

    fn input(
        config: Option<String>,
        classes: Vec<&str>,
        offer_qty: i64,
    ) -> cart_lines_discounts_generate_run::Input {
        serde_json::from_value(input_json(config, classes, offer_qty, Some("7"))).unwrap()
    }

    fn candidates(r: CartLinesDiscountsGenerateRunResult) -> Vec<ProductDiscountCandidate> {
        match r.operations.into_iter().next() {
            Some(CartOperation::ProductDiscountsAdd(o)) => o.candidates,
            _ => vec![],
        }
    }

    #[test]
    fn missing_config_empty() {
        assert!(run(input(None, vec!["PRODUCT"], 1)).operations.is_empty())
    }

    #[test]
    fn malformed_config_empty() {
        assert!(run(input(Some("{bad".into()), vec!["PRODUCT"], 1))
            .operations
            .is_empty())
    }

    #[test]
    fn product_class_absent_returns_empty() {
        assert!(run(input(
            Some(cfg(
                r#"{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":1}"#
            )),
            vec!["ORDER"],
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
                vec!["PRODUCT"],
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
            vec!["PRODUCT"],
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
            vec!["PRODUCT"],
            1,
        )));
        assert!(matches!(
            c[0].value,
            ProductDiscountCandidateValue::FixedAmount(_)
        ))
    }

    #[test]
    fn missing_compilation_version_empty() {
        let config = cfg(r#"{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":1}"#)
            .replace(r#","compilationVersion":7"#, "");
        assert!(run(input(Some(config), vec!["PRODUCT"], 1))
            .operations
            .is_empty())
    }

    #[test]
    fn wrong_compilation_empty() {
        let i: cart_lines_discounts_generate_run::Input = serde_json::from_value(input_json(
            Some(cfg(
                r#"{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":1}"#,
            )),
            vec!["PRODUCT"],
            1,
            Some("8"),
        ))
        .unwrap();
        assert!(run(i).operations.is_empty())
    }

    #[test]
    fn quantity_cap() {
        let c = candidates(run(input(
            Some(cfg(
                r#"{"type":"PERCENTAGE_OFF","value":"10","maximumQuantity":2}"#,
            )),
            vec!["PRODUCT"],
            5,
        )));
        let ProductDiscountCandidateTarget::CartLine(t) = &c[0].targets[0];
        assert_eq!(t.quantity, Some(2))
    }
}
