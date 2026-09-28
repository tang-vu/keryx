use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

trait ExportFs {
    fn create(&self, path: &Path) -> io::Result<File>;
    fn write_all(&self, file: &mut File, bytes: &[u8]) -> io::Result<()>;
    fn sync_all(&self, file: &File) -> io::Result<()>;
    fn publish(&self, staging: &Path, final_path: &Path) -> io::Result<()>;
    fn remove(&self, path: &Path) -> io::Result<()>;
}

struct SystemFs;
impl ExportFs for SystemFs {
    fn create(&self, path: &Path) -> io::Result<File> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(path)
    }
    fn write_all(&self, file: &mut File, bytes: &[u8]) -> io::Result<()> {
        file.write_all(bytes)
    }
    fn sync_all(&self, file: &File) -> io::Result<()> {
        file.sync_all()
    }
    fn publish(&self, staging: &Path, final_path: &Path) -> io::Result<()> {
        fs::hard_link(staging, final_path)
    }
    fn remove(&self, path: &Path) -> io::Result<()> {
        fs::remove_file(path)
    }
}

fn staging_path(final_path: &Path) -> Result<PathBuf, String> {
    let parent = final_path
        .parent()
        .ok_or("brief output has no parent directory")?;
    if final_path.file_name().is_none() {
        return Err("brief output is a directory root".into());
    }
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|e| format!("cannot name staging file: {e}"))?;
    Ok(parent.join(format!(
        ".keryx-brief-{:032x}.tmp",
        u128::from_be_bytes(random)
    )))
}

enum Publication {
    NotPublished,
    Unconfirmed,
    Published,
}

fn failure(
    publication: Publication,
    step: &str,
    final_path: &Path,
    staging: &Path,
    remains: bool,
    error: &io::Error,
) -> String {
    let state = match publication {
        Publication::NotPublished => "failed before publishing this attempt",
        Publication::Unconfirmed => {
            "publication outcome is unconfirmed; inspect the final path before retrying"
        }
        Publication::Published => "complete final file was published; staging cleanup failed",
    };
    let leftover = if remains {
        " Inspect and remove the owned staging file after checking it."
    } else {
        ""
    };
    format!(
        "private brief export {state} at {step}; final={final_path:?} staging={staging:?}: {error}.{leftover}"
    )
}

fn remove_before_publish(
    fs: &impl ExportFs,
    publication: Publication,
    step: &str,
    final_path: &Path,
    staging: &Path,
    error: &io::Error,
) -> String {
    let remains = fs.remove(staging).is_err();
    failure(publication, step, final_path, staging, remains, error)
}

fn export_with(fs: &impl ExportFs, final_path: &Path, markdown: &str) -> Result<(), String> {
    let staging = staging_path(final_path)?;
    let mut file = fs.create(&staging).map_err(|e| {
        failure(
            Publication::NotPublished,
            "create staging file",
            final_path,
            &staging,
            false,
            &e,
        )
    })?;
    if let Err(e) = fs.write_all(&mut file, markdown.as_bytes()) {
        drop(file);
        return Err(remove_before_publish(
            fs,
            Publication::NotPublished,
            "write staging file",
            final_path,
            &staging,
            &e,
        ));
    }
    if let Err(e) = fs.sync_all(&file) {
        drop(file);
        return Err(remove_before_publish(
            fs,
            Publication::NotPublished,
            "sync staging file",
            final_path,
            &staging,
            &e,
        ));
    }
    // Rust File::drop does not surface close errors. The completed contents were
    // explicitly synced before this handle is closed.
    drop(file);
    if let Err(e) = fs.publish(&staging, final_path) {
        return Err(remove_before_publish(
            fs,
            Publication::Unconfirmed,
            "publish final file",
            final_path,
            &staging,
            &e,
        ));
    }
    if let Err(e) = fs.remove(&staging) {
        return Err(failure(
            Publication::Published,
            "remove staging file",
            final_path,
            &staging,
            true,
            &e,
        ));
    }
    Ok(())
}

pub(crate) fn publish_private_brief(final_path: &Path, markdown: &str) -> Result<(), String> {
    export_with(&SystemFs, final_path, markdown)
}

#[cfg(test)]
#[path = "brief-export-tests.rs"]
mod tests;
