//! Bounded, feature-gated publication evaluator. Never packaged in keryx-engine.
use keryx_core::{
    parse_json, prepare_task_v1, PrivateParent, PublicationFailure, PublicationState, Value,
};
use std::{
    io::{self, Read, Write},
    path::Path,
};

const MAX_STDIN_BYTES: u64 = 16 * 1024;
const FIELDS: [&str; 7] = [
    "parent",
    "child",
    "request",
    "payee",
    "maxTotalMicros",
    "id",
    "createdAt",
];
const STAGES: [&str; 12] = [
    "before-mkdir",
    "after-mkdir",
    "request-write",
    "request-partial-write",
    "request-sync",
    "request-close",
    "task-write",
    "task-partial-write",
    "task-sync",
    "task-close",
    "directory-sync",
    "verify",
];

fn refused(stage: &'static str, error: impl ToString) -> PublicationFailure {
    PublicationFailure {
        state: PublicationState::RefusedUnchanged,
        stage,
        message: error.to_string(),
    }
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a str, PublicationFailure> {
    value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| refused("input", format!("invalid {name}")))
}

fn run() -> Result<String, PublicationFailure> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let mut fault = None;
    let mut evaluation_owner = false;
    let mut impersonate_self = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--evaluation-current-user-owner" if !evaluation_owner => evaluation_owner = true,
            "--evaluation-impersonate-self" if !impersonate_self => impersonate_self = true,
            "--fail-at" | "--pause-after" if fault.is_none() => {
                let stage = args
                    .get(index + 1)
                    .ok_or_else(|| refused("input", "missing fault stage"))?;
                if !STAGES.contains(&stage.as_str()) {
                    return Err(refused("input", "invalid fault stage"));
                }
                fault = Some((args[index].as_str(), stage.as_str()));
                index += 1;
            }
            _ => return Err(refused("input", "unsupported or duplicate evaluation flag")),
        }
        index += 1;
    }
    #[cfg(not(windows))]
    if evaluation_owner || impersonate_self {
        return Err(refused(
            "input",
            "Windows token evaluation flags are unsupported",
        ));
    }
    let mut bytes = Vec::new();
    io::stdin()
        .take(MAX_STDIN_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| refused("input", e))?;
    if bytes.len() as u64 > MAX_STDIN_BYTES {
        return Err(refused("input", "publication input exceeds 16 KiB"));
    }
    let text = std::str::from_utf8(&bytes).map_err(|e| refused("input", e))?;
    let input = parse_json(text).map_err(|e| refused("input", e))?;
    let entries = input
        .as_object()
        .ok_or_else(|| refused("input", "expected publication object"))?;
    if entries.len() != FIELDS.len()
        || entries
            .iter()
            .any(|(key, _)| !key.as_str().is_some_and(|key| FIELDS.contains(&key)))
    {
        return Err(refused("input", "unsupported publication fields"));
    }
    let parent = field(&input, "parent")?;
    if !Path::new(parent).is_absolute() {
        return Err(refused("parent", "parent must be absolute"));
    }
    let child = field(&input, "child")?;
    let request = input
        .get("request")
        .ok_or_else(|| refused("input", "missing request"))?;
    let prepared = prepare_task_v1(
        request,
        field(&input, "payee")?,
        field(&input, "maxTotalMicros")?,
        field(&input, "id")?,
        field(&input, "createdAt")?,
    )
    .map_err(|e| refused("prepare", e))?;
    #[cfg(windows)]
    if evaluation_owner {
        keryx_core::set_publication_evaluation_default_owner()
            .map_err(|e| refused("evaluation-owner", e))?;
    }
    let selected = PrivateParent::open(Path::new(parent))?;
    #[cfg(windows)]
    if impersonate_self {
        use windows_sys::Win32::Security::{ImpersonateSelf, SecurityImpersonation};
        if unsafe { ImpersonateSelf(SecurityImpersonation) } == 0 {
            return Err(refused(
                "evaluation-impersonation",
                io::Error::last_os_error(),
            ));
        }
    }
    let outcome = selected.publish_with_evaluation_hook(child, &prepared, |stage| {
        if let Some((flag, selected)) = fault {
            if selected == stage {
                if flag == "--fail-at" {
                    return Err(format!("injected {stage} failure"));
                }
                eprintln!("KERYX_PUBLICATION_PAUSED:{stage}");
                io::stderr().flush().map_err(|e| e.to_string())?;
                loop {
                    std::thread::park();
                }
            }
        }
        Ok(())
    });
    #[cfg(windows)]
    if impersonate_self {
        use windows_sys::Win32::Security::RevertToSelf;
        if unsafe { RevertToSelf() } == 0 {
            // The evaluator is a disposable process. Do not continue under an
            // unknown impersonation state after a failed revert.
            std::process::abort();
        }
    }
    let outcome = outcome?;
    serde_json::to_string(&serde_json::json!({"taskId": prepared.task_id(), "child": child, "state": outcome.as_str()}))
        .map_err(|e| refused("output", e))
}

fn main() {
    match run() {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!(
                "{}",
                serde_json::json!({"state": error.state.as_str(), "stage": error.stage, "message": error.message})
            );
            std::process::exit(1);
        }
    }
}
