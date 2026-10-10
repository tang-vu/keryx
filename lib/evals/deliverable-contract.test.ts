import { describe, expect, it } from "vitest";
import { deliverableSha256, gradeDeliverable, topLevelBulletCount, validateDeliverableInputs,
  whitespaceWordCount } from "./deliverable-contract";
import manifest from "../../scripts/fixtures/deliverable-corpus-v1.json";
import mdn from "../../scripts/fixtures/deliverable-mdn-public-20261009.json";
import rfc from "../../scripts/fixtures/deliverable-rfc-public-20261009.json";
import nasa from "../../scripts/fixtures/deliverable-nasa-public-20261009.json";
import arxiv from "../../scripts/fixtures/deliverable-arxiv-public-20261009.json";
import sqlite from "../../scripts/fixtures/deliverable-sqlite-public-20261009.json";
import originalScorecard from "../../fixtures/evals/quality/scorecard-20261009-corrected.json";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function withAnswer(answer: string) {
  const complete = answer + mdn.answer.slice(mdn.bulletRegion.end);
  return { ...clone(mdn), answer: complete, answerSha256: deliverableSha256(complete),
    bulletRegion: { start: 0 as const, end: answer.length, sha256: deliverableSha256(answer) } };
}

describe("retained public deliverable contracts", () => {
  it.each([[0, mdn], [1, rfc]] as const)("reproduces the exact original version1 grade for case %s", (index, snapshot) => {
    const historical = Object.fromEntries(Object.entries(originalScorecard.cases[index]).filter(([key]) =>
      !["fixtureSha256", "historicalCaptureAllowance", "historicalCaptureAllowanceStatus"].includes(key)));
    expect(gradeDeliverable(manifest.cases[index].contract, snapshot)).toEqual(historical);
  });
  it("reports the actual MDN layout failure separately from five intact recorded bindings", () => {
    const before = JSON.stringify(mdn);
    const result = gradeDeliverable(manifest.cases[0].contract, mdn);
    expect(result.measured).toMatchObject({ bulletCount: 0, wordCount: 415, retainedBindingCount: 5, targetCount: 4 });
    expect(result.checks.retainedBindings.status).toBe("PASS");
    expect(result.checks.bulletCount.status).toBe("FAIL");
    expect(result.checks.language.status).toBe("UNJUDGED");
    expect(result.checks.requiredFacts.status).toBe("UNJUDGED");
    expect(result.outcome).toBe("FAIL");
    expect(result.deliverableAccepted).toBe(false);
    expect(JSON.stringify(mdn)).toBe(before);
  });
  it("counts the whole RFC answer including warning, labels and source-status scaffolding", () => {
    const result = gradeDeliverable(manifest.cases[1].contract, rfc);
    expect(result.measured.wordCount).toBe(296);
    expect(result.checks.retainedBindings.status).toBe("PASS");
    expect(result.checks.wordLimit.status).toBe("FAIL");
    expect(result.checks.bulletCount.status).toBe("UNJUDGED");
  });
  it("never promotes a structurally passing synthetic replay into language, truth or deliverable acceptance", () => {
    const pairs = mdn.bindings.map(row => `Recorded text [${row.marker}] “${row.quote}”`);
    const answer = [`- ${pairs.slice(0, 2).join(" ")}`, `- ${pairs[2]}`, `- ${pairs.slice(3).join(" ")}`].join("\n\n");
    const result = gradeDeliverable(manifest.cases[0].contract, withAnswer(answer));
    expect(result.deterministicContractPassed).toBe(true);
    expect(result.outcome).toBe("UNJUDGED");
    expect(result.deliverableAccepted).toBe(false);
    expect(result.checks.language.status).toBe("UNJUDGED");
    expect(result.checks.requiredFacts.status).toBe("UNJUDGED");
  });
  it.each(["sourceId", "itemId", "itemUrl", "contentVersion", "marker"] as const)("fails a changed %s even with an unchanged visible quote", field => {
    const changed = clone(mdn);
    changed.bindings[0][field] = field === "contentVersion" ? "f".repeat(64) : field === "marker" ? "S2" : field === "itemUrl" ? "https://other.example/item" : "different";
    expect(gradeDeliverable(manifest.cases[0].contract, changed).checks.retainedBindings.status).toBe("FAIL");
  });
  it("fails missing and unexpected bindings, and excerpt/marker pairs separated into different paragraphs", () => {
    const missing = clone(mdn); missing.bindings.pop();
    expect(gradeDeliverable(manifest.cases[0].contract, missing).checks.retainedBindings.status).toBe("FAIL");
    const extra = clone(mdn); extra.bindings.push({ ...extra.bindings[0], quote: "An unexpected quote." });
    expect(gradeDeliverable(manifest.cases[0].contract, extra).checks.retainedBindings.status).toBe("FAIL");
    const separate = withAnswer(mdn.bindings.map(row => `“${row.quote}”`).join("\n\n") + "\n\n[S1]");
    expect(gradeDeliverable(manifest.cases[0].contract, separate).checks.retainedBindings.status).toBe("FAIL");
  });
  it.each(["question", "answer", "id"] as const)("refuses stale %s binding", field => {
    const changed = clone(mdn); changed[field] += "changed";
    expect(() => validateDeliverableInputs(manifest.cases[0].contract, changed)).toThrow(/MISMATCH/);
  });
  it("refuses duplicated observed bindings, duplicated targets and an uncovered contract target", () => {
    const duplicate = clone(mdn); duplicate.bindings.push(duplicate.bindings[0]);
    expect(() => gradeDeliverable(manifest.cases[0].contract, duplicate)).toThrow("DUPLICATE_OR_UNBOUND_TARGET");
    const contract = clone(manifest.cases[0].contract); contract.targets.push(contract.targets[0]);
    expect(() => gradeDeliverable(contract, mdn)).toThrow("DUPLICATE_OR_UNBOUND_TARGET");
    contract.targets[4] = { claimIndex: 4, label: "An uncovered request." };
    expect(() => gradeDeliverable(contract, mdn)).toThrow("DUPLICATE_OR_UNBOUND_TARGET");
  });
  it("refuses fractional/out-of-range or changed range boundaries", () => {
    for (const end of [0, 0.5, mdn.answer.length + 1]) {
      expect(() => gradeDeliverable(manifest.cases[0].contract, { ...mdn, bulletRegion: { ...mdn.bulletRegion, end } })).toThrow();
    }
    expect(() => gradeDeliverable(manifest.cases[0].contract, { ...mdn, bulletRegion: { ...mdn.bulletRegion, start: 1 } })).toThrow();
  });
  it("refuses a self-hashed range that hides another answer bullet inside the excluded suffix", () => {
    const changed = withAnswer("- One\n- Two\n- Three\n- Four\n\n");
    const end = changed.answer.indexOf("- Four");
    changed.bulletRegion = { start: 0, end, sha256: deliverableSha256(changed.answer.slice(0, end)) };
    expect(() => gradeDeliverable(manifest.cases[0].contract, changed)).toThrow("UNREVIEWED_BULLET_REGION_BOUNDARY");
  });
  it("refuses reward/private/unknown role fields rather than accepting a payment or capability projection", () => {
    const paid = clone(mdn); paid.bindings[0].qualifiesForReward = true;
    expect(() => gradeDeliverable(manifest.cases[0].contract, paid)).toThrow();
    expect(() => gradeDeliverable(manifest.cases[0].contract, { ...mdn, owner: "private" })).toThrow();
    expect(() => gradeDeliverable(manifest.cases[0].contract, { ...mdn, capability: { eligible: true } })).toThrow();
  });
  it("does not invoke accessors/toJSON or traverse cycles, deep objects, bad Unicode or oversized inputs", () => {
    let invoked = false;
    const getter = Object.defineProperty({}, "answer", { enumerable: true, get() { invoked = true; throw new Error(); } });
    const hook = { toJSON() { invoked = true; return mdn; } };
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    let deep: unknown = {}; for (let n = 0; n < 20; n++) deep = { child: deep };
    for (const value of [getter, hook, cycle, deep, { ...mdn, answer: "\ud800" }, { ...mdn, answer: "a".repeat(100000) }])
      expect(() => gradeDeliverable(manifest.cases[0].contract, value)).toThrow("MALFORMED_OR_UNBOUNDED_INPUT");
    expect(invoked).toBe(false);
  });
});

