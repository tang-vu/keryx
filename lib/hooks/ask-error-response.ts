import { createMessages } from "../i18n/messages";
import { parsePublicMaintenanceStatus } from "../maintenance/public-status";

const message = createMessages("en");
const codes = new Set(["KERYX_PLANNED_MAINTENANCE", "KERYX_MAINTENANCE_WINDOW_EXPIRED",
  "KERYX_MAINTENANCE_CONTROL_UNAVAILABLE", "KERYX_FRONT_DOOR_DRAINING", "KERYX_UPSTREAM_UNAVAILABLE"]);
export interface MaintenanceRefusal {
  statusPath: "/maintenance/status";
  upstreamOutcome: "not-dispatched" | "unknown";
}
export interface AskHttpError {
  code?: string;
  message: string;
  retryAfter: number | null;
  maintenance?: MaintenanceRefusal;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function keys(value: Record<string, unknown>, names: string[]): boolean {
  return Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
function frontDoor(value: unknown): value is Record<string, unknown> & { code: string; message: string;
  retryAfterSeconds: number; upstreamOutcome: MaintenanceRefusal["upstreamOutcome"] } {
  if (!record(value) || !keys(value, ["code", "planned", "message", "statusPath", "maintenance", "retryAfterSeconds",
    "automaticRetry", "authorizationConsumedByFrontDoor", "upstreamOutcome", "frontDoorDraining"]) ||
    typeof value.code !== "string" || !codes.has(value.code) || typeof value.message !== "string" || !value.message.trim() || value.message.length > 300 ||
    /[\u0000-\u001f\u007f]/.test(value.message) || value.statusPath !== "/maintenance/status" ||
    typeof value.planned !== "boolean" || typeof value.frontDoorDraining !== "boolean" || value.automaticRetry !== false ||
    value.authorizationConsumedByFrontDoor !== false || typeof value.upstreamOutcome !== "string" || !["not-dispatched", "unknown"].includes(value.upstreamOutcome) ||
    !Number.isInteger(value.retryAfterSeconds) || Number(value.retryAfterSeconds) < 1 || Number(value.retryAfterSeconds) > 1800) return false;
  const status = parsePublicMaintenanceStatus(value.maintenance);
  if (!status) return false;
  const unplanned = value.code === "KERYX_UPSTREAM_UNAVAILABLE";
  if (value.planned !== (!unplanned && status.planned)) return false;
  if (unplanned) return !value.frontDoorDraining && !status.admissionClosed && value.upstreamOutcome === "unknown";
  const expectedCode = value.frontDoorDraining ? "KERYX_FRONT_DOOR_DRAINING" : status.state === "overrun"
    ? "KERYX_MAINTENANCE_WINDOW_EXPIRED" : status.state === "control-unavailable"
      ? "KERYX_MAINTENANCE_CONTROL_UNAVAILABLE" : "KERYX_PLANNED_MAINTENANCE";
  return value.code === expectedCode && (value.frontDoorDraining || status.admissionClosed) && value.upstreamOutcome === "not-dispatched";
}

/** One already-read HTTP error body. Never returns an object as renderable copy or starts a retry. */
export function parseAskHttpError(body: string, status: number, retryHeader: string | null): AskHttpError {
  const retryAfter = retryHeader && /^[0-9]{1,6}$/.test(retryHeader) ? Number(retryHeader) : null;
  const fallback = message("researchError.httpFallback", { status });
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return { message: body || fallback, retryAfter }; }
  if (!record(parsed)) return { message: fallback, retryAfter };
  if (status === 503 && keys(parsed, ["error"]) && frontDoor(parsed.error)) {
    const error = parsed.error;
    return { code: error.code, message: error.message + (error.upstreamOutcome === "unknown"
      ? ` ${message("researchError.unknownOutcome")}` : ""), retryAfter: error.retryAfterSeconds,
      maintenance: { statusPath: "/maintenance/status", upstreamOutcome: error.upstreamOutcome } };
  }
  if (parsed.error !== undefined && typeof parsed.error !== "string") return { message: fallback, retryAfter };
  return { code: parsed.error as string | undefined, message: typeof parsed.message === "string" ? parsed.message : parsed.error || fallback,
    retryAfter: typeof parsed.retryAfter === "number" && Number.isFinite(parsed.retryAfter) && parsed.retryAfter >= 0
      ? parsed.retryAfter : retryAfter };
}
