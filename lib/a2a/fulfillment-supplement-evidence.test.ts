import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
