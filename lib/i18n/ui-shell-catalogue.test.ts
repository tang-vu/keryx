import { expect, it, vi } from "vitest";
import { createMessages, englishMessages } from "./messages";
import { preparedLocales, shippedUiLocales } from "./locales";
import { boundedShellReporter, createShellMessages, loadUiShellCatalogue, validateShellDraft, loadUiNamespaceCatalogue, validateNamespacePreview, type NamespaceSource } from "./ui-shell-catalogue";

const namespaceSource: NamespaceSource = { namespace: "shell", sourcePath: "locales/en/shell.ts", sourceSha256: "a".repeat(64),
  entries: { "shellNavigation.ask": englishMessages["shellNavigation.ask"], "shellFooter.copyright": englishMessages["shellFooter.copyright"],
    "shellFooter.usdcOnArc": englishMessages["shellFooter.usdcOnArc"], consent: "Authorize this payment", pending: "Pending confirmation" } };
const namespaceDraft = () => ({ status: "machineDraft", review: null, sourcePath: namespaceSource.sourcePath, sourceSha256: namespaceSource.sourceSha256,
  entries: { "shellNavigation.ask": { source: namespaceSource.entries["shellNavigation.ask"], text: "Preview question" },
    "shellFooter.copyright": { source: englishMessages["shellFooter.copyright"], text: "{year} Keryx preview" },
    "shellFooter.usdcOnArc": { source: englishMessages["shellFooter.usdcOnArc"], text: "USDC on Arc preview" },
    consent: { source: "Authorize this payment", text: "Draft consent" }, pending: { source: "Pending confirmation", term: "pending" } } });

it("namespace previews load only an explicitly requested/enabled chunk and preserve critical English", async () => {
  const load = vi.fn(async () => namespaceDraft());
  const request = { source: namespaceSource, previewKeys: Object.keys(namespaceSource.entries), load };
  await loadUiNamespaceCatalogue("en", preparedLocales, request);
  await loadUiNamespaceCatalogue("vi", shippedUiLocales, request);
  await loadUiNamespaceCatalogue("vi", preparedLocales, undefined);
  await loadUiNamespaceCatalogue("vi", preparedLocales, { ...request, previewKeys: [] });
  expect(load).not.toHaveBeenCalled();
  const selected = await loadUiNamespaceCatalogue("vi", preparedLocales, request);
  expect(selected["shellNavigation.ask"]).toBe("Preview question");
  expect(selected.consent).toBeUndefined(); expect(selected.pending).toBeUndefined();
  expect(createMessages("vi", selected)("shellNavigation.ask")).toBe("Preview question");
  expect(load).toHaveBeenCalledTimes(1);
  expect(Object.isFrozen(selected)).toBe(true);
});

it("namespace previews reject stale/unknown/prototype/getter metadata and fall back per invalid leaf", () => {
  const keys = Object.keys(namespaceSource.entries);
  for (const draft of [
    { ...namespaceDraft(), status: "reviewed" },
    { ...namespaceDraft(), review: { kind: "human" } },
    { ...namespaceDraft(), sourceSha256: "b".repeat(64) },
    { ...namespaceDraft(), sourcePath: "../shell.ts" },
    { ...namespaceDraft(), extra: true },
    { ...namespaceDraft(), entries: { unknown: { source: "Unknown", text: "Draft" } } },
    Object.assign(Object.create({ inherited: true }), namespaceDraft()),
    Object.defineProperty(namespaceDraft(), "entries", { enumerable: true, get() { throw Error("getter ran"); } }),
    Object.assign(namespaceDraft(), { [Symbol("hidden")]: true }),
  ]) expect(Object.keys(validateNamespacePreview(draft, namespaceSource, keys))).toEqual([]);
  const draft = namespaceDraft();
  draft.entries["shellNavigation.ask"].source = "Stale";
  draft.entries["shellFooter.copyright"].text = "{privateQuestion} Keryx";
  draft.entries["shellFooter.usdcOnArc"].text = "USD on Arc";
  expect(Object.keys(validateNamespacePreview(draft, namespaceSource, keys))).toEqual([]);
  const accessor = namespaceDraft();
  Object.defineProperty(accessor.entries["shellNavigation.ask"], "text", { enumerable: true, get() { throw Error("getter ran"); } });
  expect(validateNamespacePreview(accessor, namespaceSource, keys)["shellNavigation.ask"]).toBeUndefined();
  expect(createMessages("vi", validateNamespacePreview(draft, namespaceSource, keys))("shellNavigation.ask")).toBe(englishMessages["shellNavigation.ask"]);
});

it("unreviewed public-profile publication and visibility consent stays English in explicit previews", () => {
  const source: NamespaceSource = { namespace: "public-profiles", sourcePath: "locales/en/public-profiles.ts", sourceSha256: "d".repeat(64),
    entries: { publish: "Publish profile", unpublish: "Unpublish", publication: "Profile publication",
      manageVisibility: "Manage run visibility", ownershipLabel: "Ownership:",
      selectedBoundary: "Private, unlisted and erased runs are omitted.", purposeLabel: "Research purpose:" } };
  const entries = Object.fromEntries(Object.entries(source.entries).map(([key, english]) => [key, { source: english, text: `Preview ${key}` }]));
  const draft = { status: "machineDraft", review: null, sourcePath: source.sourcePath, sourceSha256: source.sourceSha256, entries };
  const selected = validateNamespacePreview(draft, source, Object.keys(source.entries));
  for (const key of ["publish", "unpublish", "publication", "manageVisibility", "ownershipLabel", "selectedBoundary"])
    expect(selected[key] ?? source.entries[key]).toBe(source.entries[key]);
  expect(selected.purposeLabel).toBe("Preview purposeLabel");
  expect(draft.review).toBeNull();
});

