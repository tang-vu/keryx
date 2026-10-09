import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { SqliteAdapter } from "./sqlite-adapter";
import { createSqliteStorage } from "./storage-identity-provision";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { createEnrolledSqliteAdapter, createReadonlyEnrolledSqliteAdapter } from "./enrolled-sqlite-adapter";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { seedSyntheticA2aOriginal } from "./a2a-original-fixture";
import { syntheticFailedOriginal, syntheticFulfilledRun } from "./a2a-fulfillment-fixture";
import { fulfillmentObjectSha256 as objectHash, fulfillmentSha256 as hash,
  type A2aFulfillmentClaim } from "../a2a/failed-original-fulfillment-protocol";
import { readBoundSupplementaryContext, fulfillmentEvidenceCapability,
  supplementaryInputSchema, type FulfillmentEvidenceCapability } from "../a2a/fulfillment-supplement-evidence";
import { renderFulfilledOriginalAnswer } from "../a2a/original-fulfillment-answer";
import type { GatheredContent } from "../llm/reasoning-engine";
import * as queryRunRecord from "./query-run-record";
import { buildCitationExport } from "../research-citation-export";
import { evidenceMatrixCsv } from "../research/evidence-matrix";
import * as a2aResult from "../a2a/result";

// All authority, bodies and settlement rows in this file are disposable synthetic fixtures.
// No supplier, payment transport, production database or original release packet is used.
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
});
const protectedFolder = () => {
  // The real evidence reader rejects writable ancestors on Unix; /tmp is unsuitable.
  const folder = mkdtempSync(join(process.platform === "win32" ? tmpdir() : homedir(), "keryx-supplement-db-"));
  cleanup.push(() => rmSync(folder, { recursive: true, force: true })); return folder;
};
async function setup(enrolled = false, index = 1) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-06T10:00:05.000Z");
  const folder = protectedFolder(), file = join(folder, "synthetic.sqlite");
  let writer: SqliteAdapter, reader: SqliteAdapter;
  if (enrolled) {
    const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
      network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(),
      storageId: randomUUID(), enrollmentId: randomUUID(), enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
    await createSqliteStorage(file, identity);
    const manifest = join(folder, "storage-manifest.json");
    writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
      backend: { kind: "sqlite", databasePath: file } }), { mode: 0o600 });
    vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file);
    vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", "99".repeat(32));
    writer = await createEnrolledSqliteAdapter(); cleanup.push(() => writer.close());
    reader = await createReadonlyEnrolledSqliteAdapter(); cleanup.push(() => reader.close());
  } else {
    writer = new SqliteAdapter(file); cleanup.push(() => writer.close()); await writer.init();
    reader = new SqliteAdapter(file, { readOnly: true }); cleanup.push(() => reader.close());
  }
  const fixture = enrolled ? syntheticFailedOriginal(index, ARC_MAINNET_PROFILE) : syntheticFailedOriginal(index);
  fixture.authority.input.selectedDocumentIds = ["document-one", "document-two"];
  fixture.authority.input.targets = Array.from({ length: 5 }, (_, index) => `Synthetic required target ${index}.`);
  await seedSyntheticA2aOriginal(writer, fixture);
  const claim = await writer.claimA2aFailedOriginalFulfillment(fixture.input); expect(claim).not.toBeNull();
  const native = new DatabaseSync(file); cleanup.push(() => native.close());
  return { writer, reader, native, fixture, claim: claim! };
}
function supplementalResult(claim: A2aFulfillmentClaim) {
  const folder = protectedFolder(), quotes = Array.from({ length: 5 }, (_, index) => `Synthetic verified quotation for target ${index}.`);
  const gathered: GatheredContent[] = claim.authority.input.selectedDocumentIds.map((id, index) => {
    const url = `https://developers.circle.com/synthetic/original-${index + 1}`, text = quotes[index];
    return { sourceId: `public:fulfillment:${id}`, sourceName: `Synthetic original reference ${index + 1}`,
      marker: `S${index + 1}`, text, sourceKind: "public-reference", creatorRewardEligible: false,
      itemId: id, itemTitle: `Synthetic original reference ${index + 1}`, itemUrl: url, contentVersion: hash(text),
      requestedSource: { urls: [url], readScope: "bounded-whole-document" },
      webProvenance: { retrievedAt: "2026-10-06T09:00:00.000Z", publisherGroup: "developers.circle.com",
        normalizedBodyHash: hash(text), extraction: "text", truncated: false } };
  });
  const packet = { input: claim.authority.input, gathered,
    packetSha256: objectHash({ input: claim.authority.input, gathered }), inputSemanticSha256: objectHash(claim.authority.input) };
  const section = quotes.slice(2).join("\n"), prefix = "Synthetic primary-reference header.\n", raw = `${prefix}${section}\nSynthetic footer.`;
  const rawFile = join(folder, "primary-raw.txt"), bodyFile = join(folder, "primary-section.txt");
  writeFileSync(rawFile, raw, { mode: 0o600 }); writeFileSync(bodyFile, section, { mode: 0o600 });
  const binding = { nativeClaimSha256: objectHash(claim), ownerAuthorizationSha256: "b0".repeat(32),
    executorCommit: claim.authority.executorCommit };
  const manifest = supplementaryInputSchema.parse({ format: "keryx-original-supplementary-evidence-v1", ...binding,
    originalAuthoritySha256: objectHash(claim.authority), originalPacketSha256: packet.packetSha256,
    originalInputSemanticSha256: packet.inputSemanticSha256, questionSha256: claim.authority.input.questionSha256,
    sources: [{ id: "synthetic-arc-checks", title: "Synthetic free official acceptance reference",
      requestedUrl: "https://docs.arc.io/synthetic/acceptance", finalUrl: "https://docs.arc.io/synthetic/acceptance",
      retrievedAt: "2026-10-06T09:30:00.000Z", status: 200, rawFile: "primary-raw.txt", rawSha256: hash(raw), rawBytes: Buffer.byteLength(raw),
      bodyFile: "primary-section.txt", bodySha256: hash(section), bodyBytes: Buffer.byteLength(section),
      spans: [{ start: prefix.length, end: prefix.length + section.length }] }],
    payments: 0, creatorRewards: 0, provenance: "reviewed-free-official-verbatim-sections" });
  const inputFile = join(folder, "supplement.json"), inputBytes = `${canonicalJson(manifest)}\n`;
  writeFileSync(inputFile, inputBytes, { mode: 0o600 });
  const context = readBoundSupplementaryContext(inputFile, hash(inputBytes), { authority: claim.authority, packet }, binding);
  const result = syntheticFulfilledRun(claim), run = result.run;
  const statements = quotes.map((quote, claimIndex) => ({ claimIndex, quote,
    marker: claimIndex < 2 ? `S${claimIndex + 1}` : "S3", text: `Synthetic independently reviewed target ${claimIndex}.` }));
  run.citations = context.gathered.map(source => ({ marker: source.marker, sourceId: source.sourceId, sourceName: source.sourceName,
    sourceKind: "public-reference", itemId: source.itemId, itemTitle: source.itemTitle, itemUrl: source.itemUrl,
    contentVersion: source.contentVersion, requestedSource: source.requestedSource, webProvenance: source.webProvenance,
    weight: 0, reward: 0, rationale: "Synthetic zero-reward reviewed fixture." }));
  run.evidence = statements.map(statement => {
    const source = context.gathered.find(source => source.marker === statement.marker)!;
    return { ...statement, claim: run.subClaims[statement.claimIndex], sourceId: source.sourceId, sourceName: source.sourceName,
      sourceKind: "public-reference", itemId: source.itemId, itemTitle: source.itemTitle, itemUrl: source.itemUrl,
      contentVersion: source.contentVersion, requestedSource: source.requestedSource, webProvenance: source.webProvenance,
      support: 0.9, qualifiesForAnswer: true, qualifiesForReward: false };
  });
  run.claimCoverage = statements.map(statement => ({ claimIndex: statement.claimIndex, claim: run.subClaims[statement.claimIndex],
    coverage: 0.9, coveredBy: [statement.marker] }));
  run.originalFulfillment = { ...run.originalFulfillment!, format: "keryx-a2a-original-fulfillment-result-v2",
    supplementaryInputSha256: context.authoritySha256, contextSha256: context.contextSha256,
    statements, statementReviews: statements.map(statement => ({ ...statement, support: 0.9 })) };
  run.answer = renderFulfilledOriginalAnswer({ question: run.question, answer: "", statements, evidenceGaps: [],
    ledger: { evidence: run.evidence, claimCoverage: run.claimCoverage, acceptedMarkers: new Set(run.citations.map(citation => citation.marker)),
      droppedEvidence: 0, droppedCitations: [] } });
  result.runSha256 = objectHash(run);
  return { result, context, rawFile, bodyFile, section,
    capability: fulfillmentEvidenceCapability(context, claim, run) };
}

