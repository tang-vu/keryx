import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@supabase/supabase-js";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi, afterEach } from "vitest";
import { privateWorkerScenario } from "../../scripts/test-fixtures/private-worker-scenario.mjs";
import { resolvePrivateInterruption } from "../a2a/private-interruption-operator";
import { createPrivateResultSpool } from "../a2a/private-result-spool";
import { privateResultView } from "../a2a/private-result-view";
import { privateWorkspaceResultSchema } from "../a2a/private-workspace";
import { validatePrivateBuyerResult } from "../buyer/private-result-binding";
import { readPrivateBuyerJournal } from "../buyer/private-journal";
import { BUYER_NETWORK, BUYER_USDC } from "../buyer/protocol";
import { SqliteAdapter } from "./sqlite-adapter";
import type { QueryRun } from "../types";
import { interruptSupabasePrivateResearch } from "./private-research-interruptions";

afterEach(() => vi.unstubAllGlobals());

it("recovers a lost interruption RPC response and refuses missing or foreign-worker readback", async () => {
  const s = await privateWorkerScenario();
  const raw = new DatabaseSync(join(s.root, "data", "keryx.sqlite"));
  try {
    const id = s.jobs[0], claim = (await s.db.claimPrivateResearchExecution(id, s.payer))!;
    let loseResponse = true, readback: "valid" | "missing" | "foreign" = "valid";
    const allowed = new Set(["private_research_intents", "private_research_payment_attempts",
      "private_research_executions", "private_research_results", "private_research_interruptions"]);
    const client = createClient("https://synthetic.invalid", "no-authority", { auth: { persistSession: false }, global: { fetch: async (url, options) => {
      const route = new URL(String(url)), table = route.pathname.split("/").at(-1)!;
      if (route.pathname.endsWith("/rpc/interrupt_private_research")) {
        expect(JSON.parse(String(options?.body))).toEqual({ p_id: id, p_payer: s.payer.toLowerCase(), p_worker_id: claim.workerId });
        await s.db.interruptPrivateResearch(id, s.payer, claim.workerId);
        if (loseResponse) { loseResponse = false; return new Response("{}", { status: 503 }); }
        return new Response(null, { status: 204 });
      }
      if (!allowed.has(table) || options?.method !== "GET") throw new Error("Unexpected transport");
      const rows = raw.prepare(`SELECT * FROM ${table} WHERE id=?`).all(id).map(row => {
        const parsed = { ...row };
        for (const key of ["data", "confirmation"]) if (typeof parsed[key] === "string") parsed[key] = JSON.parse(parsed[key]);
        if (table === "private_research_interruptions" && readback === "foreign") parsed.worker_id = randomUUID();
        return parsed;
      });
      return Response.json(table === "private_research_interruptions" && readback === "missing" ? [] : rows);
    } } });
    const interrupt = () => interruptSupabasePrivateResearch(client, id, s.payer, claim.workerId);
    await expect(interrupt()).rejects.toThrow("unavailable");
    const original = await s.db.getPrivateResearchInterruption(id, s.payer);
    expect(original).not.toBeNull();
    expect(await interrupt()).toEqual(original);
    readback = "missing";
    await expect(interrupt()).rejects.toThrow("unavailable");
    readback = "foreign";
    await expect(interrupt()).rejects.toThrow("unavailable");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM private_research_interruptions WHERE id=?").get(id)?.n).toBe(1);
    expect(await s.db.getPrivateResearchExecution(id, s.payer)).toEqual(claim);
  } finally { raw.close(); await s.close(); }
}, 60000);
type Scenario = Awaited<ReturnType<typeof privateWorkerScenario>>;
const options = (s: Scenario, apply = true) => ({ directory: s.env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY,
  keyHex: s.env.KERYX_PRIVATE_RESULT_SPOOL_KEY, apply });
