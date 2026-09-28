use crate::json::{canonical, digest, stringify, Result};
use serde_json::{json, Value};

const NETWORK: &str = "eip155:5042002";
const USDC: &str = "0x3600000000000000000000000000000000000000";
const GATEWAY: &str = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

pub(crate) fn field<'a>(value: &'a Value, key: &str) -> Result<&'a Value> {
    value.get(key).ok_or_else(|| format!("missing {key}"))
}
pub(crate) fn str_field<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    field(value, key)?
        .as_str()
        .ok_or_else(|| format!("invalid {key}"))
}
pub(crate) fn obj_keys(value: &Value, expected: &[&str]) -> Result<()> {
    let obj = value.as_object().ok_or("expected JSON object")?;
    if obj.len() != expected.len() || obj.keys().any(|k| !expected.contains(&k.as_str())) {
        return Err("unsupported object fields".into());
    }
    Ok(())
}
fn hex(value: &str, bytes: usize) -> bool {
    value.len() == bytes * 2 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
pub(crate) fn lower_hex(value: &str, bytes: usize) -> bool {
    value.len() == bytes * 2
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn address(v: &str) -> bool {
    v.strip_prefix("0x")
        .is_some_and(|s| hex(s, 20) && s.bytes().any(|b| b != b'0'))
}
fn atomic(s: &str) -> Result<u64> {
    if s.is_empty() || s.starts_with('0') || s.len() > 7 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err("invalid atomic amount".into());
    }
    s.parse::<u64>().map_err(|_| "invalid atomic amount".into())
}
pub(crate) fn micros(value: &Value, exact: bool) -> Result<u64> {
    let n = value.as_f64().ok_or("invalid USDC number")?;
    if !n.is_finite() || n < 0.0 || n > 1_000_000.0 {
        return Err("invalid USDC number".into());
    }
    let rounded = (n * 1_000_000.0).round();
    if exact && (n * 1_000_000.0 - rounded).abs() >= 1e-8 {
        return Err("non-atomic USDC amount".into());
    }
    Ok(rounded as u64)
}
fn normalized_request(value: &Value) -> Result<Value> {
    obj_keys(
        value,
        &[
            "question",
            "budget",
            "researchMode",
            "packageVersion",
            "responseMode",
        ],
    )?;
    let question = str_field(value, "question")?;
    let question = question.trim_matches(js_whitespace);
    if question.is_empty() || question.encode_utf16().count() > 2000 {
        return Err("invalid question".into());
    }
    let budget = micros(field(value, "budget")?, true)?;
    if budget == 0 || budget > 500_000 {
        return Err("invalid creator budget".into());
    }
    let mode = str_field(value, "researchMode")?;
    if !["quick", "deep"].contains(&mode)
        || str_field(value, "packageVersion")? != "1.0.0"
        || str_field(value, "responseMode")? != "async"
    {
        return Err("unsupported request".into());
    }
    Ok(
        json!({"question":question,"budget":field(value,"budget")?,"researchMode":mode,"packageVersion":"1.0.0","responseMode":"async"}),
    )
}
fn js_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000D}' | '\u{0020}' | '\u{00A0}' | '\u{1680}' |
        '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' |
        '\u{3000}' | '\u{FEFF}')
}
fn same_request(a: &Value, b: &Value) -> Result<bool> {
    let a = normalized_request(a)?;
    let b = normalized_request(b)?;
    Ok(stringify(&a)? == stringify(&b)?)
}
fn package(mode: &str) -> Value {
    let (id, attention, rounds, target) = if mode == "quick" {
        ("keryx-quick", 2, 0, 180_000)
    } else {
        ("keryx-deep", 4, 1, 300_000)
    };
    json!({"schema":"urn:keryx:a2a-research-package:1","id":id,"version":"1.0.0","researchMode":mode,
        "execution":{"attentionLimit":attention,"reevaluateRounds":rounds},
        "serviceLevel":{"kind":"provisional_slo","targetCompletionMs":target,"startsAt":"accepted_at","remedy":"none"},
        "quality":{"measurement":"evidence-ledger-v1","groundingThreshold":0.4,"commitment":"best_effort"}})
}
pub(crate) fn package_fingerprint(mode: &str) -> Result<String> {
    // These fixed package keys have identical UTF-16 and localeCompare ordering.
    Ok(digest(&canonical(&package(mode))?)
        .trim_start_matches("sha256:")
        .to_owned())
}
pub(crate) fn valid_digest(s: &str) -> bool {
    s.strip_prefix("sha256:").is_some_and(|x| lower_hex(x, 32))
}
fn valid_uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
pub(crate) fn valid_time(s: &str) -> bool {
    s.ends_with('Z') && chrono::DateTime::parse_from_rfc3339(s).is_ok()
}
pub struct Task {
    pub id: String,
    pub created_at: String,
    pub request: Value,
    pub payee: String,
    pub cap: u64,
}
pub struct Intent {
    pub query_id: String,
    pub amount: u64,
}

