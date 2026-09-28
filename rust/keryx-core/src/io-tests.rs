use super::*;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{File, FileTimes},
    io::Write,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

type FileTree = BTreeMap<PathBuf, Vec<u8>>;

fn copy_tree(source: &Path, target: &Path) {
    fs::create_dir_all(target).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let destination = target.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &destination);
        } else {
            assert!(entry.file_type().unwrap().is_file());
            fs::copy(entry.path(), destination).unwrap();
        }
    }
}

fn file_tree(root: &Path) -> FileTree {
    fn walk(root: &Path, dir: &Path, files: &mut FileTree) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_dir() {
                walk(root, &entry.path(), files);
            } else {
                assert!(entry.file_type().unwrap().is_file());
                files.insert(
                    entry.path().strip_prefix(root).unwrap().to_owned(),
                    fs::read(entry.path()).unwrap(),
                );
            }
        }
    }
    let mut files = FileTree::new();
    walk(root, root, &mut files);
    files
}

fn assert_writer_only(
    before: &FileTree,
    after_hook: &FileTree,
    after_read: &FileTree,
    names: &[&str],
) {
    assert_eq!(
        after_read, after_hook,
        "candidate read wrote the fixture after the controlled test writer"
    );
    let changed = before
        .keys()
        .chain(after_hook.keys())
        .filter(|key| before.get(*key) != after_hook.get(*key))
        .cloned()
        .collect::<BTreeSet<_>>();
    let expected = names.iter().map(PathBuf::from).collect::<BTreeSet<_>>();
    assert_eq!(
        changed, expected,
        "test writer changed unexpected source files"
    );
}

static NEXT: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("keryx-read-{}-{nanos}-{id}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn dir(&self) -> Dir {
        checked_dir(&self.0).unwrap()
    }
    fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
