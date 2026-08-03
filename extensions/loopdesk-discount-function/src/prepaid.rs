use serde::Deserialize;

use crate::decimal::Decimal;

/// The prepaid ("Pay Online") offer, published server-side to the shop metafield
/// `$app:loopd2c-express/prepaid-offer`. It is authoritative: the Function never
/// trusts a customer-supplied amount, only this metafield plus the (non-amount)
/// `loopd2c_payment_intent` cart attribute as a gate.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrepaidOffer {
    pub schema_version: u32,
    #[serde(rename = "type")]
    pub offer_type: String,
    /// Percent (e.g. "15") for a PERCENTAGE offer.
    #[serde(default)]
    pub percent: Option<String>,
    /// Fixed amount in the store currency for a FIXED_AMOUNT offer.
    #[serde(default)]
    pub amount: Option<String>,
    /// Optional cap on the discount, in store currency. "0"/absent = no cap.
    #[serde(default)]
    pub max_amount: Option<String>,
    /// Minimum order subtotal for the offer to apply, in store currency.
    #[serde(default)]
    pub min_subtotal: Option<String>,
}

pub fn parse(raw: &str) -> Option<PrepaidOffer> {
    serde_json::from_str::<PrepaidOffer>(raw)
        .ok()
        .filter(|o| o.schema_version == 1)
}

/// The prepaid discount amount for the given order subtotal, in store currency,
/// or `None` when the offer does not apply (below minimum, malformed, zero).
pub fn discount_amount(offer: &PrepaidOffer, subtotal: &Decimal) -> Option<Decimal> {
    let min = offer
        .min_subtotal
        .as_deref()
        .and_then(Decimal::parse)
        .unwrap_or_else(Decimal::zero);
    if subtotal < &min {
        return None;
    }

    let raw = match offer.offer_type.as_str() {
        "PERCENTAGE" => {
            let percent = Decimal::parse(offer.percent.as_deref()?)?;
            if !percent.is_positive() {
                return None;
            }
            subtotal.mul_percent(&percent)?
        }
        "FIXED_AMOUNT" => {
            let amount = Decimal::parse(offer.amount.as_deref()?)?;
            if !amount.is_positive() {
                return None;
            }
            amount
        }
        _ => return None,
    };

    let capped = match offer.max_amount.as_deref().and_then(Decimal::parse) {
        Some(cap) if cap.is_positive() => raw.min_with(&cap),
        _ => raw,
    };

    // Never discount more than the subtotal.
    let bounded = capped.min_with(subtotal);
    if bounded.is_positive() {
        Some(bounded)
    } else {
        None
    }
}
