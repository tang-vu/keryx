#!/usr/bin/env python3
"""Finite Linux origin observation. Binary stdout only with --profile; JSON stderr.

This is an operator diagnostic mechanism, not operational/recovery authorization.
It never starts PM2, evaluates application code, changes flags or restarts a role.
"""
import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

MAX_DATA = 2 * 1024 * 1024
MAX_LOG = 16 * 1024
CHILD_ENV = {"PATH": "/usr/bin:/bin", "HOME": "/root", "LC_ALL": "C", "DEBUGINFOD_URLS": "", "PERF_CONFIG": "/dev/null"}


class Refused(Exception):
    pass


def bounded_read(path, limit):
    with open(path, "rb") as stream:
        value = stream.read(limit + 1)
    if len(value) > limit:
        raise Refused("input-bound")
    return value


def stat_fields(text):
    fields = text[text.rindex(")") + 2:].split()
    if len(fields) < 22:
        raise Refused("process-stat")
    return {"state": fields[0], "parent": int(fields[1]), "start": int(fields[19]),
            "ticks": int(fields[11]) + int(fields[12]), "rss": int(fields[21]) * os.sysconf("SC_PAGE_SIZE")}


def role_commands(config, source):
    if not isinstance(config, dict):
        raise Refused("role-config")
    apps = config.get("apps", [])
    if not isinstance(apps, list) or len(apps) != 2 or not all(isinstance(app, dict) and isinstance(app.get("name"), str) for app in apps) or {app.get("name") for app in apps} != {"keryx", "keryx-a2a-worker"}:
        raise Refused("role-config")
    root = "/root/.local/share/keryx-releases/" + source + "/source/"
    common = ["/usr/bin/node", "--env-file=/root/keryx/.env.local"]
    commands = {"keryx": common + [root + "scripts/next-immutable-server.mjs", "--port", "3939"],
                "keryx-a2a-worker": common + ["--import", root + "node_modules/tsx/dist/loader.mjs", root + "scripts/a2a-research-worker.mts"]}
    prefix = ["-i", "PATH=/usr/bin:/bin", "NODE_ENV=production", "KERYX_DECISION_BRIEF=0", "KERYX_COMMIT=" + source]
    for app in apps:
        if app.get("script") != "/usr/bin/env" or app.get("interpreter") != "none" or app.get("cwd") != "/root/keryx" or app.get("args") != prefix + commands[app["name"]]:
            raise Refused("role-config")
    return commands


def load_config(args):
    path = Path(args.config)
    if not re.fullmatch(r"/root/\.local/share/keryx-private-release-archives/[a-z0-9][a-z0-9-]{0,100}/roles\.json", str(path)) or path.resolve() != path:
        raise Refused("config-location")
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1:
        raise Refused("config-file")
    value = bounded_read(path, 65_536)
    if hashlib.sha256(value).hexdigest() != args.config_sha256:
        raise Refused("config-digest")
    return role_commands(json.loads(value), args.source)


def process_facts(pid):
    root = Path("/proc") / str(pid)
    value = stat_fields(bounded_read(root / "stat", 4096).decode())
    uids = next(line.split()[1:] for line in bounded_read(root / "status", 32_768).decode().splitlines() if line.startswith("Uid:"))
    executable = (root / "exe").stat()
    selected = {b"PATH", b"NODE_ENV", b"KERYX_COMMIT", b"KERYX_DECISION_BRIEF"}
    environment = {}
    for entry in bounded_read(root / "environ", 65_536).split(b"\0"):
        key, separator, content = entry.partition(b"=")
        if separator and key in selected:
            environment[key.decode()] = content.decode()
    value.update({"pid": pid, "uid": [int(x) for x in uids], "exe": [executable.st_dev, executable.st_ino], "environment": environment,
                  "cwd": os.readlink(root / "cwd"), "argv": bounded_read(root / "cmdline", 16_384).rstrip(b"\0").decode().split("\0")})
    return value


