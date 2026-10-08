import { createServer, request, type Server } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createMaintenanceFrontDoor, RECOVERY_VALIDATOR_SHA256 } from "./front-door";
import { WINDOW_FORMAT, type PlannedWindow } from "./planned-window";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), signed: vi.fn(), grant: vi.fn(), deliver: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ getBrowserJournal: mocks.lookup, signBrowserJournal: mocks.signed }) }));
vi.mock("@/lib/payments/session-grants", () => ({ getGrant: mocks.grant }));
vi.mock("@/lib/payments/pending-signatures", () => ({ resolveSignature: mocks.deliver }));
import { POST } from "../../app/api/ask/sign/route";

const validator = resolve("app/api/ask/sign/route.ts");
const window: PlannedWindow = { format: WINDOW_FORMAT, id: "synthetic-recovery", announcedAt: "2026-10-08T10:00:00.000Z",
  startsAt: "2026-10-08T10:05:00.000Z", endsAt: "2026-10-08T10:15:00.000Z", phase: "draining", message: "Synthetic retained callback exercise." };
const closing: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closing.splice(0).reverse()) await close(); vi.clearAllMocks(); });
async function listen(server: Server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return (server.address() as { port: number }).port; }

it("pins unchanged validator and routes only exact drain callbacks; forged, foreign and unexposed challenges cannot consume authority", async () => {
  expect(createHash("sha256").update(readFileSync(validator, "utf8").replace(/\r\n/g, "\n")).digest("hex")).toBe(RECOVERY_VALIDATOR_SHA256);
  const wallet = `0x${"11".repeat(20)}`; let phase: PlannedWindow["phase"] = "draining";
  mocks.lookup.mockImplementation(async (session: string, id: string) => session === wallet && id !== "foreign" ? {
    phase: id === "stale" ? "prepared" : "exposed", signer: wallet, nonce: `0x${"44".repeat(32)}`,
    admittedAt: "2026-10-08T10:04:59.000Z", requirements: { scheme: "exact", network: "eip155:5042002",
      asset: "0x3600000000000000000000000000000000000000", amount: "2000", payTo: `0x${"22".repeat(20)}`, maxTimeoutSeconds: 691200,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } },
  } : null);
  let requests = 0;
  const app = createServer(async (req, res) => {
    requests++; const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    const result = await POST(new Request("https://keryx.cc/api/ask/sign", { method: "POST", body: Buffer.concat(chunks).toString() }) as NextRequest);
    res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(await result.text());
  }); const upstreamPort = await listen(app); closing.push(() => new Promise<void>(accept => app.close(() => accept())));
  const front = createMaintenanceFrontDoor({ upstreamPort, recoveryValidatorFile: validator,
    readControl: () => ({ kind: "valid", window: { ...window, phase } }), clock: () => Date.parse(window.startsAt) });
  const port = await listen(front.server); closing.push(front.close);
  const submit = (path: string, id: string, session = wallet) => new Promise<number>((accept, reject) => {
    const outgoing = request({ hostname: "127.0.0.1", port, path, method: "POST", agent: false,
      headers: { Host: "keryx.cc", "X-Forwarded-Proto": "https", "Content-Type": "application/json" } }, incoming => {
      incoming.resume(); incoming.on("end", () => accept(incoming.statusCode!));
    }); outgoing.on("error", reject); outgoing.end(JSON.stringify({ sessionId: session, reqId: id, paymentHeader: "Zm9v" }));
  });
  expect(await submit("/api/ask/sign", "forged")).toBe(400);
  expect(await submit("/api/ask/sign", "foreign")).toBe(404);
  expect(await submit("/api/ask/sign", "stale")).toBe(409);
  expect(await submit("/api/ask/sign", "forged", `0x${"33".repeat(20)}`)).toBe(404);
  for (const path of ["/api/ask", "/api/session/grant", "/api/ask/sign?bypass=1", "/api/ask/%73ign", "/api/session/withdraw/authorize"])
    expect(await submit(path, "forged")).toBe(503);
  phase = "active"; expect(await submit("/api/ask/sign", "forged")).toBe(503);
  expect(requests).toBe(4); expect(mocks.signed).not.toHaveBeenCalled(); expect(mocks.grant).not.toHaveBeenCalled(); expect(mocks.deliver).not.toHaveBeenCalled();
});
