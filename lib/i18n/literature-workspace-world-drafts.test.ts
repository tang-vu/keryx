import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { reportMessages } from "../../locales/en/reports";
import { sharedHelperMessages } from "../../locales/en/shared-helpers";
import { createMessages, englishMessages, type MessageKey } from "./messages";
import { loadUiPreview } from "./ui-preview-catalogues";
import { previewText } from "./ui-preview";
import { shippedUiLocales } from "./locales";
import { PAPER_CATALOG } from "../papers/catalog";
import { emptyLiteratureWorkspace, literatureScreeningCsv, parseLiteratureWorkspace, saveLiteraturePaper,
  SCREENING_STATES, serializeLiteratureWorkspace } from "../papers/literature-workspace";
import { paperReferencesCslJson, paperReferencesRis } from "../papers/reference-export";

const locales = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const critical = ["removeConfirm", "actionFailed", "privacy", "referencesNotice", "compareNotice", "draftPrivacy",
  "portableNotice", "restoreNotice", "clearNotice", "clearConfirm"].map(key => `literatureWorkspace.${key}`);
const core = Object.keys(reportMessages).filter(key => key.startsWith("literatureWorkspace.") && !critical.includes(key)) as MessageKey[];
const states = Object.keys(SCREENING_STATES) as Array<keyof typeof SCREENING_STATES>;
const helpers = states.map(state => `paperWorkspace.screening.${state}` as const);
const read = (file: string) => readFileSync(file, "utf8");
const glossary = JSON.parse(read("locales/glossary/en.json"));
const draft = (locale: string, namespace: string) => JSON.parse(read(`locales/${locale}/ui-drafts/${namespace}.json`));

it.each(locales)("%s binds75 workspace messages and4 screening labels without admitting sensitive notices", async locale => {
  const preview = await loadUiPreview(locale);
  expect(core).toHaveLength(75); expect(helpers).toHaveLength(4);
  for (const [namespace, keys, expected] of [["reports", core, 130], ["shared-helpers", helpers, 4]] as const) {
    const value = draft(locale, namespace), sourcePath = `locales/en/${namespace}.ts`;
    const binding = { namespace, ...extractNamespaceCopy(sourcePath, read(sourcePath)) };
    expect(value.status).toBe("machineDraft"); expect(value.review).toBeNull();
    expect(validateNamespaceDraft(value, binding, glossary).coveredKeys).toHaveLength(expected);
    for (const key of keys) {
      const entry = value.entries[key];
      expect(entry.source).toBe(englishMessages[key]); expect(entry.text).not.toBe(entry.source);
      expect(preview.$messages[key]).toBe(entry.text);
      expect(entry.text).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
      for (const token of ["RIS", "CSL-JSON", "CSV", "JSON", "1 MiB", "/2", "↗", "→"])
        if (entry.source.includes(token)) expect(entry.text).toContain(token);
    }
  }
  for (const key of critical as MessageKey[]) {
    expect(draft(locale, "reports").entries[key]).toBeUndefined();
    expect(preview.$messages[key]).toBeUndefined();
    expect(previewText(preview, englishMessages[key], ["reports"])).toBe(englishMessages[key]);
  }
  expect(preview["literature-bulk-screening"]).toBeUndefined();
  expect(preview["literature-clear-recovery"]).toBeUndefined();
  expect(shippedUiLocales).toEqual(["en"]);
});

it.each(locales)("%s interpolates counts and original titles once without translating or interpreting user text", async locale => {
  const preview = await loadUiPreview(locale), copy = createMessages(locale, preview.$messages);
  const original = "Compare <script>literal</script> {count} 日本語 العربية";
  const entries = draft(locale, "reports").entries;
  expect(copy("literatureWorkspace.compareLabel", { title: original })).toBe(
    entries["literatureWorkspace.compareLabel"].text.replace("{title}", original));
  for (const count of [0, 1, 2, 5, 11, 21, 101]) {
    const suffix = count === 1 ? "one" : "other";
    const key = `literatureWorkspace.selection.${suffix}` as const;
    expect(copy(key, { count, selected: 2 })).toBe(entries[key].text.replace("{count}", String(count)).replace("{selected}", "2"));
    expect(copy(key, { count, selected: 2 })).toContain("2/2");
    for (const format of ["ris", "csl"] as const) {
      const key = `literatureWorkspace.${format}Prepared.${suffix}` as const;
      expect(copy(key, { count })).toBe(entries[key].text.replace("{count}", String(count)));
    }
    const keyBackup = `literatureWorkspace.backupSummary.${suffix}` as const;
    expect(copy(keyBackup, { filename: "Original {count}.json", count, title: original })).toContain(original);
    expect(copy(keyBackup, { filename: "Original {count}.json", count, title: original })).toContain("Original {count}.json");
  }
  expect(copy("literatureWorkspace.metadataIncomplete", { recorded: 1, total: 9 })).toContain("1/9");
  expect(copy("literatureWorkspace.snapshot", { date: "2026-10-31" })).toContain("2026-10-31");
});

it("keeps language-independent screening values, original records and metadata-only export boundaries", async () => {
  expect(SCREENING_STATES).toEqual({ unscreened: "To screen", include: "Include", exclude: "Exclude", undecided: "Undecided" });
  let workspace = emptyLiteratureWorkspace();
  workspace.title = reportMessages["literatureWorkspace.titleLabel"];
  workspace.question = "Original question {count} <literal> العربية";
  for (const [index, state] of states.entries()) {
    workspace = saveLiteraturePaper(workspace, { ...PAPER_CATALOG[index], title: reportMessages["literatureWorkspace.compare"],
      authors: [sharedHelperMessages["paperWorkspace.screening.include"]], authorCount: 1, authorsTruncated: false }, "2026-10-31T00:00:00Z");
    workspace.entries[index].screening = state; workspace.entries[index].notes = `PRIVATE_NOTE ${state} {count} <script>literal</script>`;
  }
  const before = serializeLiteratureWorkspace(workspace), csv = literatureScreeningCsv(workspace);
  const ris = paperReferencesRis(workspace.entries.map(entry => entry.paper)).content;
  const csl = paperReferencesCslJson(workspace.entries.map(entry => entry.paper)).content;
  for (const locale of locales) {
    const preview = await loadUiPreview(locale), copy = createMessages(locale, preview.$messages);
    for (const key of helpers) expect(copy(key)).not.toBe(englishMessages[key]);
    expect(literatureScreeningCsv(workspace)).toBe(csv);
    expect(paperReferencesRis(workspace.entries.map(entry => entry.paper)).content).toBe(ris);
    expect(paperReferencesCslJson(workspace.entries.map(entry => entry.paper)).content).toBe(csl);
  }
  for (const label of Object.values(SCREENING_STATES)) expect(csv).toContain(label);
  for (const exported of [ris, csl]) {
    expect(exported).toContain("Compare"); expect(exported).toContain("Include");
    expect(exported).not.toContain("PRIVATE_NOTE"); expect(exported).not.toContain(workspace.question);
  }
  expect(serializeLiteratureWorkspace(workspace)).toBe(before);
  expect(parseLiteratureWorkspace(before)).toEqual(workspace);
});
