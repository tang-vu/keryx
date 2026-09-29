use crate::helper_protocol;
use crate::smoke::SmokeConfig;
use sha2::{Digest, Sha256};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{path::BaseDirectory, AppHandle, Manager};

struct Rpc {
    id: u64,
    action: &'static str,
    payload: String,
    answer: mpsc::Sender<Result<Result<String, String>, String>>,
}

pub struct Host {
    tx: mpsc::Sender<Rpc>,
    child: Arc<Mutex<Child>>,
    failed: Arc<AtomicBool>,
    gate: Mutex<u64>,
    #[cfg(windows)]
    job: Arc<WindowsJob>,
}

fn verify_digest(path: &Path, expected: &str, max_bytes: u64) -> Result<(), String> {
    let mut file = std::fs::File::open(path).map_err(|_| "Packaged helper resource is missing")?;
    let metadata = file
        .metadata()
        .map_err(|_| "Packaged helper resource cannot be read")?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err("Packaged helper resource is invalid or too large".into());
    }
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut total = 0u64;
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "Packaged helper resource cannot be read")?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > max_bytes {
            return Err("Packaged helper resource is too large".into());
        }
        digest.update(&buffer[..count]);
    }
    let actual = format!("{:x}", digest.finalize());
    if actual != expected {
        return Err("Packaged helper resource has changed".into());
    }
    Ok(())
}

fn resource(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(name, BaseDirectory::Resource)
        .map_err(|_| "Packaged helper resource could not be resolved".into())
}

fn path_text(path: &Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| "A local path cannot be represented without changing its name".into())
}

