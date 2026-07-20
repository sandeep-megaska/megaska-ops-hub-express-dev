use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FunctionConfig {
    #[serde(default = "default_contract_version", alias = "version")]
    pub function_contract_version: u32,
    pub schema_version: u32,
    pub configuration_version: u64,
    pub configuration_hash: String,
    pub rules: Vec<FunctionRule>,
}
fn default_contract_version() -> u32 {
    1
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuleStatus {
    Active,
    Paused,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MatchMode {
    Any,
    All,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RewardType {
    PercentageOff,
    FixedAmountOff,
    FixedPrice,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RewardScope {
    Product,
    Order,
    Shipping,
    StoreCredit,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RewardMethod {
    Percentage,
    FixedAmount,
    FixedPrice,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TriggerConfig {
    #[serde(rename = "type")]
    pub trigger_type: String,
    pub match_mode: MatchMode,
    pub minimum_quantity: i64,
    pub minimum_cart_subtotal: Option<String>,
    pub source_groups: Vec<SourceGroup>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceGroup {
    pub source_reference_id: String,
    pub source_type: String,
    pub source_gid: String,
    pub product_gids: Vec<String>,
    pub unresolved: bool,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OfferConfig {
    pub product_gid: String,

    #[serde(default)]
    pub handle: Option<String>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyRewardConfig {
    #[serde(rename = "type")]
    pub reward_type: RewardType,
    pub value: String,
    pub maximum_quantity: i64,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanonicalProductRewardConfiguration {
    pub value: String,
    pub product_gid: String,
    #[serde(default)]
    pub variant_gid: Option<String>,
    pub quantity_cap: i64,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrderDiscountTier {
    pub id: String,
    pub minimum_subtotal: String,
    #[serde(default)]
    pub maximum_subtotal: Option<String>,
    pub percentage: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TieredOrderPercentageConfiguration {
    pub selection_mode: String,
    pub continuity_mode: String,
    pub basis: String,
    pub tiers: Vec<OrderDiscountTier>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum CanonicalRewardConfiguration {
    Product(CanonicalProductRewardConfiguration),
    Order(TieredOrderPercentageConfiguration),
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanonicalRewardConfig {
    pub scope: RewardScope,
    pub method: RewardMethod,
    pub configuration: CanonicalRewardConfiguration,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum RewardConfig {
    Canonical(CanonicalRewardConfig),
    Legacy(LegacyRewardConfig),
}
impl RewardConfig {
    pub fn executable_product(&self) -> Option<(RewardMethod, &str, i64, &str)> {
        match self {
            Self::Canonical(value) if matches!(value.scope, RewardScope::Product) => {
                match &value.configuration {
                    CanonicalRewardConfiguration::Product(configuration) => Some((
                        value.method.clone(),
                        &configuration.value,
                        configuration.quantity_cap,
                        &configuration.product_gid,
                    )),
                    _ => None,
                }
            }
            Self::Legacy(value) => Some((
                match value.reward_type {
                    RewardType::PercentageOff => RewardMethod::Percentage,
                    RewardType::FixedAmountOff => RewardMethod::FixedAmount,
                    RewardType::FixedPrice => RewardMethod::FixedPrice,
                },
                &value.value,
                value.maximum_quantity,
                "",
            )),
            _ => None,
        }
    }
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
    let cfg: FunctionConfig = serde_json::from_str(raw).map_err(|_| ())?;
    if cfg.schema_version != 1 || !matches!(cfg.function_contract_version, 1 | 2) {
        return Err(());
    }
    Ok(cfg)
}
