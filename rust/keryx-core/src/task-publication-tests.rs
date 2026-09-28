use super::*;
use crate::{parse_json, prepare_task_v1};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Barrier,
    },
    thread,
};

static NEXT: AtomicU64 = AtomicU64::new(0);

struct OwnedParent {
    path: PathBuf,
}
impl OwnedParent {
    fn new(private: bool) -> Self {
        let root = fs::canonicalize(std::env::temp_dir()).unwrap();
        let path = root.join(format!(
            "keryx-publication-test-{}-{}-Việt & one",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        #[cfg(unix)]
        {
            use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
            let mut builder = fs::DirBuilder::new();
            builder.mode(if private { 0o700 } else { 0o755 });
            builder.create(&path).unwrap();
            if !private {
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
                assert_eq!(
                    fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                    0o755
                );
            }
        }
        #[cfg(windows)]
        {
            fs::create_dir(&path).unwrap();
            windows_acl(&path, private);
        }
        Self { path }
    }
}
impl Drop for OwnedParent {
    fn drop(&mut self) {
        let root = fs::canonicalize(std::env::temp_dir()).unwrap();
        assert_eq!(self.path.parent(), Some(root.as_path()));
        assert!(self
            .path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("keryx-publication-test-"));
        if self.path.exists() {
            fs::remove_dir_all(&self.path).unwrap();
        }
    }
}

#[cfg(windows)]
fn windows_acl(path: &Path, private: bool) {
    use std::process::Command;
    let user = Command::new("whoami.exe")
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .unwrap();
    assert!(user.status.success());
    let value = String::from_utf8(user.stdout).unwrap();
    let sid = value.split('"').nth(3).unwrap();
    assert!(
        sid.starts_with("S-1-") && sid[4..].bytes().all(|b| b.is_ascii_digit() || b == b'-'),
        "unexpected whoami SID: {value:?} / {sid:?}"
    );
    let grant = if private {
        format!("*{sid}:(OI)(CI)F")
    } else {
        "*S-1-1-0:(OI)(CI)F".into()
    };
    let granted = Command::new("icacls.exe")
        .arg(path)
        .args(["/grant:r", &grant])
        .output()
        .unwrap();
    assert!(
        granted.status.success(),
        "{}",
        String::from_utf8_lossy(&granted.stderr)
    );
    let protected = Command::new("icacls.exe")
        .arg(path)
        .arg("/inheritance:r")
        .output()
        .unwrap();
    assert!(
        protected.status.success(),
        "{}",
        String::from_utf8_lossy(&protected.stderr)
    );
}

fn prepared() -> PreparedTaskV1 {
    let request = parse_json(r#"{"question":"Synthetic Việt 😀 \ud800","budget":0.000001,"researchMode":"quick","packageVersion":"1.0.0","responseMode":"async"}"#).unwrap();
    prepare_task_v1(
        &request,
        "0x1111111111111111111111111111111111111111",
        "2",
        "00000000-0000-4000-8000-000000000001",
        "2026-09-29T01:02:03.004Z",
    )
    .unwrap()
}

#[test]
fn private_publication_is_exact_and_existing_target_is_untouched() {
    let temp = OwnedParent::new(true);
    let parent =
        PrivateParent::open(&temp.path).unwrap_or_else(|e| panic!("private parent: {e:?}"));
    let bytes = prepared();
    let complete = parent.publish("task_1", &bytes).unwrap();
    #[cfg(unix)]
    assert_eq!(complete, PublicationComplete::UnixSynced);
    #[cfg(windows)]
    assert_eq!(complete, PublicationComplete::WindowsVisibleEntryUnproven);
    assert_eq!(
        fs::read(temp.path.join("task_1/request.json")).unwrap(),
        bytes.request_json().as_bytes()
    );
    assert_eq!(
        fs::read(temp.path.join("task_1/task.json")).unwrap(),
        bytes.task_json().as_bytes()
    );
    let before = fs::read(temp.path.join("task_1/task.json")).unwrap();
    let second = parent.publish("task_1", &bytes).unwrap_err();
    assert_eq!(second.state, PublicationState::RefusedUnchanged);
    assert_eq!(
        fs::read(temp.path.join("task_1/task.json")).unwrap(),
        before
    );
    assert_eq!(
        crate::LocalTask::open(&temp.path.join("task_1"))
            .unwrap()
            .status()
            .unwrap()["stage"],
        "ready"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(temp.path.join("task_1"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        for name in ["request.json", "task.json"] {
            assert_eq!(
                fs::metadata(temp.path.join("task_1").join(name))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
}

#[test]
fn unsafe_parent_and_child_names_refuse_before_creation() {
    let private = OwnedParent::new(true);
    let broad = OwnedParent::new(false);
    assert_eq!(
        PrivateParent::open(&broad.path).err().unwrap().state,
        PublicationState::RefusedUnchanged
    );
    assert_eq!(
        PrivateParent::open(Path::new("relative-parent"))
            .err()
            .unwrap()
            .state,
        PublicationState::RefusedUnchanged
    );
    let parent = PrivateParent::open(&private.path).unwrap();
    let bytes = prepared();
    for child in [
        "",
        ".",
        "..",
        "nested/path",
        "has space",
        "CON",
        "prn",
        "AuX",
        "nul",
        "com1",
        "LPT9",
        "x:y",
    ] {
        let error = parent.publish(child, &bytes).unwrap_err();
        assert_eq!(error.state, PublicationState::RefusedUnchanged, "{child}");
    }
    assert!(fs::read_dir(&private.path).unwrap().next().is_none());
}

#[test]
fn injected_steps_retain_partial_bytes_and_never_repair() {
    let temp = OwnedParent::new(true);
    let parent = PrivateParent::open(&temp.path).unwrap();
    let bytes = prepared();
    for (index, stage) in [
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
    ]
    .iter()
    .enumerate()
    {
        let child = format!("fault_{index}");
        let error = parent
            .publish_with_hook(&child, &bytes, |at| {
                if at == *stage {
                    Err(format!("injected {at}"))
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
        assert_eq!(error.stage, *stage);
        let expected = match *stage {
            "before-mkdir" => PublicationState::RefusedUnchanged,
            "after-mkdir"
            | "request-write"
            | "request-partial-write"
            | "request-sync"
            | "request-close"
            | "task-write"
            | "task-partial-write" => PublicationState::RetainedPartial,
            _ => PublicationState::CompleteUnconfirmed,
        };
        assert_eq!(error.state, expected, "{stage}");
        let target = temp.path.join(&child);
        assert_eq!(target.exists(), *stage != "before-mkdir", "{stage}");
        if *stage == "request-partial-write" || *stage == "task-partial-write" {
            let name = if *stage == "request-partial-write" {
                "request.json"
            } else {
                "task.json"
            };
            let full = if *stage == "request-partial-write" {
                bytes.request_json()
            } else {
                bytes.task_json()
            };
            let saved = fs::read(target.join(name)).unwrap();
            assert_eq!(saved, full.as_bytes()[..full.len() / 2]);
            assert!(!saved.is_empty() && saved.len() < full.len());
            let retry = parent.publish(&child, &bytes).unwrap_err();
            assert_eq!(retry.state, PublicationState::RefusedUnchanged);
            assert_eq!(fs::read(target.join(name)).unwrap(), saved);
        }
        if ["task-close", "directory-sync", "verify"].contains(stage) {
            assert_eq!(
                fs::read(target.join("task.json")).unwrap(),
                bytes.task_json().as_bytes()
            );
        }
    }
}

#[test]
fn two_creators_choose_one_exclusive_directory() {
    let temp = OwnedParent::new(true);
    let parent = Arc::new(PrivateParent::open(&temp.path).unwrap());
    let bytes = Arc::new(prepared());
    let barrier = Arc::new(Barrier::new(3));
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let parent = Arc::clone(&parent);
            let bytes = Arc::clone(&bytes);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                parent.publish("race", &bytes)
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = workers
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| result
                .as_ref()
                .err()
                .is_some_and(|e| e.state == PublicationState::RefusedUnchanged))
            .count(),
        1
    );
    assert_eq!(
        fs::read(temp.path.join("race/task.json")).unwrap(),
        bytes.task_json().as_bytes()
    );
}

#[test]
fn observed_child_and_identical_byte_file_replacement_is_not_reported_complete() {
    let temp = OwnedParent::new(true);
    let parent = PrivateParent::open(&temp.path).unwrap();
    let bytes = prepared();
    let child = temp.path.join("swap_child");
    let moved = temp.path.join("original_child");
    let mut child_replaced = false;
    let result = parent.publish_with_hook("swap_child", &bytes, |stage| {
        if stage == "after-mkdir" {
            match fs::rename(&child, &moved) {
                Ok(()) => {
                    child_replaced = true;
                    create_private_child(&child).map_err(|e| e.to_string())?;
                }
                Err(e) => {
                    #[cfg(windows)]
                    {
                        assert!(
                            matches!(e.raw_os_error(), Some(5 | 32 | 33)),
                            "unexpected child-rename error: {e}"
                        );
                        assert!(child.is_dir() && !moved.exists());
                        eprintln!("Windows held child refused replacement: {e}");
                    }
                    #[cfg(unix)]
                    panic!("Linux child replacement setup failed: {e}");
                }
            }
        }
        Ok(())
    });
    if child_replaced {
        assert_eq!(result.unwrap_err().stage, "child-identity");
        assert!(!child.join("request.json").exists());
        fs::remove_dir_all(&moved).unwrap();
    } else {
        assert!(result.is_ok());
    }

    let original = temp.path.join("swap_file/request.json");
    let replacement = temp.path.join("swap_file/replacement.tmp");
    let mut file_replaced = false;
    let result = parent.publish_with_hook("swap_file", &bytes, |stage| {
        if stage == "verify" {
            fs::write(&replacement, bytes.request_json()).map_err(|e| e.to_string())?;
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&replacement, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
            }
            match fs::rename(&replacement, &original) {
                Ok(()) => file_replaced = true,
                Err(e) => {
                    #[cfg(windows)] {
                        assert!(matches!(e.raw_os_error(), Some(5 | 32 | 33 | 183)), "unexpected file-rename error: {e}");
                        assert!(original.is_file() && replacement.is_file());
                        eprintln!("Windows file replacement did not occur (sharing or no-replace semantics): {e}");
                    }
                    #[cfg(unix)] panic!("Linux file replacement setup failed: {e}");
                },
            }
        }
        Ok(())
    });
    if file_replaced {
        eprintln!("identical-byte file replacement exercised and rejected at verify");
        assert_eq!(result.unwrap_err().stage, "verify");
    } else {
        assert!(result.is_ok());
    }
    #[cfg(unix)]
    assert!(
        child_replaced && file_replaced,
        "Linux must exercise both replacement refusals"
    );
}

fn create_private_child(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        builder.create(path)
    }
    #[cfg(windows)]
    {
        fs::create_dir(path)
    }
}

#[test]
fn linked_parent_refuses_without_writing_outside() {
    let temp = OwnedParent::new(true);
    let outside = OwnedParent::new(true);
    let link = temp.path.join("linked");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside.path, &link).unwrap();
    #[cfg(windows)]
    {
        match std::os::windows::fs::symlink_dir(&outside.path, &link) {
            Ok(()) => {}
            Err(e) => {
                eprintln!("Windows directory symlink creation unavailable: {e}; direct no-follow parent is covered by the shared reader and hosted Linux");
                return;
            }
        }
    }
    assert_eq!(
        PrivateParent::open(&link).err().unwrap().state,
        PublicationState::RefusedUnchanged
    );
    assert!(fs::read_dir(&outside.path).unwrap().next().is_none());
}

#[test]
fn observed_private_parent_name_replacement_is_not_reported_complete() {
    let temp = OwnedParent::new(true);
    let moved = temp.path.with_file_name(format!(
        "{}-moved",
        temp.path.file_name().unwrap().to_string_lossy()
    ));
    let parent = PrivateParent::open(&temp.path).unwrap();
    let bytes = prepared();
    let mut replaced = false;
    let result = parent.publish_with_hook("parent_swap", &bytes, |stage| {
        if stage == "after-mkdir" {
            match fs::rename(&temp.path, &moved) {
                Ok(()) => {
                    replaced = true;
                    create_private_child(&temp.path).map_err(|e| e.to_string())?;
                    #[cfg(windows)]
                    windows_acl(&temp.path, true);
                }
                Err(e) => {
                    #[cfg(windows)]
                    {
                        assert!(
                            matches!(e.raw_os_error(), Some(5 | 32 | 33)),
                            "unexpected parent-rename error: {e}"
                        );
                        assert!(temp.path.is_dir() && !moved.exists());
                        eprintln!("Windows held parent refused replacement: {e}");
                    }
                    #[cfg(unix)]
                    panic!("Linux parent replacement setup failed: {e}");
                }
            }
        }
        Ok(())
    });
    if replaced {
        assert_eq!(result.unwrap_err().stage, "parent-identity");
        assert!(!temp.path.join("parent_swap/request.json").exists());
        drop(parent);
        fs::remove_dir_all(moved).unwrap();
    } else {
        assert!(result.is_ok());
    }
}