impl Host {
    pub fn start(app: &AppHandle, smoke: Option<&SmokeConfig>) -> Result<Self, String> {
        let source_commit = env!("KERYX_SOURCE_COMMIT");
        let source_path = resource(app, "dist/source-commit.txt")?;
        let mut source_file =
            std::fs::File::open(source_path).map_err(|_| "Packaged source identity is missing")?;
        if source_file
            .metadata()
            .map_err(|_| "Packaged source identity cannot be read")?
            .len()
            > 64
        {
            return Err("Packaged source identity is too large".into());
        }
        let mut source_data = String::new();
        source_file
            .take(65)
            .read_to_string(&mut source_data)
            .map_err(|_| "Packaged source identity cannot be read")?;
        if source_data.len() > 64 || source_data.trim() != source_commit {
            return Err("Packaged source identity does not match this app".into());
        }
        let runtime = resource(app, "dist/runtime/node.exe")?;
        let helper = resource(app, "dist/helper.cjs")?;
        let binary = resource(app, "dist/native/keryx-engine.exe")?;
        let manifest = resource(app, "dist/native/manifest.json")?;
        verify_digest(&runtime, env!("KERYX_NODE_SHA256"), 200 * 1024 * 1024)?;
        verify_digest(&helper, env!("KERYX_HELPER_SHA256"), 32 * 1024 * 1024)?;
        let data_dir = if let Some(smoke) = smoke {
            smoke.root.join("app-data")
        } else {
            app.path()
                .app_local_data_dir()
                .map_err(|_| "Desktop data directory is unavailable")?
        };
        std::fs::create_dir_all(&data_dir)
            .map_err(|_| "Desktop data directory cannot be created")?;
        let selection = data_dir.join("workspace.json");
        let legacy_selection = if smoke.is_some() {
            None
        } else {
            std::env::var_os("APPDATA").map(|directory| {
                PathBuf::from(directory)
                    .join("keryx-operator-desktop")
                    .join("workspace.json")
            })
        };

        let mut command = Command::new(&runtime);
        command
            .arg(&helper)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        command.current_dir(runtime.parent().ok_or("Invalid packaged runtime path")?);
        command.env_clear();
        for name in [
            "SystemRoot",
            "WINDIR",
            "TEMP",
            "TMP",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
        ] {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        command.env("NODE_ENV", "production");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|_| "Packaged helper could not start")?;
        #[cfg(windows)]
        let job = match WindowsJob::assign(&child) {
            Ok(job) => Arc::new(job),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let stdin = child
            .stdin
            .take()
            .ok_or("Helper input pipe is unavailable")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Helper output pipe is unavailable")?;
        let child = Arc::new(Mutex::new(child));
        let failed = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel::<Rpc>();
        let worker_failed = Arc::clone(&failed);
        let worker_child = Arc::clone(&child);
        #[cfg(windows)]
        let worker_job = Arc::clone(&job);
        std::thread::Builder::new()
            .name("keryx-desktop-helper".into())
            .spawn(move || {
                let mut input = stdin;
                let mut output = BufReader::new(stdout);
                while let Ok(request) = rx.recv() {
                    if worker_failed.load(Ordering::SeqCst) {
                        let _ = request.answer.send(Err("Helper is unavailable".into()));
                        continue;
                    }
                    let outcome = helper_protocol::exchange(
                        &mut input,
                        &mut output,
                        request.id,
                        request.action,
                        &request.payload,
                    );
                    if outcome.is_err() {
                        worker_failed.store(true, Ordering::SeqCst);
                        #[cfg(windows)]
                        worker_job.terminate();
                        if let Ok(mut child) = worker_child.lock() {
                            let _ = child.kill();
                        }
                    }
                    let bad = outcome.is_err();
                    let _ = request.answer.send(outcome);
                    if bad {
                        break;
                    }
                }
            })
            .map_err(|_| "Helper transport could not start")?;
        let host = Self {
            tx,
            child,
            failed,
            gate: Mutex::new(0),
            #[cfg(windows)]
            job,
        };
        let init = serde_json::json!({
            "sourceCommit": source_commit,
            "nativeBinary": path_text(&binary)?,
            "nativeManifest": path_text(&manifest)?,
            "selectionFile": path_text(&selection)?,
            "legacySelectionFile": legacy_selection.as_deref().map(path_text).transpose()?,
        });
        host.call("init", init.to_string(), Duration::from_secs(20))?;
        Ok(host)
    }

    pub fn call(
        &self,
        action: &'static str,
        payload: String,
        timeout: Duration,
    ) -> Result<String, String> {
        let mut sequence = self
            .gate
            .try_lock()
            .map_err(|_| "Another desktop operation is in progress")?;
        if self.failed.load(Ordering::SeqCst) {
            return Err("Helper is unavailable. Preserve the selected workspace, restart the app and inspect recent task folders before creating another task.".into());
        }
        *sequence += 1;
        let (answer_tx, answer_rx) = mpsc::channel();
        self.tx
            .send(Rpc {
                id: *sequence,
                action,
                payload,
                answer: answer_tx,
            })
            .map_err(|_| "Helper transport closed")?;
        match answer_rx.recv_timeout(timeout) {
            Ok(Ok(Ok(result))) => Ok(result),
            Ok(Ok(Err(message))) => Err(message),
            Ok(Err(message)) => Err(format!("{message}. Preserve the selected workspace, restart the app and inspect recent task folders before creating another task.")),
            Err(_) => {
                self.terminate();
                Err("Helper did not confirm this operation. Preserve the selected workspace, restart the app and inspect recent task folders before creating another task.".into())
            }
        }
    }

    pub fn terminate(&self) {
        self.failed.store(true, Ordering::SeqCst);
        #[cfg(windows)]
        self.job.terminate();
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[cfg(windows)]
struct WindowsJob(isize);

#[cfg(windows)]
impl WindowsJob {
    fn assign(child: &Child) -> Result<Self, String> {
        use std::mem::{size_of, zeroed};
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("Could not contain packaged helper process".into());
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) != 0;
            let assigned =
                configured && AssignProcessToJobObject(job, child.as_raw_handle() as _) != 0;
            if !assigned {
                CloseHandle(job);
                return Err("Could not contain packaged helper process".into());
            }
            Ok(Self(job as isize))
        }
    }

    fn terminate(&self) {
        unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0 as _, 1) };
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0 as _) };
    }
}
