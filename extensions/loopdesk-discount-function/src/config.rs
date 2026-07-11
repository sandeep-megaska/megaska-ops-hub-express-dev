use serde::Deserialize;

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionConfig {
    pub schema_version: u32,
    pub configuration_version: u64,
    pub configuration_hash: String,
    #[serde(default)]
    pub rules: Vec<FunctionRule>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionRule {
    pub schema_version: u32,
    pub rule_id: String,
    #[serde(default, deserialize_with = "default_compilation_version")]
    pub compilation_version: u64,
    pub status: RuleStatus,
    #[serde(default)]
    pub priority: i64,
    pub trigger: TriggerConfig,
    pub offer: OfferConfig,
    pub reward: RewardConfig,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuleStatus {
    Active,
    Paused,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MatchMode {
    Any,
    All,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RewardType {
    PercentageOff,
    FixedAmountOff,
    FixedPrice,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerConfig {
    #[serde(rename = "matchMode")]
    pub match_mode: MatchMode,
    pub minimum_quantity: i64,
    pub minimum_cart_subtotal: Option<String>,
    #[serde(default)]
    pub source_groups: Vec<SourceGroup>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceGroup {
    #[serde(default)]
    pub product_gids: Vec<String>,
    #[serde(default)]
    pub unresolved: bool,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferConfig {
    pub product_gid: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewardConfig {
    #[serde(rename = "type")]
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

pub fn parse_config(raw: &str) -> Result<FunctionConfig, ()> {
    let config: FunctionConfig = serde_json::from_str(raw).map_err(|_| ())?;
    if config.schema_version != 1 {
        return Err(());
    }
    Ok(config)
}

fn default_compilation_version<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<u64>::deserialize(deserializer)?.unwrap_or(1))
}
