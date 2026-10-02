use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "keryx-writer-cli-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self
            .0
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("keryx-writer-cli-test-"));
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn call(command: &str, args: &[&str], input: &str) -> (bool, Value) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_keryx-engine"))
        .arg(command)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.stderr.is_empty(),
        "writer diagnostic escaped to stderr"
    );
    let text = std::str::from_utf8(&output.stdout).unwrap();
    assert_eq!(text.lines().count(), 1, "writer must emit one JSON line");
    (output.status.success(), serde_json::from_str(text).unwrap())
}

fn assert_refusal(value: &Value, operation: &str, stage: &str) {
    assert_eq!(value["protocol"], "keryx-task-writer-cli-v1");
    assert_eq!(value["operation"], operation);
    assert_eq!(value["state"], "refused_unchanged");
    assert_eq!(value["stage"], stage);
    assert!(value["message"].as_str().is_some_and(|s| !s.is_empty()));
}

fn workspace_input(parent: &Path, child: &str) -> String {
    json!({"parent": parent, "child": child}).to_string()
}

#[test]
fn writer_protocol_and_invalid_input_do_not_touch_tree() {
    let fixture = Fixture::new();
    let (ok, reader) = call("protocol", &[], "");
    assert!(ok);
    assert_eq!(
        reader,
        json!({"protocol":"keryx-readonly-cli-v1","engine":"keryx-engine"})
    );
    let (ok, writer) = call("writer-protocol", &[], "");
    assert!(ok);
    assert_eq!(
        writer,
        json!({"protocol":"keryx-task-writer-cli-v1","engine":"keryx-engine"})
    );
    for (args, input) in [
        (&[][..], "{"),
        (&[][..], "x"),
        (&[][..], "[]"),
        (&["--extra"][..], "{}"),
        (&[][..], &"x".repeat(16_385)),
    ] {
        let (ok, value) = call("workspace-create", args, input);
        assert!(!ok);
        assert_refusal(&value, "workspace-create", "input");
    }
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 0);
}

#[test]
fn real_process_token_controls_workspace_and_task_creation() {
    let fixture = Fixture::new();
    let (ok, workspace) = call(
        "workspace-create",
        &[],
        &workspace_input(&fixture.0, "workspace"),
    );
    if !ok {
        // An elevated Windows process with a non-user default owner is deliberately
        // unsupported. The standard-user positive path is also covered in core tests.
        #[cfg(windows)]
        {
            assert_refusal(&workspace, "workspace-create", "token");
            assert!(!fixture.0.join("workspace").exists());
            return;
        }
        #[cfg(not(windows))]
        panic!("workspace creation refused: {workspace}");
    }
    assert_eq!(
        workspace["state"],
        if cfg!(windows) {
            "windows_visible_entry_unproven"
        } else {
            "unix_synced"
        }
    );
    let parent = fixture.0.join("workspace");
    let input = json!({
        "parent": parent, "child": "task_1",
        "request": {"question":"Synthetic question", "budget":0.000001,
            "researchMode":"quick", "packageVersion":"1.0.0", "responseMode":"async"},
        "payee":"0x1111111111111111111111111111111111111111",
        "maxTotalMicros":"2", "id":"00000000-0000-4000-8000-000000000001",
        "createdAt":"2026-09-29T01:02:03.004Z"
    })
    .to_string();
    let (ok, created) = call("create", &[], &input);
    assert!(ok, "task creation refused: {created}");
    assert_eq!(created["protocol"], "keryx-task-writer-cli-v1");
    assert_eq!(created["operation"], "create");
    assert_eq!(created["taskId"], "00000000-0000-4000-8000-000000000001");
    assert_eq!(created["child"], "task_1");
    assert!(parent.join("task_1/request.json").is_file());
    assert!(parent.join("task_1/task.json").is_file());
    let before = fs::read(parent.join("task_1/task.json")).unwrap();
    let (ok, collision) = call("create", &[], &input);
    assert!(!ok);
    assert_refusal(&collision, "create", "mkdir");
    assert_eq!(fs::read(parent.join("task_1/task.json")).unwrap(), before);
    let (ok, collision) = call(
        "workspace-create",
        &[],
        &workspace_input(&fixture.0, "workspace"),
    );
    assert!(!ok);
    assert_refusal(&collision, "workspace-create", "mkdir");
    assert_eq!(fs::read(parent.join("task_1/task.json")).unwrap(), before);
    let mut mainnet: Value = serde_json::from_str(&input).unwrap();
    mainnet["child"] = json!("mainnet_task");
    mainnet["network"] = json!("eip155:5042");
    let (ok, created_mainnet) = call("create", &[], &mainnet.to_string());
    assert!(ok, "mainnet preparation refused: {created_mainnet}");
    let saved: Value =
        serde_json::from_slice(&fs::read(parent.join("mainnet_task/task.json")).unwrap()).unwrap();
    assert_eq!(saved["schema"], "keryx-operator-task-v2");
    assert_eq!(saved["network"], "eip155:5042");
    let (ok, inspected) = call(
        "status",
        &["--state", parent.join("mainnet_task").to_str().unwrap()],
        "",
    );
    assert!(ok, "mainnet readonly inspection refused: {inspected}");
    assert_eq!(inspected["network"], "eip155:5042");
    mainnet["child"] = json!("wrong_network");
    mainnet["network"] = json!("eip155:1");
    let (ok, refused) = call("create", &[], &mainnet.to_string());
    assert!(!ok);
    assert_refusal(&refused, "create", "prepare");
    assert!(!parent.join("wrong_network").exists());
}
