import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { hasPublicHttpsMetadata } from "../../scripts/next-public-server.mjs";
import { maintenanceStatus, NOTICE_PATH, STATUS_PATH, type MaintenanceStatus, type WindowControl } from "./planned-window";

// Reviewed 7309f056 signing validator, canonical Git LF bytes. This route does not admit a grant/job.
export const RECOVERY_VALIDATOR_SHA256 = "02cfc6f0d5a1c22e659e29bec6f6dc197f2b8f2fa74f59e3443edb768adf5c1f";
export const MAINTENANCE_CODE = "KERYX_PLANNED_MAINTENANCE";
const hopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

export interface FrontDoorOptions {
  upstreamPort: number;
  readControl: () => WindowControl;
  /** Absent by default. Root-reviewed drain only; never an arbitrary route allowlist. */
  recoveryValidatorFile?: string;
  clock?: () => number;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
function write(res: ServerResponse, status: number, type: string, body: string, head: boolean, extra: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", ...extra });
  res.end(head ? undefined : body);
}
function machine(path: string, req: IncomingMessage): boolean {
  return /^\/(?:api(?:\/|$)|mcp(?:\/|$))/.test(path) || String(req.headers.accept ?? "").includes("application/json");
}
export function maintenancePage(status: MaintenanceStatus, unplanned = false, upstreamAttempted = false): string {
  const title = unplanned ? "Keryx is unavailable" : status.state === "upcoming" ? "Planned Keryx maintenance" :
    status.state === "overrun" ? "Maintenance window has ended; service remains held" : "Keryx maintenance";
  const message = unplanned ? "The application is unreachable. No planned window is active." : status.window?.message ??
    (status.state === "normal" ? "No planned maintenance window is active. This endpoint does not probe application health." : "Maintenance controls are unavailable. New requests are held.");
  const window = status.window ? `<dl><dt>Announced</dt><dd>${escapeHtml(status.window.announcedAt)}</dd><dt>Starts</dt><dd>${escapeHtml(status.window.startsAt)}</dd><dt>Expected end</dt><dd>${escapeHtml(status.window.endsAt)}</dd></dl>` : "";
  const admission = upstreamAttempted ? "The upstream request outcome is unknown. A payment may already be pending." :
    status.admissionClosed ? "New requests are refused before the application handles them." : "New requests remain available. Check the announced window before starting paid work.";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f5f2eb;color:#262422;font:18px/1.6 system-ui}main{max-width:650px;margin:10vh auto;padding:24px}h1{font-size:32px;line-height:1.2}dt{font-weight:600}dd{margin:0 0 12px;overflow-wrap:anywhere}a{color:inherit}</style><main><p>KERYX</p><h1>${title}</h1><p>${escapeHtml(message)}</p>${window}<p>${admission} An earlier request may have an unresolved payment; retain its original record and check its recovery status. Do not resubmit or sign again automatically.</p><p><a href="${NOTICE_PATH}">Refresh this status page</a> · <a href="${STATUS_PATH}">Machine-readable status</a></p></main></html>`;
}
function refusal(res: ServerResponse, req: IncomingMessage, path: string, status: MaintenanceStatus,
  context: { unplanned?: boolean; upstreamAttempted?: boolean; frontDoorDraining?: boolean } = {}) {
  const { unplanned = false, upstreamAttempted = false, frontDoorDraining = false } = context;
  const code = frontDoorDraining ? "KERYX_FRONT_DOOR_DRAINING" : unplanned ? "KERYX_UPSTREAM_UNAVAILABLE" : status.state === "overrun" ? "KERYX_MAINTENANCE_WINDOW_EXPIRED" :
    status.state === "control-unavailable" ? "KERYX_MAINTENANCE_CONTROL_UNAVAILABLE" : MAINTENANCE_CODE;
  const remaining = status.window && status.planned ? Math.ceil((Date.parse(status.window.endsAt) - Date.parse(status.checkedAt)) / 1000) : 60;
  const retryAfter = String(Math.max(1, Math.min(1800, remaining)));
  const body = { error: { code, planned: !unplanned && status.planned, message: unplanned ? "Application unavailable; no planned window is active." : "New application requests are held.",
    statusPath: STATUS_PATH, maintenance: status, retryAfterSeconds: Number(retryAfter), automaticRetry: false,
    authorizationConsumedByFrontDoor: false, upstreamOutcome: upstreamAttempted ? "unknown" : "not-dispatched", frontDoorDraining } };
  write(res, 503, machine(path, req) ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
    machine(path, req) ? JSON.stringify(body) : maintenancePage(frontDoorDraining ? { ...status, admissionClosed: true } : status, unplanned, upstreamAttempted), req.method === "HEAD", { "Retry-After": retryAfter, Connection: "close" });
}
function pinnedRecovery(options: FrontDoorOptions): boolean {
  if (!options.recoveryValidatorFile) return false;
  try {
    const bytes = readFileSync(options.recoveryValidatorFile);
    return bytes.length <= 32768 && createHash("sha256").update(bytes.toString("utf8").replace(/\r\n/g, "\n")).digest("hex") === RECOVERY_VALIDATOR_SHA256;
  } catch { return false; }
}
function proxyHeaders(raw: string[]): string[] {
  const nominated = new Set<string>();
  for (let index = 0; index < raw.length; index += 2) if (raw[index].toLowerCase() === "connection")
    raw[index + 1].split(",").forEach(value => nominated.add(value.trim().toLowerCase()));
  const clean: string[] = [];
  for (let index = 0; index < raw.length; index += 2) if (!hopHeaders.has(raw[index].toLowerCase()) && !nominated.has(raw[index].toLowerCase()))
    clean.push(raw[index], raw[index + 1]);
  return clean;
}

/** Loopback front door only. No application imports, credentials, persistence or paid retries. */
export function createMaintenanceFrontDoor(options: FrontDoorOptions) {
  if (!Number.isInteger(options.upstreamPort) || options.upstreamPort < 1 || options.upstreamPort > 65535) throw Error("Invalid upstream port");
  let drainingServer = false;
  const clock = options.clock ?? Date.now;
  const server = createServer({ shouldUpgradeCallback: () => false }, (req, res) => {
    if (!hasPublicHttpsMetadata(req)) { write(res, 421, "text/plain", "Public HTTPS metadata required", req.method === "HEAD"); return; }
    const path = req.url!.split("?", 1)[0];
    let status: MaintenanceStatus;
    try { status = maintenanceStatus(options.readControl(), clock()); }
    catch { status = maintenanceStatus({ kind: "unavailable" }, Date.now()); }
    if ([STATUS_PATH, NOTICE_PATH].includes(path)) {
      if (!["GET", "HEAD"].includes(req.method ?? "")) {
        write(res, 405, "application/json; charset=utf-8", JSON.stringify({ error: { code: "KERYX_MAINTENANCE_STATUS_READ_ONLY" } }), false, { Allow: "GET, HEAD", Connection: "close" }); return;
      }
      write(res, 200, path === STATUS_PATH ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
        path === STATUS_PATH ? JSON.stringify(status) : maintenancePage(status), req.method === "HEAD"); return;
    }
    const recovery = !drainingServer && status.state === "draining" && req.method === "POST" && req.url === "/api/ask/sign" && pinnedRecovery(options);
    if (drainingServer || status.admissionClosed && !recovery) { refusal(res, req, path, status, { frontDoorDraining: drainingServer }); return; }
    if (req.headers.upgrade !== undefined) { write(res, 426, "text/plain", "HTTP upgrades unavailable", req.method === "HEAD"); return; }
    if (status.state === "upcoming") {
      res.setHeader("X-Keryx-Maintenance-Starts-At", status.window!.startsAt);
      res.setHeader("X-Keryx-Maintenance-Ends-At", status.window!.endsAt);
      res.setHeader("Link", `<${NOTICE_PATH}>; rel="service-status"`);
    }
    const upstream = request({ hostname: "127.0.0.1", port: options.upstreamPort, method: req.method, path: req.url,
      headers: proxyHeaders(req.rawHeaders), agent: false }, incoming => {
      res.writeHead(incoming.statusCode ?? 502, proxyHeaders(incoming.rawHeaders));
      incoming.on("error", () => res.destroy()); incoming.pipe(res);
    });
    // One upstream attempt only. Keep already accepted streams unchanged during a window change.
    upstream.on("error", () => {
      if (res.headersSent) res.destroy(); else refusal(res, req, path, status, { unplanned: !status.admissionClosed, upstreamAttempted: true });
    });
    upstream.on("continue", () => { if (!res.headersSent) res.writeContinue(); });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  });
  // A refused signed body receives no preliminary 100 Continue permission.
  server.on("checkContinue", (req, res) => server.emit("request", req, res));
  server.keepAliveTimeout = 100000;
  server.keepAliveTimeoutBuffer = 5000;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (!closing) { drainingServer = true; closing = new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept())); }
    return closing;
  };
  return { server, close };
}
