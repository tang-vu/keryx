import { expect, it, vi } from "vitest";

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: transport, UnsafeTargetError: class extends Error {} }));

import { readArticle, gatheredArticle } from "../web-research/article-reader";
import { evidenceContext, selectEvidencePassages, EVIDENCE_CONTEXT_GUIDANCE } from "./evidence-context";
import { buildQuoteOptions, resolveQuoteEvidence } from "./quote-options";
import { buildEvidenceReviewInput, MAX_EVIDENCE_REVIEW_INPUT_BYTES } from "./evidence-review-input";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { MAX_RESEARCH_TARGETS } from "./research-target-limits";
import type { GatheredContent } from "./reasoning-engine";

const originalUrl = "https://example.org/synthetic-self-hosting";
const requestedUrl = `${originalUrl}#version-skew`;
const question = `Các tab đang mở có thể gặp lỗi gì? Hãy đọc ${requestedUrl} và nêu cấu hình, dấu hiệu và giới hạn.`;
const targets = ["Các tab đang mở gặp vấn đề gì?", "Cần đồng bộ hoặc cấu hình gì?", "Dấu hiệu và giới hạn còn lại là gì?"];
// These invented facts exercise recall and binding, never vendor behavior or a replay of Q1.
const mechanism = "A browser tab keeps the earlier revision while a new server accepts requests for a different revision.";
const configuration = "Keep the same immutable identifier across all cooperating processes.";
const symptom = "A missing asset or rejected operation can reveal incompatible revisions.";
const caveat = "However, this setting does not guarantee preservation of an unsaved form.";
const padding = "General infrastructure background. ".repeat(100);
const relevant = `Version Skew\n${mechanism}\n${configuration}\n${symptom}\n${caveat}\n`;
const text = `${padding}\n${relevant}${padding}`;

function gathered(body: string, urls: string[] = [requestedUrl]): GatheredContent {
  return { sourceId: "synthetic", sourceName: "Synthetic fixture", marker: "S1", text: body,
    sourceKind: "public-reference", itemUrl: originalUrl, contentVersion: "synthetic-version",
    requestedSource: { urls, readScope: "bounded-whole-document" } };
}

