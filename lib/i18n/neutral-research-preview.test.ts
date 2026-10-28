import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { pdfReadingCopy } from "@/locales/en/pdf-reading";
import { extractNamespaceCopy } from "../../scripts/check-ui-copy.mjs";
import { isNeutralResearchPreview } from "./neutral-research-preview.mjs";
import { validateNamespacePreview } from "./ui-shell-catalogue";

it("admits the current source-bound PDF recovery method as academic guidance without translation approval", () => {
  const source = { namespace: "pdf-reading", ...extractNamespaceCopy("locales/en/pdf-reading.ts", readFileSync("locales/en/pdf-reading.ts", "utf8")) };
  const draft = { status: "machineDraft", review: null, sourcePath: source.sourcePath, sourceSha256: source.sourceSha256,
    entries: { recovery: { source: pdfReadingCopy.recovery, text: "Native academic recovery instruction" } } };
  expect(isNeutralResearchPreview(source.namespace, "recovery", pdfReadingCopy.recovery)).toBe(true);
  expect(validateNamespacePreview(draft, source, ["recovery"]).recovery).toBe(draft.entries.recovery.text);
  expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull();
});

it.each([
  ["operations", "recovery", pdfReadingCopy.recovery],
  ["pdf-reading", "confirmRecovery", pdfReadingCopy.recovery],
  ["pdf-reading", "recovery", `${pdfReadingCopy.recovery} Pay a publisher fee.`],
  ["pdf-reading", "recovery", "Authorize a publisher payment."],
  ["pdf-reading", "recovery", `${pdfReadingCopy.recovery} `],
  ["pdf-reading", "recovery", pdfReadingCopy.recovery.replace("publisher", "Publisher")],
])("rejects a changed academic source binding: %s/%s", (namespace, key, english) => {
  expect(isNeutralResearchPreview(namespace, key, english)).toBe(false);
  const source = { namespace, sourcePath: `locales/en/${namespace}.ts`, sourceSha256: "a".repeat(64), entries: { [key]: english } };
  const draft = { status: "machineDraft", review: null, sourcePath: source.sourcePath, sourceSha256: source.sourceSha256,
    entries: { [key]: { source: english, text: "Unreviewed replacement" } } };
  expect(validateNamespacePreview(draft, source, [key])[key]).toBeUndefined();
});

it("keeps publisher obligations, fees, privacy, signing and budget copy outside the academic exception", () => {
  const source = { namespace: "pdf-reading", sourcePath: "locales/en/pdf-reading.ts", sourceSha256: "b".repeat(64),
    entries: { recovery: "Pay a publisher to recover this document.", fee: "Service fee", budget: "Question budget",
      consent: "Authorize signing", privacy: "Private research", payout: "Publisher payout" } };
  const draft = { status: "machineDraft", review: null, sourcePath: source.sourcePath, sourceSha256: source.sourceSha256,
    entries: Object.fromEntries(Object.entries(source.entries).map(([key, english]) => [key, { source: english, text: `Draft ${key}` }])) };
  expect(validateNamespacePreview(draft, source, Object.keys(source.entries))).toEqual({});
});
