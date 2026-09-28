use crate::brief::brief;
use crate::domain::{parse_intent, parse_task, valid_time, Intent, Task};
use crate::json::Result;
use crate::result::verify_result;
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
};

fn checked_dir(path: &Path) -> Result<()> {
    // Windows canonicalize adds a \\?\ prefix to normal absolute paths, so string
    // comparison would reject every ordinary task. Inspect each ancestor instead.
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("directory path contains a parent traversal".into());
    }
    for ancestor in path.ancestors() {
        let meta = fs::symlink_metadata(ancestor).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() || reparse(&meta) {
            return Err("directory path contains a reparse point".into());
        }
    }
    if !fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("task path is not a directory".into());
    }
    Ok(())
}

#[cfg(windows)]
fn reparse(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn reparse(_meta: &fs::Metadata) -> bool {
    false
}

fn read_json(path: &Path, max: usize) -> Result<Value> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() || meta.file_type().is_symlink() || reparse(&meta) || meta.len() > max as u64
    {
        return Err("local file must be bounded and regular".into());
    }
    let file = open_regular(path)?;
    let opened = file.metadata().map_err(|e| e.to_string())?;
    if !opened.is_file() || reparse(&opened) || opened.len() > max as u64 {
        return Err("local file changed or exceeds limit".into());
    }
    let mut bytes = Vec::with_capacity(max.min(8192));
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > max {
        return Err("local file exceeds limit".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|e| e.to_string())?;
    serde_json::from_str(text).map_err(|e| format!("invalid local JSON: {e}"))
}

fn open_regular(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Open the reparse point itself so a replacement cannot silently redirect this read.
        options.custom_flags(0x0020_0000);
    }
    options.open(path).map_err(|e| e.to_string())
}

fn present(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

pub struct LocalTask {
    dir: PathBuf,
    task: Task,
    intent: Option<Intent>,
    stage: &'static str,
}

impl LocalTask {
    pub fn open(path: &Path) -> Result<Self> {
        let dir = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join(path)
        };
        checked_dir(&dir)?;
        let task = parse_task(
            &read_json(&dir.join("task.json"), 8192)?,
            &read_json(&dir.join("request.json"), 8192)?,
        )?;
        let buyer = dir.join("buyer");
        let (intent, stage) = if !present(&buyer)? {
            (None, "ready")
        } else {
            checked_dir(&buyer)?;
            if !present(&buyer.join("intent.json"))? {
                (None, "journal_incomplete")
            } else {
                let intent = parse_intent(&read_json(&buyer.join("intent.json"), 65536)?, &task)?;
                (Some(intent), "buyer_journaled")
            }
        };
        Ok(Self {
            dir,
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
        let saved = if !present(&self.dir.join("result.json"))? {
            "absent"
        } else {
            let m =
                fs::symlink_metadata(self.dir.join("result.json")).map_err(|e| e.to_string())?;
            if m.is_file() && !m.file_type().is_symlink() && !reparse(&m) && m.len() <= 150_000 {
                "present_unchecked"
            } else {
                "invalid"
            }
        };
        Ok(
            json!({"schema":"keryx-operator-task-status-v1","taskId":self.task.id,"createdAt":self.task.created_at,
            "kind":"paid_research","network":"eip155:5042002","stage":self.stage,
            "buyerJobId":self.intent.as_ref().map(|i|i.query_id.as_str()),"creatorBudgetMicros":
                (self.task.request["budget"].as_f64().unwrap()*1_000_000.0).round() as u64,
            "maxTotalMicros":self.task.cap.to_string(),"payment":"unknown","delivery":"unknown",
            "lastObservation":observation,"savedResult":saved,
            "authority":"Local journal state only; use resume for verified remote delivery and reported payment evidence"}),
        )
    }

    fn observation(&self, intent: &Intent) -> Result<Option<Value>> {
        let path = self.dir.join("last-observation.json");
        if !present(&path)? {
            return Ok(None);
        }
        let v = read_json(&path, 8192)?;
        let fields = v.as_object().ok_or("invalid observation")?;
        if fields.len() != 5
            || fields.keys().any(|k| {
                !["schema", "taskId", "buyerJobId", "observedAt", "report"].contains(&k.as_str())
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
        Ok(Some(
            json!({"observedAt":v.get("observedAt"),"status":status,"payment":state,"accountingAgreement":accounting,
            "authority":"Last local GET observation; may be stale. Payment evidence and creator settlement remain seller-reported."}),
        ))
    }

    pub fn result(&self) -> Result<Option<Value>> {
        let path = self.dir.join("result.json");
        if !present(&path)? {
            return Ok(None);
        }
        let intent = self
            .intent
            .as_ref()
            .ok_or("saved result has no matching buyer journal")?;
        let snapshot = read_json(&path, 150_000)?;
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
        let receipt = read_json(&self.dir.join("buyer").join(receipt_file), 2_000_000)?;
        verify_result(&self.task, intent, &snapshot, &receipt).map(Some)
    }

    pub fn brief(&self) -> Result<String> {
        brief(&self.result()?.ok_or("no saved result")?)
    }
}
