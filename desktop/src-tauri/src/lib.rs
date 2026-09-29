mod helper_protocol;
mod host;
mod smoke;

use host::Host;
use smoke::SmokeConfig;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

struct HostState(Result<Arc<Host>, String>);
struct SmokeState(Result<Option<SmokeConfig>, String>);

fn smoke_selection(
    smoke: &State<'_, SmokeState>,
    action: &str,
) -> Result<Option<Option<String>>, String> {
    match &smoke.0 {
        Ok(Some(config)) => Ok(Some(config.selected(action).map(path_string).transpose()?)),
        Ok(None) => Ok(None),
        Err(error) => Err(error.clone()),
    }
}

fn local_app_url(url: &tauri::Url) -> bool {
    let local = (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
        || (url.scheme() == "tauri" && url.host_str() == Some("localhost"));
    local
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && (url.path() == "/" || url.path() == "/index.html")
        && url.query().is_none()
        && url.fragment().is_none()
}

#[cfg(test)]
mod local_url_tests {
    use super::local_app_url;

    #[test]
    fn allows_only_the_built_in_main_document_origin() {
        for url in [
            "http://tauri.localhost/",
            "http://tauri.localhost/index.html",
            "tauri://localhost/",
        ] {
            assert!(local_app_url(&url.parse().unwrap()), "{url}");
        }
        for url in [
            "http://tauri.localhost:8080/",
            "http://operator@tauri.localhost/",
            "http://operator:secret@tauri.localhost/",
            "http://tauri.localhost.evil/",
            "https://tauri.localhost/",
            "http://tauri.localhost/other",
            "http://tauri.localhost/?next=/",
            "http://tauri.localhost/#app",
            "tauri://localhost:42/",
        ] {
            assert!(!local_app_url(&url.parse().unwrap()), "{url}");
        }
    }
}

fn check_caller(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main"
        || !local_app_url(&window.url().map_err(|_| "Untrusted desktop window")?)
    {
        return Err("Untrusted desktop window".into());
    }
    Ok(())
}

fn path_string(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "The chosen path cannot be represented without changing its name".into())
}

fn handle_is_valid(handle: &str) -> bool {
    let bytes = handle.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(position, byte)| {
            if [8, 13, 18, 23].contains(&position) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

async fn helper_call(
    host: &State<'_, HostState>,
    action: &'static str,
    payload: String,
    timeout: Duration,
) -> Result<String, String> {
    let host = Arc::clone(host.0.as_ref().map_err(|message| {
        format!("{message}. Reinstall the current Keryx desktop release if this persists.")
    })?);
    tauri::async_runtime::spawn_blocking(move || host.call(action, payload, timeout))
        .await
        .map_err(|_| "Helper operation could not complete".to_string())?
}

fn json_payload(value: serde_json::Value) -> String {
    value.to_string()
}

async fn pick_folder(
    window: &WebviewWindow,
    title: &'static str,
) -> Result<Option<String>, String> {
    let window = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let folder = window
            .app_handle()
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(title)
            .blocking_pick_folder();
        folder
            .map(|path| {
                path.into_path()
                    .map_err(|_| "Only local folders are supported".to_string())
                    .and_then(path_string)
            })
            .transpose()
    })
    .await
    .map_err(|_| "Folder picker failed".to_string())?
}

async fn pick_reference(window: &WebviewWindow) -> Result<Option<String>, String> {
    let window = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let selected = window
            .app_handle()
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Import a local reference")
            .add_filter("Text or Markdown", &["txt", "md", "markdown"])
            .blocking_pick_file();
        selected
            .map(|path| {
                path.into_path()
                    .map_err(|_| "Only local files are supported".to_string())
                    .and_then(path_string)
            })
            .transpose()
    })
    .await
    .map_err(|_| "Reference picker failed".to_string())?
}

async fn save_destination(
    window: &WebviewWindow,
    title: &'static str,
    file_name: &'static str,
    extension: &'static str,
) -> Result<Option<String>, String> {
    let window = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let selected = window
            .app_handle()
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(title)
            .set_file_name(file_name)
            .add_filter(extension, &[extension])
            .blocking_save_file();
        selected
            .map(|path| {
                path.into_path()
                    .map_err(|_| "Only local export paths are supported".to_string())
                    .and_then(path_string)
            })
            .transpose()
    })
    .await
    .map_err(|_| "Save picker failed".to_string())?
}

#[tauri::command]
async fn choose_workspace(
    window: WebviewWindow,
    host: State<'_, HostState>,
    smoke: State<'_, SmokeState>,
) -> Result<String, String> {
    check_caller(&window)?;
    let selection = match smoke_selection(&smoke, "choose_workspace")? {
        Some(value) => value,
        None => pick_folder(&window, "Open Operator workspace").await?,
    };
    let Some(path) = selection else {
        return Ok("null".into());
    };
    helper_call(
        &host,
        "choose_workspace",
        json_payload(serde_json::json!({ "path": path })),
        Duration::from_secs(30),
    )
    .await
}

