// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { loadUiPreview } from "./ui-preview-catalogues";
import { shippedUiLocales } from "./locales";
import { englishMessages } from "./messages";
import { EvidenceDraftText } from "@/components/keryx/evidence-draft-text";
import { englishUiCopy, UiCopyContext } from "./ui-copy-context";
import { evidenceDraftCopy as copy } from "../research/evidence-draft-copy";
import type { UiLocale } from "./locales";
import type { UiPreview } from "./ui-preview";

function render(template: string | undefined, values: Record<string, ReactNode>, locale: UiLocale = "ar", source = copy.statement.paperUnread) {
  const preview: UiPreview = template === undefined ? {} : { "evidence-drafts": { [source]: template } };
  const markup = renderToStaticMarkup(createElement(UiCopyContext.Provider, { value: { ...englishUiCopy, locale, preview } }, createElement(EvidenceDraftText, { source, values })));
  const container = document.createElement("div"); container.innerHTML = markup;
  return { markup, container };
}

describe("authored evidence-draft templates and original data", () => {
  it.each(["ar", "de", "ja"] as const)("inserts original text after whole-template lookup in %s", locale => {
    const title = `${copy.claim.passage} العربية 日本語 <script>literal</script> {title}`;
    const original = createElement("bdi", { dir: "auto", translate: "no" }, title);
    const { container } = render("Translated prefix: {title} · translated suffix", { title: original }, locale);
    expect(container.textContent).toBe(`Translated prefix: ${title} · translated suffix`);
    expect(container.querySelector("bdi")?.textContent).toBe(title);
    expect(container.querySelector("bdi")?.getAttribute("translate")).toBe("no");
    expect(container.querySelector("script")).toBeNull();
    expect(container.firstElementChild?.getAttribute("lang")).toBe(locale);
    expect(container.firstElementChild?.getAttribute("dir")).toBe(locale === "ar" ? "rtl" : null);
  });

  it("keeps missing/held English fallback left-to-right inside an Arabic preview", () => {
    const { container } = render(undefined, { title: "Original العربية" });
    expect(container.textContent).toBe("Original العربية — no retained excerpt; cannot be described");
    expect(container.firstElementChild?.getAttribute("lang")).toBe("en");
    expect(container.firstElementChild?.getAttribute("dir")).toBe("ltr");
  });

  it.each(["Missing original slot", "Unknown {other}", "Extra {title} {other}"])("falls back without losing original data for malformed preview %s", template => {
    const { container } = render(template, { title: "Exact {title} <literal>" });
    expect(container.textContent).toBe("Exact {title} <literal> — no retained excerpt; cannot be described");
    expect(container.firstElementChild?.getAttribute("lang")).toBe("en");
  });

  it("allows the same original slot in two authored positions without reparsing its value", () => {
    const { container } = render("{title} then {title}", { title: "Original {title}" });
    expect(container.textContent).toBe("Original {title} then Original {title}");
  });

  it("escapes markup-like translator text as text", () => {
    const { container } = render("<strong>{title}</strong>", { title: "<img src=x onerror=literal>" });
    expect(container.textContent).toBe("<strong><img src=x onerror=literal></strong>");
    expect(container.querySelector("strong, img")).toBeNull();
  });

  it("keeps numeric counts and version/report originals in their named slots", () => {
    const { container } = render("Reports {reports}; excerpts {excerpts}", { reports: 2, excerpts: 0 }, "de", copy.import.summary);
    expect(container.textContent).toBe("Reports 2; excerpts 0");
    const version = "sha256:abc{report}", report = "report العربية <literal>";
    expect(render("Report {report}; version {version}", { report, version }, "ar", copy.claim.excerptVersion).container.textContent).toBe(`Report ${report}; version ${version}`);
  });

  it("preserves English output without adding a display wrapper", () => {
    const { markup } = render(undefined, { title: "Original" }, "en");
    expect(markup).toBe("Original — no retained excerpt; cannot be described");
  });

  it.each([{}, { title: undefined }, { title: "Original", extra: "Unexpected" }])("refuses invalid caller parameters", values => {
    expect(() => render(undefined, values)).toThrow(/evidence draft display parameter/);
  });

  it("refuses accessor parameters without invoking them", () => {
    let reads = 0;
    const values = Object.defineProperty({}, "title", { enumerable: true, get() { reads++; return "Do not invoke"; } });
    expect(() => render(undefined, values)).toThrow("Missing evidence draft display parameter");
    expect(reads).toBe(0);
  });
});

