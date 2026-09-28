//! Evaluation-only native publication of an already prepared immutable v1 task.
//! This module is not wired into the read-only engine CLI or payment paths.
#[cfg(windows)]
use crate::fs_boundary::reparse;
use crate::{fs_boundary::checked_dir, prepare::PreparedTaskV1};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use same_file::Handle;
use std::{
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
};

#[cfg(unix)]
use cap_std::fs::{DirBuilder, DirBuilderExt, OpenOptionsExt};

#[cfg(windows)]
#[path = "task-publication-windows.rs"]
mod windows;

#[cfg(all(windows, feature = "publication-evaluation"))]
pub fn set_publication_evaluation_default_owner() -> io::Result<()> {
    windows::set_evaluation_default_owner()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublicationState {
    RefusedUnchanged,
    RetainedPartial,
    CompleteUnconfirmed,
}

impl PublicationState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RefusedUnchanged => "refused_unchanged",
            Self::RetainedPartial => "retained_partial",
            Self::CompleteUnconfirmed => "complete_unconfirmed",
        }
    }
}

#[derive(Debug)]
pub struct PublicationFailure {
    pub state: PublicationState,
    pub stage: &'static str,
    pub message: String,
}

impl PublicationFailure {
    fn new(state: PublicationState, stage: &'static str, error: impl ToString) -> Self {
        Self {
            state,
            stage,
            message: error.to_string(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublicationComplete {
    UnixSynced,
    WindowsVisibleEntryUnproven,
}

impl PublicationComplete {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UnixSynced => "unix_synced",
            Self::WindowsVisibleEntryUnproven => "windows_visible_entry_unproven",
        }
    }
}

/// A held private directory, verified under this candidate's strict policy.
/// Another process with the same user or administrator authority remains out
/// of scope; observed name replacement is nevertheless detected where possible.
pub struct PrivateParent {
    path: PathBuf,
    dir: Dir,
}

impl PrivateParent {
    pub fn open(path: &Path) -> Result<Self, PublicationFailure> {
        if !path.is_absolute() {
            return Err(PublicationFailure::new(
                PublicationState::RefusedUnchanged,
                "parent",
                "private parent must be absolute",
            ));
        }
        if path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
        {
            return Err(PublicationFailure::new(
                PublicationState::RefusedUnchanged,
                "parent",
                "parent traversal is unsupported",
            ));
        }
        let path = std::path::absolute(path).map_err(|e| {
            PublicationFailure::new(PublicationState::RefusedUnchanged, "parent", e)
        })?;
        let dir = checked_dir(&path).map_err(|e| {
            PublicationFailure::new(PublicationState::RefusedUnchanged, "parent", e)
        })?;
        private_dir(&dir, true).map_err(|e| {
            PublicationFailure::new(PublicationState::RefusedUnchanged, "parent", e)
        })?;
        Ok(Self { path, dir })
    }

    pub fn publish(
        &self,
        child: &str,
        prepared: &PreparedTaskV1,
    ) -> Result<PublicationComplete, PublicationFailure> {
        self.publish_with_hook(child, prepared, |_| Ok(()))
    }

    #[cfg(feature = "publication-evaluation")]
    pub fn publish_with_evaluation_hook(
        &self,
        child: &str,
        prepared: &PreparedTaskV1,
        hook: impl FnMut(&'static str) -> Result<(), String>,
    ) -> Result<PublicationComplete, PublicationFailure> {
        self.publish_with_hook(child, prepared, hook)
    }

    fn publish_with_hook(
        &self,
        child: &str,
        prepared: &PreparedTaskV1,
        mut hook: impl FnMut(&'static str) -> Result<(), String>,
    ) -> Result<PublicationComplete, PublicationFailure> {
        let mut state = PublicationState::RefusedUnchanged;
        let mut step =
            |stage: &'static str| hook(stage).map_err(|e| PublicationFailure::new(state, stage, e));
        // This narrow name policy is a candidate-only refusal, not a claim
        // that every TypeScript-selected output path is supported.
        if !safe_child(child) {
            return Err(PublicationFailure::new(
                state,
                "child",
                "unsupported child name",
            ));
        }
        if prepared.request_json().len() > 8_192 || prepared.task_json().len() > 8_192 {
            return Err(PublicationFailure::new(
                state,
                "prepared",
                "prepared file exceeds 8 KiB",
            ));
        }
        self.ensure_current()
            .map_err(|e| PublicationFailure::new(state, "parent", e))?;
        step("before-mkdir")?;
        #[cfg(unix)]
        let created = {
            let mut builder = DirBuilder::new();
            builder.mode(0o700);
            self.dir.create_dir_with(child, &builder)
        };
        #[cfg(windows)]
        let created = self.dir.create_dir(child);
        created.map_err(|e| PublicationFailure::new(state, "mkdir", e))?;
        state = PublicationState::RetainedPartial;
        let mut step =
            |stage: &'static str| hook(stage).map_err(|e| PublicationFailure::new(state, stage, e));
        let dir = self
            .dir
            .open_dir_nofollow(child)
            .map_err(|e| PublicationFailure::new(state, "child-open", e))?;
        private_dir(&dir, false).map_err(|e| PublicationFailure::new(state, "child-private", e))?;
        self.ensure_child_current(child, &dir)
            .map_err(|e| PublicationFailure::new(state, "child-identity", e))?;
        step("after-mkdir")?;
        self.ensure_current()
            .map_err(|e| PublicationFailure::new(state, "parent-identity", e))?;
        self.ensure_child_current(child, &dir)
            .map_err(|e| PublicationFailure::new(state, "child-identity", e))?;
        #[cfg(unix)]
        sync_dir(&self.dir).map_err(|e| PublicationFailure::new(state, "parent-sync", e))?;

        let request_identity = write_file(
            &dir,
            "request.json",
            prepared.request_json().as_bytes(),
            "request",
            &mut step,
        )?;
        let task_identity = write_file(
            &dir,
            "task.json",
            prepared.task_json().as_bytes(),
            "task",
            &mut step,
        )?;
        state = PublicationState::CompleteUnconfirmed;
        let mut step =
            |stage: &'static str| hook(stage).map_err(|e| PublicationFailure::new(state, stage, e));
        step("directory-sync")?;
        #[cfg(unix)]
        {
            sync_dir(&dir).map_err(|e| PublicationFailure::new(state, "directory-sync", e))?;
            sync_dir(&self.dir).map_err(|e| PublicationFailure::new(state, "parent-sync", e))?;
        }
        step("verify")?;
        self.ensure_current()
            .map_err(|e| PublicationFailure::new(state, "parent-identity", e))?;
        self.ensure_child_current(child, &dir)
            .map_err(|e| PublicationFailure::new(state, "child-identity", e))?;
        verify_file(
            &dir,
            "request.json",
            prepared.request_json().as_bytes(),
            &request_identity,
        )
        .map_err(|e| PublicationFailure::new(state, "verify", e))?;
        verify_file(
            &dir,
            "task.json",
            prepared.task_json().as_bytes(),
            &task_identity,
        )
        .map_err(|e| PublicationFailure::new(state, "verify", e))?;
        #[cfg(unix)]
        {
            Ok(PublicationComplete::UnixSynced)
        }
        #[cfg(windows)]
        {
            Ok(PublicationComplete::WindowsVisibleEntryUnproven)
        }
    }

    fn ensure_current(&self) -> Result<(), String> {
        let fresh = checked_dir(&self.path)?;
        if !same_dir(&self.dir, &fresh).map_err(|e| e.to_string())? {
            return Err("private parent changed identity".into());
        }
        private_dir(&self.dir, true).map_err(|e| e.to_string())
    }

    fn ensure_child_current(&self, name: &str, original: &Dir) -> Result<(), String> {
        let fresh = self
            .dir
            .open_dir_nofollow(name)
            .map_err(|e| e.to_string())?;
        if !same_dir(original, &fresh).map_err(|e| e.to_string())? {
            return Err("created child changed identity".into());
        }
        private_dir(&fresh, false).map_err(|e| e.to_string())
    }
}

fn safe_child(child: &str) -> bool {
    if child.is_empty()
        || child.len() > 64
        || !child
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return false;
    }
    let upper = child.to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&upper.as_str()) {
        return false;
    }
    if upper.len() == 4
        && (upper.starts_with("COM") || upper.starts_with("LPT"))
        && matches!(upper.as_bytes()[3], b'1'..=b'9')
    {
        return false;
    }
    true
}

fn same_dir(a: &Dir, b: &Dir) -> io::Result<bool> {
    Ok(Handle::from_file(a.try_clone()?.into_std_file())?
        == Handle::from_file(b.try_clone()?.into_std_file())?)
}

#[cfg(unix)]
fn private_dir(dir: &Dir, _parent: bool) -> io::Result<()> {
    use cap_std::fs::MetadataExt;
    let meta = dir.dir_metadata()?;
    if !meta.is_dir()
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.mode() & 0o077 != 0
        || meta.mode() & 0o700 != 0o700
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "directory is not owned and private (0700)",
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn private_dir(dir: &Dir, parent: bool) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    if !dir.dir_metadata()?.is_dir() || reparse(&dir.dir_metadata()?) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "directory is not direct",
        ));
    }
    windows::private_handle(dir.as_raw_handle(), parent)
}

