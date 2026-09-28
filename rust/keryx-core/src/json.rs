use rustpython_wtf8::Wtf8Chunk;
use sha2::{Digest, Sha256};

mod value;
pub use value::{parse, JsString, Value};

pub type Result<T> = std::result::Result<T, String>;

pub fn digest(input: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(input.as_bytes()))
}
pub fn digest_js(input: &JsString) -> String {
    // Node's UTF-8 string encoding replaces lone surrogates with U+FFFD.
    digest(&input.to_string_lossy())
}

fn js_number(value: f64, canonical: bool) -> Result<String> {
    if !value.is_finite() {
        return if canonical {
            Err("non-finite number is not canonical JSON".into())
        } else {
            Ok("null".into())
        };
    }
    Ok(ryu_js::Buffer::new().format_finite(value).to_owned())
}

fn js_string(value: &JsString) -> String {
    if let Some(scalar) = value.as_str() {
        return serde_json::to_string(scalar).expect("UTF-8 string serialization");
    }
    let mut out = String::from("\"");
    let mut high = None;
    for chunk in value.0.chunks() {
        match chunk {
            Wtf8Chunk::Utf8(scalar) => {
                if let Some(unit) = high.take() {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
                let escaped = serde_json::to_string(scalar).expect("UTF-8 segment serialization");
                out.push_str(&escaped[1..escaped.len() - 1]);
            }
            Wtf8Chunk::Surrogate(code) => {
                let unit = code.to_u32() as u16;
                if let Some(previous) = high.take() {
                    if (0xdc00..=0xdfff).contains(&unit) {
                        let combined =
                            0x10000 + (((previous - 0xd800) as u32) << 10) + (unit - 0xdc00) as u32;
                        let escaped =
                            serde_json::to_string(&char::from_u32(combined).unwrap().to_string())
                                .expect("paired surrogate serialization");
                        out.push_str(&escaped[1..escaped.len() - 1]);
                        continue;
                    }
                    out.push_str(&format!("\\u{previous:04x}"));
                }
                if (0xd800..=0xdbff).contains(&unit) {
                    high = Some(unit);
                } else {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
        }
    }
    if let Some(unit) = high {
        out.push_str(&format!("\\u{unit:04x}"));
    }
    out.push('"');
    out
}

fn index_key(key: &JsString) -> Option<u32> {
    let key = key.as_str()?;
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
    emit(value, false, 0)
}

/// Node JSON.stringify(value, null, 2), without the writer's final newline.
/// Uses the same lossless string and binary64 spelling as compact stringify.
pub fn stringify_pretty(value: &Value) -> Result<String> {
    let mut output = String::new();
    emit_pretty(value, 0, &mut output)?;
    Ok(output)
}

fn emit_pretty(value: &Value, depth: usize, out: &mut String) -> Result<()> {
    if depth > value::MAX_DEPTH {
        return Err("JSON output exceeds nesting limit".into());
    }
    match value {
        Value::Array(children) if !children.is_empty() => {
            out.push('[');
            for (index, child) in children.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push('\n');
                out.push_str(&"  ".repeat(depth + 1));
                emit_pretty(child, depth + 1, out)?;
            }
            out.push('\n');
            out.push_str(&"  ".repeat(depth));
            out.push(']');
        }
        Value::Object(entries) if !entries.is_empty() => {
            let mut ordered: Vec<_> = entries.iter().collect();
            ordered.sort_by_key(|(key, _)| index_key(key).map(|n| (0, n)).unwrap_or((1, 0)));
            out.push('{');
            for (index, (key, child)) in ordered.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push('\n');
                out.push_str(&"  ".repeat(depth + 1));
                out.push_str(&js_string(key));
                out.push_str(": ");
                emit_pretty(child, depth + 1, out)?;
            }
            out.push('\n');
            out.push_str(&"  ".repeat(depth));
            out.push('}');
        }
        _ => out.push_str(&emit(value, false, depth)?),
    }
    Ok(())
}

/// Keryx canonical-json-v1: recursively sorted keys using JavaScript UTF-16 order.
pub fn canonical(value: &Value) -> Result<String> {
    emit(value, true, 0)
}

fn emit(value: &Value, sorted: bool, depth: usize) -> Result<String> {
    if depth > value::MAX_DEPTH {
        return Err("JSON output exceeds nesting limit".into());
    }
    match value {
        Value::Null => Ok("null".into()),
        Value::Bool(v) => Ok(v.to_string()),
        Value::Number(v) => js_number(*v, sorted),
        Value::String(v) => Ok(js_string(v)),
        Value::Array(v) => Ok(format!(
            "[{}]",
            v.iter()
                .map(|x| emit(x, sorted, depth + 1))
                .collect::<Result<Vec<_>>>()?
                .join(",")
        )),
        Value::Object(v) => {
            let mut entries: Vec<_> = v.iter().collect();
            if sorted {
                entries.sort_by(|a, b| a.0.utf16_units().cmp(b.0.utf16_units()));
            } else {
                entries.sort_by_key(|(key, _)| index_key(key).map(|n| (0, n)).unwrap_or((1, 0)));
            }
            let mut parts = Vec::with_capacity(entries.len());
            for (key, child) in entries {
                parts.push(format!(
                    "{}:{}",
                    js_string(key),
                    emit(child, sorted, depth + 1)?
                ));
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
        let value = parse("{\"\":1.0,\"😀\":0.000001,\"a\":-0.0}").unwrap();
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
            let v = parse(input).unwrap();
            assert_eq!(canonical(&v).unwrap(), expected, "{input}");
        }
    }

    #[test]
    fn lone_surrogates_and_equivalent_keys_round_trip_without_normalization() {
        let value = parse(r#"{"\uE000":1,"\uD83D\uDE00":2,"\ud800":3,"\uD800":4,"nested":{"unused":"\uDC00"},"text":"x\uD800y","escaped":"\\uD800"}"#).unwrap();
        assert_eq!(
            value.as_object().unwrap().len(),
            6,
            "duplicate key must be last-wins"
        );
        assert_eq!(
            canonical(&value).unwrap(),
            r#"{"escaped":"\\uD800","nested":{"unused":"\udc00"},"text":"x\ud800y","\ud800":4,"😀":2,"":1}"#
        );
        assert_eq!(
            value["text"].as_js_string().unwrap().to_string_lossy(),
            "x�y"
        );
        assert_eq!(
            digest_js(value["text"].as_js_string().unwrap()),
            "sha256:0b37743370331e33808c0dd0167563798a3c324504cf0055d2b0ac81578d2c58"
        );
        assert_eq!(
            stringify(&value).unwrap().matches(r#""\ud800":"#).count(),
            1
        );
        assert_eq!(value["escaped"].as_str(), Some(r"\uD800"));
    }

    #[test]
    fn ordinary_json_orders_index_keys_and_preserves_first_duplicate_position() {
        let input = format!(
            r#"{{"x":1,"10":10,"2":2,"01":1,"0":0,"4294967295":5,"4294967294":4,"x":9,"\ud83d\ude00":"old","{}":"new"}}"#,
            '\u{1f600}'
        );
        let value = parse(&input).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 8);
        assert_eq!(
            stringify(&value).unwrap(),
            format!(
                r#"{{"0":0,"2":2,"10":10,"4294967294":4,"x":9,"01":1,"4294967295":5,"{}":"new"}}"#,
                '\u{1f600}'
            )
        );
        assert_eq!(
            canonical(&value).unwrap(),
            format!(
                r#"{{"0":0,"01":1,"10":10,"2":2,"4294967294":4,"4294967295":5,"x":9,"{}":"new"}}"#,
                '\u{1f600}'
            )
        );
    }

    #[test]
    fn pretty_json_keeps_js_order_and_lossless_surrogates() {
        let value = parse(r#"{"x":"\ud800","2":{"b":true},"1":["é",null]}"#).unwrap();
        assert_eq!(
            stringify_pretty(&value).unwrap(),
            "{\n  \"1\": [\n    \"é\",\n    null\n  ],\n  \"2\": {\n    \"b\": true\n  },\n  \"x\": \"\\ud800\"\n}"
        );
    }

    #[test]
    fn ordinary_json_and_canonical_json_disagree_on_nonfinite_numbers_as_typescript_does() {
        let value = parse(r#"{"n":1e400,"negative":-1e400,"underflow":1e-400}"#).unwrap();
        assert_eq!(value["n"].as_f64(), Some(f64::INFINITY));
        assert_eq!(value["negative"].as_f64(), Some(f64::NEG_INFINITY));
        assert_eq!(
            stringify(&value).unwrap(),
            r#"{"n":null,"negative":null,"underflow":0}"#
        );
        assert!(canonical(&value).unwrap_err().contains("non-finite"));
        assert_eq!(canonical(&parse("-1e-400").unwrap()).unwrap(), "0");
    }

    #[test]
    fn malformed_json_and_resource_bounds_fail_closed() {
        for text in [r#"{"x":"\uZZZZ"}"#, "{\"x\":\"\n\"}", r#"{"x":1,}"#] {
            assert!(parse(text).is_err(), "{text:?}");
        }
        let over_depth = format!(
            "{}0{}",
            "[".repeat(value::MAX_DEPTH + 1),
            "]".repeat(value::MAX_DEPTH + 1)
        );
        assert!(parse(&over_depth).unwrap_err().contains("nesting limit"));
        assert!(parse(&"0".repeat(value::MAX_BYTES + 1))
            .unwrap_err()
            .contains("parser limit"));
        let at_limit = format!(r#"{{"text":"{}"}}"#, "a".repeat(value::MAX_BYTES - 11));
        assert_eq!(at_limit.len(), value::MAX_BYTES);
        assert_eq!(
            parse(&at_limit).unwrap()["text"].as_str().unwrap().len(),
            value::MAX_BYTES - 11
        );
    }

    #[test]
    fn depth_and_node_limits_have_exact_boundaries() {
        let exact_depth = format!(
            "{}0{}",
            "[".repeat(value::MAX_DEPTH),
            "]".repeat(value::MAX_DEPTH)
        );
        assert!(
            parse(&exact_depth).is_ok(),
            "root depth 0, scalar child depth 128"
        );
        let too_deep = format!(
            "{}0{}",
            "[".repeat(value::MAX_DEPTH + 1),
            "]".repeat(value::MAX_DEPTH + 1)
        );
        assert!(parse(&too_deep).unwrap_err().contains("nesting limit"));

        let exact_nodes = format!("[{}0]", "0,".repeat(value::MAX_NODES - 2));
        assert!(
            parse(&exact_nodes).is_ok(),
            "array root plus 199999 numbers"
        );
        let too_many = format!("[{}0]", "0,".repeat(value::MAX_NODES - 1));
        assert!(parse(&too_many).unwrap_err().contains("value limit"));
    }

    #[test]
    #[ignore = "explicit 2 MB worst-shape measurement; run with --ignored --nocapture"]
    fn maximum_receipt_bytes_at_depth_limit_with_mixed_surrogates() {
        use std::time::Instant;
        let wrapper_bytes = 2 * value::MAX_DEPTH + 2;
        let body_bytes = value::MAX_BYTES - wrapper_bytes;
        let body = format!(
            "{}{}",
            "a\\ud800".repeat(body_bytes / 7),
            "a".repeat(body_bytes % 7)
        );
        let json = format!(
            "{}\"{}\"{}",
            "[".repeat(value::MAX_DEPTH),
            body,
            "]".repeat(value::MAX_DEPTH)
        );
        assert_eq!(json.len(), value::MAX_BYTES);
        let started = Instant::now();
        let parsed = parse(&json).unwrap();
        let parsed_in = started.elapsed();
        let emitted = canonical(&parsed).unwrap();
        let emitted_in = started.elapsed() - parsed_in;
        assert_eq!(emitted, json);
        eprintln!(
            "2 MB mixed surrogate at depth 128: parse {parsed_in:?}, canonical {emitted_in:?}"
        );
    }
}
