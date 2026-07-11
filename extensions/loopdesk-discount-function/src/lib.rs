pub mod cart_lines_discounts_generate_run;
pub mod config;

use cart_lines_discounts_generate_run::{
    CartLinesDiscountsGenerateRunResult, DiscountClass, Input,
};
use config::parse_config;

pub fn run(input: Input) -> CartLinesDiscountsGenerateRunResult {
    if !input
        .discount
        .discount_classes
        .iter()
        .any(|discount_class| matches!(discount_class, DiscountClass::Product))
    {
        return empty_result();
    }

    let configuration_value = input
        .discount
        .configuration
        .as_ref()
        .map(|configuration| configuration.value.as_str());

    let _parse_result = parse_config(configuration_value);

    empty_result()
}

fn empty_result() -> CartLinesDiscountsGenerateRunResult {
    CartLinesDiscountsGenerateRunResult { operations: vec![] }
}

#[no_mangle]
pub extern "C" fn cart_lines_discounts_generate_run() {}

#[cfg(test)]
mod tests {
    use super::run;
    use crate::cart_lines_discounts_generate_run::{
        Cart, CartCost, Discount, DiscountClass, Input, Metafield, MoneyV2,
    };

    fn input(discount_classes: Vec<DiscountClass>, configuration: Option<&str>) -> Input {
        Input {
            cart: Cart {
                cost: CartCost {
                    subtotal_amount: MoneyV2 {
                        amount: "0.00".to_string(),
                    },
                },
                lines: vec![],
            },
            discount: Discount {
                discount_classes,
                configuration: configuration.map(|value| Metafield {
                    value: value.to_string(),
                }),
            },
        }
    }

    #[test]
    fn product_class_absent_returns_empty_operations() {
        let result = run(input(vec![DiscountClass::Order], None));
        assert!(result.operations.is_empty());
    }

    #[test]
    fn product_class_present_with_missing_configuration_returns_empty_operations() {
        let result = run(input(vec![DiscountClass::Product], None));
        assert!(result.operations.is_empty());
    }

    #[test]
    fn product_class_present_with_malformed_configuration_returns_empty_operations() {
        let result = run(input(vec![DiscountClass::Product], Some("{not-json")));
        assert!(result.operations.is_empty());
    }

    #[test]
    fn product_class_present_with_valid_empty_configuration_returns_empty_operations() {
        let result = run(input(
            vec![DiscountClass::Product],
            Some(
                r#"{"schemaVersion":1,"configurationVersion":1,"configurationHash":"sha256-value","rules":[]}"#,
            ),
        ));
        assert!(result.operations.is_empty());
    }

    #[test]
    fn empty_cart_returns_empty_operations() {
        let result = run(input(vec![DiscountClass::Product], None));
        assert!(result.operations.is_empty());
    }

    #[test]
    fn identical_input_produces_deterministic_empty_output() {
        let first = input(vec![DiscountClass::Product], None);
        let second = first.clone();
        assert_eq!(run(first), run(second));
    }
}
