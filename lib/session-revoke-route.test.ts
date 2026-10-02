import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteAdapter } from "./db/sqlite-adapter";
import type { BrowserJournalAdmission } from "./db/browser-authorization-journal";

const owner = `0x${"11".repeat(20)}`, signer = `0x${"22".repeat(20)}`, payee = `0x${"33".repeat(20)}`;
const state = vi.hoisted(() => ({ db: null as unknown as SqliteAdapter, session: null as { address: string } | null }));
vi.mock("@/lib/db", () => ({ getDb: async () => state.db }));
vi.mock("@/lib/auth", () => ({ getSession: async () => state.session }));
import { POST } from "@/app/api/session/revoke/route";
import { getGrant } from "./payments/session-grants";

let folder: string, second: SqliteAdapter;
const grant = (epoch: string, address = signer) => ({ sessionId: owner, ownerAddr: owner, sessAddr: address,
  cap: 0.01, expiry: Date.now() + 60_000, txHash: "synthetic-unfunded", grantEpoch: epoch });
function admission(): BrowserJournalAdmission {
  const requirements = { scheme: "exact" as const, network: "eip155:5042002" as const, asset: "0x3600000000000000000000000000000000000000",
    amount: "2000", payTo: payee, maxTimeoutSeconds: 691200,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } };
  return { sessionId: owner, requestId: "original", queryId: "synthetic-query", grantEpoch: "old", signer,
    network: requirements.network, token: requirements.asset, gatewayContract: requirements.extra.verifyingContract,
    sourceId: "synthetic-source", offerId: null, kind: "fetch", payee, amountMicroUsdc: 2000, requirements,
    payment: { kind: "fetch", queryId: "synthetic-query", sourceId: "synthetic-source", sourceName: "Synthetic",
      payer: signer, payee, amountUsdc: 0.002, network: requirements.network, grantEpoch: "old" } };
}
const request = () => new NextRequest("https://synthetic.example/api/session/revoke", { method: "POST" });
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "keryx-revoke-generation-"));
  state.db = new SqliteAdapter(join(folder, "state.sqlite")); await state.db.init();
  second = new SqliteAdapter(join(folder, "state.sqlite")); await second.init();
  state.session = { address: owner }; await state.db.upsertSessionGrant(grant("old"));
});
afterEach(() => { vi.restoreAllMocks(); state.db.close(); second.close(); rmSync(folder, { recursive: true, force: true }); });

it.each([false, true])("old revoke cannot remove a concurrent recovered epoch (journal=%s)", async active => {
  if (active) { await state.db.activateBrowserJournal(); await state.db.admitBrowserJournal(admission());
    await state.db.exposeBrowserJournal(owner, "original"); }
  const originalJournal = active ? await state.db.getBrowserJournal(owner, "original") : null;
  let entered!: () => void, resume!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const revoke = state.db.revokeSessionGrant.bind(state.db);
  vi.spyOn(state.db, "revokeSessionGrant").mockImplementationOnce(async (...args) => { entered(); await paused; return revoke(...args); });
  const pending = POST(request()); await ready;
  // Independent DB connection commits recovery after the route's capture and before its CAS.
  await second.upsertSessionGrant(grant("replacement"));
  const replacement = await second.getSessionGrant(owner); resume();
  const response = await pending;
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: "session_changed" });
  expect(await second.getSessionGrant(owner)).toEqual(replacement);
  expect((await getGrant(owner))?.grantEpoch).toBe("replacement");
  if (active) { expect(await state.db.getBrowserJournal(owner, "original")).toEqual(originalJournal);
    expect(replacement?.spent).toBe(0.002); }
});

it("matching revoke disables admission and preserves original exposed debit through replacement and reopen", async () => {
  await state.db.activateBrowserJournal(); await state.db.admitBrowserJournal(admission()); await state.db.exposeBrowserJournal(owner, "original");
  const journal = await state.db.getBrowserJournal(owner, "original");
  expect((await POST(request())).status).toBe(200); expect(await getGrant(owner)).toBeUndefined();
  expect((await state.db.getSessionGrant(owner))?.expiry).toBe(0);
  expect(await state.db.getBrowserJournal(owner, "original")).toEqual(journal);
  await second.upsertSessionGrant(grant("replacement"));
  expect((await second.getSessionGrant(owner))?.spent).toBe(0.002);
  state.db.close(); state.db = new SqliteAdapter(join(folder, "state.sqlite")); await state.db.init();
  expect(await state.db.getBrowserJournal(owner, "original")).toEqual(journal);
  expect((await state.db.getSessionGrant(owner))?.spent).toBe(0.002);
});

it("matching legacy revoke removes only the captured row and is idempotent", async () => {
  expect((await POST(request())).status).toBe(200); expect(await state.db.getSessionGrant(owner)).toBeNull();
  expect(await (await POST(request())).json()).toMatchObject({ ok: true, alreadyRevoked: true });
});
it("a different captured signer cannot revoke the row", async () => {
  expect(await state.db.revokeSessionGrant(owner, "old", payee)).toBe(false);
  expect((await getGrant(owner))?.sessAddr).toBe(signer);
});
it("unauthenticated revocation leaves authority unchanged", async () => {
  state.session = null; expect((await POST(request())).status).toBe(401);
  expect((await state.db.getSessionGrant(owner))?.grantEpoch).toBe("old");
});
