use crate::brief::brief;
use crate::domain::{parse_intent, parse_task, valid_time, Intent, Task};
use crate::json::{parse, Result, Value};
use crate::result::verify_result;
#[cfg(windows)]
use cap_fs_ext::OsMetadataExt;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use same_file::Handle;
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Component, Path},
};

fn checked_dir(path: &Path) -> Result<Dir> {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("directory path contains a parent traversal".into());
    }
    // The only ambient open is the filesystem root. Each later component is
    // resolved relative to a held parent handle, with no link traversal.
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
fn reparse(meta: &cap_fs_ext::Metadata) -> bool {
    meta.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn reparse(_meta: &cap_fs_ext::Metadata) -> bool {
    false
}

fn open_regular(dir: &Dir, name: &str) -> Result<Handle> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = dir.open_with(name, &options).map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || reparse(&meta) {
        return Err("local file must be regular and direct".into());
    }
    Handle::from_file(file.into_std()).map_err(|e| e.to_string())
}

fn read_json(dir: &Dir, name: &str, max: usize) -> Result<Value> {
    read_json_during(dir, name, max, || {})
}

// The callback gives tests a deterministic point after the bounded read.
fn read_json_during(dir: &Dir, name: &str, max: usize, after_read: impl FnOnce()) -> Result<Value> {
    let file = open_regular(dir, name)?;
    let opened = file.as_file().metadata().map_err(|e| e.to_string())?;
    let opened_mtime = opened.modified().map_err(|e| e.to_string())?;
    if opened.len() > max as u64 {
        return Err("local file exceeds limit".into());
    }
    let mut bytes = Vec::with_capacity(max.min(8192));
    file.as_file()
        .take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > max {
        return Err("local file exceeds limit".into());
    }
    after_read();
    // Re-read the same opened inode to catch byte changes even when a writer
    // restores the length and timestamp. This is still not an atomic snapshot.
    let mut view = file.as_file();
    view.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut again = Vec::with_capacity(bytes.len());
    view.take(max as u64 + 1)
        .read_to_end(&mut again)
        .map_err(|e| e.to_string())?;
    if again != bytes {
        return Err("local file changed during inspection".into());
    }
    let after = file.as_file().metadata().map_err(|e| e.to_string())?;
    let after_mtime = after.modified().map_err(|e| e.to_string())?;
    if after.len() != opened.len()
        || after_mtime != opened_mtime
        || metadata_changed(&opened, &after)
    {
        return Err("local file changed during inspection".into());
    }
    // A rename can leave the first handle readable. Reopen through the held
    // parent and compare kernel file identities, including on Windows.
    if open_regular(dir, name)? != file {
        return Err("local file replaced during inspection".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|e| e.to_string())?;
    // Node's default TextDecoder consumes one leading UTF-8 BOM before JSON.parse.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    parse(text).map_err(|e| format!(
        "invalid or unsupported local JSON: {e}. If this is a TypeScript-readable v1 directory, use the TypeScript Operator status/result/brief commands on the original directory. Do not rewrite files."
    ))
}

#[cfg(unix)]
fn metadata_changed(before: &fs::Metadata, after: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    before.ctime() != after.ctime() || before.ctime_nsec() != after.ctime_nsec()
}
#[cfg(not(unix))]
fn metadata_changed(_before: &fs::Metadata, _after: &fs::Metadata) -> bool {
    false
}

