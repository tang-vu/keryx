import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { extractNamespaceCopy, scanNamespaceDrafts } from "../../scripts/check-ui-copy.mjs";
import { researchGuidesCopy } from "@/locales/en/research-guides";
import { literatureClearRecoveryCopy } from "@/locales/en/literature-clear-recovery";
import { literatureBulkScreeningCopy } from "@/locales/en/literature-bulk-screening";
import { loadUiPreview } from "./ui-preview-catalogues";
import { previewCopy, previewMessage, previewText } from "./ui-preview";
import { validateNamespacePreview } from "./ui-shell-catalogue";
import { shippedUiLocales } from "./locales";

const draft = (locale: string, namespace: string) => JSON.parse(readFileSync(`locales/${locale}/ui-drafts/${namespace}.json`, "utf8"));

it("keeps both complete draft inventories bound to every current English source without claiming release approval", () => {
  const inventory = scanNamespaceDrafts();
  expect(inventory.map((row: { locale: string }) => row.locale)).toEqual(["vi", "zh-Hans"]);
  for (const row of inventory) {
    expect(row.complete).toBe(true);
    expect(row.uncoveredEntries).toBe(0);
    expect(row.authoredEntries + row.nonTranslatableMachineIdentifiers).toBe(row.extractedLeaves);
    const manifest = draft(row.locale, "manifest");
    expect(manifest.status).toBe("machineDraft");
    expect(manifest.review).toBeNull();
    expect(manifest.authority).toBe("en");
  }
  expect(shippedUiLocales).toEqual(["en"]);
});

for (const locale of ["vi", "zh-Hans"] as const) {
  it(`${locale} previews the new research guidance while retaining routes, anchors and original evidence`, async () => {
    const preview = await loadUiPreview(locale), authored = draft(locale, "research-guides").entries;
    const selected = previewCopy(preview, "research-guides", researchGuidesCopy);
    expect(selected.hubTitle).toBe(authored.hubTitle.text);
    expect(selected.hubTitle).not.toBe(researchGuidesCopy.hubTitle);
    expect(selected.guides[1].summary).toBe(authored["guides.1.summary"].text);
    expect(selected.guides[1].summary).not.toBe(researchGuidesCopy.guides[1].summary);
    expect(selected.guides[0].sections[0].paragraphs[0]).toBe(authored["guides.0.sections.0.paragraphs.0"].text);
    expect(selected.guides.map(guide => [guide.slug, guide.actionHref, guide.sections.map(section => section.id)]))
      .toEqual(researchGuidesCopy.guides.map(guide => [guide.slug, guide.actionHref, guide.sections.map(section => section.id)]));
    expect(selected.guides[0].sections[0].referenceUrl).toBe(researchGuidesCopy.guides[0].sections[0].referenceUrl);
    const original = `My source passage: ${researchGuidesCopy.hubTitle} {count} USDC`;
    expect(previewText(preview, original)).toBe(original);
    const report = draft(locale, "report-comparison").entries.title;
    expect(previewText(preview, report.source, ["report-comparison"])).toBe(report.text);
  });

  it(`${locale} keeps unreviewed browser privacy, destructive confirmations and funding authoritative in English`, async () => {
    const preview = await loadUiPreview(locale);
    for (const key of ["privacyNotice", "filePrivacyHelp", "exportPrivacyNotice", "replaceConsentWarning"] as const) {
      const source = researchGuidesCopy.tool[key];
      expect(previewText(preview, source, ["research-guides"])).toBe(source);
    }
    for (const namespace of ["funding-cancellation", "literature-bulk-screening", "literature-clear-recovery"]) {
      const catalogue = draft(locale, namespace);
      expect(catalogue.review).toBeNull();
      for (const entry of Object.values(catalogue.entries) as { source: string }[])
        expect(previewText(preview, entry.source, [namespace])).toBe(entry.source);
    }
    expect(previewCopy(preview, "literature-clear-recovery", literatureClearRecoveryCopy)).toEqual(literatureClearRecoveryCopy);
    expect(previewCopy(preview, "literature-bulk-screening", literatureBulkScreeningCopy)).toEqual(literatureBulkScreeningCopy);
    for (const [namespace, keys] of [
      ["evidence-draft-editing", ["confirmClaim", "confirmTheme", "confirmClear"]],
      ["reports", ["literatureWorkspace.removeConfirm", "literatureWorkspace.clearConfirm"]],
    ] as const) {
      for (const key of keys) {
        const source = draft(locale, namespace).entries[key].source;
        expect(previewText(preview, source, [namespace])).toBe(source);
        expect(previewMessage(preview, key, source)).toBe(source);
      }
    }
    const feedback = draft(locale, "reports").entries["reportFeedback.confirmed"];
    expect(previewMessage(preview, "reportFeedback.confirmed", feedback.source)).toBe(feedback.text);
  });

  it(`${locale} retains the same critical boundary when a namespace draft is loaded directly`, () => {
    const namespace = "reports", sourcePath = "locales/en/reports.ts";
    const source = { namespace, ...extractNamespaceCopy(sourcePath, readFileSync(sourcePath, "utf8")) };
    const catalogue = draft(locale, namespace);
    const keys = ["literatureWorkspace.removeConfirm", "literatureWorkspace.clearConfirm", "reportFeedback.confirmed"];
    const selected = validateNamespacePreview(catalogue, source, keys);
    expect(selected["literatureWorkspace.removeConfirm"]).toBeUndefined();
    expect(selected["literatureWorkspace.clearConfirm"]).toBeUndefined();
    expect(selected["reportFeedback.confirmed"]).toBe(catalogue.entries["reportFeedback.confirmed"].text);
  });
}
