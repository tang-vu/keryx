use crate::json::Result;
use cap_fs_ext::DirExt;
#[cfg(windows)]
use cap_fs_ext::OsMetadataExt;
use cap_std::{ambient_authority, fs::Dir};
use std::{
    fs,
    path::{Component, Path},
};

/// Resolve one component at a time from a held root, without following links.
pub(crate) fn checked_dir(path: &Path) -> Result<Dir> {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("directory path contains a parent traversal".into());
    }
    let root = path.ancestors().last().ok_or("invalid directory path")?;
    let meta = fs::symlink_metadata(root).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() || root_reparse(&meta) {
        return Err("directory root is not a direct directory".into());
    }
    let mut dir = Dir::open_ambient_dir(root, ambient_authority()).map_err(|e| e.to_string())?;
    let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err("unsupported directory path component".into());
        };
        dir = dir.open_dir_nofollow(name).map_err(|e| e.to_string())?;
        if reparse(&dir.dir_metadata().map_err(|e| e.to_string())?) {
            return Err("directory path contains a reparse point".into());
        }
    }
    Ok(dir)
}

#[cfg(windows)]
fn root_reparse(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn root_reparse(_meta: &fs::Metadata) -> bool {
    false
}

#[cfg(windows)]
pub(crate) fn reparse(meta: &cap_fs_ext::Metadata) -> bool {
    meta.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
pub(crate) fn reparse(_meta: &cap_fs_ext::Metadata) -> bool {
    false
}
