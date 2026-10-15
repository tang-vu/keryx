import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { KeryxDB } from "../db/keryx-db";
import { createOwnedHistoryRoute } from "./owned-history-route";
import { walletOwnedHistoryDb } from "./account-owned-history";

/** Negative request-boundary controls only. No fabricated store grants positive
 * account authority; genuine auth/consent/native behavior is tested separately. */
import { SqliteAdapter } from "../db/sqlite-adapter";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";
import { issueWebSession, parseWebSession, isWebSessionActive, webSessionHash } from "../auth-session";
afterEach(() => { vi.unstubAllEnvs(); });
const binding = { origin: "https://keryx.example", network: "eip155:5042" } as const;
const wallet = `0x${"a".repeat(40)}`, hash = "b".repeat(64);
describe("account-owned request boundary", () => {
  it("preserves genuine ordinary SQLite wallet reads when its lazy optional account getter refuses admission", async () => {
    vi.stubEnv("KERYX_FORCE_OFFLINE", "1"); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
    const directory = mkdtempSync(join(tmpdir(), "keryx-ordinary-owned-history-")), file = join(directory, "ordinary.sqlite");
    const raw = new DatabaseSync(file);
    try { installSqliteApplicationSchema(raw); raw.exec(RUN_PRIVACY_SQL); } finally { raw.close(); }
    const db = new SqliteAdapter(file);
    try {
      await db.init();
      const descriptor = Object.getOwnPropertyDescriptor(db, "accountMembership");
      expect(descriptor?.enumerable).toBe(false); expect(typeof descriptor?.get).toBe("function");
      expect(db.accountMembership).toBeUndefined(); // Actual 5000ms timeout intentionally refuses account admission.
      expect(db.runPrivacy).toBeDefined(); // Domain provisioned explicitly in this disposable fixture, never startup DDL.
      const run = { id: "ordinary_owned", question: "Ordinary wallet question", answer: "PRIVATE ordinary answer", budget: .1, engine: "heuristic",
        totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], trace: [],
        createdAt: new Date().toISOString(), paymentMode: "offline" as const, asker: wallet };
      await db.saveQueryRun(run);
      const secret = "only-a-public-ordinary-test-session-secret", issued = await issueWebSession(db, secret, wallet, "asker");
      const session = async () => {
        const claims = await parseWebSession(issued.token, secret);
        if (!claims || !await isWebSessionActive(db, claims)) return Response.json({ error: "unauthenticated" }, { status: 401 });
        return { db, wallet, currentId: webSessionHash(claims.jti) };
      };
      const deps = { binding, session, key: async () => null, db: async () => db };
      const list = await createOwnedHistoryRoute(deps)(new Request("https://keryx.example/api/me/asks")), body = await list.json();
      expect(list.status).toBe(200); expect(body.scope).toBe("wallet-owned-current-store");
      expect(body.rows.map((row: { id: string }) => row.id)).toEqual([run.id]);
      const detail = await createOwnedHistoryRoute(deps, "detail")(new Request("https://keryx.example/api/me/asks/ordinary_owned"), run.id);
      expect(detail.status).toBe(200); expect((await detail.json()).run.answer).toBe(run.answer);
      expect(db.accountMembership).toBeUndefined();
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it("strips a global membership projection without reading or mutating it", () => {
    const getter = vi.fn(() => { throw new Error("Global projection must never be read"); });
    const db = Object.defineProperty({ personalHistory: {}, runPrivacyActive: true }, "historyMembership", { get: getter });
    const view = walletOwnedHistoryDb(db as KeryxDB);
    expect(Object.isFrozen(view)).toBe(true); expect(Object.hasOwn(view, "historyMembership")).toBe(false);
    expect(getter).not.toHaveBeenCalled(); expect(Object.getOwnPropertyDescriptor(db, "historyMembership")?.get).toBe(getter);
  });
  it("refuses an enumerable account port before invoking it", async () => {
    const resolve = vi.fn(), db = { accountMembership: { resolve }, getWebSession: vi.fn() } as unknown as KeryxDB;
    const response = await createOwnedHistoryRoute({ binding, session: async () => ({ db, wallet, currentId: hash }), key: async () => null, db: async () => db })(new Request("https://keryx.example/api/me/asks"));
    expect(response.status).toBe(503); expect(resolve).not.toHaveBeenCalled(); expect(db.getWebSession).not.toHaveBeenCalled();
  });
  it("does not consult any account port for an API key lacking history scope", async () => {
    const getter = vi.fn(() => { throw new Error("No account inheritance"); });
    const db = Object.defineProperty({}, "accountMembership", { get: getter }) as KeryxDB;
    const response = await createOwnedHistoryRoute({ binding, session: async () => { throw new Error("No interactive fallback"); },
      key: async () => ({ walletAddress: wallet, scopes: "asks:read" }), db: async () => db })(new Request("https://keryx.example/api/me/asks", { headers: { authorization: `Bearer kx_live_${"c".repeat(96)}` } }));
    expect(response.status).toBe(403); expect(getter).not.toHaveBeenCalled();
  });
  it("preserves the interactive authentication refusal without selecting a database", async () => {
    const select = vi.fn();
    const response = await createOwnedHistoryRoute({ binding, session: async () => Response.json({ error: "unauthenticated" }, { status: 401 }),
      key: async () => null, db: select })(new Request("https://keryx.example/api/me/asks"));
    expect(response.status).toBe(401); expect(select).not.toHaveBeenCalled(); expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
