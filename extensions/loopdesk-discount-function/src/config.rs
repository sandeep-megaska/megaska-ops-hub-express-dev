const SUPPORTED_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, PartialEq)]
pub struct FunctionConfig {
    pub schema_version: u32,
    pub configuration_version: u64,
    pub configuration_hash: String,
    pub rules: Vec<ConfigValue>,
}

#[derive(Debug, PartialEq)]
pub enum ConfigValue {
    Raw(String),
}

#[derive(Debug, PartialEq)]
pub enum ConfigParseResult {
    Valid(FunctionConfig),
    Missing,
    Malformed,
    UnsupportedSchemaVersion,
    Invalid,
}

pub fn parse_config(value: Option<&str>) -> ConfigParseResult {
    let Some(raw_value) = value else {
        return ConfigParseResult::Missing;
    };
    let trimmed = raw_value.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return ConfigParseResult::Missing;
    }
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return ConfigParseResult::Malformed;
    }

    let Some(schema_version) = unsigned_field(trimmed, "schemaVersion") else {
        return ConfigParseResult::Invalid;
    };
    if schema_version != SUPPORTED_SCHEMA_VERSION as u64 {
        return ConfigParseResult::UnsupportedSchemaVersion;
    }

    let Some(configuration_version) = unsigned_field(trimmed, "configurationVersion") else {
        return ConfigParseResult::Invalid;
    };
    if configuration_version == 0 {
        return ConfigParseResult::Invalid;
    }

    let Some(configuration_hash) = string_field(trimmed, "configurationHash") else {
        return ConfigParseResult::Invalid;
    };
    if configuration_hash.trim().is_empty() {
        return ConfigParseResult::Invalid;
    }

    let Some(rules_source) = array_field(trimmed, "rules") else {
        return ConfigParseResult::Invalid;
    };
    let rules = if rules_source.trim().is_empty() {
        vec![]
    } else {
        vec![ConfigValue::Raw(rules_source.trim().to_string())]
    };

    ConfigParseResult::Valid(FunctionConfig {
        schema_version: SUPPORTED_SCHEMA_VERSION,
        configuration_version,
        configuration_hash,
        rules,
    })
}

fn field_value_start(source: &str, field: &str) -> Option<usize> {
    let needle = format!("\"{field}\"");
    let field_index = source.find(&needle)?;
    let after_field = field_index + needle.len();
    let colon_offset = source[after_field..].find(':')?;
    Some(
        after_field
            + colon_offset
            + 1
            + source[after_field + colon_offset + 1..]
                .chars()
                .take_while(|c| c.is_whitespace())
                .map(char::len_utf8)
                .sum::<usize>(),
    )
}

fn unsigned_field(source: &str, field: &str) -> Option<u64> {
    let start = field_value_start(source, field)?;
    let digits: String = source[start..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse().ok()
}

fn string_field(source: &str, field: &str) -> Option<String> {
    let start = field_value_start(source, field)?;
    let rest = source[start..].strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn array_field(source: &str, field: &str) -> Option<String> {
    let start = field_value_start(source, field)?;
    let rest = source[start..].strip_prefix('[')?;
    let end = rest.find(']')?;
    Some(rest[..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::{parse_config, ConfigParseResult};

    #[test]
    fn missing_metafield_value_is_missing() {
        assert_eq!(parse_config(None), ConfigParseResult::Missing);
    }
    #[test]
    fn blank_metafield_value_is_missing() {
        assert_eq!(parse_config(Some("  \n\t  ")), ConfigParseResult::Missing);
    }
    #[test]
    fn malformed_json_is_malformed() {
        assert_eq!(
            parse_config(Some("{not-json")),
            ConfigParseResult::Malformed
        );
    }
    #[test]
    fn unsupported_schema_version_is_unsupported() {
        assert_eq!(
            parse_config(Some(
                r#"{"schemaVersion":2,"configurationVersion":1,"configurationHash":"sha256-value","rules":[]}"#
            )),
            ConfigParseResult::UnsupportedSchemaVersion
        );
    }
    #[test]
    fn zero_configuration_version_is_invalid() {
        assert_eq!(
            parse_config(Some(
                r#"{"schemaVersion":1,"configurationVersion":0,"configurationHash":"sha256-value","rules":[]}"#
            )),
            ConfigParseResult::Invalid
        );
    }
    #[test]
    fn blank_configuration_hash_is_invalid() {
        assert_eq!(
            parse_config(Some(
                r#"{"schemaVersion":1,"configurationVersion":1,"configurationHash":"   ","rules":[]}"#
            )),
            ConfigParseResult::Invalid
        );
    }
    #[test]
    fn missing_rules_array_is_invalid() {
        assert_eq!(
            parse_config(Some(
                r#"{"schemaVersion":1,"configurationVersion":1,"configurationHash":"sha256-value"}"#
            )),
            ConfigParseResult::Invalid
        );
    }
    #[test]
    fn valid_empty_configuration_is_valid() {
        match parse_config(Some(
            r#"{"schemaVersion":1,"configurationVersion":1,"configurationHash":"sha256-value","rules":[]}"#,
        )) {
            ConfigParseResult::Valid(config) => assert!(config.rules.is_empty()),
            other => panic!("expected valid config, got {other:?}"),
        }
    }
    #[test]
    fn unknown_top_level_field_is_ignored() {
        match parse_config(Some(
            r#"{"schemaVersion":1,"configurationVersion":1,"configurationHash":"sha256-value","rules":[],"futureField":true}"#,
        )) {
            ConfigParseResult::Valid(config) => assert_eq!(config.configuration_version, 1),
            other => panic!("expected valid config, got {other:?}"),
        }
    }
}
