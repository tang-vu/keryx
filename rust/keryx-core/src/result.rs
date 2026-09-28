use crate::domain::{
    field, lower_hex, micros, obj_keys, package_fingerprint, str_field, valid_digest, valid_time,
    Intent, Task,
};
use crate::json::{canonical, digest, Result};
use serde_json::{json, Value};

pub fn verify_result(
    task: &Task,
    intent: &Intent,
    snapshot: &Value,
    receipt: &Value,
) -> Result<Value> {
    obj_keys(
        snapshot,
        &[
            "schema",
            "taskId",
            "buyerJobId",
            "savedAt",
            "receiptDigest",
            "receiptFile",
            "answerSha256",
            "packageFingerprint",
            "paymentAtCheck",
            "job",
        ],
    )?;
    let receipt_digest = str_field(snapshot, "receiptDigest")?;
    if str_field(snapshot, "schema")? != "keryx-operator-result-v1"
        || str_field(snapshot, "taskId")? != task.id
        || str_field(snapshot, "buyerJobId")? != intent.query_id
        || !valid_time(str_field(snapshot, "savedAt")?)
        || !valid_digest(receipt_digest)
        || !valid_digest(str_field(snapshot, "answerSha256")?)
        || str_field(snapshot, "receiptFile")? != format!("receipt-{}.json", &receipt_digest[7..])
    {
        return Err("invalid result binding".into());
    }
    let payment = str_field(snapshot, "paymentAtCheck")?;
    if !["seller_reported_settled", "unconfirmed"].contains(&payment) {
        return Err("invalid saved payment observation".into());
    }
    let job = field(snapshot, "job")?;
    validate_job(job)?;
    if str_field(job, "queryId")? != intent.query_id || str_field(job, "status")? != "completed" {
        return Err("wrong completed job".into());
    }
    let answer = str_field(job, "answer")?;
    if digest(answer) != str_field(snapshot, "answerSha256")? {
        return Err("answer digest mismatch".into());
    }
    let mode = str_field(&task.request, "researchMode")?;
    if package_fingerprint(mode)? != str_field(snapshot, "packageFingerprint")? {
        return Err("package fingerprint mismatch".into());
    }
    verify_pricing(field(job, "pricing")?, task, intent)?;
    obj_keys(receipt, &["payload", "integrity"])?;
    let integrity = field(receipt, "integrity")?;
    obj_keys(
        integrity,
        &["algorithm", "canonicalization", "scope", "digest"],
    )?;
    if str_field(integrity, "algorithm")? != "sha256"
        || str_field(integrity, "canonicalization")? != "keryx-json-v1"
        || str_field(integrity, "scope")? != "payload"
        || str_field(integrity, "digest")? != receipt_digest
    {
        return Err("receipt integrity metadata mismatch".into());
    }
    let payload = field(receipt, "payload")?;
    if str_field(payload, "schema")? != "urn:keryx:research-receipt:1"
        || digest(&canonical(payload)?) != receipt_digest
    {
        return Err("receipt digest mismatch".into());
    }
    let dispatch = field(payload, "dispatch")?;
    if str_field(dispatch, "id")? != intent.query_id
        || str_field(dispatch, "question")? != str_field(&task.request, "question")?
        || str_field(dispatch, "answer")? != answer
        || str_field(dispatch, "answerSha256")? != digest(answer)
        || str_field(dispatch, "researchMode")? != mode
        || micros(field(dispatch, "budgetUsdc")?, false)?
            != micros(field(&task.request, "budget")?, true)?
    {
        return Err("receipt dispatch mismatch".into());
    }
    let settlement = field(payload, "settlement")?;
    if str_field(settlement, "mode")? != "real"
        || !str_field(settlement, "ledgerCompleteness").is_ok()
        || field(settlement, "simulatedCreatorUsdc")?.as_f64() != Some(0.0)
        || !receipt_spend_within(settlement, task)?
    {
        return Err("receipt settlement outside bounds".into());
    }
    let citations = field(payload, "citations")
        .ok()
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(64)
                .filter_map(|item| {
                    let marker = item.get("marker")?.as_str()?;
                    let name = item.get("sourceName")?.as_str()?;
                    if marker.encode_utf16().count() > 64 || name.encode_utf16().count() > 256 {
                        None
                    } else {
                        Some(json!({"marker":marker,"sourceName":name}))
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(
        json!({"savedAt":str_field(snapshot,"savedAt")?,"answer":answer,"question":str_field(&task.request,"question")?,
        "citations":citations,"paymentAtCheck":payment,"receiptDigest":receipt_digest,
        "authority":"Local files rechecked against the original task and saved receipt. The original HTTPS digest observation cannot be reauthenticated offline; payment and creator settlement remain seller-reported."}),
    )
}

fn receipt_spend_within(settlement: &Value, task: &Task) -> Result<bool> {
    let settled = finite_nonnegative(field(settlement, "settledCreatorUsdc")?)?;
    let pending = finite_nonnegative(field(settlement, "pendingCreatorUsdc")?)?;
    let sum = settled + pending;
    if !sum.is_finite() {
        return Err("invalid receipt creator spend".into());
    }
    Ok((sum * 1_000_000.0).round() <= micros(field(&task.request, "budget")?, true)? as f64)
}

fn verify_pricing(pricing: &Value, task: &Task, intent: &Intent) -> Result<()> {
    let service = micros(field(pricing, "serviceFeeUsdc")?, false)?;
    let budget = micros(field(pricing, "creatorBudgetUsdc")?, false)?;
    let total = micros(field(pricing, "totalPriceUsdc")?, false)?;
    let spent = micros(field(pricing, "settledCreatorSpendUsdc")?, false)?;
    let pending = micros(field(pricing, "pendingCreatorSpendUsdc")?, false)?;
    let unused = field(pricing, "unusedCreatorReserveUsdc")?;
    if !unused.is_null() {
        finite_nonnegative(unused)?;
    }
    if budget != micros(field(&task.request, "budget")?, true)?
        || total != intent.amount
        || service + budget != total
        || spent + pending > budget
    {
        return Err("job economics mismatch".into());
    }
    Ok(())
}

fn finite_nonnegative(value: &Value) -> Result<f64> {
    let n = value.as_f64().ok_or("invalid nonnegative number")?;
    if !n.is_finite() || n < 0.0 {
        return Err("invalid nonnegative number".into());
    }
    Ok(n)
}
fn ratio(value: &Value) -> Result<()> {
    let n = finite_nonnegative(value)?;
    if n > 1.0 {
        return Err("ratio exceeds one".into());
    }
    Ok(())
}
fn nonnegative_index(value: &Value) -> Result<()> {
    if !value.as_f64().is_some_and(|n| {
        n.is_finite() && n >= 0.0 && n.fract() == 0.0 && n <= 9_007_199_254_740_991.0
    }) {
        return Err("invalid claim index".into());
    }
    Ok(())
}
fn optional_string(value: &Value, key: &str) -> Result<()> {
    if let Some(v) = value.get(key) {
        if !v.is_string() {
            return Err(format!("invalid {key}"));
        }
    }
    Ok(())
}
fn validate_job(job: &Value) -> Result<()> {
    let query = str_field(job, "queryId")?;
    if !query.strip_prefix("a2a_").is_some_and(|x| lower_hex(x, 32)) {
        return Err("invalid job id".into());
    }
    let status = str_field(job, "status")?;
    if ![
        "queued",
        "processing",
        "review_required",
        "completed",
        "failed",
    ]
    .contains(&status)
    {
        return Err("invalid job status".into());
    }
    for key in ["answer", "message", "error"] {
        optional_string(job, key)?;
    }
    if let Some(pricing) = job.get("pricing") {
        for key in [
            "serviceFeeUsdc",
            "creatorBudgetUsdc",
            "totalPriceUsdc",
            "settledCreatorSpendUsdc",
            "pendingCreatorSpendUsdc",
        ] {
            finite_nonnegative(field(pricing, key)?)?;
        }
        let unused = field(pricing, "unusedCreatorReserveUsdc")?;
        if !unused.is_null() {
            finite_nonnegative(unused)?;
        }
        if let Some(v) = pricing.get("accountingComplete") {
            if !v.is_boolean() {
                return Err("invalid accounting completeness".into());
            }
        }
    }
    if let Some(service) = job.get("serviceStatus") {
        for key in ["elapsedMs", "targetCompletionMs"] {
            finite_nonnegative(field(service, key)?)?;
        }
        if !field(service, "targetBreached")?.is_boolean() {
            return Err("invalid service status".into());
        }
    }
    if let Some(service) = job.get("serviceReceipt") {
        for key in ["totalDurationMs", "targetCompletionMs"] {
            finite_nonnegative(field(service, key)?)?;
        }
        if !field(service, "targetMet")?.is_boolean() {
            return Err("invalid service receipt".into());
        }
        if let Some(quality) = service.get("quality") {
            if !["measured", "unavailable"].contains(&str_field(quality, "status")?) {
                return Err("invalid quality status".into());
            }
            let rate = field(quality, "groundedClaimRate")?;
            if !rate.is_null() {
                ratio(rate)?;
            }
        }
    }
    if let Some(rows) = job.get("claimCoverage") {
        for item in rows.as_array().ok_or("invalid claim coverage")? {
            nonnegative_index(field(item, "claimIndex")?)?;
            str_field(item, "claim")?;
            ratio(field(item, "coverage")?)?;
        }
    }
    if let Some(rows) = job.get("evidence") {
        for item in rows.as_array().ok_or("invalid evidence")? {
            nonnegative_index(field(item, "claimIndex")?)?;
            str_field(item, "sourceName")?;
            str_field(item, "quote")?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Task, Intent, Value, Value) {
        let request = json!({"question":"Résumé 😀","budget":0.02,"researchMode":"quick","packageVersion":"1.0.0","responseMode":"async"});
        let task = Task {
            id: "12345678-1234-4234-8234-123456789abc".into(),
            created_at: "2026-09-28T00:00:00.000Z".into(),
            request,
            payee: "0x1111111111111111111111111111111111111111".into(),
            cap: 30_000,
        };
        let intent = Intent {
            query_id: format!("a2a_{}", "a".repeat(64)),
            amount: 30_000,
        };
        let answer = "Evidence\nwith source";
        let payload = json!({"schema":"urn:keryx:research-receipt:1",
            "dispatch":{"id":intent.query_id,"question":"Résumé 😀","answer":answer,"answerSha256":digest(answer),"budgetUsdc":0.02,"researchMode":"quick"},
            "settlement":{"mode":"real","ledgerCompleteness":"complete","settledCreatorUsdc":0.01,"pendingCreatorUsdc":0.005,"simulatedCreatorUsdc":0},
            "citations":[{"marker":"[1]","sourceName":"Creator"}]});
        let rd = digest(&canonical(&payload).unwrap());
        let receipt = json!({"payload":payload,"integrity":{"algorithm":"sha256","canonicalization":"keryx-json-v1","scope":"payload","digest":rd}});
        let snapshot = json!({"schema":"keryx-operator-result-v1","taskId":task.id,"buyerJobId":intent.query_id,
            "savedAt":"2026-09-28T01:00:00.000Z","receiptDigest":rd,"receiptFile":format!("receipt-{}.json",&rd[7..]),
            "answerSha256":digest(answer),"packageFingerprint":package_fingerprint("quick").unwrap(),
            "paymentAtCheck":"seller_reported_settled","job":{"queryId":intent.query_id,"status":"completed","answer":answer,
            "pricing":{"serviceFeeUsdc":0.01,"creatorBudgetUsdc":0.02,"totalPriceUsdc":0.03,
                "settledCreatorSpendUsdc":0.01,"pendingCreatorSpendUsdc":0.005,"unusedCreatorReserveUsdc":0.005}}});
        (task, intent, snapshot, receipt)
    }
    #[test]
    fn verified_local_result_has_limited_authority() {
        let (task, intent, snapshot, receipt) = fixture();
        let value = verify_result(&task, &intent, &snapshot, &receipt).unwrap();
        assert_eq!(value["answer"], "Evidence\nwith source");
        assert_eq!(value["citations"][0]["sourceName"], "Creator");
        assert!(value["authority"]
            .as_str()
            .unwrap()
            .contains("cannot be reauthenticated offline"));
    }
    #[test]
    fn rejects_corrupt_answer_receipt_binding_and_amounts() {
        let (task, intent, snapshot, receipt) = fixture();
        let mut bad = snapshot.clone();
        bad["job"]["answer"] = json!("tampered");
        assert!(verify_result(&task, &intent, &bad, &receipt).is_err());
        let mut bad = receipt.clone();
        bad["payload"]["dispatch"]["question"] = json!("other");
        assert!(verify_result(&task, &intent, &snapshot, &bad).is_err());
        let mut bad = snapshot.clone();
        bad["buyerJobId"] = json!(format!("a2a_{}", "b".repeat(64)));
        assert!(verify_result(&task, &intent, &bad, &receipt).is_err());
        let mut bad = snapshot.clone();
        bad["job"]["pricing"]["totalPriceUsdc"] = json!(0.04);
        assert!(verify_result(&task, &intent, &bad, &receipt).is_err());
        let mut bad = receipt.clone();
        bad["payload"]["settlement"]["pendingCreatorUsdc"] = json!(0.02);
        bad["integrity"]["digest"] = json!(digest(&canonical(&bad["payload"]).unwrap()));
        assert!(verify_result(&task, &intent, &snapshot, &bad).is_err());
    }
}