def verify_facts(args, commands, facts, daemon_pid, node_identity):
    if daemon_pid != args.daemon_pid or len({args.web_pid, args.worker_pid, args.daemon_pid}) != 3:
        raise Refused("daemon-binding")
    for key, pid, start in [("daemon", args.daemon_pid, args.daemon_start), ("web", args.web_pid, args.web_start), ("worker", args.worker_pid, args.worker_start)]:
        row = facts[key]
        if row["pid"] != pid or row["start"] != start or row["uid"] != [0, 0, 0, 0] or row["exe"] != node_identity or row["state"] not in ["R", "S", "D", "I"]:
            raise Refused("process-binding")
        expected_env = {"PATH": "/usr/bin:/bin", "NODE_ENV": "production", "KERYX_COMMIT": args.source, "KERYX_DECISION_BRIEF": "0"}
        if key != "daemon" and (row["parent"] != args.daemon_pid or row["cwd"] != "/root/keryx" or row["environment"] != expected_env or row["argv"] != commands["keryx" if key == "web" else "keryx-a2a-worker"]):
            raise Refused("role-binding")
    return {key: {name: row[name] for name in ["pid", "start", "ticks", "rss", "state"]} for key, row in facts.items()}


def bound_snapshot(args):
    commands = load_config(args)
    pid_file = Path("/root/.pm2/pm2.pid")
    info = pid_file.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0:
        raise Refused("daemon-file")
    daemon_pid = int(bounded_read(pid_file, 32).strip())
    node = Path("/usr/bin/node").stat()
    facts = {key: process_facts(pid) for key, pid in [("web", args.web_pid), ("worker", args.worker_pid), ("daemon", args.daemon_pid)]}
    return verify_facts(args, commands, facts, daemon_pid, [node.st_dev, node.st_ino])


def probe_http():
    command = ["/usr/bin/curl", "--disable", "--noproxy", "*", "--max-time", "2", "--max-filesize", "32768", "--max-redirs", "0", "--silent", "--show-error", "--output", "/dev/null",
               "--write-out", "%{http_code} %{time_total}", "--header", "Host: keryx.cc", "--header", "X-Forwarded-Proto: https", "http://127.0.0.1:3939/api/health"]
    result = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, env=CHILD_ENV, timeout=3)
    if len(result.stdout) > 256 or len(result.stderr) > MAX_LOG:
        raise Refused("probe-bound")
    fields = result.stdout.decode().split()
    if len(fields) != 2 or not re.fullmatch(r"\d{3}", fields[0]):
        raise Refused("probe-result")
    elapsed = float(fields[1])
    if not math.isfinite(elapsed) or elapsed < 0:
        raise Refused("probe-result")
    return {"status": int(fields[0]), "seconds": elapsed, "exitCode": result.returncode}


def perf_command(pid):
    return ["/usr/bin/perf", "record", "-e", "cpu-clock:u", "-F", "49", "--call-graph", "fp,32", "--no-inherit", "-m", "64", "-B", "-N", "-p", str(pid), "-o", "-", "--", "/usr/bin/sleep", "2"]


