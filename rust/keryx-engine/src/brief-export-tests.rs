use super::*;
use std::sync::{Arc, Barrier};

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("keryx-brief-test-{}", std::process::id()));
        let path = path.join(format!("{:032x}", {
            let mut bytes = [0u8; 16];
            getrandom::fill(&mut bytes).unwrap();
            u128::from_be_bytes(bytes)
        }));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn final_path(&self) -> PathBuf {
        self.0.join("brief.md")
    }
    fn staging(&self) -> Vec<PathBuf> {
        fs::read_dir(&self.0)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".keryx-brief-")
            })
            .collect()
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[derive(Clone, Copy)]
enum Fault {
    Write,
    Sync,
    WriteThenRemove,
    SyncThenRemove,
    Publish,
    PublishThenError,
    Remove,
}
struct FaultFs(Fault);
impl ExportFs for FaultFs {
    fn create(&self, path: &Path) -> io::Result<File> {
        SystemFs.create(path)
    }
    fn write_all(&self, file: &mut File, bytes: &[u8]) -> io::Result<()> {
        if matches!(self.0, Fault::Write | Fault::WriteThenRemove) {
            file.write_all(&bytes[..bytes.len().min(3)])?;
            return Err(io::Error::other("injected write failure"));
        }
        SystemFs.write_all(file, bytes)
    }
    fn sync_all(&self, file: &File) -> io::Result<()> {
        if matches!(self.0, Fault::Sync | Fault::SyncThenRemove) {
            return Err(io::Error::other("injected sync failure"));
        }
        SystemFs.sync_all(file)
    }
    fn publish(&self, staging: &Path, final_path: &Path) -> io::Result<()> {
        if matches!(self.0, Fault::Publish) {
            return Err(io::Error::other("injected link failure"));
        }
        SystemFs.publish(staging, final_path)?;
        if matches!(self.0, Fault::PublishThenError) {
            return Err(io::Error::other("injected ambiguous link failure"));
        }
        Ok(())
    }
    fn remove(&self, path: &Path) -> io::Result<()> {
        if matches!(
            self.0,
            Fault::Remove | Fault::WriteThenRemove | Fault::SyncThenRemove
        ) {
            return Err(io::Error::other("injected cleanup failure"));
        }
        SystemFs.remove(path)
    }
}

