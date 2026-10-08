import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, type BigIntStats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const WINDOW_FORMAT = "keryx-planned-maintenance-v1";
export const MAX_WINDOW_MS = 30 * 60 * 1000;
export const STATUS_PATH = "/maintenance/status";
export const NOTICE_PATH = "/maintenance";
export interface PlannedWindow {
  format: typeof WINDOW_FORMAT;
  id: string;
  announcedAt: string;
  startsAt: string;
  endsAt: string;
  phase: "draining" | "active";
  message: string;
}
export type WindowControl = { kind: "absent" } | { kind: "valid"; window: PlannedWindow } | { kind: "unavailable" };
export type MaintenanceState = "normal" | "upcoming" | "draining" | "active" | "overrun" | "control-unavailable";
export interface MaintenanceStatus {
  state: MaintenanceState;
  planned: boolean;
  admissionClosed: boolean;
  window: PlannedWindow | null;
  checkedAt: string;
  statusPath: typeof STATUS_PATH;
  applicationStatus: "not-probed";
}

function time(value: unknown): number {
  if (typeof value !== "string") throw Error("Invalid maintenance window");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw Error("Invalid maintenance window");
  return parsed;
}
export function parsePlannedWindow(value: unknown): PlannedWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid maintenance window");
  const row = value as Record<string, unknown>;
  const keys = ["format", "id", "announcedAt", "startsAt", "endsAt", "phase", "message"];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) || row.format !== WINDOW_FORMAT ||
      typeof row.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(row.id) ||
      !["draining", "active"].includes(String(row.phase)) || typeof row.message !== "string" ||
      !row.message.trim() || row.message.length > 300 || /[\u0000-\u001f\u007f]/.test(row.message)) throw Error("Invalid maintenance window");
  const announced = time(row.announcedAt), starts = time(row.startsAt), ends = time(row.endsAt);
  if (announced > starts || starts >= ends || ends - starts > MAX_WINDOW_MS) throw Error("Invalid maintenance window");
  return structuredClone(row) as unknown as PlannedWindow;
}

export function maintenanceStatus(control: WindowControl, now: number): MaintenanceStatus {
  if (!Number.isFinite(now)) throw Error("Invalid maintenance clock");
  let state: MaintenanceState = "normal";
  let window: PlannedWindow | null = null;
  if (control.kind === "unavailable") state = "control-unavailable";
  if (control.kind === "valid") {
    window = parsePlannedWindow(control.window);
    if (now < Date.parse(window.announcedAt)) state = "control-unavailable";
    else if (now < Date.parse(window.startsAt)) state = "upcoming";
    else if (now >= Date.parse(window.endsAt)) state = "overrun";
    else state = window.phase;
  }
  return { state, planned: ["upcoming", "draining", "active"].includes(state),
    admissionClosed: !["normal", "upcoming"].includes(state), window,
    checkedAt: new Date(now).toISOString(), statusPath: STATUS_PATH, applicationStatus: "not-probed" };
}

function sameFile(before: BigIntStats, after: BigIntStats): boolean {
  return (["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode", "uid", "gid", "nlink"] as const)
    .every(key => before[key] === after[key]);
}
function protectedIdentity(path: string, directory: boolean): BigIntStats {
  if (!isAbsolute(path) || resolve(path) !== path || process.platform !== "linux")
    throw Error("Maintenance control unavailable");
  const stat = lstatSync(path, { bigint: true });
  if (!(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === BigInt(1)) ||
      stat.uid !== BigInt(process.getuid!()) || Number(stat.mode & BigInt(0o777)) !== (directory ? 0o700 : 0o600) || realpathSync(path) !== path)
    throw Error("Maintenance control unavailable");
  return stat;
}

/** Existing private Linux control directory only. No creation, repair, expiry reset or writes. */
export function readWindowControl(directory: string): WindowControl {
  let fd: number | undefined;
  try {
    const dir = protectedIdentity(directory, true), file = join(directory, "window.json");
    let before: BigIntStats;
    try { before = protectedIdentity(file, false); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && sameFile(dir, protectedIdentity(directory, true))) return { kind: "absent" };
      throw error;
    }
    if (before.size < BigInt(1) || before.size > BigInt(4096)) throw Error("Maintenance control unavailable");
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!sameFile(before, fstatSync(fd, { bigint: true }))) throw Error("Maintenance control unavailable");
    const raw = readFileSync(fd);
    if (raw.length !== Number(before.size) || !sameFile(before, fstatSync(fd, { bigint: true })) ||
        !sameFile(before, protectedIdentity(file, false)) || !sameFile(dir, protectedIdentity(directory, true))) throw Error("Maintenance control unavailable");
    return { kind: "valid", window: parsePlannedWindow(JSON.parse(raw.toString("utf8"))) };
  } catch { return { kind: "unavailable" }; }
  finally { if (fd !== undefined) closeSync(fd); }
}
