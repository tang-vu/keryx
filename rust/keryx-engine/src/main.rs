use keryx_core::LocalTask;
use std::{env, fs::OpenOptions, io::Write, path::PathBuf};

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args
        .next()
        .ok_or("usage: keryx-engine status|result|brief --state PATH [--file PATH]")?;
    let mut state = None;
    let mut output = None;
    while let Some(flag) = args.next() {
        let value = args.next().ok_or("missing flag value")?;
        match flag.as_str() {
            "--state" if state.is_none() => state = Some(PathBuf::from(value)),
            "--file" if output.is_none() => output = Some(PathBuf::from(value)),
            _ => return Err("unsupported or repeated CLI flag".into()),
        }
    }
    let state = state.ok_or("--state is required")?;
    let task = LocalTask::open(&state)?;
    let text = match command.as_str() {
        "status" => serde_json::to_string(&task.status()?).map_err(|e| e.to_string())?,
        "result" => serde_json::to_string(&task.result()?.ok_or("no saved result")?)
            .map_err(|e| e.to_string())?,
        "brief" => task.brief()?,
        _ => return Err("unsupported command".into()),
    };
    if let Some(path) = output {
        if command != "brief" {
            return Err("--file is only supported for brief".into());
        }
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&path)
            .map_err(|e| format!("cannot create brief: {e}"))?;
        file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        println!(
            "{}",
            serde_json::json!({"file":path,"engineProtocol":"keryx-rust-local-v1"})
        );
    } else {
        println!("{text}");
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("keryx-engine: {error}");
        std::process::exit(1);
    }
}