it("namespace loader failures/unknown requests retain English and non-shared leaves preserve interpolation", async () => {
  const load = vi.fn(async () => { throw Error("missing draft chunk"); });
  expect(await loadUiNamespaceCatalogue("vi", preparedLocales, { source: namespaceSource, previewKeys: ["shellNavigation.ask"], load })).toEqual({});
  load.mockClear();
  await loadUiNamespaceCatalogue("vi", preparedLocales, { source: { ...namespaceSource, namespace: "../unknown" }, previewKeys: ["shellNavigation.ask"], load });
  expect(load).not.toHaveBeenCalled();
  const source = { namespace: "bibliographies", sourcePath: "locales/en/bibliographies.json", sourceSha256: "c".repeat(64), entries: { title: "Read {count} references" } };
  const draft = { status: "machineDraft", review: null, sourcePath: source.sourcePath, sourceSha256: source.sourceSha256,
    entries: { title: { source: source.entries.title, text: "Preview {count} references" } } };
  expect(validateNamespacePreview(draft, source, ["title"]).title).toBe("Preview {count} references");
  draft.entries.title.text = "Preview {total} references";
  expect(validateNamespacePreview(draft, source, ["title"]).title).toBeUndefined();
});

it("legacy shell drafts reject unknown/accessor top-level keys and loader failures", async () => {
  const draft = { "shellNavigation.ask": { source: englishMessages["shellNavigation.ask"], text: "Preview" }, unknown: { source: "Unknown", text: "Unknown" } };
  expect(validateShellDraft("vi", draft)).toEqual({});
  expect(validateShellDraft("vi", Object.defineProperty({}, "shellNavigation.ask", { enumerable: true, get() { throw Error("getter ran"); } }))).toEqual({});
  expect(await loadUiShellCatalogue("vi", preparedLocales, () => {}, { vi: async () => { throw Error("missing chunk"); }, "zh-Hans": async () => ({}) })).toEqual({});
});

it("loads only the selected admitted target and no target for English/disabled locales", async () => {
  const viLoader = vi.fn(async () => ({ "shellNavigation.ask": { source: englishMessages["shellNavigation.ask"], text: "Đặt câu hỏi" } }));
  const zhLoader = vi.fn(async () => ({})); const loaders = { vi: viLoader, "zh-Hans": zhLoader };
  await loadUiShellCatalogue("en", preparedLocales, () => {}, loaders);
  await loadUiShellCatalogue("vi", shippedUiLocales, () => {}, loaders);
  expect(viLoader).not.toHaveBeenCalled(); expect(zhLoader).not.toHaveBeenCalled();
  const selected = await loadUiShellCatalogue("vi", preparedLocales, () => {}, loaders);
  expect(createShellMessages("vi", selected)("shellNavigation.ask")).toBe("Đặt câu hỏi");
  expect(viLoader).toHaveBeenCalledTimes(1); expect(zhLoader).not.toHaveBeenCalled();
});
it("falls back for missing, stale, invalid-placeholder, accessor and oversized entries", () => {
  const reported: string[] = [], report = boundedShellReporter((locale, key) => reported.push(`${locale}:${key}`));
  const draft = {
    "shellNavigation.ask": { source: "old English source", text: "stale" },
    "shellNavigation.sources": { source: englishMessages["shellNavigation.sources"], text: "{privateQuestion}" },
    "shellHeader.openMenu": Object.defineProperty({ source: "Open menu" }, "text", { enumerable: true, get() { throw new Error("accessor ran"); } }),
    "shellHeader.closeMenu": { source: "Close menu", text: "x".repeat(2001) },
  };
  const message = createShellMessages("vi", validateShellDraft("vi", draft, report), report);
  for (const key of ["shellNavigation.ask", "shellNavigation.sources", "shellHeader.openMenu", "shellHeader.closeMenu", "shellFooter.house"] as const) expect(message(key)).toBe(englishMessages[key]);
  expect(reported.every(value => !value.includes("privateQuestion"))).toBe(true);
  expect(reported).toContain("vi:shellFooter.house");
});
it("keeps reports bounded/deduplicated and typed source keys/parameters intact", () => {
  const report = vi.fn(), bounded = boundedShellReporter(report, 1);
  bounded("vi", "shellNavigation.ask"); bounded("vi", "shellNavigation.ask"); bounded("vi", "shellHeader.openMenu");
  expect(report).toHaveBeenCalledTimes(1); expect(report).toHaveBeenCalledWith("vi", "shellNavigation.ask");
  const message = createMessages("en"); expect(message("shellFooter.copyright", { year: 2026 })).toContain("2026");
  if (false) {
    // @ts-expect-error Unknown English keys must fail checking.
    message("shellNavigation.typo");
    // @ts-expect-error Required named parameters must fail checking.
    message("shellFooter.copyright");
  }
});