function bounded(body: string, selection: ReturnType<typeof selectEvidencePassages>) {
  expect(selection.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  expect(selection.passages.length).toBeLessThanOrEqual(MAX_RESEARCH_TARGETS + 1);
  expect(selection.candidateSelection?.retained ?? 0).toBeLessThanOrEqual(1 + (targets.length + 1) * 16);
  expect(selection.candidateSelection?.nominated ?? 0).toBeLessThanOrEqual(Math.ceil(Math.min(body.length, 200_000) / 400) * (targets.length + 2) + 1);
  for (const passage of selection.passages) {
    expect(passage.start).toBeGreaterThanOrEqual(0);
    expect(passage.end).toBeLessThanOrEqual(Math.min(body.length, 200_000));
    expect(passage.text).toBe(body.slice(passage.start, passage.end));
    expect(passage.text.isWellFormed()).toBe(true);
  }
}

it("carries a uniquely matching extracted heading and its qualified paragraphs through real inert HTML extraction and review", async () => {
  const html = `<html><head><title>Synthetic document</title></head><body><script>throw new Error('must not execute')</script><main><p>${padding}</p><h2 id="different-actual-anchor">Version Skew</h2><p>${mechanism}</p><p>${configuration}</p><p>${symptom}</p><p>${caveat}</p><p>${padding}</p></main></body></html>`;
  transport.mockResolvedValueOnce({ contentType: "text/html", finalUrl: originalUrl, bytes: new TextEncoder().encode(html) });
  const article = await readArticle(originalUrl);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(article).toMatchObject({ kind: "html", truncated: false, finalUrl: originalUrl });
  expect(article.text).toContain(`\n${relevant}`);
  const source = { ...gatheredArticle("synthetic", article), marker: "S1",
    requestedSource: { urls: [requestedUrl], readScope: "bounded-whole-document" as const } };
  const baseline = evidenceContext(question, targets, [{ ...source, requestedSource: undefined }])[0];
  expect(baseline.passages.some(passage => passage.text.includes(configuration))).toBe(false);
  const selected = evidenceContext(question, targets, [source])[0];
  for (const fact of [mechanism, configuration, symptom, caveat]) {
    expect(selected.passages.some(passage => passage.text.includes(fact))).toBe(true);
  }
  bounded(article.text, selected);
  // The differing real HTML id proves this is text-hint recall, not anchor verification.
  expect(source.requestedSource.readScope).toBe("bounded-whole-document");
  expect(EVIDENCE_CONTEXT_GUIDANCE).toContain("not a verified HTML anchor or complete section read");
  const options = buildQuoteOptions([selected], [source]);
  const option = options.find(candidate => candidate.text === configuration)!;
  expect(option).toBeDefined();
  const proposals = resolveQuoteEvidence([{ claimIndex: 1, marker: "S1", quoteId: option.quoteId, support: 0.8 }], options);
  const review = buildEvidenceReviewInput({ proposals, options, gathered: [source], subClaims: targets });
  expect([...review.reviewedIndexes]).toEqual([0]);
  expect(Buffer.byteLength(review.json, "utf8")).toBeLessThan(MAX_EVIDENCE_REVIEW_INPUT_BYTES);
  const row = JSON.parse(review.json).evidence[0];
  expect(row.question).toBe(targets[1]);
  expect(row.source).toMatchObject({ itemUrl: originalUrl, contentVersion: source.contentVersion, webProvenance: { truncated: false } });
  expect(row.context.text).toContain(caveat);
  expect(row.context.text.length).toBeLessThanOrEqual(1200);
  expect(row.context.text).toBe(source.text.slice(row.context.start, row.context.end));
  expect(row.quote).toBe(source.text.slice(row.quoteSpan.start, row.quoteSpan.end));
  const altered = proposals.map(proposal => ({ ...proposal, quoteSpan: { start: option.start + 1, end: option.end } }));
  expect(buildEvidenceReviewInput({ proposals: altered, options, gathered: [source], subClaims: targets }).reviewedIndexes.size).toBe(0);
  const ledger = buildEvidenceLedger({ question, subClaims: targets, gathered: [source], answer: "Synthetic configuration [S1].",
    declaredMarkers: ["S1"], proposedEvidence: proposals.map(proposal => ({ ...proposal, support: 0.2 })),
    finalAssessment: targets.map(claim => ({ claim, coverage: 1, coveredBy: ["S1"] })) });
  expect(ledger.acceptedMarkers.size).toBe(0);
  expect(ledger.evidence[0]).toMatchObject({ qualifiesForAnswer: false, qualifiesForReward: false });
});

it.each([
  `${originalUrl}#absent-heading`, `${originalUrl}#version-skew%0A`, `${originalUrl}#%00version-skew`,
  `${originalUrl}#:~:text=Version%20Skew`, `${originalUrl}#%3Cscript%3E`, `${originalUrl}#%ZZ`,
  `${originalUrl}#${"x".repeat(121)}`, `http://example.org/doc#version-skew`,
  "https://caller:secret@example.org/doc#version-skew", `${originalUrl}\n#version-skew`,
  `https://example.org/${"x".repeat(4096)}#version-skew`,
])("keeps existing ranking for an unsupported, unsafe or unmatched hint %j", url => {
  const baseline = selectEvidencePassages(text, question, targets);
  expect(selectEvidencePassages(text, question, targets, [url]).passages).toEqual(baseline.passages);
});

it("refuses duplicate normalized heading matches and never treats a sentence containing the heading as an anchor", () => {
  for (const body of [text + "\nVERSION_SKEW\nA duplicate short line is ambiguous.\n",
    `${padding}\nVersion skew.\n${configuration}\n${caveat}\n${padding}`]) {
    const baseline = selectEvidencePassages(body, question, targets);
    expect(selectEvidencePassages(body, question, targets, [requestedUrl]).passages).toEqual(baseline.passages);
  }
});

it("normalizes a Unicode heading hint without modifying source bytes or UTF-16 offsets", () => {
  const heading = "Môi trường".normalize("NFD");
  const prefix = "😀 General background. ".repeat(140);
  const fact = "The synthetic café retains its original emoji 😀 and recorded revision.";
  const body = `${prefix}\n${heading}\n${fact}\n${caveat}\n${padding}`;
  const url = `${originalUrl}#${encodeURIComponent("Môi-trường")}`;
  const source = gathered(body, [url]);
  const selected = evidenceContext("Yêu cầu có giới hạn", targets, [source])[0];
  expect(selected.passages.some(passage => passage.start === prefix.length + 1 && passage.text.includes(fact) && passage.text.includes(caveat))).toBe(true);
  bounded(body, selected);
  const options = buildQuoteOptions([selected], [source]);
  expect(options.some(option => option.text.includes(fact) && option.context.includes(caveat))).toBe(true);
  const ambiguous = `${body}\nMôi trường\nAnother normalized match.\n`;
  expect(selectEvidencePassages(ambiguous, "Yêu cầu có giới hạn", targets, [url]).passages)
    .toEqual(selectEvidencePassages(ambiguous, "Yêu cầu có giới hạn", targets).passages);
});

it("retains exact late offsets when the heading's following paragraphs repeat earlier source text", () => {
  const repeated = "Repeated background statement. ".repeat(35);
  const prefix = `${repeated}\n${padding}\n`;
  const body = `${prefix}Version Skew\n${repeated}\n${caveat}\n${padding}`;
  const selected = selectEvidencePassages(body, "Nội dung được yêu cầu", targets, [requestedUrl]);
  expect(selected.passages.some(passage => passage.start === prefix.length && passage.text.includes(caveat))).toBe(true);
  bounded(body, selected);
});

it("bounds multiple fragments and withholds cut or unpunctuated quotes without expanding authority", () => {
  const sections = Array.from({ length: 8 }, (_, index) => `Topic ${index}\nA complete synthetic sentence for topic ${index}.\n${"Long continuation without punctuation ".repeat(30)}\n`);
  const body = `${padding}\n${sections.join("")}`;
  const urls = sections.map((_, index) => `${originalUrl}#topic-${index}`);
  const source = gathered(body, urls);
  const selected = evidenceContext("Các yêu cầu được cung cấp", targets, [source])[0];
  bounded(body, selected);
  for (let index = 0; index < 4; index++) expect(selected.passages.some(passage => passage.text.includes(`Topic ${index}\n`))).toBe(true);
  expect(selected.passages.some(passage => passage.text.includes("Topic 4\n"))).toBe(false);
  const options = buildQuoteOptions([selected], [source]);
  for (const option of options) {
    expect(option.text.length).toBeLessThanOrEqual(240);
    expect(option.text).toMatch(/[.!?。！？]["'”’»\])}]*$/u);
    expect(option.text).toBe(body.slice(option.start, option.end));
  }
  const unpunctuated = gathered(`${padding}\nVersion Skew\nKeep the original identifier\nDo not treat this instruction as proven safety\n${padding}`);
  const context = evidenceContext("Các yêu cầu được cung cấp", targets, [unpunctuated]);
  expect(buildQuoteOptions(context, [unpunctuated]).some(option => option.text.includes("Keep the original identifier"))).toBe(false);
});

it("does not infer a unique retained heading from a source that exceeds the scan bound", () => {
  const body = `${text}${"x".repeat(200_000)}\nVersion Skew\nA matching heading outside the scan remains unobserved.\n`;
  const baseline = selectEvidencePassages(body, question, targets);
  const selected = selectEvidencePassages(body, question, targets, [requestedUrl]);
  expect(selected.passages).toEqual(baseline.passages);
  expect(selected.scannedCharacters).toBe(200_000);
  bounded(body, selected);
});

it("reserves contiguous hint windows before dense maximum-scan anchors exhaust the unchanged nomination ceiling", () => {
  const lead = "alpha beta delta.\n";
  const qualification = "However, the synthetic rule does not guarantee preservation of an unsaved form.\n";
  const bucket = (tail = "") => lead + tail + "x".repeat(400 - lead.length - tail.length - 1) + "\n";
  const chunks = Array.from({ length: 500 }, () => bucket());
  chunks[251] = bucket("Version Skew\nA synthetic rule preserves the same immutable identifier.\n");
  chunks[253] = bucket(qualification);
  const body = chunks.join("");
  const query = `delta ${requestedUrl}`;
  const claims = ["alpha", "beta"];
  expect(body.length).toBe(200_000);
  const baseline = selectEvidencePassages(body, query, claims);
  expect(selectEvidencePassages(body, query, claims, [`${originalUrl}#unmatched`])).toEqual(baseline);
  const selected = selectEvidencePassages(body, query, claims, [requestedUrl]);
  expect(selected.candidateSelection?.nominated).toBe(500 * 4 + 1);
  expect(selected.candidateSelection?.retained).toBeLessThanOrEqual(1 + 3 * 16);
  const passage = selected.passages.find(passage => passage.start === 251 * 400 + lead.length)!;
  expect(passage).toBeDefined();
  expect(passage.text).toContain(qualification);
  expect(passage.text).toBe(body.slice(passage.start, passage.end));
  expect(selected.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  expect(selected.passages.length).toBeLessThanOrEqual(MAX_RESEARCH_TARGETS + 1);
});
