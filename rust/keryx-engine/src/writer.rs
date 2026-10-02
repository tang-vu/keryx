use keryx_core::{
    create_private_workspace, parse_json, prepare_task_for_network, PrivateParent,
    PublicationFailure, Value,
};
use serde_json::{json, Value as Json};
use std::{
    io::{self, Read},
    path::Path,
};

const PROTOCOL: &str = "keryx-task-writer-cli-v1";
const LIMIT: u64 = 16_384;
const CREATE_FIELDS: [&str; 7] = [
    "parent",
    "child",
    "request",
    "payee",
    "maxTotalMicros",
    "id",
    "createdAt",
];
const WORKSPACE_FIELDS: [&str; 2] = ["parent", "child"];

fn failure(operation: &str, state: &str, stage: &str, message: &str) -> Json {
    json!({"protocol": PROTOCOL, "operation": operation, "state": state,
        "stage": stage, "message": message})
}

fn publication_failure(operation: &str, error: PublicationFailure) -> Json {
    let message = match error.state.as_str() {
        "retained_partial" => {
            "Creation is incomplete; inspect the retained directory before retrying"
        }
        "complete_unconfirmed" => {
            "Creation may be complete; inspect the retained directory before retrying"
        }
        _ => match error.stage {
            "parent" => "Selected parent is missing or unsupported",
            "child" => "Unsupported child name",
            "token" => "Windows creator token is unsupported",
            "mkdir" => "Target exists or cannot be created",
            _ => "Creation refused before publication",
        },
    };
    failure(operation, error.state.as_str(), error.stage, message)
}

fn input_error(operation: &str) -> Json {
    failure(
        operation,
        "refused_unchanged",
        "input",
        "Invalid bounded UTF-8 writer input",
    )
}

fn preparation_error(error: &str) -> Json {
    let message = if error.contains("rounds to zero micro-USDC") {
        "Creator budget must be at least one micro-USDC for a new task"
    } else if error == "invalid creator budget" {
        "Creator budget must be positive, at most 0.5 USDC, and whole micro-USDC"
    } else if error == "invalid total cap" {
        "Total cap must exceed the creator budget and be at most 1 USDC"
    } else if error == "task request or metadata exceeds 8 KB" {
        "Task request or metadata exceeds 8 KiB"
    } else {
        "Task input does not meet writer policy"
    };
    failure("create", "refused_unchanged", "prepare", message)
}

fn bounded_input(operation: &str, fields: &[&str]) -> Result<Value, Json> {
    let mut bytes = Vec::new();
    io::stdin()
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| input_error(operation))?;
    if bytes.len() as u64 > LIMIT {
        return Err(input_error(operation));
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| input_error(operation))?;
    let value = parse_json(text).map_err(|_| input_error(operation))?;
    let entries = value.as_object().ok_or_else(|| input_error(operation))?;
    let selected_network = operation == "create"
        && entries
            .iter()
            .any(|(key, _)| key.as_str() == Some("network"));
    if entries.len() != fields.len() + usize::from(selected_network)
        || entries.iter().any(|(key, _)| {
            !key.as_str()
                .is_some_and(|key| fields.contains(&key) || (selected_network && key == "network"))
        })
    {
        return Err(input_error(operation));
    }
    Ok(value)
}

fn field<'a>(value: &'a Value, name: &str, operation: &str) -> Result<&'a str, Json> {
    value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| input_error(operation))
}

fn create() -> Result<Json, Json> {
    let operation = "create";
    let input = bounded_input(operation, &CREATE_FIELDS)?;
    let parent = field(&input, "parent", operation)?;
    let child = field(&input, "child", operation)?;
    let request = input.get("request").ok_or_else(|| input_error(operation))?;
    let prepared = prepare_task_for_network(
        request,
        field(&input, "payee", operation)?,
        field(&input, "maxTotalMicros", operation)?,
        field(&input, "id", operation)?,
        field(&input, "createdAt", operation)?,
        if input.get("network").is_some() {
            field(&input, "network", operation)?
        } else {
            "eip155:5042002"
        },
    )
    .map_err(|error| preparation_error(&error))?;
    let parent = PrivateParent::open(Path::new(parent))
        .map_err(|error| publication_failure(operation, error))?;
    let state = parent
        .publish(child, &prepared)
        .map_err(|error| publication_failure(operation, error))?;
    Ok(
        json!({"protocol": PROTOCOL, "operation": operation, "taskId": prepared.task_id(),
        "child": child, "state": state.as_str()}),
    )
}

fn workspace_create() -> Result<Json, Json> {
    let operation = "workspace-create";
    let input = bounded_input(operation, &WORKSPACE_FIELDS)?;
    let parent = field(&input, "parent", operation)?;
    let child = field(&input, "child", operation)?;
    let state = create_private_workspace(Path::new(parent), child)
        .map_err(|error| publication_failure(operation, error))?;
    Ok(
        json!({"protocol": PROTOCOL, "operation": operation, "child": child,
        "state": state.as_str()}),
    )
}

pub(crate) fn run(args: &[String]) -> Option<Result<Json, Json>> {
    let operation = args.first()?.as_str();
    if !matches!(operation, "writer-protocol" | "create" | "workspace-create") {
        return None;
    }
    if args.len() != 1 {
        return Some(Err(failure(
            operation,
            "refused_unchanged",
            "input",
            "Writer commands accept no flags",
        )));
    }
    Some(match operation {
        "writer-protocol" => Ok(json!({"protocol": PROTOCOL, "engine": "keryx-engine"})),
        "create" => create(),
        "workspace-create" => workspace_create(),
        _ => unreachable!(),
    })
}