describe("supplemental same-original native completion", () => {
  it("reads the unchanged pre-CSL v2 receipt through enrolled readonly storage only with genuine evidence capability", async () => {
    const f = await setup(true), value = supplementalResult(f.claim), run = value.result.run;
    const financialBefore = f.native.prepare("SELECT * FROM payment_events ORDER BY id").all();
    const modern = a2aResult.a2aResponseFromRun(run, a2aResult.quoteFromA2aOrder(f.fixture.order),
      { acceptedAt: f.fixture.order.createdAt, startedAt: f.fixture.order.startedAt });
    expect(modern.researchExports).toHaveProperty("cslJson");
    // Complete known historical presentation from unchanged export primitives.
    const legacy = { ...modern, researchExports: { bibtex: buildCitationExport(run.citations, "bibtex"),
      ris: buildCitationExport(run.citations, "ris"), evidenceCsv: evidenceMatrixCsv(run) } };
    expect(legacy.researchExports.bibtex.count).toBe(3);
    expect(legacy.researchExports.ris.content).toContain("Content version:");
    // Emulate only the pre-CSL writer presentation through the real enrolled
    // transaction, without bypassing its storage fence or any native validator.
    // The historical shape intentionally predates today's inferred CSL type.
    const presentation = vi.spyOn(a2aResult, "a2aResponseFromRun").mockReturnValueOnce(legacy as typeof modern);
    try { expect(await f.writer.completeA2aFailedOriginalFulfillment(value.result, value.capability)).toBe(true); }
    finally { presentation.mockRestore(); }
    const rows = () => canonicalJson(["a2a_orders", "query_runs", "a2a_failed_original_fulfillments",
      "a2a_fulfillment_completions", "payment_events"].map(table => f.native.prepare(`SELECT * FROM ${table}`).all()));
    const before = rows();
    vi.setSystemTime("2026-10-09T12:00:00.000Z");
    expect(await f.reader.hasA2aFailedOriginalFulfillment(f.claim.authority, value.capability)).toBe(true);
    expect(await f.reader.hasA2aFailedOriginalFulfillment(f.claim.authority)).toBe(false);
    expect(await f.reader.hasA2aFailedOriginalFulfillment(f.claim.authority, Object.freeze({}) as FulfillmentEvidenceCapability)).toBe(false);
    expect(rows()).toBe(before);
    expect((await f.reader.getA2aOrder(run.id))!.response).toEqual(legacy);
    expect(await f.writer.completeA2aFailedOriginalFulfillment(value.result, value.capability)).toBe(true);
    expect(rows()).toBe(before);
    expect(f.native.prepare("SELECT * FROM payment_events ORDER BY id").all()).toEqual(financialBefore);
    expect(await f.reader.getQueryRun(run.id)).toEqual(run);
  }, 30000);

  it.each([false, true])("commits once with enrolled=%s, retains financial history and proves delivery after expiry", async enrolled => {
    const f = await setup(enrolled), value = supplementalResult(f.claim);
    const financialBefore = f.native.prepare("SELECT * FROM payment_events ORDER BY id").all();
    expect(await f.writer.completeA2aFailedOriginalFulfillment(value.result, value.capability)).toBe(true);
    expect(await f.writer.completeA2aFailedOriginalFulfillment(value.result, value.capability)).toBe(true);
    expect(await f.reader.hasA2aFailedOriginalFulfillment(f.claim.authority, value.capability)).toBe(true);
    expect(await f.reader.hasA2aFailedOriginalFulfillment(f.claim.authority)).toBe(false);
    expect(await f.reader.hasA2aFailedOriginalFulfillment(f.claim.authority, Object.freeze({}) as FulfillmentEvidenceCapability)).toBe(false);
    expect(await f.writer.getQueryRun(f.claim.authority.original.queryId)).toEqual(value.result.run);
    expect((await f.reader.getA2aFailedOriginalFulfillment(f.claim.authority.original.id))?.claim).toEqual(f.claim);
    expect(f.native.prepare("SELECT count(*) AS n FROM a2a_fulfillment_completions").get()?.n).toBe(1);
    expect(f.native.prepare("SELECT * FROM payment_events ORDER BY id").all()).toEqual(financialBefore);
    vi.setSystemTime("2026-10-09T12:00:00.000Z");
    const historicalCapability = fulfillmentEvidenceCapability(value.context, f.claim, value.result.run);
    expect(await f.reader.hasA2aFailedOriginalFulfillment(f.claim.authority, historicalCapability)).toBe(true);
    await expect(f.writer.claimA2aFailedOriginalFulfillment({ ...f.fixture.input, claimId: "bb".repeat(32),
      claimedAt: new Date().toISOString() })).rejects.toThrow(/window/);
  }, 30000);

  it.each(["missing", "counterfeit", "copied"])("refuses %s capability before result or original mutation", async kind => {
    const f = await setup(), value = supplementalResult(f.claim);
    const capability = kind === "missing" ? undefined : kind === "copied" ? structuredClone(value.capability) as FulfillmentEvidenceCapability : Object.freeze({}) as FulfillmentEvidenceCapability;
    await expect(f.writer.completeA2aFailedOriginalFulfillment(value.result, capability)).rejects.toThrow(/refused/);
    expect(await f.writer.getQueryRun(value.result.run.id)).toBeNull();
    expect(await f.writer.getA2aOrder(value.result.run.id)).toEqual(f.fixture.order);
    expect((await f.writer.getA2aFailedOriginalFulfillment(value.result.run.id))?.completion).toBeNull();
  });

  it("revalidates protected raw evidence at completion and historical read, despite a previously minted capability", async () => {
    const f = await setup(), value = supplementalResult(f.claim);
    writeFileSync(value.bodyFile, `${value.section}\nTampered synthetic body.`);
    await expect(f.writer.completeA2aFailedOriginalFulfillment(value.result, value.capability)).rejects.toThrow(/refused/);
    expect(await f.writer.getA2aOrder(value.result.run.id)).toEqual(f.fixture.order);
    expect(await f.writer.getQueryRun(value.result.run.id)).toBeNull();
    writeFileSync(value.bodyFile, value.section);
    expect(await f.writer.completeA2aFailedOriginalFulfillment(value.result, value.capability)).toBe(true);
    writeFileSync(value.rawFile, "Tampered synthetic primary raw response.");
    expect(await f.reader.hasA2aFailedOriginalFulfillment(f.claim.authority, value.capability)).toBe(false);
  });

  it("rolls back the inserted v2 run and original transition if final native completion fails", async () => {
    const f = await setup(), value = supplementalResult(f.claim);
    f.native.exec("CREATE TRIGGER synthetic_supplement_abort BEFORE INSERT ON a2a_fulfillment_completions BEGIN SELECT RAISE(ABORT,'synthetic supplement failure'); END");
    await expect(f.writer.completeA2aFailedOriginalFulfillment(value.result, value.capability)).rejects.toThrow(/synthetic supplement failure/);
    expect(await f.writer.getQueryRun(value.result.run.id)).toBeNull();
    expect(await f.writer.getA2aOrder(value.result.run.id)).toEqual(f.fixture.order);
    expect((await f.writer.getA2aFailedOriginalFulfillment(value.result.run.id))?.completion).toBeNull();
  });

  it("rolls back every completion write if protected evidence drifts before transactional readback", async () => {
    const f = await setup(), value = supplementalResult(f.claim), writeRun = queryRunRecord.writeSqliteQueryRun;
    vi.spyOn(queryRunRecord, "writeSqliteQueryRun").mockImplementation((...args) => {
      writeRun(...args); writeFileSync(value.bodyFile, "Synthetic evidence drift during result insertion.");
    });
    await expect(f.writer.completeA2aFailedOriginalFulfillment(value.result, value.capability)).rejects.toThrow(/readback refused/);
    expect(await f.writer.getQueryRun(value.result.run.id)).toBeNull();
    expect(await f.writer.getA2aOrder(value.result.run.id)).toEqual(f.fixture.order);
    expect((await f.writer.getA2aFailedOriginalFulfillment(value.result.run.id))?.completion).toBeNull();
  });

  it("refuses a genuine evidence capability minted for another permanently claimed original", async () => {
    const f = await setup(), other = await setup(false, 2);
    const value = supplementalResult(f.claim), foreign = supplementalResult(other.claim);
    await expect(f.writer.completeA2aFailedOriginalFulfillment(value.result, foreign.capability)).rejects.toThrow(/refused/);
    expect(await f.writer.getQueryRun(value.result.run.id)).toBeNull();
    expect(await f.writer.getA2aOrder(value.result.run.id)).toEqual(f.fixture.order);
    expect((await other.reader.getA2aFailedOriginalFulfillment(other.fixture.order.id))?.completion).toBeNull();
  });

  it("rejects a low-support independent statement review even with a genuine run-bound capability", async () => {
    const f = await setup(), value = supplementalResult(f.claim);
    const metadata = value.result.run.originalFulfillment!;
    if (metadata.format !== "keryx-a2a-original-fulfillment-result-v2") throw new Error("Synthetic fixture format mismatch");
    metadata.statementReviews[4].support = 0.69;
    value.result.runSha256 = objectHash(value.result.run);
    const capability = fulfillmentEvidenceCapability(value.context, f.claim, value.result.run);
    await expect(f.writer.completeA2aFailedOriginalFulfillment(value.result, capability)).rejects.toThrow(/refused/);
    expect(await f.writer.getQueryRun(value.result.run.id)).toBeNull();
    expect(await f.writer.getA2aOrder(value.result.run.id)).toEqual(f.fixture.order);
  });
});