fn write_file(
    dir: &Dir,
    name: &str,
    bytes: &[u8],
    prefix: &'static str,
    hook: &mut impl FnMut(&'static str) -> Result<(), PublicationFailure>,
) -> Result<Handle, PublicationFailure> {
    let partial = PublicationState::RetainedPartial;
    let full = if prefix == "task" {
        PublicationState::CompleteUnconfirmed
    } else {
        partial
    };
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .follow(FollowSymlinks::No);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = dir
        .open_with(name, &options)
        .map_err(|e| PublicationFailure::new(partial, prefix, e))?;
    private_file(&file).map_err(|e| PublicationFailure::new(partial, prefix, e))?;
    let identity = Handle::from_file(
        file.try_clone()
            .map_err(|e| PublicationFailure::new(partial, prefix, e))?
            .into_std(),
    )
    .map_err(|e| PublicationFailure::new(partial, prefix, e))?;
    let write = if prefix == "request" {
        "request-write"
    } else {
        "task-write"
    };
    #[cfg(any(test, feature = "publication-evaluation"))]
    let partial_write = if prefix == "request" {
        "request-partial-write"
    } else {
        "task-partial-write"
    };
    let sync = if prefix == "request" {
        "request-sync"
    } else {
        "task-sync"
    };
    let close = if prefix == "request" {
        "request-close"
    } else {
        "task-close"
    };
    hook(write)?;
    #[cfg(any(test, feature = "publication-evaluation"))]
    {
        let split = bytes.len() / 2;
        file.write_all(&bytes[..split])
            .map_err(|e| PublicationFailure::new(partial, write, e))?;
        hook(partial_write)?;
        file.write_all(&bytes[split..])
            .map_err(|e| PublicationFailure::new(partial, write, e))?;
    }
    #[cfg(not(any(test, feature = "publication-evaluation")))]
    file.write_all(bytes)
        .map_err(|e| PublicationFailure::new(partial, write, e))?;
    hook(sync).map_err(|e| PublicationFailure::new(full, e.stage, e.message))?;
    file.sync_all()
        .map_err(|e| PublicationFailure::new(full, sync, e))?;
    checked_close(file.into_std()).map_err(|e| PublicationFailure::new(full, close, e))?;
    hook(close).map_err(|e| PublicationFailure::new(full, e.stage, e.message))?;
    Ok(identity)
}

#[cfg(unix)]
fn private_file(file: &cap_std::fs::File) -> io::Result<()> {
    use cap_std::fs::MetadataExt;
    let meta = file.metadata()?;
    if !meta.is_file()
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.mode() & 0o077 != 0
        || meta.mode() & 0o600 != 0o600
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "file is not owned and private (0600)",
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn private_file(file: &cap_std::fs::File) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    if !file.metadata()?.is_file() || reparse(&file.metadata()?) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "file is not direct",
        ));
    }
    windows::private_handle(file.as_raw_handle(), false)
}

