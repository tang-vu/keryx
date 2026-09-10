import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { privateResearchService } from "../a2a/private-research-service";
import { privateResultView } from "../a2a/private-result-view";
import { preparePrivateBuyerJournal } from "./private-checkout-preparation";
import { readPrivateBuyerJournal } from "./private-journal";
import { submitPrivateBuyerJournal } from "./private-submission";
import { recoverPrivateBuyerResult } from "./private-recovery";
import { PRIVATE_RESEARCH_RESOURCE } from "./private-request-commitment";
import { BUYER_NETWORK, BUYER_ORIGIN } from "./protocol";

afterEach(() => vi.unstubAllGlobals());

// Actual EOA signatures, local journal and SQLite adapters; no HTTP server, real
// facilitator, funded wallet, provider call or on-chain settlement is exercised.
it.each(["after-settlement", "during-settlement"] as const)(
  "recovers across a database reopen with response loss %s and no second debit attempt", async (loss) => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in this integration test"); }));
    const root = await mkdtemp(join(tmpdir(), "keryx-private-integration-"));
    const file = join(root, "test.sqlite"), journal = join(root, "journal");
    let db = new SqliteAdapter(file);
    try {
      await db.init();
      const account = privateKeyToAccount(generatePrivateKey());
      const merchants = { privatePayee: `0x${"ab".repeat(20)}`, publicResearchPayee: `0x${"cd".repeat(20)}` };
      const env = { KERYX_PRIVATE_RESEARCH_ENABLED: "1", KERYX_PRIVATE_RESEARCH_PAYEE: merchants.privatePayee,
        KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: merchants.privatePayee, KERYX_PRIVATE_TREASURY_ADDRESS: `0x${"99".repeat(20)}`,
        KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: "30000", KERYX_PRIVATE_SERVICE_FEE_MICROS: "20000",
        KERYX_PRIVATE_MODEL_ID: "deepseek-flash", KERYX_PRIVATE_PROVIDER: "deepseek",
        KERYX_PRIVATE_PROVIDER_BASE_URL: "https://synthetic.example/v1", KERYX_PRIVATE_PROVIDER_API_KEY: "synthetic-not-secret",
        KERYX_PRIVATE_APPROVED_ENDPOINTS: '["https://synthetic.example/v1/chat/completions"]' };
      const context = { network: BUYER_NETWORK, publicSeller: merchants.publicResearchPayee,
        publicTreasurySigners: [`0x${"88".repeat(20)}`], privateTreasurySigner: env.KERYX_PRIVATE_TREASURY_ADDRESS };
      const now = 1788912000000;
      const facilitator = vi.fn(async (action: "verify" | "settle", body: unknown) => {
        const serialized = JSON.stringify(body);
        expect(serialized).not.toContain("Synthetic integration question");
        expect(serialized).not.toContain("synthetic.example");
        if (action === "verify") return { isValid: true, payer: account.address };
        if (loss === "during-settlement") throw new Error("Synthetic facilitator response loss");
        return { success: true, payer: account.address, network: BUYER_NETWORK, transaction: "synthetic-confirmation" };
      });
      let service = privateResearchService(db, env, context, { facilitator, now: () => now })!;
      const request = { question: "Synthetic integration question", budget: 0.03, researchMode: "quick" as const,
        packageVersion: "1.0.0" as const, responseMode: "async" as const };
      const quote = service.quote(request);
      // Independently selected model/endpoint policy, rather than trusting echoed quote fields.
      const expected = { ...request, access: "payer-private-v1", model: "deepseek-flash", reasoning: {
        modelId: "deepseek-flash", provider: "deepseek", wireModel: "deepseek-v4-flash",
        endpoint: "https://synthetic.example/v1/chat/completions", fallback: "local-heuristic", redirects: "prohibited" } };
      const prepared = await preparePrivateBuyerJournal(journal, quote, expected, merchants,
        { maxTotalMicros: "50000", maxServiceFeeMicros: "20000" }, account, now);
      expect(await db.listPrivateWorkerCandidates(context.privateTreasurySigner)).toEqual([]);
      const original = await readPrivateBuyerJournal(journal, account.address, merchants);
      // This injection represents the authenticated owner boundary, not an authentication test.
      const send = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
        expect(url).toBe(PRIVATE_RESEARCH_RESOURCE);
        await service.submit(JSON.parse(String(init?.body)), account.address);
        throw new Error("Synthetic buyer response loss");
      });
      expect(await submitPrivateBuyerJournal(journal, account.address, merchants, "keryx_session=synthetic", send, now))
        .toEqual({ status: "recovery-required", submissionAttempted: true });
      db.close(); db = new SqliteAdapter(file); await db.init();
      service = privateResearchService(db, env, context, { facilitator, now: () => now })!;
      expect(await submitPrivateBuyerJournal(journal, account.address, merchants, "keryx_session=synthetic", send, now))
        .toEqual({ status: "recovery-required", submissionAttempted: false });
      expect(send).toHaveBeenCalledTimes(1);
      // Even bypassing the local journal marker cannot start another backend settlement.
      const replay = await service.submit(original.submission, account.address);
      const expectedStatus = loss === "after-settlement" ? "settled" : "pending";
      expect(await db.listPrivateWorkerCandidates(context.privateTreasurySigner)).toEqual(loss === "after-settlement"
        ? [{ id: prepared.id, payer: account.address.toLowerCase() }] : []);
      expect(await db.listPrivateWorkerCandidates(context.publicTreasurySigners[0])).toEqual([]);
      expect(await db.listPrivateWorkerCandidates(context.privateTreasurySigner, prepared.id)).toEqual([]);
      expect(replay.response.paymentStatus).toBe(expectedStatus);
      expect(facilitator.mock.calls.map(([action]) => action)).toEqual(["verify", "settle"]);
      const view = await recoverPrivateBuyerResult(journal, account.address, merchants, "keryx_session=synthetic",
        async (url, init) => {
          expect(url).toBe(`${BUYER_ORIGIN}/api/me/private-jobs/result`);
          expect(JSON.parse(String(init?.body))).toEqual({ id: prepared.id });
          return Response.json({ wallet: account.address.toLowerCase(), ...await privateResultView(db, prepared.id, account.address) });
        });
      expect(view.spend.incoming.status).toBe(expectedStatus);
      expect(view.status).toBe(loss === "after-settlement" ? "awaiting-execution" : "awaiting-payment");
      expect(view.spend.creator).toMatchObject({ budgetMicros: "30000", committedMicros: "0", uncommittedMicros: "30000" });
      expect(await readPrivateBuyerJournal(journal, account.address, merchants)).toEqual(original);
      expect(await privateResultView(db, prepared.id, merchants.publicResearchPayee)).toBeNull();
      expect(await db.getQueryRun(prepared.id)).toBeNull();
      expect(await db.getA2aOrder(prepared.id)).toBeNull();
      if (loss === "after-settlement") {
        expect(await db.claimPrivateResearchExecution(prepared.id, account.address)).not.toBeNull();
        expect(await db.listPrivateWorkerCandidates(context.privateTreasurySigner)).toEqual([]);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      db.close();
      for (const name of ["private-intent.json", "private-submission-attempt.json"]) await unlink(join(journal, name)).catch(() => undefined);
      await rmdir(journal).catch(() => undefined);
      for (const suffix of ["", "-wal", "-shm"]) await unlink(file + suffix).catch(() => undefined);
      await rmdir(root);
    }
  });
