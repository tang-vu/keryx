import { createServer, request, type Server } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createMaintenanceFrontDoor, MAINTENANCE_CODE } from "./front-door";
import { WINDOW_FORMAT, type PlannedWindow, type WindowControl } from "./planned-window";

const window: PlannedWindow = { format: WINDOW_FORMAT, id: "synthetic-routing", announcedAt: "2026-10-08T10:00:00.000Z",
  startsAt: "2026-10-08T10:05:00.000Z", endsAt: "2026-10-08T10:15:00.000Z", phase: "active", message: "Maintenance <script>unsafe</script> & diagnosis." };
const servers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of servers.splice(0).reverse()) await close(); });
async function listen(server: Server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening"); return (server.address() as { port: number }).port;
}
async function fixture(initial: WindowControl = { kind: "valid", window }) {
  let control = initial, count = 0;
  const upstream = createServer((_req, res) => { count++; res.end("synthetic app"); }); const upstreamPort = await listen(upstream);
  servers.push(() => upstream.listening ? new Promise<void>((accept, reject) => upstream.close(error => error ? reject(error) : accept())) : Promise.resolve());
  const front = createMaintenanceFrontDoor({ upstreamPort, readControl: () => control, clock: () => Date.parse(window.startsAt) });
  const port = await listen(front.server); servers.push(front.close);
  return { port, upstream, front, count: () => count, set: (value: WindowControl) => { control = value; } };
}
function get(port: number, path: string, method = "GET", extra: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>((accept, reject) => {
    const outgoing = request({ hostname: "127.0.0.1", port, path, method,
      headers: { Host: "keryx.cc", "X-Forwarded-Proto": "https", ...extra }, agent: false }, incoming => {
      const chunks: Buffer[] = []; incoming.on("data", chunk => chunks.push(chunk)); incoming.on("error", reject);
      incoming.on("end", () => accept({ status: incoming.statusCode!, headers: incoming.headers, body: Buffer.concat(chunks).toString() }));
    }); outgoing.on("error", reject); outgoing.end(method === "POST" ? "synthetic signed body" : undefined);
  });
}
it("serves static browser/API/MCP and independent window status after the app stops; consumes no upstream authorization", async () => {
  const f = await fixture(); await new Promise<void>(accept => f.upstream.close(() => accept()));
  for (const path of ["/api/health", "/api/metrics", "/api/ask", "/api/source/source", "/api/session/grant", "/mcp"]) {
    const result = await get(f.port, path, "POST", { Authorization: "synthetic-key", "Payment-Signature": "synthetic-header" });
    expect(result.status).toBe(503); expect(result.headers["retry-after"]).toBe("600");
    expect(JSON.parse(result.body).error).toMatchObject({ code: MAINTENANCE_CODE, automaticRetry: false, authorizationConsumedByFrontDoor: false });
    expect(JSON.parse(result.body).error.upstreamOutcome).toBe("not-dispatched");
  }
  const browser = await get(f.port, "/"); expect(browser.status).toBe(503); expect(browser.headers["content-type"]).toContain("text/html");
  expect(browser.body).toContain(window.startsAt); expect(browser.body).toContain("&lt;script&gt;"); expect(browser.body).not.toContain("<script>");
  const status = await get(f.port, "/maintenance/status"); expect(status.status).toBe(200);
  expect(JSON.parse(status.body)).toMatchObject({ state: "active", applicationStatus: "not-probed" }); expect(f.count()).toBe(0);
  expect((await get(f.port, "/maintenance", "HEAD")).body).toBe("");
  expect((await get(f.port, "/maintenance/status", "POST")).status).toBe(405); expect(f.count()).toBe(0);
});
it("preserves ordinary upstream behavior/metadata, announces upcoming and distinguishes unplanned failure", async () => {
  const f = await fixture({ kind: "absent" }); expect((await get(f.port, "/api/health")).body).toBe("synthetic app");
  f.set({ kind: "valid", window: { ...window, startsAt: window.endsAt, endsAt: "2026-10-08T10:25:00.000Z" } });
  expect((await get(f.port, "/")).headers["x-keryx-maintenance-starts-at"]).toBe(window.endsAt);
  f.set({ kind: "absent" }); await new Promise<void>(accept => f.upstream.close(() => accept()));
  const result = await get(f.port, "/api/health"); expect(result.status).toBe(503);
  expect(JSON.parse(result.body).error).toMatchObject({ code: "KERYX_UPSTREAM_UNAVAILABLE", planned: false }); expect(f.count()).toBe(2);
});
it("reports an unknown upstream outcome after dispatch without claiming a payment was unconsumed or retrying", async () => {
  const f = await fixture({ kind: "absent" }); let attempts = 0;
  f.upstream.removeAllListeners("request");
  f.upstream.on("request", (req, _res) => { attempts++; req.resume(); req.on("end", () => req.socket.destroy()); });
  const result = await get(f.port, "/api/ask", "POST");
  expect(JSON.parse(result.body).error).toMatchObject({ code: "KERYX_UPSTREAM_UNAVAILABLE", upstreamOutcome: "unknown", automaticRetry: false });
  const browser = await get(f.port, "/", "POST"); expect(browser.body).toContain("payment may already be pending");
  expect(browser.body).not.toContain("refused before the application handles"); expect(attempts).toBe(2);
});
it("refuses forged ingress metadata and arbitrary callback bypass; invalid controls remain closed", async () => {
  const f = await fixture({ kind: "valid", window: { ...window, phase: "draining" } });
  expect((await get(f.port, "/api/ask/sign", "POST")).status).toBe(503);
  expect((await get(f.port, "/api/health", "GET", { Host: "foreign.invalid" })).status).toBe(421);
  f.set({ kind: "unavailable" }); const response = await get(f.port, "/api/ask");
  expect(JSON.parse(response.body).error.code).toBe("KERYX_MAINTENANCE_CONTROL_UNAVAILABLE"); expect(f.count()).toBe(0);
});
it("refuses a recovery exception when the supplied validator differs from the pinned source", async () => {
  const f = await fixture();
  const front = createMaintenanceFrontDoor({ upstreamPort: (f.upstream.address() as { port: number }).port,
    recoveryValidatorFile: resolve("lib/maintenance/front-door.test.ts"),
    readControl: () => ({ kind: "valid", window: { ...window, phase: "draining" } }), clock: () => Date.parse(window.startsAt) });
  const port = await listen(front.server); servers.push(front.close);
  expect((await get(port, "/api/ask/sign", "POST")).status).toBe(503); expect(f.count()).toBe(0);
});
it("refuses Expect100Continue without preliminary permission, body handling or upstream admission", async () => {
  const f = await fixture(); let continues = 0;
  const status = await new Promise<number>((accept, reject) => {
    const outgoing = request({ hostname: "127.0.0.1", port: f.port, path: "/api/ask", method: "POST", headers: {
      Host: "keryx.cc", "X-Forwarded-Proto": "https", Expect: "100-continue", "Content-Length": "100" }, agent: false }, incoming => {
      incoming.resume(); incoming.on("end", () => accept(incoming.statusCode!));
    }); outgoing.on("continue", () => { continues++; outgoing.end("x".repeat(100)); }); outgoing.on("error", reject); outgoing.flushHeaders();
  }); expect(status).toBe(503); expect(continues).toBe(0); expect(f.count()).toBe(0);
});
it("allows an already accepted stream to complete during active maintenance and never retries", async () => {
  const f = await fixture({ kind: "absent" }); let finish: (() => void) | undefined;
  let started!: () => void; const startedRequest = new Promise<void>(accept => { started = accept; });
  f.upstream.removeAllListeners("request"); let admitted = 0;
  f.upstream.on("request", (_req, res) => { admitted++; res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write("data: first\n\n"); finish = () => res.end("data: complete\n\n"); started(); });
  const streaming = get(f.port, "/api/ask");
  await startedRequest;
  f.set({ kind: "valid", window }); expect((await get(f.port, "/api/ask", "POST")).status).toBe(503);
  const closed = f.front.close();
  finish!(); expect((await streaming).body).toContain("data: complete"); await closed; expect(admitted).toBe(1);
});