pub fn parse_task(task: &Value, request: &Value) -> Result<Task> {
    obj_keys(
        task,
        &[
            "schema",
            "id",
            "createdAt",
            "kind",
            "request",
            "payee",
            "maxTotalMicros",
        ],
    )?;
    if str_field(task, "schema")? != "keryx-operator-task-v1"
        || str_field(task, "kind")? != "paid_research"
    {
        return Err("unsupported task schema".into());
    }
    let id = str_field(task, "id")?;
    let created = str_field(task, "createdAt")?;
    if !valid_uuid(id) || !valid_time(created) {
        return Err("invalid task identity".into());
    }
    let payee = str_field(task, "payee")?;
    if !address(payee) {
        return Err("invalid task payee".into());
    }
    let req = normalized_request(request)?;
    if !same_request(field(task, "request")?, &req)? {
        return Err("task request file mismatch".into());
    }
    let cap = atomic(str_field(task, "maxTotalMicros")?)?;
    if cap > 1_000_000 || cap <= micros(field(&req, "budget")?, true)? {
        return Err("invalid total cap".into());
    }
    Ok(Task {
        id: id.into(),
        created_at: created.into(),
        request: req,
        payee: payee.into(),
        cap,
    })
}
pub fn parse_intent(intent: &Value, task: &Task) -> Result<Intent> {
    obj_keys(
        intent,
        &[
            "schema",
            "request",
            "requirement",
            "authorization",
            "queryId",
        ],
    )?;
    if str_field(intent, "schema")? != "keryx-buyer-intent-v1"
        || !same_request(field(intent, "request")?, &task.request)?
    {
        return Err("journal request mismatch".into());
    }
    let req = field(intent, "requirement")?;
    obj_keys(
        req,
        &[
            "scheme",
            "network",
            "asset",
            "amount",
            "payTo",
            "maxTimeoutSeconds",
            "extra",
        ],
    )?;
    let extra = field(req, "extra")?;
    obj_keys(extra, &["name", "version", "verifyingContract"])?;
    let pay_to = str_field(req, "payTo")?;
    let timeout = field(req, "maxTimeoutSeconds")?
        .as_f64()
        .ok_or("invalid timeout")?;
    if str_field(req, "scheme")? != "exact"
        || str_field(req, "network")? != NETWORK
        || !str_field(req, "asset")?.eq_ignore_ascii_case(USDC)
        || !address(pay_to)
        || !timeout.is_finite()
        || timeout.fract() != 0.0
        || !(604_860.0..=691_200.0).contains(&timeout)
        || str_field(extra, "name")? != "GatewayWalletBatched"
        || str_field(extra, "version")? != "1"
        || !str_field(extra, "verifyingContract")?.eq_ignore_ascii_case(GATEWAY)
    {
        return Err("unsupported payment requirement".into());
    }
    let amount = atomic(str_field(req, "amount")?)?;
    if !pay_to.eq_ignore_ascii_case(&task.payee)
        || amount > task.cap
        || amount <= micros(field(&task.request, "budget")?, true)?
    {
        return Err("journal amount or payee outside task bounds".into());
    }
    let auth = field(intent, "authorization")?;
    obj_keys(
        auth,
        &["from", "to", "value", "validAfter", "validBefore", "nonce"],
    )?;
    let payer = str_field(auth, "from")?;
    let to = str_field(auth, "to")?;
    let nonce = str_field(auth, "nonce")?;
    if !address(payer)
        || !address(to)
        || !to.eq_ignore_ascii_case(pay_to)
        || atomic(str_field(auth, "value")?)? != amount
        || !decimal_string(str_field(auth, "validAfter")?)
        || !decimal_string(str_field(auth, "validBefore")?)
        || !nonce.strip_prefix("0x").is_some_and(|x| lower_hex(x, 32))
    {
        return Err("invalid authorization".into());
    }
    let preimage = format!(
        "keryx-a2a-v2|{NETWORK}|{}|{}|{}",
        payer.to_ascii_lowercase(),
        to.to_ascii_lowercase(),
        nonce.to_ascii_lowercase()
    );
    let expected = format!("a2a_{}", digest(&preimage).trim_start_matches("sha256:"));
    if str_field(intent, "queryId")? != expected {
        return Err("journal authorization/job binding mismatch".into());
    }
    Ok(Intent {
        query_id: expected,
        amount,
    })
}
fn decimal_string(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn package_fingerprints_match_typescript() {
        assert_eq!(
            package_fingerprint("quick").unwrap(),
            "97d169ee73d9bab3034b139d438a51e77cfedca976f1ffb649c148a3d7f2d89a"
        );
        assert_eq!(
            package_fingerprint("deep").unwrap(),
            "3bbbf0c9954c8c7d8a075eb028a71a88819ace0d9230cbc4cd83cc33f0fa65ea"
        );
    }
    #[test]
    fn javascript_whitespace_boundaries() {
        assert!(js_whitespace('\u{FEFF}'));
        assert!(!js_whitespace('\u{0085}'));
    }
}
