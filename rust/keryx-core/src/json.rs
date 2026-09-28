use serde_json::Value;
use sha2::{Digest, Sha256};

pub type Result<T> = std::result::Result<T, String>;

pub fn digest(input: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(input.as_bytes()))
}

fn js_number(value: &serde_json::Number) -> Result<String> {
    let f = value
        .as_f64()
        .ok_or("JSON number is outside the supported binary64 range")?;
    if !f.is_finite() {
        return Err("non-finite JSON number".into());
    }
    // JSON.parse represents integers and decimals as binary64. The serde_json
    // float_roundtrip parser plus this conversion preserves that number model;
    // ryu-js then emits the ECMAScript spelling used by JSON.stringify.
    Ok(ryu_js::Buffer::new().format_finite(f).to_owned())
}

fn js_string(value: &str) -> Result<String> {
    // serde_json's escape set matches JSON.stringify for Unicode scalar values.
    // The parser rejects unpaired UTF-16 surrogates, which Rust cannot represent.
    serde_json::to_string(value).map_err(|e| e.to_string())
}

fn index_key(key: &str) -> Option<u32> {
    let n: u32 = key.parse().ok()?;
    if n == u32::MAX || n.to_string() != key {
        None
    } else {
        Some(n)
    }
}

/// JSON.stringify order, used for JS journal request comparisons. Zod's strict
/// request schema reconstructs the known fields in declaration order upstream.
pub fn stringify(value: &Value) -> Result<String> {
    emit(value, false)
}

/// Keryx canonical-json-v1: recursively sorted keys using JavaScript UTF-16 order.
pub fn canonical(value: &Value) -> Result<String> {
    emit(value, true)
}

fn emit(value: &Value, sorted: bool) -> Result<String> {
    match value {
        Value::Null => Ok("null".into()),
        Value::Bool(v) => Ok(v.to_string()),
        Value::Number(v) => js_number(v),
        Value::String(v) => js_string(v),
        Value::Array(v) => Ok(format!(
            "[{}]",
            v.iter()
                .map(|x| emit(x, sorted))
                .collect::<Result<Vec<_>>>()?
                .join(",")
        )),
        Value::Object(v) => {
            let mut keys: Vec<_> = v.keys().collect();
            if sorted {
                keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            } else {
                keys.sort_by_key(|key| index_key(key).map(|n| (0, n)).unwrap_or((1, 0)));
            }
            let mut parts = Vec::with_capacity(keys.len());
            for key in keys {
                parts.push(format!("{}:{}", js_string(key)?, emit(&v[key], sorted)?));
            }
            Ok(format!("{{{}}}", parts.join(",")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn utf16_sort_and_number() {
        let value: Value = serde_json::from_str("{\"\":1.0,\"😀\":0.000001,\"a\":-0.0}").unwrap();
        assert_eq!(
            canonical(&value).unwrap(),
            "{\"a\":0,\"😀\":0.000001,\"\":1}"
        );
    }
    #[test]
    fn binary64_number_spelling_matches_javascript() {
        for (input, expected) in [
            ("9007199254740992", "9007199254740992"),
            ("9007199254740993", "9007199254740992"),
            ("18446744073709551615", "18446744073709552000"),
            ("0.0000001", "1e-7"),
            ("1e21", "1e+21"),
            ("1.0000000000000002", "1.0000000000000002"),
            ("2.2250738585072014e-308", "2.2250738585072014e-308"),
            ("5e-324", "5e-324"),
            ("-0.0", "0"),
        ] {
            let v: Value = serde_json::from_str(input).unwrap();
            assert_eq!(canonical(&v).unwrap(), expected, "{input}");
        }
    }
}