#[ignore = "run through scripts/test-rust-inspection-contract.mts with TS-written fixtures"]
fn inter_file_contract_with_ts_written_v1_fixtures() {
    let root = PathBuf::from(
        std::env::var_os("KERYX_TEST_INSPECTION_FIXTURE_ROOT")
            .expect("explicit TS-written inspection fixture root is required"),
    );
    let old = root.join("old");
    let newer = root.join("new");
    let oracle = parse(&fs::read_to_string(root.join("oracle.json")).unwrap()).unwrap();
    for (dir, name) in [(&old, "old"), (&newer, "newer")] {
        let task = LocalTask::open(dir).unwrap();
        assert_eq!(task.status().unwrap(), oracle[name]["status"]);
        assert_eq!(task.result().unwrap().unwrap(), oracle[name]["result"]);
        assert_eq!(
            task.brief().unwrap(),
            oracle[name]["brief"].as_str().unwrap()
        );
    }

    let task_request = root.join("case-task-request");
    copy_tree(&old, &task_request);
    let before = file_tree(&task_request);
    let mut writer_after = None;
    let mismatch = LocalTask::open_with_hook(&task_request, |point| {
        if point == InterReadPoint::Task {
            let path = task_request.join("request.json");
            let mut request: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            request["question"] = "A different question".into();
            fs::write(path, serde_json::to_vec(&request).unwrap()).unwrap();
            writer_after = Some(file_tree(&task_request));
        }
    })
    .err()
    .expect("task/request mutation must refuse");
    assert!(
        mismatch.contains("task request file mismatch"),
        "{mismatch}"
    );
    assert_writer_only(
        &before,
        &writer_after.unwrap(),
        &file_tree(&task_request),
        &["request.json"],
    );

    let request_intent = root.join("case-request-intent");
    copy_tree(&old, &request_intent);
    let before = file_tree(&request_intent);
    let mut writer_after = None;
    let mismatch = LocalTask::open_with_hook(&request_intent, |point| {
        if point == InterReadPoint::Request {
            let path = request_intent.join("buyer").join("intent.json");
            let mut intent: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            intent["request"]["question"] = "A different question".into();
            fs::write(path, serde_json::to_vec(&intent).unwrap()).unwrap();
            writer_after = Some(file_tree(&request_intent));
        }
    })
    .err()
    .expect("request/intent mutation must refuse");
    assert!(mismatch.contains("journal request mismatch"), "{mismatch}");
    assert_writer_only(
        &before,
        &writer_after.unwrap(),
        &file_tree(&request_intent),
        &["buyer/intent.json"],
    );

    let observation = root.join("case-old-observation");
    copy_tree(&root.join("old-observation-no-result"), &observation);
    let task = LocalTask::open(&observation).unwrap();
    assert_eq!(task.status().unwrap(), oracle["oldNoResultStatus"]);
    assert_eq!(oracle["oldNoResultStatus"]["savedResult"], "absent");
    let before = file_tree(&observation);
    let mut writer_after = None;
    let status = task
        .status_with_hook(|point| {
            if point == InterReadPoint::Observation {
                fs::copy(
                    newer.join("last-observation.json"),
                    observation.join("last-observation.json"),
                )
                .unwrap();
                fs::copy(newer.join("result.json"), observation.join("result.json")).unwrap();
                let new_receipt = oracle["newer"]["snapshot"]["receiptFile"].as_str().unwrap();
                fs::copy(
                    newer.join("buyer").join(new_receipt),
                    observation.join("buyer").join(new_receipt),
                )
                .unwrap();
                writer_after = Some(file_tree(&observation));
            }
        })
        .unwrap();
    let mut expected_status = oracle["oldNoResultStatus"].clone();
    expected_status["savedResult"] = "present_unchecked".into();
    assert_eq!(status, expected_status);
    assert_ne!(
        status["lastObservation"]["observedAt"],
        oracle["newer"]["status"]["lastObservation"]["observedAt"]
    );
    assert_eq!(status["savedResult"], "present_unchecked");
    assert_eq!(status["payment"], "unknown");
    assert_eq!(status["delivery"], "unknown");
    assert_eq!(status["lastObservation"]["payment"], "unconfirmed");
    assert!(status["lastObservation"]["authority"]
        .as_str()
        .unwrap()
        .contains("may be stale"));
    assert_eq!(
        LocalTask::open(&observation).unwrap().status().unwrap(),
        oracle["newer"]["status"]
    );
    assert_eq!(
        LocalTask::open(&observation)
            .unwrap()
            .result()
            .unwrap()
            .unwrap(),
        oracle["newer"]["result"]
    );
    assert_writer_only(
        &before,
        &writer_after.unwrap(),
        &file_tree(&observation),
        &[
            "last-observation.json",
            "result.json",
            &format!(
                "buyer/{}",
                oracle["newer"]["snapshot"]["receiptFile"].as_str().unwrap()
            ),
        ],
    );

    let receipt_mismatch = root.join("case-receipt-mismatch");
    copy_tree(&old, &receipt_mismatch);
    let task = LocalTask::open(&receipt_mismatch).unwrap();
    let before = file_tree(&receipt_mismatch);
    let old_receipt = oracle["old"]["snapshot"]["receiptFile"].as_str().unwrap();
    let new_receipt = oracle["newer"]["snapshot"]["receiptFile"].as_str().unwrap();
    let mut writer_after = None;
    let mismatch = task
        .result_with_hook(|point| {
            if point == InterReadPoint::Snapshot {
                fs::copy(
                    newer.join("buyer").join(new_receipt),
                    receipt_mismatch.join("buyer").join(old_receipt),
                )
                .unwrap();
                writer_after = Some(file_tree(&receipt_mismatch));
            }
        })
        .expect_err("old snapshot/new receipt must refuse");
    assert!(
        mismatch.contains("receipt integrity metadata mismatch"),
        "{mismatch}"
    );
    assert_writer_only(
        &before,
        &writer_after.unwrap(),
        &file_tree(&receipt_mismatch),
        &[&format!("buyer/{old_receipt}")],
    );

    let older_result = root.join("case-older-result");
    copy_tree(&old, &older_result);
    let task = LocalTask::open(&older_result).unwrap();
    let before = file_tree(&older_result);
    let mut writer_after = None;
    let returned = task
        .result_with_hook(|point| {
            if point == InterReadPoint::Snapshot {
                fs::copy(
                    newer.join("buyer").join(new_receipt),
                    older_result.join("buyer").join(new_receipt),
                )
                .unwrap();
                fs::copy(newer.join("result.json"), older_result.join("result.json")).unwrap();
                writer_after = Some(file_tree(&older_result));
            }
        })
        .unwrap()
        .unwrap();
    assert_eq!(returned, oracle["old"]["result"]);
    assert_ne!(returned["savedAt"], oracle["newer"]["result"]["savedAt"]);
    assert_ne!(returned["answer"], oracle["newer"]["result"]["answer"]);
    assert_ne!(
        returned["receiptDigest"],
        oracle["newer"]["result"]["receiptDigest"]
    );
    assert_eq!(returned["paymentAtCheck"], "unconfirmed");
    assert!(returned["authority"]
        .as_str()
        .unwrap()
        .contains("Local files rechecked"));
    assert!(returned["authority"]
        .as_str()
        .unwrap()
        .contains("seller-reported"));
    assert_eq!(
        fs::read(older_result.join("result.json")).unwrap(),
        fs::read(newer.join("result.json")).unwrap()
    );
    assert_eq!(
        LocalTask::open(&older_result)
            .unwrap()
            .result()
            .unwrap()
            .unwrap(),
        oracle["newer"]["result"]
    );
    assert_writer_only(
        &before,
        &writer_after.unwrap(),
        &file_tree(&older_result),
        &["result.json", &format!("buyer/{new_receipt}")],
    );
}

