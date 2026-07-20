use crate::{
    config::{FunctionRule, RewardMethod},
    decimal::Decimal,
    eligibility::Line,
    schema,
};
pub fn candidate(
    rule: &FunctionRule,
    line: &Line,
    quantity: i64,
) -> Option<schema::ProductDiscountCandidate> {
    if quantity <= 0 {
        return None;
    }
    let (method, configured_value, quantity_cap, configured_product_gid) = rule.reward.executable_product()?;
    if quantity_cap <= 0 || (!configured_product_gid.is_empty() && configured_product_gid != rule.offer.product_gid) { return None; }
    let value = match method {
        RewardMethod::Percentage => {
            let v = Decimal::parse(configured_value)?;
            if !v.is_positive() || v > Decimal::parse("100")? {
                return None;
            }
            schema::ProductDiscountCandidateValue::Percentage(schema::Percentage {
                value: v.to_shopify_decimal()?,
            })
        }
        RewardMethod::FixedAmount => {
            let v = Decimal::parse(configured_value)?;
            if !v.is_positive() {
                return None;
            }
            schema::ProductDiscountCandidateValue::FixedAmount(
                schema::ProductDiscountCandidateFixedAmount {
                    amount: v.to_shopify_decimal()?,
                    applies_to_each_item: Some(true),
                },
            )
        }
        RewardMethod::FixedPrice => {
            let fixed = Decimal::parse(configured_value)?;
            if fixed.is_negative() {
                return None;
            }
            let d = line.unit_amount.sub(&fixed)?;
            if !d.is_positive() {
                return None;
            }
            schema::ProductDiscountCandidateValue::FixedAmount(
                schema::ProductDiscountCandidateFixedAmount {
                    amount: d.to_shopify_decimal()?,
                    applies_to_each_item: Some(true),
                },
            )
        }
    };
    let quantity = i32::try_from(quantity).ok()?;
    Some(schema::ProductDiscountCandidate {
        associated_discount_code: None,
        message: Some("LoopDesk promotion".into()),
        prerequisites: None,
        targets: vec![schema::ProductDiscountCandidateTarget::CartLine(
            schema::CartLineTarget {
                id: line.id.clone(),
                quantity: Some(quantity),
            },
        )],
        value,
    })
}
