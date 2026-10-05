use loopdesk_discount_function::cart_lines_discounts_generate_run::cart_lines_discounts_generate_run;
use loopdesk_discount_function::schema;
use shopify_function::run_function_with_input;

fn input(configuration: &str, intent: &str) -> String {
    format!(
        r#"{{
  "cart": {{
    "cost": {{ "subtotalAmount": {{ "amount": "490.0" }} }},
    "paymentIntent": {{ "value": "{intent}" }},
    "lines": [{{
      "id": "gid://shopify/CartLine/1", "quantity": 1,
      "cost": {{ "amountPerQuantity": {{ "amount": "490.0" }} }},
      "promotionRuleId": null, "promotionCompilationVersion": null,
      "merchandise": {{ "__typename": "ProductVariant", "id": "gid://shopify/ProductVariant/1", "product": {{ "id": "gid://shopify/Product/1" }} }}
    }}]
  }},
  "discount": {{ "discountClasses": ["PRODUCT", "ORDER"], "configuration": {configuration} }},
  "shop": {{ "prepaidOffer": {{ "value": "{{\"schemaVersion\":1,\"type\":\"PERCENTAGE\",\"percent\":\"15\",\"maxAmount\":\"0.00\",\"minSubtotal\":\"0.00\"}}" }} }}
}}"#
    )
}

fn order_amount(result: &schema::CartLinesDiscountsGenerateRunResult) -> Option<String> {
    result.operations.iter().find_map(|op| match op {
        schema::CartOperation::OrderDiscountsAdd(add) => add.candidates.first().and_then(|c| match &c.value {
            schema::OrderDiscountCandidateValue::FixedAmount(fixed) => Some(fixed.amount.to_string()),
            _ => None,
        }),
        _ => None,
    })
}

#[test]
fn prepaid_applies_when_promotion_config_is_missing() {
    // Shopify returns null for metafield values over 10,000 bytes.
    let result: schema::CartLinesDiscountsGenerateRunResult =
        run_function_with_input(cart_lines_discounts_generate_run, &input("null", "prepaid")).unwrap();
    assert_eq!(order_amount(&result).as_deref(), Some("73.5"));
}

#[test]
fn prepaid_applies_when_promotion_config_is_malformed() {
    let result: schema::CartLinesDiscountsGenerateRunResult =
        run_function_with_input(cart_lines_discounts_generate_run, &input(r#"{ "value": "{bad" }"#, "prepaid")).unwrap();
    assert_eq!(order_amount(&result).as_deref(), Some("73.5"));
}

#[test]
fn cod_gets_no_discount_without_promotion_config() {
    let result: schema::CartLinesDiscountsGenerateRunResult =
        run_function_with_input(cart_lines_discounts_generate_run, &input("null", "cod")).unwrap();
    assert!(result.operations.is_empty());
}
