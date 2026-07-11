use crate::{
    config::{FunctionRule, RewardType},
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
    let value = match rule.reward.reward_type {
        RewardType::PercentageOff => {
            let v = Decimal::parse(&rule.reward.value)?;
            if !v.is_positive() || v > Decimal::parse("100")? {
                return None;
            }
            schema::ProductDiscountCandidateValue::Percentage(schema::Percentage {
                value: v.to_shopify(),
            })
        }
        RewardType::FixedAmountOff => {
            let v = Decimal::parse(&rule.reward.value)?;
            if !v.is_positive() {
                return None;
            }
            schema::ProductDiscountCandidateValue::FixedAmount(schema::FixedAmount {
                amount: v.to_shopify(),
                applies_to_each_item: true,
            })
        }
        RewardType::FixedPrice => {
            let fixed = Decimal::parse(&rule.reward.value)?;
            if fixed.is_negative() {
                return None;
            }
            let d = line.unit_amount.sub(&fixed)?;
            if !d.is_positive() {
                return None;
            }
            schema::ProductDiscountCandidateValue::FixedAmount(schema::FixedAmount {
                amount: d.to_shopify(),
                applies_to_each_item: true,
            })
        }
    };
    Some(schema::ProductDiscountCandidate {
        message: Some("LoopDesk promotion".into()),
        targets: vec![schema::ProductDiscountCandidateTarget::CartLine(
            schema::CartLineTarget {
                id: line.id.clone(),
                quantity: Some(quantity),
            },
        )],
        value,
    })
}
