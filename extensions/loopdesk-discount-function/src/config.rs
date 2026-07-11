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
pub fn parse_config(raw: &str) -> Result<FunctionConfig, ()> {
    let raw = raw.trim();
    if !raw.starts_with('{') {
        return Err(());
    }
    let schema_version = num(raw, "schemaVersion").ok_or(())? as u32;
    let configuration_version = num(raw, "configurationVersion").ok_or(())?;
    let configuration_hash = string(raw, "configurationHash").ok_or(())?;
    if schema_version != 1 {
        return Err(());
    }
    let rules_src = array(raw, "rules").ok_or(())?;
    let mut rules = Vec::new();
    for obj in objects(&rules_src) {
        rules.push(parse_rule(&obj)?);
    }
    Ok(FunctionConfig {
        schema_version,
        configuration_version,
        configuration_hash,
        rules,
    })
}
fn parse_rule(s: &str) -> Result<FunctionRule, ()> {
    Ok(FunctionRule {
        schema_version: num(s, "schemaVersion").ok_or(())? as u32,
        rule_id: string(s, "ruleId").ok_or(())?,
        compilation_version: num(s, "compilationVersion")
            .unwrap_or_else(|| num(s, "configurationVersion").unwrap_or(1)),
        status: match string(s, "status").ok_or(())?.as_str() {
            "ACTIVE" => RuleStatus::Active,
            "PAUSED" => RuleStatus::Paused,
            _ => return Err(()),
        },
        priority: num_i(s, "priority").unwrap_or(0),
        trigger: TriggerConfig {
            match_mode: match string(section(s, "trigger").ok_or(())?, "matchMode")
                .ok_or(())?
                .as_str()
            {
                "ANY" => MatchMode::Any,
                "ALL" => MatchMode::All,
                _ => return Err(()),
            },
            minimum_quantity: num_i(section(s, "trigger").ok_or(())?, "minimumQuantity")
                .ok_or(())?,
            minimum_cart_subtotal: null_string(
                section(s, "trigger").ok_or(())?,
                "minimumCartSubtotal",
            ),
            source_groups: parse_groups(
                array(section(s, "trigger").ok_or(())?, "sourceGroups").unwrap_or_default(),
            )?,
        },
        offer: OfferConfig {
            product_gid: string(section(s, "offer").ok_or(())?, "productGid").ok_or(())?,
        },
        reward: RewardConfig {
            reward_type: match string(section(s, "reward").ok_or(())?, "type")
                .ok_or(())?
                .as_str()
            {
                "PERCENTAGE_OFF" => RewardType::PercentageOff,
                "FIXED_AMOUNT_OFF" => RewardType::FixedAmountOff,
                "FIXED_PRICE" => RewardType::FixedPrice,
                _ => return Err(()),
            },
            value: string(section(s, "reward").ok_or(())?, "value").ok_or(())?,
            maximum_quantity: num_i(section(s, "reward").ok_or(())?, "maximumQuantity").ok_or(())?,
        },
    })
}
fn parse_groups(src: String) -> Result<Vec<SourceGroup>, ()> {
    Ok(objects(&src)
        .into_iter()
        .map(|g| SourceGroup {
            unresolved: g.contains("\"unresolved\":true"),
            product_gids: strings(array(&g, "productGids").unwrap_or_default()),
        })
        .collect())
}
fn key(s: &str, k: &str) -> Option<usize> {
    s.find(&format!("\"{}\"", k))
        .and_then(|i| s[i..].find(':').map(|c| i + c + 1))
}
fn ws(s: &str, i: usize) -> usize {
    i + s[i..]
        .chars()
        .take_while(|c| c.is_whitespace())
        .map(char::len_utf8)
        .sum::<usize>()
}
fn string(s: &str, k: &str) -> Option<String> {
    let i = ws(s, key(s, k)?);
    let r = s[i..].strip_prefix('"')?;
    Some(r[..r.find('"')?].to_string())
}
fn null_string(s: &str, k: &str) -> Option<String> {
    let i = ws(s, key(s, k)?);
    if s[i..].starts_with("null") {
        None
    } else {
        string(s, k)
    }
}
fn num(s: &str, k: &str) -> Option<u64> {
    num_i(s, k).and_then(|n| if n >= 0 { Some(n as u64) } else { None })
}
fn num_i(s: &str, k: &str) -> Option<i64> {
    let i = ws(s, key(s, k)?);
    let t: String = s[i..]
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '-')
        .collect();
    t.parse().ok()
}
fn array(s: &str, k: &str) -> Option<String> {
    let i = ws(s, key(s, k)?);
    balanced(&s[i..], '[', ']')
}
fn section<'a>(s: &'a str, k: &str) -> Option<&'a str> {
    let i = ws(s, key(s, k)?);
    let end = balanced_end(&s[i..], '{', '}')?;
    Some(&s[i..i + end])
}
fn balanced(s: &str, o: char, c: char) -> Option<String> {
    let end = balanced_end(s, o, c)?;
    Some(s[1..end - 1].to_string())
}
fn balanced_end(s: &str, o: char, c: char) -> Option<usize> {
    if !s.starts_with(o) {
        return None;
    }
    let mut d = 0;
    for (i, ch) in s.char_indices() {
        if ch == o {
            d += 1
        }
        if ch == c {
            d -= 1;
            if d == 0 {
                return Some(i + 1);
            }
        }
    }
    None
}
fn objects(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(p) = s[i..].find('{') {
        let start = i + p;
        if let Some(end) = balanced_end(&s[start..], '{', '}') {
            out.push(s[start..start + end].to_string());
            i = start + end
        } else {
            break;
        }
    }
    out
}
fn strings(s: String) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = s.as_str();
    while let Some(i) = rest.find('"') {
        let r = &rest[i + 1..];
        if let Some(e) = r.find('"') {
            out.push(r[..e].to_string());
            rest = &r[e + 1..]
        } else {
            break;
        }
    }
    out
}
