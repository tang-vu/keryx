/** Public front-door data only. No Node imports, health probe, admission or retry authority. */
export const WINDOW_FORMAT = "keryx-planned-maintenance-v1";
export const MAX_WINDOW_MS = 30 * 60 * 1000;
export const STATUS_PATH = "/maintenance/status";
export interface PlannedWindow {
  format: typeof WINDOW_FORMAT;
  id: string;
  announcedAt: string;
  startsAt: string;
  endsAt: string;
  phase: "draining" | "active";
  message: string;
}
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
function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => Object.hasOwn(descriptor, "value"));
}
function keys(value: Record<string, unknown>, names: string[]): boolean {
  return Object.keys(value).length === names.length && Reflect.ownKeys(value).length === names.length &&
    names.every(name => Object.hasOwn(value, name));
}
function utc(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** Closed copied output: malformed values, coercible enums and accessors have no public authority. */
export function parsePublicMaintenanceWindow(value: unknown): PlannedWindow | null {
  try {
    if (!record(value) || !keys(value, ["format", "id", "announcedAt", "startsAt", "endsAt", "phase", "message"]) ||
      value.format !== WINDOW_FORMAT || typeof value.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(value.id) ||
      (value.phase !== "draining" && value.phase !== "active") || typeof value.message !== "string" ||
      !value.message.trim() || value.message.length > 300 || /[\u0000-\u001f\u007f]/.test(value.message) ||
      !utc(value.announcedAt) || !utc(value.startsAt) || !utc(value.endsAt)) return null;
    const [announced, start, end] = [value.announcedAt, value.startsAt, value.endsAt].map(Date.parse);
    if (!(announced < start && start < end && end - start <= MAX_WINDOW_MS)) return null;
    return { format: WINDOW_FORMAT, id: value.id, announcedAt: value.announcedAt, startsAt: value.startsAt,
      endsAt: value.endsAt, phase: value.phase, message: value.message };
  } catch { return null; }
}

/** State is evaluated only against the server's checkedAt; the browser clock cannot open admission. */
export function parsePublicMaintenanceStatus(value: unknown): MaintenanceStatus | null {
  try {
    if (!record(value) || !keys(value, ["state", "planned", "admissionClosed", "window", "checkedAt", "statusPath", "applicationStatus"]) ||
      typeof value.state !== "string" || !["normal", "upcoming", "draining", "active", "overrun", "control-unavailable"].includes(value.state) ||
      typeof value.planned !== "boolean" || typeof value.admissionClosed !== "boolean" || !utc(value.checkedAt) ||
      value.statusPath !== STATUS_PATH || value.applicationStatus !== "not-probed") return null;
    const window = value.window === null ? null : parsePublicMaintenanceWindow(value.window);
    if (value.window !== null && !window) return null;
    const state = value.state as MaintenanceState;
    if (window) {
      const checked = Date.parse(value.checkedAt);
      const expected = checked < Date.parse(window.announcedAt) ? "control-unavailable" : checked < Date.parse(window.startsAt)
        ? "upcoming" : checked >= Date.parse(window.endsAt) ? "overrun" : window.phase;
      if (state !== expected) return null;
    } else if (state !== "normal" && state !== "control-unavailable") return null;
    if (value.planned !== ["upcoming", "draining", "active"].includes(state) ||
      value.admissionClosed !== !["normal", "upcoming"].includes(state)) return null;
    return { state, planned: value.planned, admissionClosed: value.admissionClosed, window,
      checkedAt: value.checkedAt, statusPath: STATUS_PATH, applicationStatus: "not-probed" };
  } catch { return null; }
}