def collect_child(command, timeout=12, max_data=MAX_DATA, max_log=MAX_LOG):
    """Bound both pipes; cleanup signals address only this new helper session."""
    child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=CHILD_ENV, start_new_session=True)
    data, log, reason = bytearray(), bytearray(), None
    started = time.monotonic()
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ, (data, max_data))
            selector.register(child.stderr, selectors.EVENT_READ, (log, max_log))
            while selector.get_map():
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    reason = "helper-deadline"
                    break
                for key, _ in selector.select(min(remaining, 0.1)):
                    chunk = os.read(key.fd, 65_536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    target, limit = key.data
                    available = max(0, limit - len(target))
                    target.extend(chunk[:available])
                    if len(chunk) > available:
                        reason = "helper-output-bound"
                        break
                if reason:
                    break
        remaining = max(0.01, timeout - (time.monotonic() - started))
        if not reason:
            try:
                child.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                reason = "helper-deadline"
    except (OSError, Refused):
        reason = "helper-interrupted"
    finally:
        if child.poll() is None:
            try:
                if os.getpgid(child.pid) == child.pid:
                    os.killpg(child.pid, signal.SIGTERM)
                else:
                    reason = "helper-group"
                    child.terminate()
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                try:
                    if child.poll() is None:
                        if os.getpgid(child.pid) == child.pid:
                            os.killpg(child.pid, signal.SIGKILL)
                        else:
                            child.kill()
                except ProcessLookupError:
                    pass
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    reason = "helper-cleanup-unconfirmed"
        child.stdout.close()
        child.stderr.close()
    return {"data": bytes(data), "stderr": bytes(log).decode(errors="replace"), "returncode": child.returncode,
            "stopReason": reason, "helperPid": child.pid, "helperClosed": child.poll() is not None, "seconds": round(time.monotonic() - started, 3)}


def observe(args, snapshot=bound_snapshot, probe=probe_http, recorder=collect_child, sleeper=time.sleep, clock=time.monotonic):
    result = {"format": "keryx-origin-diagnostic-v1", "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "source": args.source, "captured": False, "inspectorOpened": False, "appStarts": 0, "workerStarts": 0}
    data = b""
    try:
        before = snapshot(args)
        started = clock()
        sleeper(0.5)
        http = probe()
        after = snapshot(args)
        elapsed = clock() - started
        ticks = after["web"]["ticks"] - before["web"]["ticks"]
        if not math.isfinite(elapsed) or elapsed <= 0 or ticks < 0:
            raise Refused("cpu-observation")
        cpu = ticks / os.sysconf("SC_CLK_TCK") / elapsed * 100
        result.update({"roles": after, "http": http, "cpuPercent": round(cpu, 1), "cpuWindowSeconds": round(elapsed, 3)})
        if http["status"] == 421 or 300 <= http["status"] < 500 or http["exitCode"] not in [0, 28]:
            raise Refused("probe-not-outage-proof")
        if not args.profile:
            result["kind"] = "observation"
            return result, data, 0
        if cpu < 80 or not (http["exitCode"] == 28 or http["status"] >= 500):
            result.update({"kind": "skipped", "reason": "not-busy-and-unresponsive"})
            return result, data, 0
        recording = recorder(perf_command(args.web_pid))
        data = recording.pop("data")
        result["recording"] = recording
        result["profileBytes"] = len(data)
        result["profileSha256"] = hashlib.sha256(data).hexdigest()
        final = snapshot(args)
        if any(final[key]["start"] != after[key]["start"] or final[key]["pid"] != after[key]["pid"] for key in after):
            raise Refused("post-profile-binding")
        if recording["returncode"] != 0 or recording["stopReason"] or not recording["helperClosed"] or not data.startswith(b"PERFILE2"):
            raise Refused("profile-incomplete")
        result.update({"kind": "profile", "captured": True, "identityStable": True})
        return result, data, 0
    except (Refused, OSError, ValueError, KeyError, StopIteration, subprocess.SubprocessError) as error:
        result.update({"kind": "incomplete" if data else "refused", "reason": str(error) if isinstance(error, Refused) else "observation-unavailable"})
        return result, data, 1


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["web-pid", "worker-pid", "daemon-pid", "web-start", "worker-start", "daemon-start"]:
        parser.add_argument("--" + name, type=int, required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--config-sha256", required=True)
    parser.add_argument("--profile", action="store_true")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[a-f0-9]{40}", args.source) or not re.fullmatch(r"[a-f0-9]{64}", args.config_sha256) or any(getattr(args, name.replace("-", "_")) <= 1 for name in ["web-pid", "worker-pid", "daemon-pid", "web-start", "worker-start", "daemon-start"]):
        parser.error("Expected positive pinned process identities and full source/config digests")
    return args


if __name__ == "__main__":
    args = arguments()
    if sys.platform != "linux" or os.geteuid() != 0:
        print(json.dumps({"format": "keryx-origin-diagnostic-v1", "kind": "refused", "reason": "linux-root-required"}), file=sys.stderr)
        raise SystemExit(1)
    def interrupted(_signum, _frame):
        raise Refused("diagnostic-interrupted")
    for own_signal in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]:
        signal.signal(own_signal, interrupted)
    metadata, data, code = observe(args)
    if args.profile:
        print(json.dumps(metadata), file=sys.stderr, flush=True)
        sys.stdout.buffer.write(data)
    else:
        print(json.dumps(metadata))
    raise SystemExit(code)