fn verify_file(dir: &Dir, name: &str, expected: &[u8], identity: &Handle) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let file = dir.open_with(name, &options)?;
    private_file(&file)?;
    let mut bytes = Vec::new();
    (&file).take(8_193).read_to_end(&mut bytes)?;
    if bytes != expected {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "published bytes changed",
        ));
    }
    let fresh = Handle::from_file(file.into_std())?;
    if fresh != *identity {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "published file changed identity",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn sync_dir(dir: &Dir) -> io::Result<()> {
    // cap-std may hold directories with O_PATH, which cannot be fsynced.
    // Open a read-capable descriptor for "." relative to that held directory,
    // then prove it still names the same object before syncing its entries.
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let file = dir.open_with(".", &options)?;
    if !file.metadata()?.is_dir()
        || Handle::from_file(file.try_clone()?.into_std())?
            != Handle::from_file(dir.try_clone()?.into_std_file())?
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "directory sync handle changed identity",
        ));
    }
    let file = file.into_std();
    let result = file.sync_all();
    let close = checked_close(file);
    result.and(close)
}

#[cfg(unix)]
fn checked_close(file: std::fs::File) -> io::Result<()> {
    use std::os::fd::IntoRawFd;
    let fd = file.into_raw_fd();
    // Linux releases the descriptor even on most close errors; never retry.
    if unsafe { libc::close(fd) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn checked_close(file: std::fs::File) -> io::Result<()> {
    use std::os::windows::io::IntoRawHandle;
    let handle = file.into_raw_handle();
    if unsafe { windows_sys::Win32::Foundation::CloseHandle(handle) } != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(test)]
#[path = "task-publication-tests.rs"]
mod tests;
