import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import type { ProvenanceLimits } from "./storage-provenance";

export const SNAPSHOT_PROCESS_BYTES = 256 * 1024 * 1024;
export const SNAPSHOT_UNIT_PATTERN = /^keryx-provenance-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.service$/;

/** Fixed system-manager containment; privileged operator invocation, never auto-sudo or a shell. */
export function launchContainedSnapshot(node: string, loader: string, script: string, target: string, limits: ProvenanceLimits) {
  const unit = `keryx-provenance-${randomUUID()}.service`;
  const childPath = realpathSync(script);
  const child = spawn("/usr/bin/systemd-run", ["--quiet", "--wait", "--pipe", `--unit=${unit}`,
    `--property=MemoryMax=${SNAPSHOT_PROCESS_BYTES}`, "--property=MemorySwapMax=0", "--property=TasksMax=32",
    "--property=RuntimeMaxSec=10", "--property=KillMode=control-group", "--property=NoNewPrivileges=yes",
    "--property=PrivateNetwork=yes", `--working-directory=${dirname(childPath)}`, "--", "/usr/bin/env", "-i",
    "NODE_ENV=production", realpathSync(node), "--max-old-space-size=128", "--import", realpathSync(loader),
    childPath, target, JSON.stringify(limits), "offline_snapshot", unit],
  { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: { NODE_ENV: "production" } });
  return { child, unit };
}

function control(args: string[]): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile("/usr/bin/systemctl", args, { timeout: 2000, maxBuffer: 4096, windowsHide: true,
      env: { NODE_ENV: "production" } }, (error, stdout) => {
      const value = stdout.trim();
      // Some systemctl versions return nonzero for an absent unit while still reporting not-found.
      const absenceProbe = args.length === 4 && args[0] === "show" && args[1] === "--property=LoadState" &&
        args[2] === "--value" && SNAPSHOT_UNIT_PATTERN.test(args[3]);
      resolve(!error || (absenceProbe && value === "not-found") ? value : undefined);
    });
  });
}

/** Only the fresh unit captured from our launch is inspected or terminated. RuntimeMax is a fallback. */
export async function cleanupSnapshotUnit(unit: string): Promise<{ oom: boolean; cleaned: boolean }> {
  if (!SNAPSHOT_UNIT_PATTERN.test(unit)) return { oom: false, cleaned: false };
  const result = await control(["show", "--property=Result", "--value", unit]);
  await control(["kill", "--signal=SIGKILL", "--kill-who=all", unit]);
  await control(["stop", unit]);
  await control(["reset-failed", unit]);
  const state = await control(["show", "--property=LoadState", "--value", unit]);
  return { oom: result === "oom-kill", cleaned: !existsSync(`/sys/fs/cgroup/system.slice/${unit}`) &&
    state === "not-found" };
}