#[tauri::command]
async fn create_workspace(
    window: WebviewWindow,
    host: State<'_, HostState>,
    smoke: State<'_, SmokeState>,
) -> Result<String, String> {
    check_caller(&window)?;
    let selection = match smoke_selection(&smoke, "create_workspace")? {
        Some(value) => value,
        None => pick_folder(&window, "Choose a private parent folder").await?,
    };
    let Some(parent) = selection else {
        return Ok("null".into());
    };
    helper_call(
        &host,
        "create_workspace",
        json_payload(serde_json::json!({ "parent": parent })),
        Duration::from_secs(45),
    )
    .await
}

#[tauri::command]
async fn refresh(window: WebviewWindow, host: State<'_, HostState>) -> Result<String, String> {
    check_caller(&window)?;
    helper_call(&host, "refresh", "{}".into(), Duration::from_secs(30)).await
}

#[tauri::command]
async fn create_task(
    window: WebviewWindow,
    host: State<'_, HostState>,
    input: String,
) -> Result<String, String> {
    check_caller(&window)?;
    if input.len() > 16 * 1024 || !input.starts_with('{') || !input.ends_with('}') {
        return Err("Invalid task input".into());
    }
    // The inner JS JSON is deliberately opaque to Rust. JS can carry legacy lone UTF-16
    // surrogate escapes that serde_json would reject before the TypeScript domain validates them.
    let payload = format!("{{\"input\":{input}}}");
    helper_call(&host, "create_task", payload, Duration::from_secs(45)).await
}

#[tauri::command]
async fn resume_task(
    window: WebviewWindow,
    host: State<'_, HostState>,
    handle: String,
) -> Result<String, String> {
    check_caller(&window)?;
    if !handle_is_valid(&handle) {
        return Err("Invalid task handle".into());
    }
    helper_call(
        &host,
        "resume_task",
        json_payload(serde_json::json!({ "handle": handle })),
        Duration::from_secs(90),
    )
    .await
}

#[tauri::command]
async fn read_result(
    window: WebviewWindow,
    host: State<'_, HostState>,
    handle: String,
) -> Result<String, String> {
    check_caller(&window)?;
    if !handle_is_valid(&handle) {
        return Err("Invalid task handle".into());
    }
    helper_call(
        &host,
        "read_result",
        json_payload(serde_json::json!({ "handle": handle })),
        Duration::from_secs(30),
    )
    .await
}

async fn export(
    window: WebviewWindow,
    host: State<'_, HostState>,
    smoke: State<'_, SmokeState>,
    handle: String,
    action: &'static str,
    title: &'static str,
    file_name: &'static str,
    extension: &'static str,
) -> Result<String, String> {
    check_caller(&window)?;
    if !handle_is_valid(&handle) {
        return Err("Invalid task handle".into());
    }
    let selection = match smoke_selection(&smoke, action)? {
        Some(value) => value,
        None => save_destination(&window, title, file_name, extension).await?,
    };
    let Some(path) = selection else {
        return Ok("false".into());
    };
    helper_call(
        &host,
        action,
        json_payload(serde_json::json!({ "handle": handle, "path": path })),
        Duration::from_secs(45),
    )
    .await
}

#[tauri::command]
async fn export_brief(
    window: WebviewWindow,
    host: State<'_, HostState>,
    smoke: State<'_, SmokeState>,
    handle: String,
) -> Result<String, String> {
    export(
        window,
        host,
        smoke,
        handle,
        "export_brief",
        "Export private research brief",
        "private-research-brief.md",
        "md",
    )
    .await
}

#[tauri::command]
async fn export_task(
    window: WebviewWindow,
    host: State<'_, HostState>,
    smoke: State<'_, SmokeState>,
    handle: String,
) -> Result<String, String> {
    export(
        window,
        host,
        smoke,
        handle,
        "export_task",
        "Export private task status",
        "operator-task-status.json",
        "json",
    )
    .await
}

#[tauri::command]
async fn import_reference(
    window: WebviewWindow,
    host: State<'_, HostState>,
    smoke: State<'_, SmokeState>,
) -> Result<String, String> {
    check_caller(&window)?;
    let selection = match smoke_selection(&smoke, "import_reference")? {
        Some(value) => value,
        None => pick_reference(&window).await?,
    };
    let Some(path) = selection else {
        return Ok("null".into());
    };
    helper_call(
        &host,
        "import_reference",
        json_payload(serde_json::json!({ "path": path })),
        Duration::from_secs(45),
    )
    .await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri::plugin::Builder::<_, ()>::new("local-navigation")
                .on_navigation(|_webview, url| local_app_url(url))
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            choose_workspace,
            create_workspace,
            refresh,
            create_task,
            resume_task,
            read_result,
            export_brief,
            export_task,
            import_reference,
        ])
        .setup(|app| {
            let smoke = SmokeConfig::from_env();
            let host = match &smoke {
                Ok(config) => Host::start(&app.handle(), config.as_ref()).map(Arc::new),
                Err(error) => Err(error.clone()),
            };
            app.manage(SmokeState(smoke));
            app.manage(HostState(host));
            let main = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or_else(|| {
                    std::io::Error::other("The main desktop window is missing from configuration")
                })?;
            tauri::WebviewWindowBuilder::from_config(app, main)?
                .on_navigation(local_app_url)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(host) = &window.app_handle().state::<HostState>().0 {
                    host.terminate();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Keryx desktop could not start");
}
