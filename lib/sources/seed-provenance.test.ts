import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { SEED_SOURCES } from "./seed-data";
import { contentBodyHash } from "./content-receipt";
import { backfillSqliteSeedProvenance } from "./seed-provenance";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { buildAnswerContent } from "../openai-compat";
import { exportsFromCheckedReceipt } from "../research/receipt-exports";
import type { PaymentRecord, QueryRun, Source, SourceItem } from "../types";

const adapters: SqliteAdapter[] = [];
afterEach(() => { for (const adapter of adapters.splice(0)) adapter.close(); });
const source = (id: string): Source => ({ id, name: "Unrelated display name", url: "https://production.test", description: "Source",
  fetchPrice: 0.003, tags: [], walletAddress: "0x1111111111111111111111111111111111111111", authors: [], createdAt: "2026-10-02T00:00:00Z" });
const seed = SEED_SOURCES.flatMap(s => s.items ?? []).find(item => item.title === "Measuring x402 settlement latency on Arc")!;
const item = (sourceId: string, id: string): SourceItem => ({ ...seed, id, sourceId });

async function dbFixture() { const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter); await adapter.init(); return adapter; }

describe("trusted synthetic corpus provenance", () => {
  it("backfills encrypted and plaintext exact corpus rows, rejects names/domains/IDs alone, and preserves custody", async () => {
    const adapter = await dbFixture();
    for (const id of ["arc-settlement-benchmarks-69af9e", "arbitrary-copy", "mixed", "near-match"]) await adapter.upsertSource(source(id));
    const encrypted = { ...item("arc-settlement-benchmarks-69af9e", "11203a0e-e458-421d-9722-a6a243f1f779"),
      content: "retained-ciphertext", bodyHash: contentBodyHash(seed.content), storageMode: "db_encrypted" as const, itemKeyEnc: "retained-envelope" };
    await adapter.addItems([encrypted, item("arbitrary-copy", "copy"), item("mixed", "demo-item"),
      { ...item("mixed", "real-item"), content: "Real observed document", summary: "Independent data" },
      { ...item("near-match", "impostor"), content: "Different empirical content", bodyHash: "0xwrong" }]);
    await adapter.init(); // The ordinary startup migration applies reviewed exact-corpus backfill.
    expect((await adapter.getSource(encrypted.sourceId))?.evidenceProvenance).toBe("synthetic-demo");
    expect((await adapter.getSource("arbitrary-copy"))?.evidenceProvenance).toBe("synthetic-demo");
    expect((await adapter.getSource("mixed"))?.evidenceProvenance).toBeUndefined();
    expect((await adapter.getSource("near-match"))?.evidenceProvenance).toBeUndefined();
    expect(await adapter.getItem(encrypted.sourceId, encrypted.id)).toMatchObject({ evidenceProvenance: "synthetic-demo", content: "retained-ciphertext", itemKeyEnc: "retained-envelope" });
    expect((await adapter.getItem("mixed", "demo-item"))?.evidenceProvenance).toBe("synthetic-demo");
    await adapter.upsertSource(source(encrypted.sourceId)); await adapter.addItems([{ ...encrypted, evidenceProvenance: undefined }]);
    expect((await adapter.getSource(encrypted.sourceId))?.evidenceProvenance).toBe("synthetic-demo");
    expect((await adapter.getItem(encrypted.sourceId, encrypted.id))?.evidenceProvenance).toBe("synthetic-demo");
    const raw = (adapter as unknown as { db: DatabaseSync }).db;
    expect(() => raw.prepare("UPDATE sources SET evidence_provenance=NULL WHERE id=?").run(encrypted.sourceId)).toThrow("immutable");
    expect(() => raw.prepare("INSERT OR REPLACE INTO source_items(id,source_id) VALUES (?,?)").run(encrypted.id, encrypted.sourceId)).toThrow("immutable");
    raw.prepare("INSERT INTO source_items(id,source_id,title) VALUES (?,?,?)").run("old-writer-new", encrypted.sourceId, "New demo article");
    expect((await adapter.getItem(encrypted.sourceId, "old-writer-new"))?.evidenceProvenance).toBe("synthetic-demo");
  });

  it("demotes the retained S4 benchmark in historical archive, receipt and local export without rewriting real settlement", async () => {
    const adapter = await dbFixture(), publication = source("arc-settlement-benchmarks-69af9e");
    await adapter.upsertSource(publication);
    const article = item(publication.id, "11203a0e-e458-421d-9722-a6a243f1f779");
    await adapter.addItems([article]); await adapter.init();
    const identity = { itemId: article.id, itemTitle: article.title, itemUrl: article.link,
      contentVersion: "sha256:f1823c1d02eb7043039aa848558586008a7e1084888cf714bef22c09889607d6" };
    const run: QueryRun = { id: "a455ae08-114b-4532-8680-c0049b3a6c4f", question: "What settlement latency was measured?", budget: 0.04,
      engine: "fixture", subClaims: ["Measured latency"], decisions: [], citations: [{ ...identity, marker: "S4", sourceId: publication.id,
        sourceName: publication.name, weight: 1, reward: 0.015, rationale: "Retained allocation" }],
      evidence: [{ ...identity, marker: "S4", sourceId: publication.id, sourceName: publication.name, claimIndex: 0, claim: "Measured latency",
        quote: "measured median 178ms, p95 240ms", support: 0.9, qualifiesForAnswer: true, qualifiesForReward: true }],
      claimCoverage: [{ claimIndex: 0, claim: "Measured latency", coverage: 0.9, coveredBy: ["S4"] }],
      answer: "Median settlement latency is 178ms and p95 is 240ms [S4].", totalSpent: 0.015, totalToCreators: 0.015,
      trace: [], createdAt: "2026-10-02T00:00:00Z", paymentMode: "real", paymentAttempts: 1, settledPayments: 1, pendingPayments: 0 };
    const payment: PaymentRecord = { kind: "citation", queryId: run.id, sourceId: publication.id, sourceName: publication.name,
      payer: "0x2222222222222222222222222222222222222222", payee: publication.walletAddress, amountUsdc: 0.015,
      network: "eip155:5042002", settled: true, settlementStatus: "settled", txHash: "retained-circle-transfer", createdAt: run.createdAt, ...identity };
    await adapter.saveQueryRun(run); await adapter.recordPayment(payment);
    const projected = (await adapter.getQueryRun(run.id))!;
    expect(projected.answer).toContain("Illustrative demo content"); expect(projected.answer).toContain(run.answer);
    expect(projected.evidence?.[0]).toMatchObject({ support: 0, qualifiesForAnswer: false, qualifiesForReward: false, evidenceProvenance: "synthetic-demo" });
    expect(projected.claimCoverage?.[0]).toMatchObject({ coverage: 0, coveredBy: [] });
    expect((await adapter.listRecentQueries(10))[0].answer).toContain("Illustrative demo content");
    const receipt = buildResearchReceipt(projected, [payment]);
    expect(verifyResearchReceipt(receipt).valid).toBe(true);
    expect(receipt.payload.settlement.creatorPayments[0]).toMatchObject({ status: "settled", amountUsdc: 0.015 });
    expect(receipt.payload.dispatch.answer).toContain("Illustrative demo content");
    expect(receipt.payload.citations[0].evidenceProvenance).toBe("synthetic-demo");
    expect(buildAnswerContent(projected)).toContain("not factual research evidence");
    const exported = exportsFromCheckedReceipt(receipt);
    expect(exported.bibtex.content).toContain("ILLUSTRATIVE SYNTHETIC DEMO");
    expect(exported.evidenceCsv).toContain("Synthetic demo; illustrative only");
    expect((await adapter.listPaymentsByQuery(run.id))[0]).toMatchObject({ settled: true, settlementStatus: "settled", txHash: payment.txHash });
  });

  it("uses the same reviewed plaintext/hash predicates for migration on legacy schema", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("create table sources(id text,evidence_provenance text); create table source_items(id text,source_id text,title text,summary text,link text,content text,body_hash text,evidence_provenance text);");
      db.prepare("insert into sources values (?,null)").run("arbitrary");
      db.prepare("insert into source_items values (?,?,?,?,?,?,?,null)").run("random", "arbitrary", seed.title, seed.summary, seed.link, seed.content, null);
      backfillSqliteSeedProvenance(db);
      expect(db.prepare("select evidence_provenance from sources").get()?.evidence_provenance).toBe("synthetic-demo");
    } finally { db.close(); }
  });
});