#[test]
fn exact_utf8_byte_bounds_for_every_v1_file_class() {
    let fixture = Fixture::new();
    let dir = fixture.dir();
    for (name, limit) in [
        ("task.json", 8192),
        ("request.json", 8192),
        ("last-observation.json", 8192),
        ("intent.json", 65536),
        ("result.json", 150_000),
        ("receipt.json", 2_000_000),
    ] {
        let base = "{\"text\":\"🙂\"}";
        let exact = format!("{base}{}", " ".repeat(limit - base.len()));
        assert_eq!(exact.len(), limit);
        fs::write(fixture.file(name), &exact).unwrap();
        assert_eq!(read_json(&dir, name, limit).unwrap()["text"], "🙂");
        fs::write(fixture.file(name), format!("{exact} ")).unwrap();
        assert!(
            read_json(&dir, name, limit).is_err(),
            "{name} accepted limit+1"
        );
    }
}

#[test]
fn utf8_decoder_matches_typescript_bom_and_malformed_byte_policy() {
    let fixture = Fixture::new();
    let dir = fixture.dir();
    fs::write(fixture.file("request.json"), b"\xef\xbb\xbf{\"x\":\"ok\"}").unwrap();
    assert_eq!(read_json(&dir, "request.json", 8192).unwrap()["x"], "ok");
    fs::write(fixture.file("request.json"), b"\xef\xbb\xbf\xef\xbb\xbf{}").unwrap();
    assert!(read_json(&dir, "request.json", 8192).is_err());
    fs::write(fixture.file("request.json"), b"{\"x\":\"\xff\"}").unwrap();
    assert!(read_json(&dir, "request.json", 8192).is_err());
}

#[test]
fn growth_and_same_size_write_during_read_are_rejected() {
    let fixture = Fixture::new();
    let dir = fixture.dir();
    let path = fixture.file("task.json");
    fs::write(&path, b"{\"v\":1}").unwrap();
    let err = read_json_during(&dir, "task.json", 8192, || {
        File::options()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b" ")
            .unwrap();
    })
    .unwrap_err();
    assert!(err.contains("changed"), "{err}");

    fs::write(&path, b"{\"v\":1}").unwrap();
    let original_mtime = fs::metadata(&path).unwrap().modified().unwrap();
    let err = read_json_during(&dir, "task.json", 8192, || {
        fs::write(&path, b"{\"v\":2}").unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(FileTimes::new().set_modified(original_mtime))
            .unwrap();
    })
    .unwrap_err();
    assert!(err.contains("changed"), "{err}");
}