#[test]
fn stages_complete_private_brief_then_cleans_up() {
    let root = TestDir::new();
    let final_path = root.final_path();
    publish_private_brief(&final_path, "🌍 private\n").unwrap();
    assert_eq!(fs::read_to_string(final_path).unwrap(), "🌍 private\n");
    assert!(root.staging().is_empty());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(root.final_path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn prepublication_faults_leave_no_final_or_partial_staging() {
    for fault in [Fault::Write, Fault::Sync] {
        let root = TestDir::new();
        let error =
            export_with(&FaultFs(fault), &root.final_path(), "private content").unwrap_err();
        assert!(
            error.contains("failed before publishing this attempt"),
            "{error}"
        );
        assert!(!root.final_path().exists());
        assert!(root.staging().is_empty());
    }
}

#[test]
fn prepublication_fault_with_cleanup_failure_retains_only_owned_stage() {
    for fault in [Fault::WriteThenRemove, Fault::SyncThenRemove] {
        let root = TestDir::new();
        let error =
            export_with(&FaultFs(fault), &root.final_path(), "private content").unwrap_err();
        assert!(
            error.contains("failed before publishing this attempt"),
            "{error}"
        );
        assert!(
            error.contains("Inspect and remove the owned staging file"),
            "{error}"
        );
        assert!(!root.final_path().exists());
        assert_eq!(root.staging().len(), 1);
    }
}

#[test]
fn failed_link_is_unconfirmed_and_only_own_staging_is_removed() {
    for fault in [Fault::Publish, Fault::PublishThenError] {
        let root = TestDir::new();
        let error = export_with(
            &FaultFs(fault),
            &root.final_path(),
            "complete private content",
        )
        .unwrap_err();
        assert!(
            error.contains("publication outcome is unconfirmed"),
            "{error}"
        );
        assert!(error.contains("inspect the final path"), "{error}");
        assert!(root.staging().is_empty());
        if matches!(fault, Fault::PublishThenError) {
            assert_eq!(
                fs::read_to_string(root.final_path()).unwrap(),
                "complete private content"
            );
        } else {
            assert!(!root.final_path().exists());
        }
    }
}

#[test]
fn cleanup_fault_reports_published_complete_final_and_retains_stage() {
    let root = TestDir::new();
    let error = export_with(&FaultFs(Fault::Remove), &root.final_path(), "complete").unwrap_err();
    assert!(
        error.contains("complete final file was published"),
        "{error}"
    );
    assert_eq!(fs::read_to_string(root.final_path()).unwrap(), "complete");
    assert_eq!(root.staging().len(), 1);
}

#[test]
fn two_writers_publish_exactly_one_complete_final() {
    let root = TestDir::new();
    let final_path = root.final_path();
    let barrier = Arc::new(Barrier::new(3));
    let handles: Vec<_> = ["first", "second"]
        .into_iter()
        .map(|content| {
            let path = final_path.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                publish_private_brief(&path, content)
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert!(matches!(
        fs::read_to_string(final_path).unwrap().as_str(),
        "first" | "second"
    ));
    assert!(root.staging().is_empty());
}

#[test]
fn existing_final_file_and_directory_are_untouched() {
    for directory in [false, true] {
        let root = TestDir::new();
        let final_path = root.final_path();
        if directory {
            fs::create_dir(&final_path).unwrap();
            fs::write(final_path.join("sentinel"), "keep").unwrap();
        } else {
            fs::write(&final_path, "existing").unwrap();
        }
        let error = publish_private_brief(&final_path, "new").unwrap_err();
        assert!(error.contains("unconfirmed"), "{error}");
        if directory {
            assert!(final_path.is_dir());
            assert_eq!(
                fs::read_to_string(final_path.join("sentinel")).unwrap(),
                "keep"
            );
        } else {
            assert_eq!(fs::read_to_string(final_path).unwrap(), "existing");
        }
        assert!(root.staging().is_empty());
    }
}

#[test]
fn existing_final_symlink_is_untouched() {
    let root = TestDir::new();
    let final_path = root.final_path();
    let target = root.0.join("target.md");
    fs::write(&target, "target").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, &final_path).unwrap();
    #[cfg(windows)]
    if let Err(error) = std::os::windows::fs::symlink_file(&target, &final_path) {
        if error.raw_os_error() == Some(1314) {
            println!("Windows file-symlink privilege unavailable; existing-symlink case skipped");
            return;
        }
        panic!("cannot create test symlink: {error}");
    }
    let error = publish_private_brief(&final_path, "new").unwrap_err();
    assert!(error.contains("unconfirmed"), "{error}");
    assert_eq!(fs::read_to_string(&target).unwrap(), "target");
    assert!(fs::symlink_metadata(&final_path)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(fs::read_link(&final_path).unwrap(), target);
    assert!(root.staging().is_empty());
}

#[test]
fn selected_linked_parent_keeps_lexical_output_behavior() {
    let root = TestDir::new();
    let parent = root.0.join("target");
    let alias = root.0.join("alias");
    fs::create_dir(&parent).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&parent, &alias).unwrap();
    #[cfg(windows)]
    if let Err(error) = std::os::windows::fs::symlink_dir(&parent, &alias) {
        if error.raw_os_error() == Some(1314) {
            println!("Windows directory-link privilege unavailable; linked-parent case skipped");
            return;
        }
        panic!("cannot create test directory link: {error}");
    }
    publish_private_brief(&alias.join("brief.md"), "linked parent").unwrap();
    assert_eq!(
        fs::read_to_string(parent.join("brief.md")).unwrap(),
        "linked parent"
    );
    assert_eq!(fs::read_dir(parent).unwrap().count(), 1);
}

#[test]
fn missing_parent_does_not_create_final() {
    let root = TestDir::new();
    let final_path = root.0.join("missing").join("brief.md");
    let error = publish_private_brief(&final_path, "new").unwrap_err();
    assert!(
        error.contains("failed before publishing this attempt"),
        "{error}"
    );
    assert!(!final_path.exists());
}