describe("version2 retained target-binding diagnostics", () => {
  const contractFor = (id: string) => manifest.cases.find(row => row.contract.id === id)!.contract;
  it("admits the real zero-binding arXiv refusal without scoring it as a supported answer", () => {
    const result = gradeDeliverable(contractFor(arxiv.id), arxiv);
    expect(result.version).toBe(2);
    expect(result.measured).toMatchObject({ retainedBindingCount: 0, targetCount: 4, matchedTargetCount: 0 });
    expect(result.checks.retainedBindings.status).toBe("PASS"); // The empty retained set matches, not semantic support.
    expect(result.checks.retainedTargetBindings.status).toBe("FAIL");
    expect(result.checks.bulletCount.status).toBe("FAIL");
    expect(result.deterministicContractPassed).toBe(false);
    expect(result.deliverableAccepted).toBe(false);
    expect(result.checks.requiredFacts.status).toBe("UNJUDGED");
  });
  it("keeps the NASA missing binding distinct from unknown language and sentence judgments", () => {
    const result = gradeDeliverable(contractFor(nasa.id), nasa);
    expect(result.measured).toMatchObject({ retainedBindingCount: 2, targetCount: 3, matchedTargetCount: 2 });
    expect(result.checks.retainedTargetBindings.status).toBe("FAIL");
    expect(result.checks.language.status).toBe("UNJUDGED");
    expect(result.checks.sentenceCount.status).toBe("UNJUDGED");
    expect(result.checks.sentenceCount.detail).toContain("3 sentences requested");
  });
  it("admits the qualitative SQLite checklist without inventing a numeric format requirement", () => {
    const result = gradeDeliverable(contractFor(sqlite.id), sqlite);
    expect(result.measured).toMatchObject({ targetCount: 8, matchedTargetCount: 5 });
    expect(result.checks.retainedTargetBindings.status).toBe("FAIL");
    expect(result.checks.bulletCount.status).toBe("UNJUDGED");
    expect(result.checks.wordLimit.status).toBe("UNJUDGED");
  });
  it("refuses zero targets, malformed bindings, absent receipt provenance and mixed versions", () => {
    const contract = contractFor(arxiv.id);
    expect(() => gradeDeliverable({ ...contract, targets: [] }, arxiv)).toThrow();
    expect(() => gradeDeliverable(contract, { ...arxiv, bindings: [{ ...nasa.bindings[0], qualifiesForReward: true }] })).toThrow();
    expect(() => gradeDeliverable(contract, { ...arxiv, bindings: [{ ...nasa.bindings[0], contentVersion: "invalid" }] })).toThrow();
    expect(() => gradeDeliverable(contract, { ...arxiv, provenance: { ...arxiv.provenance, retainedReceipt: undefined } })).toThrow();
    expect(() => gradeDeliverable(contractFor(nasa.id), { ...mdn, id: nasa.id })).toThrow("CASE_OR_QUESTION_BINDING_MISMATCH");
  });
  it("does not weaken version1 admission or add successor checks to historical grades", () => {
    const old = manifest.cases[0].contract;
    expect(() => gradeDeliverable({ ...old, requiredBindings: [] }, mdn)).toThrow();
    expect(() => gradeDeliverable({ ...old, format: {} }, mdn)).toThrow();
    expect(() => gradeDeliverable({ ...old, format: { ...old.format, requestedSentenceCount: 3 } }, mdn)).toThrow();
    const result = gradeDeliverable(old, mdn);
    expect(result.version).toBe(1);
    expect(result.checks.retainedTargetBindings).toBeUndefined();
    expect(result.checks.sentenceCount).toBeUndefined();
  });
});

describe("version1 structural counting rules", () => {
  it("counts unindented bullets, excluding code, block quotes, nested rows and horizontal rules", () => {
    expect(topLevelBulletCount("- One\n  - Nested\n> - Quoted\n```md\n- Code\n```\n* Two\n+ Three\n- - -")).toBe(3);
    expect(topLevelBulletCount("~~~\n- Code\n~~~\n- Visible\n```\n- Unclosed code")).toBe(1);
  });
  it("uses the same rules with CRLF, empty text and Unicode whitespace", () => {
    expect(topLevelBulletCount("- One\r\n- Two")).toBe(2);
    expect(whitespaceWordCount("\t\n")).toBe(0);
    expect(whitespaceWordCount("Um\u00a0dois\ntrês")).toBe(3);
    expect(whitespaceWordCount("中文句子。")).toBe(1); // Token measure, not a language word segmenter.
  });
});
