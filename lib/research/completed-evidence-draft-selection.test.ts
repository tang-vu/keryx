// Source-only synthetic fixtures. Execute only in root's admitted validation environment.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrivateResearchIntent } from "../a2a/private-research-intent";
import { PAPER_CATALOG } from "../papers/catalog";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { createCompletedEvidenceDraftSelectionRoute, loadCompletedEvidenceDraftSelection } from "./completed-evidence-draft-selection";
import { MAX_COMPLETED_SNAPSHOT_BYTES, loadCompletedEvidenceDraft } from "./completed-evidence-draft";

const wallet = `0x${"1".repeat(40)}`, id = `prv_${"a".repeat(64)}`, baseUrl = "https://keryx.cc", network = "eip155:5042";
function fixture() {
  const workspace = evidenceDraftFixture().workspace, claim = "Original research target";
  const identity = { sourceId: "original-paper", sourceName: "Original", marker: "S1", itemId: "paper-v1",
    itemUrl: workspace.entries[0].paper.url, contentVersion: `sha256:${"b".repeat(64)}`,
    contentReceipt: { bodyHash: `0x${"c".repeat(64)}`, deliveryKind: "full_text", storageMode: "db_plaintext", plaintextBytes: 200 } };
  const run = { id, question: "Read exact retained paper", budget: 0.05, researchMode: "deep", asker: wallet,
    origin: "a2a", paymentMode: "real", fundingOwner: "treasury", answer: "Saved result [S1].", engine: "synthetic-fixture",
    createdAt: "2026-10-12T01:00:00.000Z", subClaims: [claim],
    citations: [{ ...identity, weight: 1, reward: 0.001, rationale: "Fixture citation" }],
    evidence: [{ ...identity, claimIndex: 0, claim, quote: "The evaluated method improved the measured outcome.", support: 0.8,
      qualifiesForAnswer: true, qualifiesForReward: false }],
    decisions: [{ ...identity, action: "BUY", rationale: "Fixture retained read", targets: [0], price: 0.01 }] };
  const saved = { id, format: "query-run-v1" as const, savedAt: "2026-10-12T02:00:00.000Z", serializedRun: JSON.stringify(run, null, 2) + "\n" };
  const intent = { id, submission: { request: { question: run.question, budget: run.budget, researchMode: run.researchMode },
    payment: { signature: "SECRET_SIGNATURE", authorization: { from: wallet, nonce: "SECRET_NONCE" } } }, requirement: { network } } as unknown as PrivateResearchIntent;
  const db = { getPrivateResearchResult: vi.fn(async () => ({ ...saved })), getPrivateResearchIntent: vi.fn(async () => intent),
    getPrivateResearchExecution: vi.fn(async () => ({ id, workerId: "12345678-1234-4234-8234-123456789abc", startedAt: "2026-10-12T00:00:00.000Z" })),
    getPrivateResearchInterruption: vi.fn(async () => null),
    // These traps are not ports admitted to the selector or accepted importer.
    savePrivateResearchResult: vi.fn(() => { throw new Error("write forbidden"); }), listPrivateResearchHistory: vi.fn(() => { throw new Error("history forbidden"); }),
    getQueryRun: vi.fn(() => { throw new Error("public query forbidden"); }), getSourceContent: vi.fn(() => { throw new Error("source read forbidden"); }),
    recordPayment: vi.fn(() => { throw new Error("payment forbidden"); }) };
  const input = { version: 1, id, workspace }, context = { db, wallet, baseUrl, network };
  const account = vi.fn(async (): Promise<{ db: typeof db; wallet: string } | Response> => ({ db, wallet }));
  const resnapshot = () => { saved.serializedRun = JSON.stringify(run, null, 2) + "\n"; };
  return { input, context, db, run, saved, intent, account, resnapshot };
}
function request(body: unknown, headers: Record<string, string> = {}, url = `${baseUrl}/api/research/evidence-draft/completed-read/selection`) {
  return new Request(url, { method: "POST", headers: { Origin: baseUrl, "Content-Type": "application/json",
    "X-Keryx-Expected-Owner": wallet, ...headers }, body: JSON.stringify(body) });
}
const route = (f: ReturnType<typeof fixture>) => createCompletedEvidenceDraftSelectionRoute({ baseUrl, network, account: f.account });
afterEach(() => vi.useRealTimers());
describe("retained completed-job selection", () => {
  it("derives hash from exact retained bytes, authenticates the ledger, and returns only selectable metadata", async () => {
    const f = fixture(), original = f.saved.serializedRun, response = await route(f)(request(f.input));
    expect(response.status).toBe(200);
    const packet = await response.json();
    expect(packet.selection.snapshotSha256).toBe(`sha256:${createHash("sha256").update(original, "utf8").digest("hex")}`);
    expect(packet.selection.snapshotSha256).not.toBe(`sha256:${createHash("sha256").update(JSON.stringify(JSON.parse(original))).digest("hex")}`);
    expect(packet.selection.sources[0]).toEqual({ sourceId: "original-paper", itemId: "paper-v1", itemUrl: f.run.citations[0].itemUrl,
      contentVersion: f.run.citations[0].contentVersion });
    expect(f.account).toHaveBeenCalledTimes(2); expect(f.db.getPrivateResearchResult).toHaveBeenCalledTimes(3);
    for (const read of [f.db.getPrivateResearchResult, f.db.getPrivateResearchIntent, f.db.getPrivateResearchExecution, f.db.getPrivateResearchInterruption])
      for (const args of read.mock.calls) expect(args).toEqual([id, wallet]);
    for (const forbidden of [f.db.getQueryRun, f.db.getSourceContent, f.db.recordPayment, f.db.savePrivateResearchResult, f.db.listPrivateResearchHistory])
      expect(forbidden).not.toHaveBeenCalled();
    expect(f.saved.serializedRun).toBe(original);
    const text = JSON.stringify(packet);
    for (const privateValue of ["SECRET_SIGNATURE", "SECRET_NONCE", f.run.answer, f.run.evidence[0].quote, "serializedRun", "exports"])
      expect(text).not.toContain(privateValue);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("X-Keryx-Expected-Owner");
  });
  it.each([{ Origin: "https://foreign.example" }, { Origin: "https://keryx.cc/" }, { "Sec-Fetch-Site": "cross-site" },
    { Origin: "http://keryx.cc", Host: "keryx.cc", "X-Forwarded-Host": "keryx.cc" }] as Array<Record<string, string>>)("refuses configured-origin changes before auth/body/private reads: %j", async headers => {
    const f = fixture(), req = request(f.input, headers);
    expect((await route(f)(req)).status).toBe(403); expect(req.bodyUsed).toBe(false);
    expect(f.account).not.toHaveBeenCalled(); expect(f.db.getPrivateResearchResult).not.toHaveBeenCalled();
  });
  it.each(["", "Basic anything", `Bearer kx_live_${"a".repeat(96)}`])("API key/authorization presence never chooses account authority: %s", async Authorization => {
    const f = fixture(), req = request(f.input, { Authorization });
    expect((await route(f)(req)).status).toBe(401); expect(f.account).not.toHaveBeenCalled(); expect(req.bodyUsed).toBe(false);
  });
  it.each(["missing", "malformed", "different", "unauthenticated", "unavailable"])("refuses %s owner before private access", async change => {
    const f = fixture(), req = request(f.input);
    if (change === "missing") req.headers.delete("X-Keryx-Expected-Owner");
    if (change === "malformed") req.headers.set("X-Keryx-Expected-Owner", "owner");
    if (change === "different") req.headers.set("X-Keryx-Expected-Owner", `0x${"2".repeat(40)}`);
    if (change === "unauthenticated") f.account.mockResolvedValue(Response.json({}, { status: 401 }));
    if (change === "unavailable") f.account.mockRejectedValue(new Error("SECRET"));
    expect((await route(f)(req)).status).toBe(change === "unauthenticated" ? 401 : change === "unavailable" ? 503 : 403);
    expect(req.bodyUsed).toBe(false); expect(f.db.getPrivateResearchResult).not.toHaveBeenCalled();
  });
  it("rechecks owner and adapter after metadata reads, refusing disclosure on change", async () => {
    for (const change of ["owner", "adapter", "signout"] as const) {
      const f = fixture(); f.account.mockResolvedValueOnce({ db: f.db, wallet });
      f.account.mockResolvedValue(change === "owner" ? { db: f.db, wallet: `0x${"2".repeat(40)}` }
        : change === "adapter" ? { db: { ...f.db }, wallet } : Response.json({}, { status: 401 }));
      const response = await route(f)(request(f.input)); expect(response.status).toBe(change === "signout" ? 401 : 403);
      expect(await response.json()).toEqual({ error: "owner_changed" });
    }
  });
  it("rejects body authority, URLs, imported drafts and oversized requests before private access", async () => {
    const f = fixture(), handler = route(f);
    for (const body of [{ ...f.input, owner: wallet }, { ...f.input, baseUrl }, { ...f.input, network },
      { ...f.input, selection: {} }, { ...f.input, draft: evidenceDraftFixture() }, { ...f.input, id: "public-id" }])
      expect((await handler(request(body))).status).toBe(400);
    expect((await handler(request(f.input, {}, `${baseUrl}/api/research/evidence-draft/completed-read/selection?id=${id}`))).status).toBe(400);
    const req = request(f.input); Object.defineProperty(req, "body", { value: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(65537)); c.close(); } }) });
    expect((await handler(req)).status).toBe(400); expect(f.db.getPrivateResearchResult).not.toHaveBeenCalled();
  });
  it.each(["missing-url", "missing-item", "missing-version", "bad-version", "foreign-owner", "oversize", "conflicting-version", "no-include-match"])("refuses incomplete/changed snapshot identities: %s", async change => {
    const f = fixture();
    if (change === "missing-url") delete (f.run.citations[0] as Partial<typeof f.run.citations[0]>).itemUrl;
    if (change === "missing-item") delete (f.run.citations[0] as Partial<typeof f.run.citations[0]>).itemId;
    if (change === "missing-version") delete (f.run.evidence[0] as Partial<typeof f.run.evidence[0]>).contentVersion;
    if (change === "bad-version") f.run.citations[0].contentVersion = "unknown";
    if (change === "foreign-owner") f.run.asker = `0x${"2".repeat(40)}`;
    if (change === "conflicting-version") f.run.evidence[0].contentVersion = `sha256:${"e".repeat(64)}`;
    if (change === "no-include-match") f.input.workspace.entries[0].paper = PAPER_CATALOG[1];
    f.resnapshot(); if (change === "oversize") f.saved.serializedRun = " ".repeat(MAX_COMPLETED_SNAPSHOT_BYTES + 1);
    const response = await route(f)(request(f.input)); expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "completed_selection_unavailable_or_changed" });
  });
  it.each(["missing", "saved-at", "bytes", "interruption"])("refuses %s snapshot change during authenticated capture", async change => {
    const f = fixture();
    if (change === "missing") f.db.getPrivateResearchResult.mockResolvedValue(null as never);
    else if (change === "interruption") f.db.getPrivateResearchInterruption.mockResolvedValue({ id } as never);
    else f.db.getPrivateResearchResult.mockResolvedValueOnce({ ...f.saved }).mockResolvedValue({ ...f.saved,
      ...(change === "saved-at" ? { savedAt: "2026-10-12T03:00:00.000Z" } : { serializedRun: f.saved.serializedRun + " " }) });
    expect((await route(f)(request(f.input))).status).toBe(409);
  });
  it("reports selected storage refusal and bounds a stalled read without starting later reads", async () => {
    const f = fixture(); f.db.getPrivateResearchResult.mockRejectedValue(new Error("SECRET_DB"));
    const response = await route(f)(request(f.input)); expect(response.status).toBe(503); expect(await response.text()).not.toContain("SECRET_DB");
    vi.useFakeTimers(); f.db.getPrivateResearchResult.mockImplementation(() => new Promise(() => {}));
    const promise = loadCompletedEvidenceDraftSelection(f.context, f.input);
    const assertion = expect(promise).rejects.toMatchObject({ kind: "storage" });
    await vi.advanceTimersByTimeAsync(10001); await assertion;
    expect(f.db.getPrivateResearchIntent).not.toHaveBeenCalled();
  });
  it("refuses absent private ports and excessive retained rows without falling back", async () => {
    const absent = fixture(); Object.defineProperty(absent.db, "getPrivateResearchExecution", { value: undefined });
    expect((await route(absent)(request(absent.input))).status).toBe(503);
    expect(absent.db.getPrivateResearchResult).not.toHaveBeenCalled();
    for (const field of ["citations", "evidence"] as const) {
      const f = fixture(), raw = { ...f.run, [field]: Array.from({ length: field === "citations" ? 65 : 257 }, () => f.run[field][0]) };
      f.saved.serializedRun = JSON.stringify(raw);
      expect((await route(f)(request(f.input))).status).toBe(409); expect(f.db.getPrivateResearchIntent).not.toHaveBeenCalled();
    }
  });
  it.each([false, true])("preserves mixed/all-unavailable and unrelated unknown observations (all: %s)", async all => {
    const f = fixture(), second = PAPER_CATALOG[1];
    f.input.workspace.entries.push({ ...f.input.workspace.entries[0], paper: second }, { ...f.input.workspace.entries[0], paper: PAPER_CATALOG[2] });
    const identity = { sourceId: "original-b", itemId: "paper-b", itemUrl: second.url, marker: "S2" };
    f.run.citations.push({ ...f.run.citations[0], ...identity }); f.run.evidence.push({ ...f.run.evidence[0], ...identity, qualifiesForAnswer: false });
    f.run.decisions.push({ ...f.run.decisions[0], ...identity }); f.run.answer += " [S2]";
    f.run.evidence[0].qualifiesForAnswer = !all; f.resnapshot();
    const metadata = await loadCompletedEvidenceDraftSelection(f.context, f.input);
    const packet = await loadCompletedEvidenceDraft(f.context, { version: 1, capability: metadata.capability,
      baseUrl, network, selection: metadata.selection, workspace: f.input.workspace });
    expect(packet.draft.excerpts).toHaveLength(all ? 0 : 1);
    expect(packet.editableRequest.readingStatuses).toHaveLength(all ? 2 : 1);
    expect(packet.editableRequest.readingStatuses?.some(row => row.paperUrl === PAPER_CATALOG[2].url)).toBe(false);
    expect(packet.provenance.semanticSupport).toBe("UNJUDGED");
  });
});
