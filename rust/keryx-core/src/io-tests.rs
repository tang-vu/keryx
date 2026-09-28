use super::*;
use std::{
    fs::{File, FileTimes},
    io::Write,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

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
