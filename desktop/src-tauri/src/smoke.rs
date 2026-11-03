use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SmokeConfig {
    pub root: PathBuf,
    #[serde(default)]
    debug_port: Option<u16>,
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
        fixture.browser_options()?;
        Ok(Some(fixture))
    }

    /// Only a validated, fresh smoke fixture can request a test CDP endpoint.
    /// No arbitrary browser flags or normal profile paths are accepted.
    pub fn browser_options(&self) -> Result<Option<(PathBuf, String)>, String> {
        let Some(port) = self.debug_port else {
            return Ok(None);
        };
        if port < 1024 || !self.root.is_absolute() {
            return Err("Invalid desktop smoke debug port or root".into());
        }
        // Different browser arguments require distinct WebView data directories.
        let profile = self.root.join(format!("webview-data-{port}"));
        match std::fs::symlink_metadata(&profile) {
            Ok(metadata) => {
                if !metadata.is_dir() || metadata.file_type().is_symlink() {
                    return Err("Desktop smoke browser profile must be a directory".into());
                }
                validate_existing(&self.root, &profile)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Desktop smoke browser profile is unavailable".into()),
        }
        // Preserve the pinned Wry default switches when setting explicit args.
        let arguments = format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-address=127.0.0.1 --remote-debugging-port={port} --remote-allow-origins=*");
        Ok(Some((profile, arguments)))
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

#[cfg(test)]
mod browser_option_tests {
    use super::SmokeConfig;

    fn fixture(port: serde_json::Value) -> Result<SmokeConfig, serde_json::Error> {
        serde_json::from_value(serde_json::json!({
            "root": std::env::temp_dir().join(format!("keryx-tauri-smoke-options-{}", std::process::id())),
            "debugPort": port,
        }))
    }

    #[test]
    fn missing_debug_port_adds_no_browser_options() {
        let config: SmokeConfig =
            serde_json::from_value(serde_json::json!({ "root": "unused" })).unwrap();
        assert!(config.browser_options().unwrap().is_none());
    }

    #[test]
    fn numeric_loopback_port_has_a_separate_confined_profile() {
        for port in [1024, 49152, 65535] {
            let config = fixture(serde_json::json!(port)).unwrap();
            let (profile, arguments) = config.browser_options().unwrap().unwrap();
            assert_eq!(profile.parent(), Some(config.root.as_path()));
            assert_eq!(
                profile.file_name().unwrap(),
                format!("webview-data-{port}").as_str()
            );
            assert!(arguments.contains("--remote-debugging-address=127.0.0.1"));
            assert!(arguments.contains(&format!("--remote-debugging-port={port} ")));
            assert!(arguments
                .starts_with("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection "));
        }
    }

    #[test]
    fn rejects_privileged_ports_and_relative_roots() {
        for port in [0, 80, 1023] {
            assert!(fixture(serde_json::json!(port))
                .unwrap()
                .browser_options()
                .is_err());
        }
        let mut config = fixture(serde_json::json!(49152)).unwrap();
        config.root = "relative-fixture".into();
        assert!(config.browser_options().is_err());
    }

    #[test]
    fn rejects_non_integer_ports_overflow_and_arbitrary_flags() {
        for port in [
            serde_json::json!(-1),
            serde_json::json!(65536),
            serde_json::json!(1.5),
            serde_json::json!("49152 --unsafe-switch"),
        ] {
            assert!(fixture(port).is_err());
        }
        assert!(serde_json::from_value::<SmokeConfig>(serde_json::json!({
            "root": "unused", "additionalBrowserArguments": "--unsafe-switch"
        }))
        .is_err());
    }

    #[test]
    fn existing_profile_must_be_a_directory_within_the_fixture() {
        let mut config = fixture(serde_json::json!(49152)).unwrap();
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        config.root = std::env::temp_dir().join(format!(
            "keryx-tauri-smoke-options-profile-{}-{nonce}",
            std::process::id()
        ));
        assert!(config.root.is_absolute());
        std::fs::create_dir(&config.root).unwrap();
        config.root = config.root.canonicalize().unwrap();
        let profile = config.root.join("webview-data-49152");
        std::fs::write(&profile, b"").unwrap();
        assert!(config.browser_options().is_err());
        std::fs::remove_file(&profile).unwrap();
        std::fs::create_dir(&profile).unwrap();
        assert!(config.browser_options().unwrap().is_some());
        std::fs::remove_dir(&profile).unwrap();
        std::fs::remove_dir(&config.root).unwrap();
    }
}