const displayKeys = [
  "page.back",
  "page.heading",
  "page.introduction",
  "page.noScript",
  "page.navigation",
  "workspace.loading",
  "workspace.includeFirst",
  "workspace.changed",
  "workspace.clear",
  "workspace.cleared",
  "import.label",
  "import.guidance",
  "import.button",
  "import.summary",
  "import.success",
  "import.refused",
  "claim.label",
  "claim.passage",
  "claim.add",
  "claim.selectFirst",
  "claim.reviewer",
  "claim.paper",
  "claim.unavailable",
  "claim.assessed",
  "claim.recordAssessment",
  "claim.unavailableGuidance",
  "claim.excerptVersion",
  "claim.verdicts.supported",
  "claim.verdicts.partly-supported",
  "claim.verdicts.not-found",
  "theme.label",
  "theme.heading",
  "theme.guidance",
  "theme.assemble",
  "theme.regenerate",
  "theme.assemblyRefused",
  "theme.title",
  "theme.notes",
  "theme.clearExcerpts",
  "theme.add",
  "theme.unreadHeading",
  "reading.guidance",
  "reading.prepare",
  "reading.clear",
  "reading.status",
  "reading.unknown",
  "reading.unread",
  "reading.unavailable",
  "reading.reason",
  "reading.unreadHeading",
  "reading.unavailableHeading",
  "statement.heading",
  "statement.guidance",
  "statement.add",
  "statement.remove",
  "statement.kind",
  "statement.kinds.contribution",
  "statement.kinds.agreement",
  "statement.kinds.disagreement",
  "statement.kinds.gap",
  "statement.text",
  "statement.papers",
  "statement.paperUnread",
  "statement.excerpts",
  "statement.empty",
  "statement.bound",
  "statement.authorGap",
  "statement.needsOnePaper",
  "statement.needsTwoPapers",
  "statement.needsExcerpt",
  "download.markdown",
  "download.latex",
  "download.bibtex",
  "download.ris",
  "download.refused",
  "download.backupRefused"
];

it.each(["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const)("%s binds all76 rendered draft messages and keeps model/default/critical originals out of preview copy", async locale => {
  const sourcePath = "locales/en/evidence-drafts.json";
  const binding = extractNamespaceCopy(sourcePath, readFileSync(sourcePath, "utf8"));
  const draft = JSON.parse(readFileSync(`locales/${locale}/ui-drafts/evidence-drafts.json`, "utf8"));
  const glossary = JSON.parse(readFileSync("locales/glossary/en.json", "utf8"));
  expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull();
  expect(Object.keys(draft.entries).sort()).toEqual([...displayKeys].sort());
  expect(validateNamespaceDraft(draft, binding, glossary).coveredKeys).toHaveLength(76);
  const preview = await loadUiPreview(locale);
  for (const key of displayKeys) {
    const entry = draft.entries[key];
    expect(entry.source).toBe(binding.entries[key]); expect(entry.text).not.toBe(entry.source);
    expect(entry.text).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
    expect(preview["evidence-drafts"][entry.source]).toBe(entry.text);
    // This JSON namespace is resolved by authored templates, not unknown MessageKey casts.
    if (!Object.hasOwn(englishMessages, key)) expect(preview.$messages[key]).toBeUndefined();
  }
  const excluded = Object.keys(binding.entries).filter(key => !displayKeys.includes(key));
  expect(excluded).toHaveLength(16);
  for (const key of excluded) {
    expect(draft.entries[key]).toBeUndefined();
    expect(preview["evidence-drafts"][binding.entries[key]]).toBeUndefined();
  }
  // The original title equals another translatable UI label on purpose.
  const original = copy.claim.passage;
  expect(preview["evidence-drafts"][original]).not.toBe(original);
  const markup = renderToStaticMarkup(createElement(UiCopyContext.Provider, { value: { ...englishUiCopy, locale, preview } },
    createElement(EvidenceDraftText, { source: copy.statement.paperUnread, values: { title: createElement("bdi", { dir: "auto", translate: "no" }, original) } })));
  const container = document.createElement("div"); container.innerHTML = markup;
  expect(container.textContent).toBe(draft.entries["statement.paperUnread"].text.replace("{title}", original));
  expect(container.querySelector("bdi")?.textContent).toBe(original);
  expect(shippedUiLocales).toEqual(["en"]);
});