async function savedRun(s: Scenario, id: string): Promise<QueryRun> {
  const intent = (await s.db.getPrivateResearchIntent(id, s.payer))!;
  return { id, question: intent.submission.request.question, budget: 0.03, researchMode: "quick", paymentMode: "real",
    fundingOwner: "treasury", origin: "a2a", engine: "synthetic", answer: "Synthetic recovered original answer",
    subClaims: [], decisions: [], citations: [], trace: [], totalSpent: 0, totalToCreators: 0,
    createdAt: "2026-09-10T00:00:00.000Z" };
}

it("fences interruption once, retains uncertain spend, accepts late confirmation and exposes the owner-bound outcome", async () => {
  vi.stubGlobal("fetch", () => { throw new Error("Network forbidden"); });
  const s = await privateWorkerScenario();
  try {
    const id = s.jobs[0], claim = (await s.db.claimPrivateResearchExecution(id, s.payer))!;
    const leg = { kind: "citation" as const, sourceId: "synthetic-source", itemId: null, submission: {
      authorizationId: `0x${"1".repeat(64)}`, authorizationExpiresAt: "2020-01-01T00:00:00.000Z",
      payer: s.treasury, payee: `0x${"bc".repeat(20)}`, amountMicros: "17000", network: BUYER_NETWORK, asset: BUYER_USDC } } as const;
    expect(await s.db.admitPrivateCreatorSubmission(id, s.payer, claim.workerId, leg)).toBe(true);
    await expect(s.db.interruptPrivateResearch(id, leg.submission.payee, claim.workerId)).rejects.toThrow("authority");
    await expect(s.db.interruptPrivateResearch(id, s.payer, randomUUID())).rejects.toThrow("authority");
    const other = new SqliteAdapter(join(s.root, "data", "keryx.sqlite")); await other.init();
    try {
      const records = await Promise.all([s.db.interruptPrivateResearch(id, s.payer, claim.workerId), other.interruptPrivateResearch(id, s.payer, claim.workerId)]);
      expect(records[0]).toEqual(records[1]);
      expect(await other.admitPrivateCreatorSubmission(id, s.payer, claim.workerId, { ...leg, sourceId: "late",
        submission: { ...leg.submission, authorizationId: `0x${"2".repeat(64)}`, amountMicros: "1" } })).toBe(false);
      expect(await other.claimPrivateResearchExecution(id, s.payer)).toBeNull();
      expect(await other.releasePrivateTreasury(id, s.payer, s.treasury)).toMatchObject({ amountMicros: "13000" });
      expect(await other.getPrivateTreasurySummary(s.treasury)).toMatchObject({ allocatedMicros: "47000", committedMicros: "17000", confirmedMicros: "0" });
      await other.confirmPrivateCreatorSubmission(id, s.payer, claim.workerId,
        { source: "circle-facilitator-success", transaction: "synthetic-late-confirmation", submission: leg.submission });
      expect(await other.getPrivateTreasurySummary(s.treasury)).toMatchObject({ allocatedMicros: "47000", confirmedMicros: "17000" });
      expect(await other.getPrivateResearchInterruption(id, leg.submission.payee)).toBeNull();
      const view = { ...await privateResultView(other, id, s.payer), wallet: s.payer.toLowerCase() };
      expect(privateWorkspaceResultSchema.parse(view)).toMatchObject({ status: "interrupted", result: null });
      const merchants = { privatePayee: s.env.KERYX_PRIVATE_RESEARCH_PAYEE, publicResearchPayee: s.env.SELLER_ADDRESS };
      const journals = await Promise.all([0, 1].map(i => readPrivateBuyerJournal(join(s.root, `journal-${i}`), s.payer, merchants)));
      expect(validatePrivateBuyerResult(view, s.payer, journals.find(journal => journal.id === id)!)).toMatchObject({ status: "interrupted" });
      expect(privateWorkspaceResultSchema.safeParse({ ...view, interruption: undefined }).success).toBe(false);
      // Restoring an original result after the fence does not authorize another payment.
      const run = await savedRun(s, id);
      await other.savePrivateResearchResult(id, s.payer, claim.workerId, run);
      expect(await privateResultView(other, id, s.payer)).toMatchObject({ status: "completed", result: { answer: run.answer } });
      expect(await other.getPrivateResearchInterruption(id, s.payer)).toEqual(records[0]);
      expect(await other.releasePrivateTreasury(id, s.payer, s.treasury)).toMatchObject({ amountMicros: "13000", newlyReleased: false });
    } finally { other.close(); }
  } finally { await s.close(); }
}, 60000);

