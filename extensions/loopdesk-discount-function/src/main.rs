//! LoopDesk Shopify Discount Function foundation.
//!
//! This recovery restores a Cargo-backed WASM build path while intentionally
//! keeping reward enforcement disabled. The function reads the expected
//! LoopDesk discount configuration metafield defensively and always returns an
//! empty operations list until a later enforcement phase is implemented.

const CONFIG_NAMESPACE: &str = "loopdesk";
const CONFIG_KEY: &str = "discount_function_config";
const EMPTY_OPERATIONS_JSON: &str = r#"{"operations":[]}"#;

/// Contract retained for the Shopify Function input query.
pub fn metafield_contract() -> (&'static str, &'static str) {
    (CONFIG_NAMESPACE, CONFIG_KEY)
}

/// Evaluate a raw function input JSON document.
///
/// Missing, invalid, disabled, and enabled configs all return no discount
/// operations in this phase. The boolean is retained internally so future
/// enforcement can distinguish valid enabled config after this no-op phase.
pub fn cart_lines_discounts_generate_run(input_json: &str) -> &'static str {
    let _config_detected = detect_enabled_config(input_json);
    EMPTY_OPERATIONS_JSON
}

fn detect_enabled_config(input_json: &str) -> bool {
    let Some(metafield_pos) = input_json.find("\"metafield\"") else {
        return false;
    };
    let Some(value_key_relative) = input_json[metafield_pos..].find("\"value\"") else {
        return false;
    };
    let value_key_pos = metafield_pos + value_key_relative;
    let Some(colon_relative) = input_json[value_key_pos..].find(':') else {
        return false;
    };
    let mut chars = input_json[value_key_pos + colon_relative + 1..].chars().peekable();

    while matches!(chars.peek(), Some(c) if c.is_whitespace()) {
        chars.next();
    }

    if chars.next() != Some('"') {
        return false;
    }

    let mut value = String::new();
    let mut escaped = false;
    for ch in chars {
        if escaped {
            value.push(match ch {
                '"' => '"',
                '\\' => '\\',
                '/' => '/',
                'b' => '\u{0008}',
                'f' => '\u{000c}',
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                other => other,
            });
            escaped = false;
            continue;
        }

        match ch {
            '\\' => escaped = true,
            '"' => break,
            other => value.push(other),
        }
    }

    value.contains("\"enabled\":true") || value.contains("\"enabled\": true")
}

/// Export name preserved for Shopify targeting metadata.
///
/// The current foundation does not read from raw host memory directly; Shopify
/// Function ABI integration remains intentionally limited to producing a real
/// WASM artifact from Cargo without enforcing discounts.
#[no_mangle]
pub extern "C" fn cartLinesDiscountsGenerateRun() -> i32 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_metafield_contract() {
        assert_eq!(metafield_contract(), ("loopdesk", "discount_function_config"));
    }

    #[test]
    fn missing_config_returns_empty_operations() {
        assert_eq!(cart_lines_discounts_generate_run(r#"{"cart":{"lines":[]}}"#), EMPTY_OPERATIONS_JSON);
    }

    #[test]
    fn invalid_config_returns_empty_operations() {
        let input = r#"{"discountNode":{"metafield":{"value":"not json"}}}"#;
        assert_eq!(cart_lines_discounts_generate_run(input), EMPTY_OPERATIONS_JSON);
    }

    #[test]
    fn disabled_config_returns_empty_operations() {
        let input = r#"{"discountNode":{"metafield":{"value":"{\"enabled\":false}"}}}"#;
        assert_eq!(cart_lines_discounts_generate_run(input), EMPTY_OPERATIONS_JSON);
    }

    #[test]
    fn enabled_config_still_returns_empty_operations() {
        let input = r#"{"discountNode":{"metafield":{"value":"{\"enabled\":true,\"rules\":[]}"}}}"#;
        assert_eq!(cart_lines_discounts_generate_run(input), EMPTY_OPERATIONS_JSON);
        assert!(detect_enabled_config(input));
    }
}
