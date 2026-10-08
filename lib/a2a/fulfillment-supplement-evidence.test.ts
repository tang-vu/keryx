import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticFailedOriginal } from "../db/a2a-fulfillment-fixture";
import { fulfillmentObjectSha256 as objectHash, fulfillmentSha256 as hash } from "./failed-original-fulfillment-protocol";
import { readBoundSupplementaryContext, assertSupplementaryRunBinding,
  supplementaryQuoteOptions, type FulfillmentSupplementContext } from "./fulfillment-supplement-evidence";
import { isCompleteEvidenceSpan } from "../llm/evidence-span";
import { buildEvidenceReviewInput } from "../llm/evidence-review-input";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import type { SupplementalSpanCapability } from "../llm/supplemental-span-capability";
import type { GatheredContent } from "../llm/reasoning-engine";
import type { QueryRun } from "../types";
import { qualityQuestion } from "../llm/original-fulfillment-quality-fixture";
import type { ContinuationQualityEvidenceCapability } from "../business-operator/fulfillment-continuation-policy";

// Isolate evidence enrollment from supplier authority. Genuine policy token and
// native lifecycle behavior are exercised in the protected policy integration suite.
const qualityTokens = vi.hoisted(() => new WeakMap<object, { context: string; open: boolean }>());
vi.mock("../business-operator/fulfillment-continuation-policy", () => ({
  continuationQualityEvidenceProtocol(token: object, context: string) {
    const state = qualityTokens.get(token);
    if (!state?.open || state.context !== context) throw new Error("Synthetic quality token refused");
    return "same-evidence-prepared-quality-v1";
  },
}));

