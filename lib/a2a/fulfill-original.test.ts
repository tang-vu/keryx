import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fulfillCanaryOriginal, preflightOriginalFulfillment } from "./fulfill-original";
import { completePreparedFulfillment, fulfillmentDirectory, fulfillmentProviderLedger, verifyPreparedFulfillment,
  readFrozenFulfillmentPacket } from "../business-operator/fulfillment-policy";
import { canaryExecutionPaused, configuredBusinessCanary, retainedBusinessCanaryClosure } from "../business-operator/canary-policy";
import { fulfillmentFixture, fixtureNow, fixtureCommit, fixtureFlush, cleanFulfillmentFixtures,
  withFulfillmentSupplierWindow } from "../business-operator/fulfillment-test-fixture";
import { fulfillmentSha256, fulfillmentObjectSha256 } from "./failed-original-fulfillment-protocol";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import { a2aResponseFromRun, quoteFromA2aOrder } from "./result";

const git = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), execFileSync: git }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(fixtureNow); git.mockImplementation((_command, args) => args?.[0] === "status" ? "" : `${fixtureCommit}\n`); });
afterEach(() => { cleanFulfillmentFixtures(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
function provider(options: { failureAt?: number; omitStatements?: boolean; unsupportedTarget?: number; missingCore?: boolean; duplicateReview?: boolean; fiveTargets?: boolean } = {}) {
  let call = 0;
  const mock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const user = JSON.parse(body.messages[1].content); const index = ++call;
    if (index === options.failureAt) return new Response("synthetic provider body must be redacted", { status: 503 });
    let result: object;
    if (index === 1) result = { rationale: "Synthetic fixture assessment.", perClaim: user.subClaims.map((claim: string, target: number) => ({
      claim, supportedAnswer: "Synthetic supported procedure.", missingRequestedParts: options.fiveTargets && target === 4
        ? ["Arc network constants and deployed contract addresses are not established by the two selected reference bodies."] : [],
      coverage: target === options.unsupportedTarget ? 0 : options.fiveTargets && target === 4 ? 0.6 : 0.9,
      coveredBy: [`S${options.fiveTargets ? [1, 1, 2, 1, 2][target] : target + 1}`] })) };
    else if (index === 2) {
      const evidence = user.researchTargets.flatMap((target: { claimIndex: number }) => {
        if (target.claimIndex === options.unsupportedTarget || options.missingCore && target.claimIndex === 0) return [];
        const keywords = ["contract signature flow", "EOA authorization flow", "Nanopayments uses", "TEE validation", "check the nonce"];
        const quote = user.quoteOptions.find((item: { marker: string; text: string }) => options.fiveTargets
          ? item.text.includes(keywords[target.claimIndex]) : item.marker === `S${target.claimIndex + 1}`);
        return [{ claimIndex: target.claimIndex, marker: quote.marker, quoteId: quote.quoteId, support: 0.9,
          ...(!options.omitStatements ? { statement: options.fiveTargets ? [
            "Gateway validates ERC-1271 contract signatures before a transfer.",
            "The EOA flow validates the EOA signature before batching the transfer.",
            "Nanopayments supports EOA signatures and excludes ERC-1271 signatures.",
            "The contract-signature flow requires its TEE validation component.",
            "Before sending a Nanopayments transfer, match the nonce and signed amount to the exact payment requirement.",
          ][target.claimIndex] : target.claimIndex === 0 ? "The contract checks the signature before it permits a transfer." :
            "The service records a confirmed transfer before it delivers the response." } : {}) }];
      });
      result = { answer: "Synthetic fixture explanation. [S1] [S2]", citedMarkers: ["S1", "S2"], evidence, conflicts: [] };
    } else {
      const reviews = user.evidence.map((item: { index: number }) => ({ index: item.index, supportedFact: "Synthetic quoted mechanism.", support: 0.9, statementSupport: 0.9 }));
      result = { reviews: options.duplicateReview ? [...reviews, reviews[0]] : reviews };
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 100 } }), { status: 200 });
  });
  vi.stubGlobal("fetch", mock); return mock;
}

