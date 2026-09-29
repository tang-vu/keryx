use sha2::{Digest, Sha256};
use std::{env, fs, path::PathBuf, process::Command};

fn hash(path: &PathBuf) -> String {
    let bytes =
        fs::read(path).unwrap_or_else(|error| panic!("Cannot read {}: {error}", path.display()));
    format!("{:x}", Sha256::digest(bytes))
}

fn main() {
    let here =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("Missing Cargo manifest directory"));
    let root = here
        .join("../..")
        .canonicalize()
        .expect("Missing repository root");
    let dist = here.join("../dist");
    let commit = fs::read_to_string(dist.join("source-commit.txt"))
        .expect("Build the clean desktop source first")
        .trim()
        .to_owned();
    assert!(
        commit.len() == 40 && commit.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "Invalid source commit"
    );
    let head = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&root)
        .output()
        .expect("Cannot resolve source commit");
    assert!(
        head.status.success() && String::from_utf8_lossy(&head.stdout).trim() == commit,
        "Desktop source identity differs from checkout HEAD"
    );
    let status = Command::new("git")
        .args(["status", "--porcelain", "--untracked-files=all"])
        .current_dir(&root)
        .output()
        .expect("Cannot inspect checkout");
    assert!(
        status.status.success() && status.stdout.is_empty(),
        "Commit source changes before building desktop release"
    );
    println!("cargo:rustc-env=KERYX_SOURCE_COMMIT={commit}");
    println!(
        "cargo:rustc-env=KERYX_HELPER_SHA256={}",
        hash(&dist.join("helper.cjs"))
    );
    println!(
        "cargo:rustc-env=KERYX_NODE_SHA256={}",
        hash(&dist.join("runtime/node.exe"))
    );
    println!(
        "cargo:rerun-if-changed={}",
        dist.join("helper.cjs").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        dist.join("runtime/node.exe").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        dist.join("source-commit.txt").display()
    );
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "choose_workspace",
            "create_workspace",
            "refresh",
            "create_task",
            "resume_task",
            "read_result",
            "export_brief",
            "export_task",
            "import_reference",
        ]),
    ))
    .expect("Tauri build metadata failed");
}
