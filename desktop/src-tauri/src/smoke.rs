use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SmokeConfig {
    pub root: PathBuf,
    pub open_workspace: Option<PathBuf>,
    pub create_workspace_parent: Option<PathBuf>,
    pub import_reference: Option<PathBuf>,
    pub export_brief: Option<PathBuf>,
    pub export_task: Option<PathBuf>,
}

impl SmokeConfig {
    pub fn from_env() -> Result<Option<Self>, String> {
        let Some(path) = std::env::var_os("KERYX_DESKTOP_SMOKE_CONFIG") else {
            return Ok(None);
        };
        let path = PathBuf::from(path);
        if !path.is_absolute()
            || path.file_name().and_then(|name| name.to_str()) != Some("smoke.json")
        {
            return Err("Invalid desktop smoke fixture path".into());
        }
        let metadata =
            std::fs::symlink_metadata(&path).map_err(|_| "Desktop smoke fixture is missing")?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 4096 {
            return Err("Invalid desktop smoke fixture".into());
        }
        let data = std::fs::read(&path).map_err(|_| "Desktop smoke fixture cannot be read")?;
        if data.len() > 4096 {
            return Err("Desktop smoke fixture is too large".into());
        }
        let mut fixture: SmokeConfig =
            serde_json::from_slice(&data).map_err(|_| "Invalid desktop smoke fixture format")?;
        let temporary = std::env::temp_dir()
            .canonicalize()
            .map_err(|_| "Desktop smoke temporary directory is unavailable")?;
        let root = fixture
            .root
            .canonicalize()
            .map_err(|_| "Desktop smoke root is unavailable")?;
        if root.parent() != Some(temporary.as_path())
            || !root
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("keryx-tauri-smoke-"))
            || path.parent().and_then(|parent| parent.canonicalize().ok()) != Some(root.clone())
        {
            return Err("Desktop smoke paths must stay inside a fresh synthetic fixture".into());
        }
        let created = std::fs::metadata(&root)
            .and_then(|value| value.created())
            .map_err(|_| "Desktop smoke fixture creation time is unavailable")?;
        if SystemTime::now()
            .duration_since(created)
            .unwrap_or(Duration::MAX)
            > Duration::from_secs(3600)
        {
            return Err("Desktop smoke fixture is stale".into());
        }
        for item in [
            &fixture.open_workspace,
            &fixture.create_workspace_parent,
            &fixture.import_reference,
        ] {
            if let Some(path) = item {
                validate_existing(&root, path)?;
            }
        }
        for item in [&fixture.export_brief, &fixture.export_task] {
            if let Some(path) = item {
                validate_new_target(&root, path)?;
            }
        }
        fixture.root = root;
        Ok(Some(fixture))
    }

    pub fn selected(&self, action: &str) -> Option<PathBuf> {
        match action {
            "choose_workspace" => self.open_workspace.clone(),
            "create_workspace" => self.create_workspace_parent.clone(),
            "import_reference" => self.import_reference.clone(),
            "export_brief" => self.export_brief.clone(),
            "export_task" => self.export_task.clone(),
            _ => None,
        }
    }
}

fn inside(root: &Path, path: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn validate_existing(root: &Path, path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Desktop smoke path is not absolute".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "Desktop smoke input is missing")?;
    if !inside(root, &canonical) {
        return Err("Desktop smoke input escapes its fixture".into());
    }
    Ok(())
}

fn validate_new_target(root: &Path, path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.exists() {
        return Err("Desktop smoke output target must be new".into());
    }
    let parent = path
        .parent()
        .ok_or("Desktop smoke output has no parent")?
        .canonicalize()
        .map_err(|_| "Desktop smoke output parent is missing")?;
    if !inside(root, &parent) || path.file_name().is_none() {
        return Err("Desktop smoke output escapes its fixture".into());
    }
    Ok(())
}
