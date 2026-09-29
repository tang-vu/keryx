use keryx_core::{stringify, LocalTask};
use std::{
    env,
    io::Write,
    path::{Component, Path, PathBuf},
};

#[path = "brief-export.rs"]
mod brief_export;
mod writer;

// Match Node's path.resolve for CLI output paths without resolving symlinks.
// Opening this path too matters: a symlink followed by `..` must have the same
// lexical target that the TypeScript export opens.
fn resolve_output_path(path: &Path) -> Result<PathBuf, String> {
    let absolute =
        std::path::absolute(path).map_err(|e| format!("cannot resolve brief path: {e}"))?;
    let mut resolved = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
            }
            component => resolved.push(component.as_os_str()),
        }
    }
    Ok(resolved)
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.first().is_some_and(|command| command == "protocol") {
        if args.len() != 1 {
            return Err("protocol accepts no flags".into());
        }
        // This query never opens a task or reads private state.
        println!("{}", protocol_json());
        return Ok(());
    }
    let mut args = args.into_iter();
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
        "status" => stringify(&task.status()?)?,
        "result" => stringify(&task.result()?.ok_or("no saved result")?)?,
        "brief" => task.brief()?,
        _ => return Err("unsupported command".into()),
    };
    if let Some(path) = output {
        if command != "brief" {
            return Err("--file is only supported for brief".into());
        }
        let path = resolve_output_path(&path)?;
        brief_export::publish_private_brief(&path, &text)?;
        println!("{}", serde_json::json!({"saved":path,"private":true}));
    } else {
        println!("{text}");
    }
    Ok(())
}

fn protocol_json() -> &'static str {
    r#"{"protocol":"keryx-readonly-cli-v1","engine":"keryx-engine"}"#
}

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if let Some(result) = writer::run(&args) {
        let success = result.is_ok();
        let value = result.unwrap_or_else(|error| error);
        let mut stdout = std::io::stdout().lock();
        if serde_json::to_writer(&mut stdout, &value).is_err()
            || stdout.write_all(b"\n").is_err()
            || stdout.flush().is_err()
        {
            std::process::exit(1);
        }
        if !success {
            std::process::exit(1);
        }
        return;
    }
    if let Err(error) = run() {
        eprintln!("keryx-engine: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{protocol_json, resolve_output_path};
    use std::path::Path;

    #[test]
    fn protocol_query_is_two_fixed_fields() {
        assert_eq!(
            protocol_json(),
            r#"{"protocol":"keryx-readonly-cli-v1","engine":"keryx-engine"}"#
        );
    }

    #[test]
    fn output_path_is_absolute_and_lexically_clean() {
        let cwd = std::env::current_dir().unwrap();
        assert_eq!(resolve_output_path(Path::new(".")).unwrap(), cwd);
        assert_eq!(
            resolve_output_path(Path::new("./part/../brief.md")).unwrap(),
            cwd.join("brief.md")
        );
        assert_eq!(
            resolve_output_path(Path::new("../brief.md")).unwrap(),
            cwd.parent().unwrap().join("brief.md")
        );
        assert_eq!(resolve_output_path(Path::new("./part/../")).unwrap(), cwd);
    }

    #[test]
    fn output_path_does_not_walk_above_root() {
        let root = resolve_output_path(Path::new("/")).unwrap();
        assert_eq!(
            resolve_output_path(&root.join("../brief.md")).unwrap(),
            root.join("brief.md")
        );
    }
}
