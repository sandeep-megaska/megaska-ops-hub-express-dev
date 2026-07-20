use crate::{
    config::{CanonicalRewardConfiguration, FunctionRule, RewardConfig, RewardMethod, RewardScope},
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
    let (method, configured_value, quantity_cap, configured_product_gid) =
        rule.reward.executable_product()?;
    if quantity_cap <= 0
        || (!configured_product_gid.is_empty() && configured_product_gid != rule.offer.product_gid)
    {
        return None;
    }
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

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedOrderRewardCandidate {
    pub source_rule_id: String,
    pub source_tier_id: String,
    pub percentage: Decimal,
    pub priority: i64,
}

pub fn order_candidate(
    rule: &FunctionRule,
    subtotal: &Decimal,
) -> Option<ResolvedOrderRewardCandidate> {
    let RewardConfig::Canonical(reward) = &rule.reward else {
        return None;
    };
    if !matches!(reward.scope, RewardScope::Order)
        || !matches!(reward.method, RewardMethod::Percentage)
    {
        return None;
    }
    let CanonicalRewardConfiguration::Order(configuration) = &reward.configuration else {
        return None;
    };
    if configuration.selection_mode != "highest_eligible"
        || !matches!(
            configuration.continuity_mode.as_str(),
            "continuous" | "allow_gaps"
        )
        || configuration.basis != "eligible_merchandise_subtotal"
        || configuration.tiers.is_empty()
    {
        return None;
    }

    let hundred = Decimal::parse("100")?;
    let zero = Decimal::zero();
    let mut tiers = Vec::with_capacity(configuration.tiers.len());
    let mut tier_ids = std::collections::BTreeSet::new();
    for tier in &configuration.tiers {
        if tier.id.trim().is_empty() || !tier_ids.insert(tier.id.as_str()) {
            return None;
        }
        let minimum = Decimal::parse(&tier.minimum_subtotal)?;
        let maximum = match tier.maximum_subtotal.as_deref() {
            Some(value) => Some(Decimal::parse(value)?),
            None => None,
        };
        let percentage = Decimal::parse(&tier.percentage)?;
        if minimum < zero
            || maximum.as_ref().is_some_and(|v| v <= &minimum)
            || !percentage.is_positive()
            || percentage > hundred
        {
            return None;
        }
        tiers.push((minimum, maximum, percentage, tier.id.as_str()));
    }
    tiers.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.3.cmp(b.3)));
    for index in 0..tiers.len() {
        if index > 0 {
            let previous = &tiers[index - 1];
            let current = &tiers[index];
            let Some(previous_maximum) = &previous.1 else {
                return None;
            };
            if previous.0 == current.0 || previous_maximum > &current.0 {
                return None;
            }
            if configuration.continuity_mode == "continuous" && previous_maximum != &current.0 {
                return None;
            }
        }
    }
    let matches: Vec<_> = tiers
        .iter()
        .filter(|(minimum, maximum, _, _)| {
            subtotal >= minimum && maximum.as_ref().is_none_or(|value| subtotal < value)
        })
        .collect();
    if matches.len() != 1 {
        return None;
    }
    let (_, _, percentage, tier_id) = matches[0];
    Some(ResolvedOrderRewardCandidate {
        source_rule_id: rule.rule_id.clone(),
        source_tier_id: (*tier_id).into(),
        percentage: percentage.clone(),
        priority: rule.priority,
    })
}

pub fn resolve_order_candidate<'a>(
    rules: impl Iterator<Item = &'a FunctionRule>,
    subtotal: &Decimal,
) -> Option<ResolvedOrderRewardCandidate> {
    let mut candidates: Vec<_> = rules
        .filter_map(|rule| order_candidate(rule, subtotal))
        .collect();
    candidates.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then_with(|| b.percentage.cmp(&a.percentage))
            .then_with(|| a.source_rule_id.cmp(&b.source_rule_id))
    });
    candidates.into_iter().next()
}
