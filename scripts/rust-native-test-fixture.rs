//! Test-only subprocess fixture for the native read-only transport acceptance drill.
//! This file is compiled into a temporary directory and is never packaged with Keryx.
use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process;
use std::thread;
use std::time::Duration;

fn main() {
    let directory = env::current_exe()
        .expect("fixture executable path")
        .parent()
        .expect("fixture parent")
        .to_path_buf();
    let mode = fs::read_to_string(directory.join("mode.txt")).unwrap_or_else(|_| "normal".into());
    fs::write(directory.join("launched.txt"), b"launched").unwrap();
    let command = env::args().nth(1).expect("fixture command");
    if command == "protocol" {
        match mode.trim() {
            "protocol_wrong" => print!("{{\"protocol\":\"wrong\",\"engine\":\"keryx-engine\"}}"),
            "protocol_invalid_utf8" => io::stdout().write_all(&[0xff]).unwrap(),
            "protocol_nonzero" => process::exit(7),
            "protocol_hang" => hang(&directory),
            "protocol_delay" | "both_delay" => {
                thread::sleep(Duration::from_secs(2));
                print!("{{\"protocol\":\"keryx-readonly-cli-v1\",\"engine\":\"keryx-engine\"}}")
            }
            _ => print!("{{\"protocol\":\"keryx-readonly-cli-v1\",\"engine\":\"keryx-engine\"}}"),
        }
        return;
    }
    if !["status", "result", "brief"].contains(&command.as_str())
        || env::args().nth(2).as_deref() != Some("--state")
        || env::args().nth(3).is_none()
        || env::args().nth(4).is_some()
    {
        process::exit(9);
    }
    fs::write(directory.join("command-called.txt"), command.as_bytes()).unwrap();
    match mode.trim() {
        "command_nonzero" => process::exit(8),
        "command_hang" => hang(&directory),
        "command_late_success" => thread::sleep(Duration::from_secs(3)),
        "command_delay" | "both_delay" => thread::sleep(Duration::from_secs(2)),
        "command_oversize_stderr" => {
            io::stderr().write_all(&vec![b'e'; 20_000]).unwrap();
        }
        _ => {}
    }
    let bytes =
        fs::read(directory.join("response.bin")).unwrap_or_else(|_| b"fixture brief\n".to_vec());
    io::stdout().write_all(&bytes).unwrap();
}

fn hang(directory: &PathBuf) -> ! {
    fs::write(directory.join("active.pid"), process::id().to_string()).unwrap();
    loop {
        thread::sleep(Duration::from_secs(60));
    }
}
