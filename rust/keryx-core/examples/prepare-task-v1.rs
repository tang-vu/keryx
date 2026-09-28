//! Test-only pure bridge for the TypeScript writer's differential corpus.
//! This example is not a task-creation CLI and performs no filesystem writes.
use keryx_core::{parse_json, prepare_task_v1, Value};
use std::io::{self, Read};

const MAX_STDIN_BYTES: u64 = 16 * 1024;
const FIELDS: [&str; 5] = ["request", "payee", "maxTotalMicros", "id", "createdAt"];

fn field<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("invalid {key}"))
}

fn run() -> Result<String, String> {
    let mut bytes = Vec::new();
    io::stdin()
        .take(MAX_STDIN_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "cannot read preparation input")?;
    if bytes.len() as u64 > MAX_STDIN_BYTES {
        return Err("preparation input exceeds 16 KiB".into());
    }
    let input = parse_json(std::str::from_utf8(&bytes).map_err(|_| "invalid UTF-8 input")?)?;
    let entries = input.as_object().ok_or("expected preparation object")?;
    if entries.len() != FIELDS.len()
        || entries
            .iter()
            .any(|(key, _)| !key.as_str().is_some_and(|key| FIELDS.contains(&key)))
    {
        return Err("unsupported preparation fields".into());
    }
    let request = input.get("request").ok_or("missing request")?;
    let prepared = prepare_task_v1(
        request,
        field(&input, "payee")?,
        field(&input, "maxTotalMicros")?,
        field(&input, "id")?,
        field(&input, "createdAt")?,
    )?;
    serde_json::to_string(&serde_json::json!({
        "taskId": prepared.task_id(),
        "requestJson": prepared.request_json(),
        "taskJson": prepared.task_json(),
    }))
    .map_err(|_| "cannot encode preparation output".into())
}

fn main() {
    match run() {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