it("previews without closing, refuses an unclaimed job and restores a matching backup before interruption", async () => {
  vi.stubGlobal("fetch", () => { throw new Error("Network forbidden"); });
  const s = await privateWorkerScenario();
  try {
    const id = s.jobs[0], locator = { id, payer: s.payer };
    await expect(resolvePrivateInterruption(s.db, locator, options(s))).rejects.toThrow();
    const claim = (await s.db.claimPrivateResearchExecution(id, s.payer))!;
    expect(await resolvePrivateInterruption(s.db, locator, options(s, false))).toMatchObject({ status: "interruption-proposed" });
    expect(await s.db.getPrivateResearchInterruption(id, s.payer)).toBeNull();
    const spool = await createPrivateResultSpool(options(s).directory, options(s).keyHex);
    await spool.save({ ...locator, workerId: claim.workerId }, await savedRun(s, id));
    expect(await resolvePrivateInterruption(s.db, locator, options(s, false))).toMatchObject({ status: "backup-available" });
    expect(await s.db.getPrivateResearchResult(id, s.payer)).toBeNull();
    expect(await resolvePrivateInterruption(s.db, locator, options(s))).toMatchObject({ status: "result-restored", paymentRequestsSent: 0 });
    expect(await s.db.getPrivateResearchInterruption(id, s.payer)).toBeNull();
    expect(await resolvePrivateInterruption(s.db, locator, options(s))).toMatchObject({ status: "result-available" });
  } finally { await s.close(); }
}, 60000);

it("refuses partial/unknown backups and retained locks; clean inspection permits an idempotent interruption", async () => {
  const s = await privateWorkerScenario();
  try {
    const id = s.jobs[0], locator = { id, payer: s.payer };
    await s.db.claimPrivateResearchExecution(id, s.payer);
    await createPrivateResultSpool(options(s).directory, options(s).keyHex);
    const corrupt = join(options(s).directory, `${"1".repeat(64)}.json`), unknown = join(options(s).directory, "unknown.tmp");
    for (const file of [corrupt, unknown]) {
      await writeFile(file, "{", { flag: "wx", mode: 0o600 });
      await expect(resolvePrivateInterruption(s.db, locator, options(s))).rejects.toThrow();
      expect(await s.db.getPrivateResearchInterruption(id, s.payer)).toBeNull();
      await unlink(file);
    }
    const lock = join(options(s).directory, "private-worker.lock");
    await writeFile(lock, "synthetic-retained-lock", { flag: "wx", mode: 0o600 });
    await expect(resolvePrivateInterruption(s.db, locator, options(s))).rejects.toThrow();
    await unlink(lock); // This fixture's own file, never a production lock or live process.
    expect(await resolvePrivateInterruption(s.db, locator, options(s))).toMatchObject({ status: "interrupted", refundIssuedByThisAction: false });
    const original = await s.db.getPrivateResearchInterruption(id, s.payer);
    expect(await resolvePrivateInterruption(s.db, locator, options(s))).toMatchObject({ status: "interrupted" });
    expect(await s.db.getPrivateResearchInterruption(id, s.payer)).toEqual(original);
    expect(await s.db.getPrivateTreasurySummary(s.treasury)).toMatchObject({ allocatedMicros: "30000", committedMicros: "0" });
  } finally { await s.close(); }
}, 60000);
