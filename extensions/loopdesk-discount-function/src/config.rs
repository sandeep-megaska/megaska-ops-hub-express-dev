use serde_json::{DeserializeOwned, Error, Value};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq)]
pub struct FunctionConfig {
    pub schema_version: u32,
    pub configuration_version: u64,
    pub configuration_hash: String,
    pub rules: Vec<FunctionRule>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct FunctionRule {
    pub schema_version: u32,
    pub rule_id: String,
    pub compilation_version: u64,
    pub status: RuleStatus,
    pub priority: i64,
    pub trigger: TriggerConfig,
    pub offer: OfferConfig,
    pub reward: RewardConfig,
}
#[derive(Clone, Debug, PartialEq)]
pub enum RuleStatus {
    Active,
    Paused,
}
#[derive(Clone, Debug, PartialEq)]
pub enum MatchMode {
    Any,
    All,
}
#[derive(Clone, Debug, PartialEq)]
pub enum RewardType {
    PercentageOff,
    FixedAmountOff,
    FixedPrice,
}
#[derive(Clone, Debug, PartialEq)]
pub struct TriggerConfig {
    pub match_mode: MatchMode,
    pub minimum_quantity: i64,
    pub minimum_cart_subtotal: Option<String>,
    pub source_groups: Vec<SourceGroup>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct SourceGroup {
    pub product_gids: Vec<String>,
    pub unresolved: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct OfferConfig {
    pub product_gid: String,
}
#[derive(Clone, Debug, PartialEq)]
pub struct RewardConfig {
    pub reward_type: RewardType,
    pub value: String,
    pub maximum_quantity: i64,
}

impl FunctionRule {
    pub fn is_executable(&self) -> bool {
        self.schema_version == 1
            && self.compilation_version > 0
            && matches!(self.status, RuleStatus::Active)
            && matches!(self.trigger.match_mode, MatchMode::Any)
    }
}

pub fn parse_config(raw: &str) -> Result<FunctionConfig, Error> {
    serde_json::from_str(raw)
}

impl DeserializeOwned for FunctionConfig {
    fn from_json(value: Value) -> Result<Self, Error> {
        let o = obj(value)?;
        let config = Self {
            schema_version: u32_field(&o, "schemaVersion")?,
            configuration_version: u64_field(&o, "configurationVersion")?,
            configuration_hash: string_field(&o, "configurationHash")?,
            rules: array_field(&o, "rules")?
                .into_iter()
                .map(FunctionRule::from_json)
                .collect::<Result<_, _>>()?,
        };
        if config.schema_version != 1 {
            return Err(Error::custom("unsupported schemaVersion"));
        }
        Ok(config)
    }
}
impl DeserializeOwned for FunctionRule {
    fn from_json(value: Value) -> Result<Self, Error> {
        let o = obj(value)?;
        Ok(Self {
            schema_version: u32_field(&o, "schemaVersion")?,
            rule_id: string_field(&o, "ruleId")?,
            compilation_version: u64_field(&o, "compilationVersion")?,
            status: match string_field(&o, "status")?.as_str() {
                "ACTIVE" => RuleStatus::Active,
                "PAUSED" => RuleStatus::Paused,
                _ => return Err(Error::custom("unsupported status")),
            },
            priority: i64_field_default(&o, "priority", 0)?,
            trigger: TriggerConfig::from_json(field(&o, "trigger")?)?,
            offer: OfferConfig::from_json(field(&o, "offer")?)?,
            reward: RewardConfig::from_json(field(&o, "reward")?)?,
        })
    }
}
impl DeserializeOwned for TriggerConfig {
    fn from_json(value: Value) -> Result<Self, Error> {
        let o = obj(value)?;
        Ok(Self {
            match_mode: match string_field(&o, "matchMode")?.as_str() {
                "ANY" => MatchMode::Any,
                "ALL" => MatchMode::All,
                _ => return Err(Error::custom("unsupported matchMode")),
            },
            minimum_quantity: i64_field(&o, "minimumQuantity")?,
            minimum_cart_subtotal: optional_string_field(&o, "minimumCartSubtotal")?,
            source_groups: array_field_default(&o, "sourceGroups")?
                .into_iter()
                .map(SourceGroup::from_json)
                .collect::<Result<_, _>>()?,
        })
    }
}
impl DeserializeOwned for SourceGroup {
    fn from_json(value: Value) -> Result<Self, Error> {
        let o = obj(value)?;
        Ok(Self {
            product_gids: array_field_default(&o, "productGids")?
                .into_iter()
                .map(string_value)
                .collect::<Result<_, _>>()?,
            unresolved: bool_field_default(&o, "unresolved", false)?,
        })
    }
}
impl DeserializeOwned for OfferConfig {
    fn from_json(value: Value) -> Result<Self, Error> {
        let o = obj(value)?;
        Ok(Self {
            product_gid: string_field(&o, "productGid")?,
        })
    }
}
impl DeserializeOwned for RewardConfig {
    fn from_json(value: Value) -> Result<Self, Error> {
        let o = obj(value)?;
        Ok(Self {
            reward_type: match string_field(&o, "type")?.as_str() {
                "PERCENTAGE_OFF" => RewardType::PercentageOff,
                "FIXED_AMOUNT_OFF" => RewardType::FixedAmountOff,
                "FIXED_PRICE" => RewardType::FixedPrice,
                _ => return Err(Error::custom("unsupported reward type")),
            },
            value: string_field(&o, "value")?,
            maximum_quantity: i64_field(&o, "maximumQuantity")?,
        })
    }
}

fn obj(value: Value) -> Result<BTreeMap<String, Value>, Error> {
    if let Value::Object(o) = value {
        Ok(o)
    } else {
        Err(Error::custom("expected object"))
    }
}
fn field(o: &BTreeMap<String, Value>, k: &str) -> Result<Value, Error> {
    o.get(k)
        .cloned()
        .ok_or_else(|| Error::custom(format!("missing {k}")))
}
fn string_value(v: Value) -> Result<String, Error> {
    if let Value::String(s) = v {
        Ok(s)
    } else {
        Err(Error::custom("expected string"))
    }
}
fn string_field(o: &BTreeMap<String, Value>, k: &str) -> Result<String, Error> {
    string_value(field(o, k)?)
}
fn optional_string_field(o: &BTreeMap<String, Value>, k: &str) -> Result<Option<String>, Error> {
    match o.get(k).cloned().unwrap_or(Value::Null) {
        Value::Null => Ok(None),
        Value::String(s) => Ok(Some(s)),
        _ => Err(Error::custom("expected string or null")),
    }
}
fn i64_field(o: &BTreeMap<String, Value>, k: &str) -> Result<i64, Error> {
    if let Value::Number(n) = field(o, k)? {
        Ok(n)
    } else {
        Err(Error::custom("expected number"))
    }
}
fn i64_field_default(o: &BTreeMap<String, Value>, k: &str, d: i64) -> Result<i64, Error> {
    if o.contains_key(k) {
        i64_field(o, k)
    } else {
        Ok(d)
    }
}
fn u64_field(o: &BTreeMap<String, Value>, k: &str) -> Result<u64, Error> {
    let n = i64_field(o, k)?;
    if n >= 0 {
        Ok(n as u64)
    } else {
        Err(Error::custom("expected unsigned number"))
    }
}
fn u32_field(o: &BTreeMap<String, Value>, k: &str) -> Result<u32, Error> {
    u64_field(o, k)?
        .try_into()
        .map_err(|_| Error::custom("number out of range"))
}
fn bool_field_default(o: &BTreeMap<String, Value>, k: &str, d: bool) -> Result<bool, Error> {
    match o.get(k).cloned().unwrap_or(Value::Bool(d)) {
        Value::Bool(b) => Ok(b),
        _ => Err(Error::custom("expected bool")),
    }
}
fn array_field(o: &BTreeMap<String, Value>, k: &str) -> Result<Vec<Value>, Error> {
    if let Value::Array(a) = field(o, k)? {
        Ok(a)
    } else {
        Err(Error::custom("expected array"))
    }
}
fn array_field_default(o: &BTreeMap<String, Value>, k: &str) -> Result<Vec<Value>, Error> {
    match o.get(k).cloned().unwrap_or(Value::Array(vec![])) {
        Value::Array(a) => Ok(a),
        _ => Err(Error::custom("expected array")),
    }
}