describe("same-paid-original finite cited-statement fulfillment", () => {
  it("verifies and metadata-completes the same v2 prepared result after expiry without another supplier request", async () => {
    const window = { approvalReceivedAt: fixtureNow, expiresAt: "2026-10-06T13:30:00.000Z", maximumDurationMs: 5_400_000 as const };
    const value = withFulfillmentSupplierWindow(await fulfillmentFixture(), window, fixtureNow), fetch = provider();
    await fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush);
    const before = await verifyPreparedFulfillment(value.db); vi.setSystemTime("2026-10-06T13:30:01.000Z");
    expect(await verifyPreparedFulfillment(value.db)).toEqual(before);
    expect(await completePreparedFulfillment(value.db, before.preparedResultSha256, fixtureFlush)).toMatchObject({ deliveryCompleted: true });
    expect(fetch).toHaveBeenCalledTimes(3); expect(fulfillmentProviderLedger().combinedReservedMicroUsd).toBe(98640);
    await expect(fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest,
      "synthetic-fixture-key", fixtureFlush)).rejects.toThrow("expired");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("renders all five supported themes and concrete checks while keeping the missing Arc profile explicit", async () => {
    const value = await fulfillmentFixture(true), fetch = provider({ fiveTargets: true });
    await fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush);
    const { completion } = await verifyPreparedFulfillment(value.db), run = completion.run;
    expect(run.subClaims).toEqual(value.packet.input.targets);
    expect(run.originalFulfillment!.statements.map(item => item.claimIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(run.claimCoverage![4]).toMatchObject({ claimIndex: 4, coverage: 0.6, coveredBy: ["S2"] });
    for (let index = 1; index <= 5; index++) expect(run.answer).toContain(`### Research target ${index}`);
    expect(run.answer).toContain("Nanopayments supports EOA signatures and excludes ERC-1271 signatures.");
    expect(run.answer).toContain("match the nonce and signed amount to the exact payment requirement.");
    expect(run.answer).toContain("Requested evidence gaps from the model assessment");
    expect(run.answer).toContain("Arc network constants and deployed contract addresses are not established");
    expect(run.answer).toContain("not independently verified");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(value.db.completeA2aFailedOriginalFulfillment).not.toHaveBeenCalled();
    expect(canaryExecutionPaused()).toBe(true);
  });
  it("preserves the original execution interval in the native completion response without resetting elapsed service time", async () => {
    const value = await fulfillmentFixture(); provider();
    vi.setSystemTime("2026-10-06T12:20:00.000Z");
    await fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush);
    const proof = await verifyPreparedFulfillment(value.db);
    const response = a2aResponseFromRun(proof.completion.run, quoteFromA2aOrder(value.order), {
      acceptedAt: value.order.createdAt, startedAt: value.order.startedAt });
    expect(response.serviceReceipt).toMatchObject({ acceptedAt: value.order.createdAt, startedAt: value.order.startedAt,
      executionDurationMs: 1201000, totalDurationMs: 1202000, targetMet: false });
    expect(proof.completion.run.durationMs).toBe(Date.parse(proof.completion.run.createdAt) - Date.parse(value.order.startedAt!));
    expect(proof.completion.run.durationMs).toBeGreaterThan(20 * 60 * 1000);
  });

  it("binds the reviewed prepared digest to the same parsed bytes across a between-read replacement", async () => {
    const value = await fulfillmentFixture(); provider();
    await fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush);
    const file = path.join(fulfillmentDirectory(), "prepared-result.json"), originalBytes = fs.readFileSync(file);
    const replaced = JSON.parse(originalBytes.toString("utf8"));
    replaced.run.trace.push({ phase: "synthesize", message: "Different privately reviewed artifact", ts: Date.now() });
    replaced.runSha256 = fulfillmentObjectSha256(replaced.run);
    const replacementBytes = Buffer.from(JSON.stringify(replaced)), expectedReplacementDigest = fulfillmentSha256(replacementBytes);
    const originalStat = fs.lstatSync(file), originalClose = fs.closeSync; let changed = false;
    const close = vi.spyOn(fs, "closeSync").mockImplementation(fd => {
      const stat = fs.fstatSync(fd), selected = stat.ino === originalStat.ino && stat.dev === originalStat.dev;
      originalClose(fd);
      // Mutate after the first fully verified read has completed, before a hypothetical
      // independent digest reread. The approved B digest must never commit parsed run A.
      if (selected && !changed) { changed = true; fs.writeFileSync(file, replacementBytes); }
    });
    try { await expect(completePreparedFulfillment(value.db, expectedReplacementDigest, fixtureFlush)).rejects.toThrow("digest changed"); }
    finally { close.mockRestore(); }
    expect(changed).toBe(true); expect(value.db.completeA2aFailedOriginalFulfillment).not.toHaveBeenCalled();
    expect(canaryExecutionPaused()).toBe(true);
  });
  it("preflights exact full targets and prompt bytes without a claim, credential or provider", async () => {
    const value = await fulfillmentFixture(), fetch = provider();
    const proof = await preflightOriginalFulfillment(value.binding);
    expect(proof).toMatchObject({ targets: 2, selectedSources: 2, providerRequests: 0, payments: 0 });
    expect(proof.prompts).toHaveLength(2); expect(proof.prompts.every(item => item.promptUtf8Bytes <= 32000)).toBe(true);
    expect(fetch).not.toHaveBeenCalled(); expect(value.db.claimA2aFailedOriginalFulfillment).not.toHaveBeenCalled();
    expect(fs.readdirSync(fulfillmentDirectory())).toEqual([]);
  });
  it("stages a real reviewed summary, keeps admission held, then completes only the exact reviewed digest", async () => {
    const value = await fulfillmentFixture(), fetch = provider();
    const oldBytes = fs.readdirSync(value.oldDirectory).map(name => [name, fs.readFileSync(path.join(value.oldDirectory, name), "hex")]);
    const result = await fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush);
    expect(result).toMatchObject({ prepared: true, newModelCalls: 3, combinedReservedMicroUsd: 98640, payments: 0,
      searches: 0, originalProviderBilling: "unknown", paidDeliveryObligation: "unresolved" });
    expect(value.db.completeA2aFailedOriginalFulfillment).not.toHaveBeenCalled(); expect(canaryExecutionPaused()).toBe(true);
    const proof = await verifyPreparedFulfillment(value.db);
    expect(proof.completion.run.answer).toContain("Model-written summary");
    expect(proof.completion.run.answer).not.toContain("Synthetic fixture explanation");
    expect(proof.completion.run.subClaims).toEqual(value.binding.packet.input.targets);
    expect(proof.completion.run.originalFulfillment!.statements).toHaveLength(2);
    expect(proof.completion.run.evidence!.every(item => item.qualifiesForAnswer && !item.qualifiesForReward)).toBe(true);
    expect(proof.completion.run.llmCalls).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      const wire = JSON.parse(String(init?.body)); expect(wire.model).toBe("deepseek-v4-flash");
      expect(init?.redirect).toBe("error"); expect(wire.thinking).toEqual({ type: "disabled" });
    }
    await expect(completePreparedFulfillment(value.db, "a".repeat(64), fixtureFlush)).rejects.toThrow("digest changed");
    expect(value.db.completeA2aFailedOriginalFulfillment).not.toHaveBeenCalled();
    const marker = await completePreparedFulfillment(value.db, proof.preparedResultSha256, fixtureFlush);
    expect(marker).toMatchObject({ outcome: "verified-fulfilled-original", paidDeliveryObligation: "resolved", refunded: false, noNewInboundPayment: true });
    expect(configuredBusinessCanary()).toBeNull(); expect(canaryExecutionPaused()).toBe(false);
    expect(retainedBusinessCanaryClosure()).toMatchObject({ outcome: "verified-fulfilled-original", deliveryCompleted: true });
    expect(fs.readdirSync(value.oldDirectory).map(name => [name, fs.readFileSync(path.join(value.oldDirectory, name), "hex")])).toEqual(oldBytes);
    await expect(fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush)).rejects.toThrow("already retained");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("keeps an unsupported optional target visible as a gap rather than inventing an answer", async () => {
    const value = await fulfillmentFixture(); provider({ unsupportedTarget: 1 });
    await fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush);
    const proof = await verifyPreparedFulfillment(value.db);
    expect(proof.completion.run.subClaims).toEqual(value.binding.packet.input.targets);
    expect(proof.completion.run.claimCoverage![1]).toMatchObject({ coverage: 0, coveredBy: [] });
    expect(proof.completion.run.answer).toContain("Research target 2"); expect(proof.completion.run.answer).toContain("Evidence gap");
    expect(proof.completion.run.originalFulfillment!.statements).toHaveLength(1);
  });
  it("refuses missing required core support through the normal grounding contract", async () => {
    const value = await fulfillmentFixture(), fetch = provider({ missingCore: true });
    await expect(fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush)).rejects.toThrow("complete reviewed");
    expect(fetch).toHaveBeenCalledTimes(3); expect(fs.existsSync(path.join(fulfillmentDirectory(), "prepared-result.json"))).toBe(false);
    expect(canaryExecutionPaused()).toBe(true); expect(value.db.completeA2aFailedOriginalFulfillment).not.toHaveBeenCalled();
  });
  it.each([1, 3])("does not retry/fallback a provider failure at call %s", async failureAt => {
    const value = await fulfillmentFixture(), fetch = provider({ failureAt });
    await expect(fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(failureAt); expect(fulfillmentProviderLedger().newModelCalls).toBe(failureAt);
    expect(fs.existsSync(path.join(fulfillmentDirectory(), "prepared-result.json"))).toBe(false); expect(canaryExecutionPaused()).toBe(true);
    await expect(fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush)).rejects.toThrow("already retained");
    expect(fetch).toHaveBeenCalledTimes(failureAt);
  });
  it.each([{ omitStatements: true }, { duplicateReview: true }])("refuses excerpt-only or ambiguous review output %#", async options => {
    const value = await fulfillmentFixture(), fetch = provider(options);
    await expect(fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3); expect(canaryExecutionPaused()).toBe(true);
    expect(fs.existsSync(path.join(fulfillmentDirectory(), "prepared-result.json"))).toBe(false);
  });
  it("recovers a lost native completion acknowledgement with metadata only, including after supplier expiry", async () => {
    const value = await fulfillmentFixture(), fetch = provider();
    await fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush);
    const proof = await verifyPreparedFulfillment(value.db), original = vi.mocked(value.db.completeA2aFailedOriginalFulfillment!).getMockImplementation()!;
    vi.mocked(value.db.completeA2aFailedOriginalFulfillment!).mockImplementationOnce(async input => { await original(input); throw Error("synthetic acknowledgement lost"); });
    await expect(completePreparedFulfillment(value.db, proof.preparedResultSha256, fixtureFlush)).rejects.toThrow("acknowledgement lost");
    expect(canaryExecutionPaused()).toBe(true); expect(fs.existsSync(path.join(fulfillmentDirectory(), "delivered.json"))).toBe(false);
    vi.setSystemTime("2026-10-08T00:00:00.000Z");
    expect((await completePreparedFulfillment(value.db, proof.preparedResultSha256, fixtureFlush)).deliveryCompleted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3); expect(fulfillmentProviderLedger().newModelCalls).toBe(3);
  });
  it("releases no admission when native delivered proof is false and fails closed on later ledger tamper", async () => {
    const value = await fulfillmentFixture(); provider();
    await fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush);
    const proof = await verifyPreparedFulfillment(value.db); vi.mocked(value.db.hasA2aFailedOriginalFulfillment!).mockResolvedValueOnce(false);
    await expect(completePreparedFulfillment(value.db, proof.preparedResultSha256, fixtureFlush)).rejects.toThrow("acknowledgement uncertain");
    expect(canaryExecutionPaused()).toBe(true);
    await completePreparedFulfillment(value.db, proof.preparedResultSha256, fixtureFlush);
    fs.appendFileSync(path.join(fulfillmentDirectory(), "model-02.json"), " ");
    expect(canaryExecutionPaused()).toBe(true);
    await expect(verifyPreparedFulfillment(value.db)).rejects.toThrow("ledger changed");
  });
  it("refuses an oversized full frozen scope before any model call or native claim", async () => {
    const value = await fulfillmentFixture(), fetch = provider();
    const raw = JSON.parse(fs.readFileSync(value.authorization.inputFile, "utf8")); raw.constraints = Array.from({ length: 16 }, (_, index) => `${index}: ${"é".repeat(900)}`);
    fs.writeFileSync(value.authorization.inputFile, JSON.stringify(raw));
    const inputSha256 = fulfillmentSha256(fs.readFileSync(value.authorization.inputFile));
    const packet = readFrozenFulfillmentPacket(value.authorization.inputFile, inputSha256,
      value.authorization.sourceManifestFile, value.authorization.sourceManifestSha256);
    const authorization = { ...value.authorization, inputSha256, packetSha256: packet.packetSha256,
      inputSemanticSha256: packet.inputSemanticSha256 };
    fs.writeFileSync(value.authorizationFile, JSON.stringify(authorization)); const digest = fulfillmentSha256(fs.readFileSync(value.authorizationFile));
    await expect(fulfillCanaryOriginal(value.db, value.authorizationFile, digest, "synthetic-fixture-key", fixtureFlush)).rejects.toThrow("supplier bounds");
    expect(fetch).not.toHaveBeenCalled(); expect(value.db.claimA2aFailedOriginalFulfillment).not.toHaveBeenCalled();
  });
  it("metadata recovery rechecks mandatory target support rather than trusting a replaced prepared packet", async () => {
    const value = await fulfillmentFixture(), fetch = provider();
    await fulfillCanaryOriginal(value.db, value.authorizationFile, value.authorizationDigest, "synthetic-fixture-key", fixtureFlush);
    const file = path.join(fulfillmentDirectory(), "prepared-result.json"), prepared = JSON.parse(fs.readFileSync(file, "utf8"));
    const run = prepared.run;
    run.evidence = run.evidence.filter((item: { claimIndex: number }) => item.claimIndex === 1);
    run.citations = run.citations.filter((item: { marker: string }) => item.marker === "S2");
    run.claimCoverage[0] = { claimIndex: 0, claim: run.subClaims[0], coverage: 0, coveredBy: [] };
    run.originalFulfillment.statements = run.originalFulfillment.statements.filter((item: { claimIndex: number }) => item.claimIndex === 1);
    run.answer = finalizeGroundedAnswer({ question: run.question, answer: "", statements: run.originalFulfillment.statements,
      ledger: { evidence: run.evidence, claimCoverage: run.claimCoverage, acceptedMarkers: new Set(["S2"]), droppedEvidence: 0, droppedCitations: [] } });
    prepared.runSha256 = fulfillmentObjectSha256(run);
    fs.writeFileSync(file, JSON.stringify(prepared));
    await expect(verifyPreparedFulfillment(value.db)).rejects.toThrow("required support");
    await expect(completePreparedFulfillment(value.db, fulfillmentSha256(fs.readFileSync(file)), fixtureFlush)).rejects.toThrow("required support");
    expect(value.db.completeA2aFailedOriginalFulfillment).not.toHaveBeenCalled(); expect(canaryExecutionPaused()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