const cleanup: string[] = [];
afterEach(() => { for (const folder of cleanup.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
function fixture(body = "Synthetic exact primary section.") {
  const folder = fs.mkdtempSync(path.join(process.platform === "win32" ? os.tmpdir() : os.homedir(), "keryx-supplement-proof-"));
  cleanup.push(folder); fs.chmodSync(folder, 0o700);
  const authority = syntheticFailedOriginal().authority, originalText = "Synthetic original frozen reference.";
  const gathered: GatheredContent[] = [{ marker: "S1", sourceId: "public:fulfillment:document-one", sourceName: "Synthetic original",
    text: originalText, sourceKind: "public-reference", creatorRewardEligible: false, contentVersion: hash(originalText),
    webProvenance: { normalizedBodyHash: hash(originalText), retrievedAt: "2026-10-06T09:00:00.000Z", publisherGroup: "developers.circle.com",
      extraction: "text", truncated: false } }];
  const packet = { input: authority.input, gathered, packetSha256: objectHash({ input: authority.input, gathered }), inputSemanticSha256: objectHash(authority.input) };
  const base = { authority, packet }, binding = { nativeClaimSha256: "ab".repeat(32), ownerAuthorizationSha256: "ac".repeat(32), executorCommit: "a".repeat(40) };
  const raw = `Synthetic prefix.\n${body}\nSynthetic suffix.`;
  fs.writeFileSync(path.join(folder, "raw.txt"), raw, { mode: 0o600 }); fs.writeFileSync(path.join(folder, "body.txt"), body, { mode: 0o600 });
  const input = { format: "keryx-original-supplementary-evidence-v1", ...binding, originalAuthoritySha256: objectHash(authority),
    originalPacketSha256: packet.packetSha256, originalInputSemanticSha256: packet.inputSemanticSha256,
    questionSha256: authority.input.questionSha256, payments: 0, creatorRewards: 0, provenance: "reviewed-free-official-verbatim-sections",
    sources: [{ id: "section", title: "Synthetic official section", requestedUrl: "https://docs.arc.io/synthetic/section", finalUrl: "https://docs.arc.io/synthetic/section",
      retrievedAt: "2026-10-06T09:00:00.000Z", status: 200, rawFile: "raw.txt", rawSha256: hash(raw), rawBytes: Buffer.byteLength(raw),
      bodyFile: "body.txt", bodySha256: hash(body), bodyBytes: Buffer.byteLength(body), spans: [{ start: raw.indexOf(body), end: raw.indexOf(body) + body.length }] }] };
  const file = path.join(folder, "manifest.json");
  const read = () => { const bytes = JSON.stringify(input); fs.writeFileSync(file, bytes, { mode: 0o600 }); return readBoundSupplementaryContext(file, hash(bytes), base, binding); };
  return { base, input, read };
}
describe("protected supplemental source provenance", () => {
  it("enrolls only the complete original authorization bullet and qualified RPC proposition under the exact opaque quality token", () => {
    const f = fixture(), bullet = "Contracts that enforce allowlists, spending limits, or compliance checks before approving an action",
      rpc = "RPC trust assumptions: Gateway uses a quorum of multiple node operators on each request to mitigate incorrect responses, but Gateway can’t guarantee that each RPC performed the validation correctly or that an RPC’s network security wasn’t compromised.";
    const authority = f.base.authority;
    authority.question = qualityQuestion; authority.input.questionSha256 = hash(qualityQuestion);
    authority.input.selectedDocumentIds = ["erc-1271", "nanopayments"];
    const original = `Synthetic context for the complete permission list.\n${bullet}\nSynthetic neighboring qualification.\n${rpc}\nSynthetic ending.`;
    const first: GatheredContent = { ...f.base.packet.gathered[0], sourceId: "public:fulfillment:erc-1271", itemUrl: "https://developers.circle.com/gateway/references/erc-1271",
      text: original, contentVersion: hash(original), webProvenance: { ...f.base.packet.gathered[0].webProvenance!, normalizedBodyHash: hash(original) } };
    const second: GatheredContent = { ...first, marker: "S2", sourceId: "public:fulfillment:nanopayments", text: "Synthetic original EOA reference.",
      contentVersion: hash("Synthetic original EOA reference."), webProvenance: { ...first.webProvenance!, normalizedBodyHash: hash("Synthetic original EOA reference.") } };
    f.base.packet.gathered = [first, second];
    f.base.packet.inputSemanticSha256 = objectHash(authority.input);
    f.base.packet.packetSha256 = objectHash({ input: authority.input, gathered: f.base.packet.gathered });
    f.input.originalAuthoritySha256 = objectHash(authority); f.input.questionSha256 = authority.input.questionSha256;
    f.input.originalInputSemanticSha256 = f.base.packet.inputSemanticSha256; f.input.originalPacketSha256 = f.base.packet.packetSha256;
    const context = f.read(), token = Object.freeze({}) as ContinuationQualityEvidenceCapability;
    qualityTokens.set(token, { context: context.contextSha256, open: true });
    expect(supplementaryQuoteOptions(context).options.some(option => option.marker === "S1")).toBe(false);
    expect(() => supplementaryQuoteOptions(context, {} as ContinuationQualityEvidenceCapability)).toThrow(/token refused/);
    const proof = supplementaryQuoteOptions(context, token), rows = proof.options.filter(row => row.marker === "S1");
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toBe(bullet);
    expect(rows[1].text).toBe(rpc.slice("RPC trust assumptions: ".length));
    expect(rows[1].text.length).toBeLessThanOrEqual(240);
    expect(rows[1].context).toContain("RPC trust assumptions:");
    const proposals = rows.map(row => ({ claimIndex: 0, marker: row.marker, quote: row.text,
      quoteSpan: { start: row.start, end: row.end }, support: 0.9, statement: "Synthetic complete premise.", statementSupport: 0.9 }));
    for (const row of rows) {
      const span = { start: row.start, end: row.end };
      expect(isCompleteEvidenceSpan(context.gathered[0], row.text, span)).toBe(false);
      expect(isCompleteEvidenceSpan(context.gathered[0], row.text, span, proof.capability)).toBe(true);
      expect(isCompleteEvidenceSpan(context.gathered[0], row.text.slice(1), { start: row.start + 1, end: row.end }, proof.capability)).toBe(false);
    }
    const review = { proposals, options: proof.options, gathered: context.gathered, subClaims: ["Synthetic original limitations"], supplementalCapability: proof.capability };
    expect(buildEvidenceReviewInput(review).reviewedIndexes.size).toBe(2);
    const ledger = buildEvidenceLedger({ subClaims: review.subClaims, gathered: review.gathered, answer: "Synthetic original [S1].", declaredMarkers: ["S1"],
      proposedEvidence: proposals, supplementalCapability: proof.capability });
    expect(ledger.evidence).toHaveLength(2); expect(ledger.evidence.every(row => row.qualifiesForAnswer && !row.qualifiesForReward)).toBe(true);
    qualityTokens.get(token)!.open = false;
    expect(() => isCompleteEvidenceSpan(context.gathered[0], rows[0].text, { start: rows[0].start, end: rows[0].end }, proof.capability)).toThrow(/token refused/);
  });
  it("retains original bytes/marker and records distinct bounded public sections", () => {
    const f = fixture(), context = f.read();
    expect(context.gathered[0]).toEqual(f.base.packet.gathered[0]);
    expect(context.gathered[1]).toMatchObject({ marker: "S2", sourceId: "public:fulfillment:supplement:section", sourceKind: "public-reference",
      creatorRewardEligible: false, text: "Synthetic exact primary section.", webProvenance: { truncated: true } });
  });
  it.each(["foreign-host", "url-credentials", "url-query", "path-traversal", "offset-drift", "body-hash", "raw-hash", "duplicate-source", "owner", "claim", "executor", "base-packet", "base-body"])
    ("refuses changed or unbound source authority: %s", mutation => {
      const f = fixture(), source = f.input.sources[0];
      if (mutation === "foreign-host") source.finalUrl = "https://example.org/section";
      if (mutation === "url-credentials") source.requestedUrl = "https://secret@docs.arc.io/section";
      if (mutation === "url-query") source.finalUrl += "?grant=claimed";
      if (mutation === "path-traversal") source.bodyFile = "../body.txt";
      if (mutation === "offset-drift") source.spans[0].start++;
      if (mutation === "body-hash") source.bodySha256 = "dd".repeat(32);
      if (mutation === "raw-hash") source.rawSha256 = "dd".repeat(32);
      if (mutation === "duplicate-source") f.input.sources.push(structuredClone(source));
      if (mutation === "owner") f.input.ownerAuthorizationSha256 = "dd".repeat(32);
      if (mutation === "claim") f.input.nativeClaimSha256 = "dd".repeat(32);
      if (mutation === "executor") f.input.executorCommit = "d".repeat(40);
      if (mutation === "base-packet") f.input.originalPacketSha256 = "dd".repeat(32);
      if (mutation === "base-body") f.base.packet.gathered[0].text += " altered";
      expect(f.read).toThrow();
    });
  it("cannot recover a protected context capability by copying its serialized fields", () => {
    const context = fixture().read(), copied = structuredClone(context) as FulfillmentSupplementContext;
    expect(() => assertSupplementaryRunBinding({} as QueryRun, copied)).toThrow(/supplemental evidence refused/);
  });
  it("admits an exact table with its header across generation, review and ledger only under the private capability", () => {
    const f = fixture("| Parameter | Value |\n| :- | :- |\n| Chain ID | 5042 |\n| Currency | USDC |"), context = f.read();
    const proof = supplementaryQuoteOptions(context), source = context.gathered[1], option = proof.options.find(row => row.text.includes("5042"))!;
    expect(option).toBeDefined(); expect(option.text).toContain("Parameter | Value");
    const span = { start: option.start, end: option.end };
    expect(isCompleteEvidenceSpan(source, option.text, span)).toBe(false);
    expect(isCompleteEvidenceSpan(source, option.text, span, {} as SupplementalSpanCapability)).toBe(false);
    expect(isCompleteEvidenceSpan(source, option.text, span, proof.capability)).toBe(true);
    const proposal = { claimIndex: 0, marker: source.marker, quote: option.text, quoteSpan: span, support: 0.9,
      statement: "Synthetic chain configuration requires chain 5042.", statementSupport: 0.9 };
    const input = { proposals: [proposal], options: proof.options, gathered: context.gathered, subClaims: ["Synthetic chain check"] };
    expect(buildEvidenceReviewInput(input).reviewedIndexes.size).toBe(0);
    expect(buildEvidenceReviewInput({ ...input, supplementalCapability: proof.capability }).reviewedIndexes.size).toBe(1);
    const ledger = { subClaims: input.subClaims, gathered: input.gathered, answer: "Synthetic chain check. [S2]", declaredMarkers: ["S2"], proposedEvidence: [proposal] };
    expect(buildEvidenceLedger(ledger).evidence).toHaveLength(0);
    expect(buildEvidenceLedger({ ...ledger, supplementalCapability: proof.capability }).evidence[0]).toMatchObject({ qualifiesForAnswer: true, qualifiesForReward: false });
    expect(isCompleteEvidenceSpan(source, option.text, { ...span, start: span.start + 1 }, proof.capability)).toBe(false);
    expect(isCompleteEvidenceSpan({ ...source, contentVersion: "dd".repeat(32) }, option.text, span, proof.capability)).toBe(false);
    expect(isCompleteEvidenceSpan(source, "5042", { start: source.text.indexOf("5042"), end: source.text.indexOf("5042") + 4 }, proof.capability)).toBe(false);
  });
  it("retains actual mixed newline widths in protected table excerpts", () => {
    const context = fixture("| Parameter | Value |\r\n| :- | :- |\n| Chain ID | 5042 |\r\n| Currency | USDC |").read();
    const proof = supplementaryQuoteOptions(context), source = context.gathered[1];
    expect(proof.options).toHaveLength(1);
    const option = proof.options[0];
    expect(option.text).toBe(source.text.slice(option.start, option.end));
    expect(option.text.endsWith("| Currency | USDC |")).toBe(true);
    expect(isCompleteEvidenceSpan(source, option.text, { start: option.start, end: option.end }, proof.capability)).toBe(true);
  });
});