fn present(dir: &Dir, name: &str) -> Result<bool> {
    match dir.symlink_metadata(name) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

pub struct LocalTask {
    dir: Dir,
    buyer: Option<Dir>,
    task: Task,
    intent: Option<Intent>,
    stage: &'static str,
}

impl LocalTask {
    pub fn open(path: &Path) -> Result<Self> {
        if path.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err("directory path contains a parent traversal".into());
        }
        let dir = std::path::absolute(path).map_err(|e| e.to_string())?;
        let dir = checked_dir(&dir)?;
        let task = parse_task(
            &read_json(&dir, "task.json", 8192)?,
            &read_json(&dir, "request.json", 8192)?,
        )?;
        let (buyer, intent, stage) = if !present(&dir, "buyer")? {
            (None, None, "ready")
        } else {
            let buyer = dir.open_dir_nofollow("buyer").map_err(|e| e.to_string())?;
            if reparse(&buyer.dir_metadata().map_err(|e| e.to_string())?) {
                return Err("buyer path contains a reparse point".into());
            }
            if !present(&buyer, "intent.json")? {
                (Some(buyer), None, "journal_incomplete")
            } else {
                let intent = parse_intent(&read_json(&buyer, "intent.json", 65536)?, &task)?;
                (Some(buyer), Some(intent), "buyer_journaled")
            }
        };
        Ok(Self {
            dir,
            buyer,
            task,
            intent,
            stage,
        })
    }

    pub fn status(&self) -> Result<Value> {
        let observation = if let Some(intent) = &self.intent {
            self.observation(intent)?
        } else {
            None
        };
        let saved = if !present(&self.dir, "result.json")? {
            "absent"
        } else {
            let m = self
                .dir
                .symlink_metadata("result.json")
                .map_err(|e| e.to_string())?;
            if m.is_file() && !m.file_type().is_symlink() && !reparse(&m) && m.len() <= 150_000 {
                "present_unchecked"
            } else {
                "invalid"
            }
        };
        Ok(Value::object(vec![
            ("schema", "keryx-operator-task-status-v1".into()),
            ("taskId", self.task.id.as_str().into()),
            ("createdAt", self.task.created_at.as_str().into()),
            ("kind", "paid_research".into()),
            ("network", "eip155:5042002".into()),
            ("stage", self.stage.into()),
            ("buyerJobId", self.intent.as_ref().map(|i| i.query_id.as_str()).into()),
            ("creatorBudgetMicros", ((self.task.request["budget"].as_f64().unwrap()*1_000_000.0).round() as u64).into()),
            ("maxTotalMicros", self.task.cap.to_string().into()),
            ("payment", "unknown".into()),
            ("delivery", "unknown".into()),
            ("lastObservation", observation.unwrap_or(Value::Null)),
            ("savedResult", saved.into()),
            ("authority", "Local journal state only; use resume for verified remote delivery and reported payment evidence".into()),
        ]))
    }

    fn observation(&self, intent: &Intent) -> Result<Option<Value>> {
        if !present(&self.dir, "last-observation.json")? {
            return Ok(None);
        }
        let v = read_json(&self.dir, "last-observation.json", 8192)?;
        let fields = v.as_object().ok_or("invalid observation")?;
        if fields.len() != 5
            || fields.iter().any(|(key, _)| {
                !key.as_str().is_some_and(|key| {
                    ["schema", "taskId", "buyerJobId", "observedAt", "report"].contains(&key)
                })
            })
            || !v
                .get("observedAt")
                .and_then(Value::as_str)
                .is_some_and(valid_time)
        {
            return Err("invalid observation metadata".into());
        }
        if v.get("schema").and_then(Value::as_str) != Some("keryx-operator-observation-v1")
            || v.get("taskId").and_then(Value::as_str) != Some(&self.task.id)
            || v.get("buyerJobId").and_then(Value::as_str) != Some(&intent.query_id)
        {
            return Err("observation binding mismatch".into());
        }
        let report = v.get("report").ok_or("invalid observation")?;
        let state = report
            .pointer("/payment/state")
            .and_then(Value::as_str)
            .ok_or("invalid observation payment")?;
        let status = report
            .get("status")
            .and_then(Value::as_str)
            .ok_or("invalid observation status")?;
        let accounting = report
            .get("accountingAgreement")
            .and_then(Value::as_str)
            .ok_or("invalid observation accounting")?;
        if report.get("schema").and_then(Value::as_str) != Some("keryx-buyer-report-v1")
            || !["seller_reported_settled", "unconfirmed"].contains(&state)
            || ![
                "queued",
                "processing",
                "review_required",
                "completed",
                "failed",
                "not_found_uncertain",
            ]
            .contains(&status)
            || !["matches", "differs", "unavailable"].contains(&accounting)
        {
            return Err("unsupported observation".into());
        }
        Ok(Some(Value::object(vec![
            ("observedAt", v.get("observedAt").cloned().unwrap_or(Value::Null)),
            ("status", status.into()),
            ("payment", state.into()),
            ("accountingAgreement", accounting.into()),
            ("authority", "Last local GET observation; may be stale. Payment evidence and creator settlement remain seller-reported.".into()),
        ])))
    }

    pub fn result(&self) -> Result<Option<Value>> {
        if !present(&self.dir, "result.json")? {
            return Ok(None);
        }
        let intent = self
            .intent
            .as_ref()
            .ok_or("saved result has no matching buyer journal")?;
        let snapshot = read_json(&self.dir, "result.json", 150_000)?;
        let receipt_file = snapshot
            .get("receiptFile")
            .and_then(Value::as_str)
            .ok_or("invalid receipt filename")?;
        if receipt_file.len() != 77
            || !receipt_file.starts_with("receipt-")
            || !receipt_file.ends_with(".json")
            || !receipt_file.as_bytes()[8..72]
                .iter()
                .copied()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("invalid receipt filename".into());
        }
        let buyer = self
            .buyer
            .as_ref()
            .ok_or("saved result has no buyer directory")?;
        let receipt = read_json(buyer, receipt_file, 2_000_000)?;
        verify_result(&self.task, intent, &snapshot, &receipt).map(Some)
    }

    pub fn brief(&self) -> Result<String> {
        brief(&self.result()?.ok_or("no saved result")?)
    }
}

#[cfg(test)]
#[path = "io-tests.rs"]
mod tests;
