use crate::{
    domain::{normalized_request, parse_task},
    json::{stringify_pretty, Result, Value},
};

const MAX_TASK_FILE_BYTES: usize = 8_192;

/// Validated, immutable v1 file contents. The caller remains responsible for
/// choosing a private target and implementing exclusive durable publication.
#[derive(Debug)]
pub struct PreparedTaskV1 {
    task_id: String,
    request_json: String,
    task_json: String,
}

impl PreparedTaskV1 {
    pub fn task_id(&self) -> &str {
        &self.task_id
    }

    pub fn request_json(&self) -> &str {
        &self.request_json
    }

    pub fn task_json(&self) -> &str {
        &self.task_json
    }
}

/// Pure preparation of the two files written by TypeScript createOperatorTask.
/// Identity and time are injected; this function does no I/O or generation.
pub fn prepare_task_v1(
    request: &Value,
    payee: &str,
    max_total_micros: &str,
    id: &str,
    created_at: &str,
) -> Result<PreparedTaskV1> {
    prepare_task_for_network(
        request,
        payee,
        max_total_micros,
        id,
        created_at,
        "eip155:5042002",
    )
}

/// Explicit rail for new task preparation. Legacy v1 bytes remain testnet-only;
/// mainnet v2 persists its network before any purchase can be handed off.
pub fn prepare_task_for_network(
    request: &Value,
    payee: &str,
    max_total_micros: &str,
    id: &str,
    created_at: &str,
    network: &str,
) -> Result<PreparedTaskV1> {
    if !["eip155:5042002", "eip155:5042"].contains(&network) {
        return Err("unsupported task network".into());
    }
    // The accepted v1 datetime grammar permits an arbitrarily long fraction,
    // and this public API can receive oversized invalid strings directly.
    // No scalar this large can fit the task file, so reject before cloning.
    if [payee, max_total_micros, id, created_at]
        .iter()
        .any(|value| value.len() > MAX_TASK_FILE_BYTES)
    {
        return Err("task request or metadata exceeds 8 KB".into());
    }
    let request = normalized_request(request)?;
    let mut fields = vec![
        (
            "schema",
            if network == "eip155:5042" {
                "keryx-operator-task-v2"
            } else {
                "keryx-operator-task-v1"
            }
            .into(),
        ),
        ("id", id.into()),
        ("createdAt", created_at.into()),
        ("kind", "paid_research".into()),
        ("request", request.clone()),
        ("payee", payee.into()),
        ("maxTotalMicros", max_total_micros.into()),
    ];
    if network == "eip155:5042" {
        fields.push(("network", network.into()));
    }
    let task = Value::object(fields);
    // Reuse the same identity, address, cap, and request binding validator as
    // read-only inspection instead of maintaining a second admission policy.
    let parsed = parse_task(&task, &request)?;
    let request_json = format!("{}\n", stringify_pretty(&request)?);
    let task_json = format!("{}\n", stringify_pretty(&task)?);
    if request_json.len() > MAX_TASK_FILE_BYTES || task_json.len() > MAX_TASK_FILE_BYTES {
        return Err("task request or metadata exceeds 8 KB".into());
    }
    Ok(PreparedTaskV1 {
        task_id: parsed.id,
        request_json,
        task_json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::parse;

    const PAYEE: &str = "0x1111111111111111111111111111111111111111";
    const ID: &str = "00000000-0000-4000-8000-000000000001";
    const TIME: &str = "2026-09-29T01:02:03.004Z";

    fn request(question: &str, budget: &str) -> Value {
        parse(&format!(
            r#"{{"question":{question},"budget":{budget},"researchMode":"quick","packageVersion":"1.0.0","responseMode":"async"}}"#
        ))
        .unwrap()
    }

    fn prepare(request: &Value) -> Result<PreparedTaskV1> {
        prepare_task_v1(request, PAYEE, "500001", ID, TIME)
    }

    #[test]
    fn prepares_ordered_pretty_files_with_trim_and_lossless_unicode() {
        let value = request(r#"" \ud800é😀  ""#, "0.5");
        let prepared = prepare(&value).unwrap();
        assert_eq!(prepared.task_id(), ID);
        assert_eq!(
            prepared.request_json(),
            "{\n  \"question\": \"\\ud800é😀\",\n  \"budget\": 0.5,\n  \"researchMode\": \"quick\",\n  \"packageVersion\": \"1.0.0\",\n  \"responseMode\": \"async\"\n}\n"
        );
        assert_eq!(
            prepared.task_json(),
            format!(
                "{{\n  \"schema\": \"keryx-operator-task-v1\",\n  \"id\": \"{ID}\",\n  \"createdAt\": \"{TIME}\",\n  \"kind\": \"paid_research\",\n  \"request\": {},\n  \"payee\": \"{PAYEE}\",\n  \"maxTotalMicros\": \"500001\"\n}}\n",
                prepared.request_json().trim_end().replace('\n', "\n  ")
            )
        );
        assert_eq!(
            parse(prepared.request_json()).unwrap()["question"].as_str(),
            None
        );
        assert!(parse(prepared.task_json()).is_ok());
    }

    #[test]
    fn validates_shared_budget_cap_identity_and_payee_rules() {
        let ordinary = request(r#""synthetic""#, "0.000001");
        assert!(prepare(&ordinary).is_ok());
        assert_eq!(
            prepare(&request(r#""synthetic""#, "0.500000000000001")).unwrap_err(),
            "invalid creator budget"
        );
        assert!(prepare(&request(r#""synthetic""#, "1e-15"))
            .unwrap_err()
            .contains("rounds to zero micro-USDC"));
        assert!(prepare_task_v1(&ordinary, PAYEE, "1", ID, TIME).is_err());
        assert!(prepare_task_v1(&ordinary, PAYEE, "1000001", ID, TIME).is_err());
        assert!(prepare_task_v1(
            &ordinary,
            "0x0000000000000000000000000000000000000000",
            "500001",
            ID,
            TIME
        )
        .is_err());
        assert!(prepare_task_v1(&ordinary, PAYEE, "500001", "bad", TIME).is_err());
        assert!(prepare_task_v1(&ordinary, PAYEE, "500001", ID, "2026-09-29 01:02Z").is_err());
    }

    #[test]
    fn checks_each_prepared_file_at_the_8192_byte_boundary() {
        // Escaped controls expand to six bytes but only one UTF-16 unit, so
        // the file bound can be reached without exceeding the question cap.
        let baseline = prepare(&request(r#""x""#, "0.000001")).unwrap();
        let request_base = baseline.request_json().len();
        let task_base = baseline.task_json().len();
        assert!(task_base > request_base);
        let extra = 8_192 - task_base;
        let question = format!(
            "\"x{}{}\"",
            "\\u0001".repeat(extra / 6),
            "a".repeat(extra % 6)
        );
        assert!(1 + extra / 6 + extra % 6 <= 2_000);
        let at = prepare(&request(&question, "0.000001")).unwrap();
        assert_eq!(at.task_json().len(), 8_192);
        assert!(at.request_json().len() < 8_192);
        let over = format!("{}a\"", &question[..question.len() - 1]);
        assert!(prepare(&request(&over, "0.000001"))
            .unwrap_err()
            .contains("exceeds 8 KB"));

        let request_over = request(&format!("\"{}\"", "\\u0001".repeat(1_400)), "0.000001");
        let normalized = normalized_request(&request_over).unwrap();
        assert!(stringify_pretty(&normalized).unwrap().len() + 1 > 8_192);
        assert!(prepare(&request_over).unwrap_err().contains("exceeds 8 KB"));

        let excessive_fraction = format!("2026-09-29T01:02:03.{}Z", "1".repeat(8_192));
        assert!(prepare_task_v1(
            &request(r#""x""#, "0.000001"),
            PAYEE,
            "500001",
            ID,
            &excessive_fraction
        )
        .unwrap_err()
        .contains("exceeds 8 KB"));
        assert!(prepare_task_v1(
            &request(r#""x""#, "0.000001"),
            PAYEE,
            &"9".repeat(8_193),
            ID,
            TIME
        )
        .unwrap_err()
        .contains("exceeds 8 KB"));
    }
}
