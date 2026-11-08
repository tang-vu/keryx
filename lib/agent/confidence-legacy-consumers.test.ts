import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { deriveConfidence } from "./confidence";
import { archiveEntryFromRun, buildArchive, buildArchiveStream } from "../answers-archive";
import { compareAnswerReceipts } from "../answers-delta";
import { a2aResearchPackage, completedA2aServiceReceipt } from "../a2a/research-package";
import { buildResearchReceipt, canonicalJson, verifyResearchReceipt } from "../research-receipt";
import { presentationRun } from "../research/presentation.test-fixture";
import { validatePrivacyRun } from "../run-privacy/contracts";
import type { Confidence } from "../types";

const id = "eaf71ac0-cbf3-4c6d-b691-0c45ffcb6ba1";
const verdict = (level: string, reason: unknown = "Recorded explanation") => ({ phase: "verdict", ts: 1, message: "Recorded verdict", detail: { level, reason } });
const high: Confidence = { level: "High", reason: "Recorded explanation" };
const low: Confidence = { level: "Low", reason: "Stored assessment" };
const cases: { name: string; trace: unknown[]; stored?: Confidence; expected: Confidence | null }[] = [
  { name: "no verdict among opaque entries", trace: [null, 0, "historical entry", [], false], expected: null },
  { name: "verdict before a null entry", trace: [verdict("High"), null], expected: high },
  { name: "verdict after a null entry", trace: [null, verdict("High")], expected: high },
  { name: "unknown later verdict and opaque entries", trace: [verdict("High"), verdict("Unknown"), null, { phase: "fetch", detail: null }], expected: high },
  { name: "recognized later verdict whose explanation cannot be converted", trace: [verdict("High"), verdict("Low", { toString: null })], expected: null },
  { name: "nested unconvertible explanation", trace: [verdict("High"), verdict("Low", [{ toString: null }])], expected: null },
  { name: "stored assessment before opaque history", trace: [verdict("High"), null], stored: low, expected: low },
];

function admitted(trace: unknown[], confidence?: Confidence) {
  // Exercise the real persisted-JSON contract, rather than casting a fabricated
  // trace into the typed reader. Keep the serialized original unchanged.
  return validatePrivacyRun(JSON.parse(JSON.stringify({ ...presentationRun(), id, trace, confidence })), id);
}
function digest(value: unknown) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function serviceReceipt(run: ReturnType<typeof admitted>) {
  return completedA2aServiceReceipt({ researchPackage: a2aResearchPackage("quick"),
    acceptedAt: "2026-10-11T23:59:00.000Z", startedAt: "2026-10-11T23:59:00.000Z", run });
}

it.each(cases)("keeps the admitted archive readable: $name", async ({ trace, stored, expected }) => {
  const run = admitted(trace, stored), before = digest(run);
  const entry = archiveEntryFromRun(run);
  expect(deriveConfidence(run)).toEqual(expected);
  expect(entry).toMatchObject({ id, confidence: expected, citationCount: run.citations.length, totalSpent: run.totalSpent, toCreators: run.totalToCreators });
  expect(buildArchive([run])).toEqual([entry]);
  async function* rows() { yield run; }
  expect(await buildArchiveStream(rows())).toEqual([entry]);
  expect(digest(run)).toBe(before);
});

it.each(cases)("retains the original answer and financial receipt: $name", ({ trace, stored, expected }) => {
  const run = admitted(trace, stored), before = digest(run);
  const receipt = buildResearchReceipt(run, []);
  const reference = buildResearchReceipt(admitted([], expected ?? undefined), []);
  expect(receipt).toEqual(reference);
  expect(verifyResearchReceipt(JSON.parse(JSON.stringify(receipt))).valid).toBe(true);
  expect(receipt.payload.dispatch.answer).toBe(run.answer);
  expect(receipt.payload.dispatch.confidence).toEqual(expected);
  expect(digest(run)).toBe(before);
});

it.each(cases)("preserves comparison facts: $name", ({ trace, stored, expected }) => {
  const run = admitted(trace, stored), reference = admitted([], expected ?? undefined), previous = admitted([], low), before = digest(run);
  expect(compareAnswerReceipts(previous, run)).toEqual(compareAnswerReceipts(previous, reference));
  expect(compareAnswerReceipts(previous, run)).toMatchObject({ previousConfidence: "Low", currentConfidence: expected?.level ?? null, settlement: null });
  expect(digest(run)).toBe(before);
});

it.each(cases)("preserves A2A quality facts: $name", ({ trace, stored, expected }) => {
  const run = admitted(trace, stored), reference = admitted([], expected ?? undefined), before = digest(run);
  expect(serviceReceipt(run)).toEqual(serviceReceipt(reference));
  expect(serviceReceipt(run).quality?.confidence).toEqual(expected);
  expect(digest(run)).toBe(before);
});