#[test]
fn replaced_entry_is_rejected_even_with_same_bytes_and_mtime() {
    let fixture = Fixture::new();
    let dir = fixture.dir();
    let path = fixture.file("task.json");
    fs::write(&path, b"{\"v\":1}").unwrap();
    let mtime = fs::metadata(&path).unwrap().modified().unwrap();
    let mut replaced = false;
    let result = read_json_during(&dir, "task.json", 8192, || {
        let old = fixture.file("old.json");
        match fs::rename(&path, &old) {
            Ok(()) => {
                fs::write(&path, b"{\"v\":1}").unwrap();
                File::options()
                    .write(true)
                    .open(&path)
                    .unwrap()
                    .set_times(FileTimes::new().set_modified(mtime))
                    .unwrap();
                replaced = true;
            }
            Err(e)
                if cfg!(windows)
                    && (e.kind() == std::io::ErrorKind::PermissionDenied
                        || e.raw_os_error() == Some(32)) =>
            {
                eprintln!("Windows refused replacement of held file: {e}");
            }
            Err(e) => panic!("unexpected held-file rename failure: {e}"),
        }
    });
    if replaced {
        let err = result.unwrap_err();
        assert!(err.contains("replaced") || err.contains("changed"), "{err}");
    } else {
        // Some Windows sharing modes deny a rename while the file is open.
        assert!(result.is_ok());
    }
}

#[test]
fn link_boundaries_and_parent_traversal_are_rejected() {
    let fixture = Fixture::new();
    let outside = fixture.file("outside");
    fs::create_dir(&outside).unwrap();
    fs::create_dir(outside.join("subdir")).unwrap();
    fs::write(outside.join("data.json"), b"{}").unwrap();
    let linked_dir = fixture.file("linked");
    make_dir_link(&outside, &linked_dir);
    assert!(checked_dir(&linked_dir).is_err());
    assert!(checked_dir(&fixture.0.join("linked").join("subdir")).is_err());
    assert!(checked_dir(&fixture.0.join("..").join("outside")).is_err());
    let dir = fixture.dir();
    let linked_file = fixture.file("linked.json");
    if make_file_link(&outside.join("data.json"), &linked_file) {
        assert!(read_json(&dir, "linked.json", 8192).is_err());
        eprintln!("file symlink refusal exercised");
    }
}

#[test]
fn held_task_directory_does_not_redirect_after_name_replacement() {
    let fixture = Fixture::new();
    let original = fixture.file("task");
    fs::create_dir(&original).unwrap();
    fs::write(original.join("task.json"), b"{\"owner\":\"original\"}").unwrap();
    let held = checked_dir(&original).unwrap();
    let moved = fixture.file("moved");
    match fs::rename(&original, &moved) {
        Ok(()) => {
            eprintln!("replaced task pathname while original directory handle remained open");
            fs::create_dir(&original).unwrap();
            fs::write(original.join("task.json"), b"{\"owner\":\"replacement\"}").unwrap();
        }
        Err(e)
            if cfg!(windows)
                && (e.kind() == std::io::ErrorKind::PermissionDenied
                    || e.raw_os_error() == Some(32)) =>
        {
            eprintln!("Windows refused replacement of held task directory: {e}");
        }
        Err(e) => panic!("unexpected held-directory rename failure: {e}"),
    }
    assert_eq!(
        read_json(&held, "task.json", 8192).unwrap()["owner"],
        "original"
    );
}

#[cfg(unix)]
fn make_dir_link(target: &Path, link: &Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}
#[cfg(windows)]
fn make_dir_link(target: &Path, link: &Path) {
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .status()
        .unwrap();
    assert!(status.success());
}
#[cfg(unix)]
fn make_file_link(target: &Path, link: &Path) -> bool {
    std::os::unix::fs::symlink(target, link).unwrap();
    true
}
#[cfg(windows)]
fn make_file_link(target: &Path, link: &Path) -> bool {
    match std::os::windows::fs::symlink_file(target, link) {
        Ok(()) => true,
        Err(e)
            if e.kind() == std::io::ErrorKind::PermissionDenied
                || e.raw_os_error() == Some(1314) =>
        {
            eprintln!("Windows file-symlink test skipped because creation was denied: {e}");
            false
        }
        Err(e) => panic!("file symlink creation failed: {e}"),
    }
}

#[cfg(unix)]
#[test]
fn fifo_is_refused_without_waiting_for_a_writer() {
    let fixture = Fixture::new();
    let status = std::process::Command::new("mkfifo")
        .arg(fixture.file("task.json"))
        .status()
        .unwrap();
    assert!(status.success());
    assert!(read_json(&fixture.dir(), "task.json", 8192).is_err());
}
