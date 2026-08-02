use shopify_function::prelude::Decimal as ShopifyDecimal;
use std::cmp::Ordering;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Decimal {
    neg: bool,
    units: i128,
}

const SCALE: usize = 6;

impl Decimal {
    pub fn parse(s: &str) -> Option<Self> {
        let s = s.trim();
        if s.is_empty() {
            return None;
        }
        let (neg, body) = match s.as_bytes()[0] {
            b'-' => (true, &s[1..]),
            b'+' => (false, &s[1..]),
            _ => (false, s),
        };
        if body.is_empty() {
            return None;
        }
        let parts: Vec<_> = body.split('.').collect();
        if parts.len() > 2 {
            return None;
        }
        let whole = parts[0];
        let frac = if parts.len() == 2 { parts[1] } else { "" };
        if whole.is_empty() && frac.is_empty() {
            return None;
        }
        if !whole.chars().all(|c| c.is_ascii_digit())
            || !frac.chars().all(|c| c.is_ascii_digit())
            || frac.len() > SCALE
        {
            return None;
        }
        let w: i128 = if whole.is_empty() {
            0
        } else {
            whole.parse().ok()?
        };
        let mut f = frac.to_string();
        while f.len() < SCALE {
            f.push('0');
        }
        let fv: i128 = if f.is_empty() { 0 } else { f.parse().ok()? };
        Some(Self {
            neg,
            units: w.checked_mul(1_000_000)?.checked_add(fv)?,
        })
    }

    pub fn parse_shopify(value: &ShopifyDecimal) -> Option<Self> {
        let value = value.as_f64();
        if !value.is_finite() {
            return None;
        }
        Self::parse(&format!("{value:.6}"))
    }

    pub fn zero() -> Self {
        Self {
            neg: false,
            units: 0,
        }
    }

    pub fn is_positive(&self) -> bool {
        !self.neg && self.units > 0
    }

    pub fn is_negative(&self) -> bool {
        self.neg && self.units > 0
    }

    pub fn sub(&self, other: &Self) -> Option<Self> {
        if self.neg || other.neg {
            return None;
        }
        if self.units <= other.units {
            return None;
        }
        Some(Self {
            neg: false,
            units: self.units - other.units,
        })
    }

    /// Sum of two non-negative decimals (fixed-point, scale 1e6).
    pub fn add(&self, other: &Self) -> Option<Self> {
        if self.neg || other.neg {
            return None;
        }
        Some(Self {
            neg: false,
            units: self.units.checked_add(other.units)?,
        })
    }

    /// `self` * (`percent` / 100), i.e. `percent`% of `self`, truncated to scale
    /// 1e6. Both operands are non-negative fixed-point (scale 1e6).
    pub fn mul_percent(&self, percent: &Self) -> Option<Self> {
        if self.neg || percent.neg {
            return None;
        }
        // units are scaled by 1e6; product is scaled by 1e12. Divide by 1e6 to
        // return to scale 1e6, then by 100 for the percentage.
        let product = self.units.checked_mul(percent.units)?;
        Some(Self {
            neg: false,
            units: product / 1_000_000 / 100,
        })
    }

    /// The smaller of two non-negative decimals (named to avoid clashing with
    /// the `Ord::min` provided method, which takes its args by value).
    pub fn min_with(&self, other: &Self) -> Self {
        if self <= other {
            self.clone()
        } else {
            other.clone()
        }
    }

    pub fn to_shopify(&self) -> String {
        let w = self.units / 1_000_000;
        let mut f = format!("{:06}", self.units % 1_000_000);
        while f.ends_with('0') {
            f.pop();
        }
        if f.is_empty() {
            format!("{}{}", if self.neg && self.units > 0 { "-" } else { "" }, w)
        } else {
            format!(
                "{}{}.{}",
                if self.neg && self.units > 0 { "-" } else { "" },
                w,
                f
            )
        }
    }

    pub fn to_shopify_decimal(&self) -> Option<ShopifyDecimal> {
        let value = self.to_shopify().parse::<f64>().ok()?;
        if !value.is_finite() {
            return None;
        }
        Some(ShopifyDecimal(value))
    }
}

impl Ord for Decimal {
    fn cmp(&self, o: &Self) -> Ordering {
        match (self.neg, o.neg) {
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            (true, true) => o.units.cmp(&self.units),
            (false, false) => self.units.cmp(&o.units),
        }
    }
}

impl PartialOrd for Decimal {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
