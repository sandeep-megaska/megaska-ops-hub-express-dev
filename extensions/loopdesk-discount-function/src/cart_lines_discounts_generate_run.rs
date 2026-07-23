use shopify_function::prelude::*;
use shopify_function::Result;

use crate::{config, eligibility, rewards, schema};

#[shopify_function]
pub fn cart_lines_discounts_generate_run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<schema::CartLinesDiscountsGenerateRunResult> {
    Ok(run(input))
}

pub fn run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> schema::CartLinesDiscountsGenerateRunResult {
    let product_enabled = input
        .discount()
        .discount_classes()
        .iter()
        .any(|c| matches!(c, schema::DiscountClass::Product));
    let order_enabled = input
        .discount()
        .discount_classes()
        .iter()
        .any(|c| matches!(c, schema::DiscountClass::Order));
    if !product_enabled && !order_enabled {
        return empty_result();
    }
    let Some(raw) = input
        .discount()
        .configuration()
        .as_ref()
        .map(|m| m.value().as_str())
        .filter(|v| !v.trim().is_empty())
    else {
        return empty_result();
    };
    let Ok(cfg) = config::parse_config(raw) else {
        return empty_result();
    };
    if cfg.schema_version != 1
        || cfg.configuration_version == 0
        || cfg.configuration_hash.trim().is_empty()
        || cfg.rules.is_empty()
    {
        return empty_result();
    }
    let cart = eligibility::Cart::from_input(&input);
    let mut candidates = Vec::new();
    let mut claimed = std::collections::BTreeSet::new();
    if product_enabled {
        for rule in &cfg.rules {
            if !rule.is_executable() || !eligibility::conditions_met(rule, &cart) {
                continue;
            }
            let allocations = eligibility::allocations(rule, &cart, &claimed);
            for allocation in allocations {
                if let Some(candidate) =
                    rewards::candidate(rule, allocation.line, allocation.quantity)
                {
                    claimed.insert(allocation.line.id.clone());
                    candidates.push(candidate);
                }
            }
        }
    }
    let mut operations = Vec::new();
    if !candidates.is_empty() {
        operations.push(schema::CartOperation::ProductDiscountsAdd(
            schema::ProductDiscountsAddOperation {
                selection_strategy: schema::ProductDiscountSelectionStrategy::All,
                candidates,
            },
        ));
    }
    if order_enabled && cfg.function_contract_version == 2 {
        if let Some(order) = cart.subtotal.as_ref().and_then(|subtotal| {
            rewards::resolve_order_candidate(
                cfg.rules.iter().filter(|rule| rule.is_executable()),
                subtotal,
            )
        }) {
            if let Some(value) = order.percentage.to_shopify_decimal() {
                operations.push(schema::CartOperation::OrderDiscountsAdd(
                    schema::OrderDiscountsAddOperation {
                        selection_strategy: schema::OrderDiscountSelectionStrategy::First,
                        candidates: vec![schema::OrderDiscountCandidate {
                            associated_discount_code: None,
                            conditions: None,
                            message: Some("LoopD2C order promotion".into()),
                            targets: vec![schema::OrderDiscountCandidateTarget::OrderSubtotal(
                                schema::OrderSubtotalTarget {
                                    excluded_cart_line_ids: vec![],
                                },
                            )],
                            value: schema::OrderDiscountCandidateValue::Percentage(
                                schema::Percentage { value },
                            ),
                        }],
                    },
                ));
            }
        }
    }
    schema::CartLinesDiscountsGenerateRunResult { operations }
}

fn empty_result() -> schema::CartLinesDiscountsGenerateRunResult {
    schema::CartLinesDiscountsGenerateRunResult { operations: vec![] }
}
