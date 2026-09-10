import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SqliteAdapter } from "../../lib/db/sqlite-adapter";
import { privateResearchService } from "../../lib/a2a/private-research-service";
import { preparePrivateBuyerJournal } from "../../lib/buyer/private-checkout-preparation";
import { readPrivateBuyerJournal } from "../../lib/buyer/private-journal";
import { BUYER_NETWORK } from "../../lib/buyer/protocol";

/** Unfunded ephemeral identities, synthetic incoming evidence, an empty source corpus.
 * No environment file, existing database or live payment transport is read. */
export async function privateWorkerScenario() {
  const root = await mkdtemp(join(tmpdir(), "keryx-worker-drain-"));
  const db = new SqliteAdapter(join(root, "data", "keryx.sqlite"));
  try {
    await db.init();
    const owner = privateKeyToAccount(generatePrivateKey()), treasuryKey = generatePrivateKey(), publicKey = generatePrivateKey();
    const treasury = privateKeyToAccount(treasuryKey).address;
    const merchants = { privatePayee: `0x${"ab".repeat(20)}`, publicResearchPayee: `0x${"cd".repeat(20)}` };
    const env = { KERYX_PRIVATE_WORKER_ENABLED: "1", KERYX_PRIVATE_RESEARCH_ENABLED: "1", KERYX_COMMIT: "abcdef0",
      CONTENT_MASTER_KEY: randomBytes(32).toString("hex"),
      KERYX_PRIVATE_RESEARCH_PAYEE: merchants.privatePayee, KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: merchants.privatePayee,
      SELLER_ADDRESS: merchants.publicResearchPayee, AGENT_FUNDER_PRIVATE_KEY: publicKey,
      KERYX_PRIVATE_TREASURY_ADDRESS: treasury, KERYX_PRIVATE_TREASURY_PRIVATE_KEY: treasuryKey,
      KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: "60000", KERYX_PRIVATE_SERVICE_FEE_MICROS: "20000",
      KERYX_PRIVATE_MODEL_ID: "deepseek-flash", KERYX_PRIVATE_PROVIDER: "deepseek",
      KERYX_PRIVATE_PROVIDER_BASE_URL: "https://synthetic.invalid/v1", KERYX_PRIVATE_PROVIDER_API_KEY: "synthetic-not-secret",
      KERYX_PRIVATE_APPROVED_ENDPOINTS: '["https://synthetic.invalid/v1/chat/completions"]',
      KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY: join(root, "spool"), KERYX_PRIVATE_RESULT_SPOOL_KEY: randomBytes(32).toString("hex") };
    const now = 1788912000000;
    let verifications = 0, settlements = 0;
    const service = privateResearchService(db, env, { network: BUYER_NETWORK, publicSeller: merchants.publicResearchPayee,
      publicTreasurySigners: [privateKeyToAccount(publicKey).address], privateTreasurySigner: treasury }, {
      now: () => now, facilitator: async action => {
        if (action === "verify") { verifications++; return { isValid: true, payer: owner.address }; }
        settlements++; return { success: true, payer: owner.address, network: BUYER_NETWORK, transaction: "synthetic-drain-payment" };
      } })!;
    const jobs: string[] = [];
    for (let index = 0; index < 2; index++) {
      const request = { question: `Synthetic worker lifecycle question ${index}`, budget: 0.03, researchMode: "quick" as const,
        packageVersion: "1.0.0" as const, responseMode: "async" as const };
      const expected = { ...request, access: "payer-private-v1", model: "deepseek-flash", reasoning: {
        modelId: "deepseek-flash", provider: "deepseek", wireModel: "deepseek-v4-flash",
        endpoint: "https://synthetic.invalid/v1/chat/completions", fallback: "local-heuristic", redirects: "prohibited" } };
      const journal = join(root, `journal-${index}`);
      const prepared = await preparePrivateBuyerJournal(journal, service.quote(request), expected, merchants,
        { maxTotalMicros: "50000", maxServiceFeeMicros: "20000" }, owner, now);
      const original = await readPrivateBuyerJournal(journal, owner.address, merchants);
      await service.submit(original.submission, owner.address);
      assert.equal((await db.getPrivatePaymentState(prepared.id, owner.address))?.status, "settled");
      jobs.push(prepared.id);
    }
    assert.equal(verifications, 2); assert.equal(settlements, 2);
    return { root, db, env, payer: owner.address, treasury, jobs: jobs.sort(),
      close: async () => { db.close(); await rm(root, { recursive: true }); } };
  } catch (error) { db.close(); await rm(root, { recursive: true }); throw error; }
}
