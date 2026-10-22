import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compareBaseline, extractUiCopy, makeBaseline, scanRepository, extractNamespaceCopy, uiSourceSha256, validateNamespaceDraft, scanNamespaceDrafts } from "./check-ui-copy.mjs";

const filename = "components/example.tsx";
const sourceCommit = "a".repeat(40);
const scan = source => extractUiCopy(filename, source);
const texts = source => scan(source).map(finding => finding.text);
const baseline = source => makeBaseline(scan(source), sourceCommit);

const glossary = JSON.parse(readFileSync(new URL("../locales/glossary/en.json", import.meta.url), "utf8"));
const namespaceSource = 'export const copy = Object.freeze({ title: "Read {count} sources with USDC on Arc", pending: "Pending confirmation" } as const);';
const namespaceBinding = () => extractNamespaceCopy("locales/en/example.ts", namespaceSource);
const namespaceDraft = () => ({ status: "machineDraft", review: null, sourcePath: "locales/en/example.ts",
  sourceSha256: uiSourceSha256(namespaceSource), entries: {
    title: { source: "Read {count} sources with USDC on Arc", text: "Lire {count} sources avec USDC sur Arc" },
    pending: { source: "Pending confirmation", term: "pending" },
  } });

test("namespace extraction uses source AST for nested leaves, arrays, aliases, CJS and core-inline", () => {
  const extracted = extractNamespaceCopy("locales/en/example.ts", 'export const copy = Object.freeze([{label: "Read", format: "bibtex"}]); export const errors = {empty: helpers["empty"]};',
    expression => expression === 'helpers["empty"]' ? "Empty" : undefined);
  assert.deepEqual({ ...extracted.entries }, { "0.label": "Read", "0.format": "bibtex", empty: "Empty" });
  assert.deepEqual({ ...extracted.aliases }, { empty: 'helpers["empty"]' });
  assert.deepEqual({ ...extractNamespaceCopy("locales/en/example.cjs", 'const copy = {ready: "Ready"}; module.exports = {copy};').entries }, { ready: "Ready" });
  assert.deepEqual({ ...extractNamespaceCopy("lib/i18n/messages.ts", 'const unrelated = {x: "Excluded"}; export const englishMessages = Object.freeze({...imported, "core.title": "Title"});').entries }, { "core.title": "Title" });
  assert.throws(() => extractNamespaceCopy("locales/en/example.ts", 'const copy = {title: runProvider["title"]};'), /unresolved source alias/);
  assert.throws(() => extractNamespaceCopy("locales/en/example.ts", 'const copy = {title:'), /cannot be parsed/);
  assert.equal(uiSourceSha256("a\r\nb\rc\n"), uiSourceSha256("a\nb\nc\n"));
});

test("namespace completeness is derived, and source hashes/leaves/terms/placeholders are exact", () => {
  assert.deepEqual(validateNamespaceDraft(namespaceDraft(), namespaceBinding(), glossary), { coveredKeys: ["pending", "title"], uncoveredKeys: [] });
  const partial = namespaceDraft(); delete partial.entries.pending;
  assert.deepEqual(validateNamespaceDraft(partial, namespaceBinding(), glossary).uncoveredKeys, ["pending"]);
  for (const mutate of [
    draft => { draft.sourceSha256 = "0".repeat(64); },
    draft => { draft.entries.title.source += "!"; },
    draft => { draft.entries.title.text = "Lire {total} sources avec USDC sur Arc"; },
    draft => { draft.entries.title.text = "Lire {count} sources avec USD sur Arc"; },
    draft => { draft.entries.pending.term = "settled"; },
    draft => { draft.entries.unknown = { source: "Unknown", text: "Unknown" }; },
    draft => { draft.status = "reviewed"; },
    draft => { draft.review = { kind: "human" }; },
    draft => { draft.extra = true; },
  ]) {
    const draft = namespaceDraft(); mutate(draft);
    assert.throws(() => validateNamespaceDraft(draft, namespaceBinding(), glossary));
  }
});

test("distinct exported roots qualify colliding leaves, including equal text, without losing unique leaves", () => {
  const binding = extractNamespaceCopy("locales/en/example.ts", `
    export const first = { nested: { title: "Same", only: "Only" }, rows: [{label: "One"}] };
    export const second = { nested: { title: "Same" }, rows: [{label: "Two"}] };
  `);
  assert.deepEqual({ ...binding.entries }, {
    "first.nested.title": "Same", "nested.only": "Only", "first.rows.0.label": "One",
    "second.nested.title": "Same", "second.rows.0.label": "Two",
  });
  const draft = { status: "machineDraft", review: null, sourcePath: binding.sourcePath,
    sourceSha256: binding.sourceSha256, entries: { "nested.title": { source: "Same", text: "Identique" } } };
  assert.throws(() => validateNamespaceDraft(draft, binding, glossary), /Unknown namespace key/);
});

test("root re-export aliases share declaration identity while structural aliases retain their own paths", () => {
  let resolutions = 0;
  const binding = extractNamespaceCopy("locales/en/example.ts", `
    const title = "Title";
    const alias = original;
    const frozenAlias = Object.freeze(alias);
    const original = { title, nested: {ready: helper["ready"]} };
    export { alias as renamed, frozenAlias, original };
    export const second = { nested: {ready: helper["ready"]} };
  `, expression => { resolutions += 1; return expression === 'helper["ready"]' ? "Ready" : undefined; });
  assert.deepEqual({ ...binding.entries }, { title: "Title", "original.nested.ready": "Ready", "second.nested.ready": "Ready" });
  assert.deepEqual({ ...binding.aliases }, { "original.nested.ready": 'helper["ready"]', "second.nested.ready": 'helper["ready"]' });
  assert.equal(resolutions, 2); // Each distinct structural alias once; no re-export traversal.
  assert.deepEqual({ ...extractNamespaceCopy("locales/en/example.cjs", `
    const first = {title: "First"}; const renamed = first; const second = {title: "Second"};
    module.exports = {first, renamed, second}; exports.again = first;
  `).entries }, { "first.title": "First", "second.title": "Second" });
  assert.deepEqual({ ...extractNamespaceCopy("locales/en/example.cjs", 'module.exports = {ready: "Ready", nested: ["One"]};').entries }, { ready: "Ready", "nested.0": "One" });
});

test("duplicate structural and qualified-key collisions refuse even equal text", () => {
  for (const source of [
    'export const copy = {title: "Same", title: "Same"};',
    'export const copy = {"nested.title": "Same", nested: {title: "Same"}};',
    'export const first = {title: "Same"}; export const second = {title: "Same", "first.title": "Same"};',
  ]) assert.throws(() => extractNamespaceCopy("locales/en/example.ts", source), /(?:duplicate structural|conflicting) leaf/);
  assert.throws(() => extractNamespaceCopy("locales/en/example.json", '{"title":"Same","title":"Same"}'), /duplicate structural leaf/);
  assert.deepEqual({ ...extractNamespaceCopy("locales/en/example.json", '{"nested":{"title":"Title"},"rows":[{"label":"One"}]}').entries },
    { "nested.title": "Title", "rows.0.label": "One" });
  assert.throws(() => extractNamespaceCopy("locales/en/example.ts", 'const copy = {nested: copy};'), /cyclic source alias/);
});

test("actual completed result selection/import exports retain all 23 original source leaves", () => {
  const file = "locales/en/completed-evidence-draft-selection.ts";
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const binding = extractNamespaceCopy(file, source);
  assert.equal(Object.keys(binding.entries).length, 23);
  assert.deepEqual(Object.keys(binding.entries).sort(), [
    ...["label", "guidance", "privacy", "reading", "unavailable", "timedOut", "imported"].flatMap(key =>
      [`completedEvidenceDraftSelectionCopy.${key}`, `completedEvidenceDraftImportCopy.${key}`]),
    "jobId", "read", "ready", "signIn", "changed", "invalid", "storage", "empty", "import",
  ].sort());
  assert.equal(binding.sourceSha256, "3f5a7137fc8975e7c4b92525c004bec9f332ddb03058c11c45d4c7a638772cd5");
  assert.equal(binding.entries["completedEvidenceDraftSelectionCopy.imported"], "Completed report and reading observations imported; draft edits are preserved.");
  assert.equal(binding.entries["completedEvidenceDraftImportCopy.imported"], "Retained report appended. Existing draft edits are preserved. Semantic support is unjudged; downloaded or edited reports have caller-supplied origin.");
  assert.equal(binding.entries.read, "Read saved metadata");
  assert(!Object.hasOwn(binding.entries, "imported"));
  for (const locale of ["vi", "zh-Hans"]) {
    const draft = JSON.parse(readFileSync(new URL(`../locales/${locale}/ui-drafts/completed-evidence-draft-selection.json`, import.meta.url), "utf8"));
    assert.deepEqual(validateNamespaceDraft(draft, binding, glossary).uncoveredKeys, []);
    assert.equal(Object.keys(draft.entries).length, 23);
  }
});

test("all 72 existing English namespaces and core-inline are source-extractable without importing them", () => {
  const directory = new URL("../locales/en/", import.meta.url);
  const files = readdirSync(directory).filter(file => /\.(ts|json|cjs)$/.test(file));
  assert.equal(files.length, 72);
  assert(files.includes("about-story.ts"));
  assert(files.includes("wallet-workspace.ts"));
  assert(files.includes("evidence-draft-restore.ts"));
  assert(files.includes("evidence-matrix-export.ts"));
  assert(files.includes("literature-search.ts"));
  assert(files.includes("literature-import.ts"));
  assert(files.includes("evidence-draft-editing.ts"));
  assert(files.includes("research-guides.ts"));
  const helpers = extractNamespaceCopy("locales/en/shared-helpers.ts", readFileSync(new URL("shared-helpers.ts", directory), "utf8"));
  const resolve = expression => {
    const match = /^sharedHelperMessages\["([^"]+)"\]$/.exec(expression);
    return match ? helpers.entries[match[1]] : undefined;
  };
  for (const file of files) {
    const binding = extractNamespaceCopy(`locales/en/${file}`, readFileSync(new URL(file, directory), "utf8"), resolve);
    assert(Object.keys(binding.entries).length > 0, file);
  }
  const core = extractNamespaceCopy("lib/i18n/messages.ts", readFileSync(new URL("../lib/i18n/messages.ts", import.meta.url), "utf8"));
  assert.equal(core.entries["locale.label"], "Interface language");
  assert(!Object.hasOwn(core.entries, "shellNavigation.ask"));
});

test("standalone critical labels reference the existing concept and cannot override it", () => {
  const binding = extractNamespaceCopy("locales/en/example.ts", 'const copy = {pending: "Pending", reward: "Citation rewards"};');
  const draft = { status: "machineDraft", review: null, sourcePath: binding.sourcePath, sourceSha256: binding.sourceSha256,
    entries: { pending: { source: "Pending", term: "pending" }, reward: { source: "Citation rewards", term: "citation-reward" } } };
  assert.equal(validateNamespaceDraft(draft, binding, glossary).coveredKeys.length, 2);
  draft.entries.pending.term = "settled";
  assert.throws(() => validateNamespaceDraft(draft, binding, glossary), /glossary reference/);
  draft.entries.pending = { source: "Pending", text: "Paid" };
  assert.throws(() => validateNamespaceDraft(draft, binding, glossary), /requires glossary term/);
  draft.entries.pending = { source: "Pending", term: "pending" };
  draft.entries.reward = { source: "Citation rewards", text: "Guaranteed earnings" };
  assert.throws(() => validateNamespaceDraft(draft, binding, glossary), /requires glossary term/);
});

test("namespace validation refuses accessors, symbols and inherited draft data without invoking getters", () => {
  for (const mutate of [
    draft => Object.defineProperty(draft, "entries", { enumerable: true, get() { throw Error("getter executed"); } }),
    draft => Object.defineProperty(draft.entries.title, "text", { enumerable: true, get() { throw Error("getter executed"); } }),
    draft => Object.setPrototypeOf(draft.entries, { inherited: true }),
    draft => { draft[Symbol("hidden")] = true; },
  ]) {
    const draft = namespaceDraft(); mutate(draft);
    assert.throws(() => validateNamespaceDraft(draft, namespaceBinding(), glossary), /Invalid draft/);
  }
});

test("manifest inventory and completeness cannot hide missing namespaces or uncovered leaves", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "keryx-draft-manifest-"));
  try {
    for (const directory of ["locales/en", "locales/glossary", "locales/vi/ui-drafts", "locales/zh-Hans/ui-drafts", "lib/i18n"]) mkdirSync(path.join(root, directory), { recursive: true });
    writeFileSync(path.join(root, "locales/en/shared-helpers.ts"), 'export const helpers = {label: "Label"};');
    writeFileSync(path.join(root, "lib/i18n/messages.ts"), 'export const englishMessages = {"core.title": "Title"};');
    writeFileSync(path.join(root, "locales/glossary/en.json"), JSON.stringify(glossary));
    const rows = ["locales/en/shared-helpers.ts", "lib/i18n/messages.ts"].map(file => ({
      namespace: file.startsWith("lib/") ? "core-inline" : "shared-helpers",
      binding: extractNamespaceCopy(file, readFileSync(path.join(root, file), "utf8")),
    }));
    for (const locale of ["vi", "zh-Hans"]) {
      const namespaces = rows.map(({ namespace, binding }) => {
        const draftPath = `locales/${locale}/ui-drafts/${namespace}.json`;
        writeFileSync(path.join(root, draftPath), JSON.stringify({ status: "machineDraft", review: null,
          sourcePath: binding.sourcePath, sourceSha256: binding.sourceSha256, entries: {} }));
        return { namespace, sourcePath: binding.sourcePath, sourceSha256: binding.sourceSha256, draftPath,
          extractedLeaves: 1, authoredEntries: 0, coveredKeys: [], nonTranslatableMachineIdentifiers: [],
          uncoveredKeys: Object.keys(binding.entries), sourceAliases: {} };
      });
      writeFileSync(path.join(root, `locales/${locale}/ui-drafts/manifest.json`), JSON.stringify({ locale, status: "machineDraft", review: null, authority: "en", complete: false, namespaces,
        totals: { englishNamespaceFiles: 1, coreInlineSources: 1, extractedLeaves: 2, authoredEntries: 0, nonTranslatableMachineIdentifiers: 0, uncoveredEntries: 2, completeNamespaces: 0 } }));
    }
    assert.equal(scanNamespaceDrafts(root)[0].uncoveredEntries, 2);
    const file = path.join(root, "locales/vi/ui-drafts/manifest.json"), manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.complete = true; writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => scanNamespaceDrafts(root), /dishonest completeness/);
    manifest.complete = false;
    manifest.namespaces[0].nonTranslatableMachineIdentifiers = [{ key: "label", value: "Label", reason: "pretend machine identifier" }];
    writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => scanNamespaceDrafts(root), /preserved identifier/);
    manifest.namespaces[0].nonTranslatableMachineIdentifiers = [];
    manifest.complete = false; manifest.namespaces.pop(); writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => scanNamespaceDrafts(root), /inventory/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("only the three exact source-bound CSS, HTTP and CLI identifiers are preserved", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "keryx-draft-fixed-identifiers-"));
  const css = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
  const api = "POST /api/research/mandates", command = "node --import tsx scripts/research-mandate.mts --input policy.json";
  const fixed = { operations: ["businessCalculator.borderBorderInkPx4Py2Font"], "research-mandates": ["api", "command"] };
  const sources = {
    "locales/en/shared-helpers.ts": { label: "Label" },
    "locales/en/operations.ts": { "businessCalculator.borderBorderInkPx4Py2Font": css, title: "Operations preview" },
    "locales/en/research-mandates.ts": { api, command, other: command },
    "lib/i18n/messages.ts": { "core.title": "Title" },
  };
  try {
    for (const directory of ["locales/en", "locales/glossary", "locales/vi/ui-drafts", "locales/zh-Hans/ui-drafts", "lib/i18n"])
      mkdirSync(path.join(root, directory), { recursive: true });
    for (const [file, entries] of Object.entries(sources)) writeFileSync(path.join(root, file),
      `export const ${file.startsWith("lib/") ? "englishMessages" : "copy"} = ${JSON.stringify(entries)};`);
    writeFileSync(path.join(root, "locales/glossary/en.json"), JSON.stringify(glossary));
    for (const locale of ["vi", "zh-Hans"]) {
      const namespaces = Object.keys(sources).map(file => {
        const namespace = file.startsWith("lib/") ? "core-inline" : path.basename(file, ".ts");
        const binding = extractNamespaceCopy(file, readFileSync(path.join(root, file), "utf8"));
        const ids = fixed[namespace] ?? [], draftPath = `locales/${locale}/ui-drafts/${namespace}.json`;
        writeFileSync(path.join(root, draftPath), JSON.stringify({ status: "machineDraft", review: null,
          sourcePath: file, sourceSha256: binding.sourceSha256, entries: {} }));
        return { namespace, sourcePath: file, sourceSha256: binding.sourceSha256, draftPath,
          extractedLeaves: Object.keys(binding.entries).length, authoredEntries: 0, coveredKeys: [],
          nonTranslatableMachineIdentifiers: ids.map(key => ({ key, value: binding.entries[key], reason: "source-owned machine syntax" })),
          uncoveredKeys: Object.keys(binding.entries).filter(key => !ids.includes(key)), sourceAliases: {} };
      });
      writeFileSync(path.join(root, `locales/${locale}/ui-drafts/manifest.json`), JSON.stringify({ locale, status: "machineDraft", review: null,
        authority: "en", complete: false, namespaces, totals: { englishNamespaceFiles: 3, coreInlineSources: 1, extractedLeaves: 7,
          authoredEntries: 0, nonTranslatableMachineIdentifiers: 3, uncoveredEntries: 4, completeNamespaces: 0 } }));
    }
    assert.equal(scanNamespaceDrafts(root)[0].nonTranslatableMachineIdentifiers, 3);
    const file = path.join(root, "locales/vi/ui-drafts/manifest.json"), manifest = JSON.parse(readFileSync(file, "utf8"));
    const mandates = manifest.namespaces.find(row => row.namespace === "research-mandates");
    mandates.nonTranslatableMachineIdentifiers.push({ key: "other", value: command, reason: "same command at an unadmitted key" });
    writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => scanNamespaceDrafts(root), /preserved identifier/);
    mandates.nonTranslatableMachineIdentifiers.pop();
    const operations = manifest.namespaces.find(row => row.namespace === "operations");
    const changedSource = `export const copy = ${JSON.stringify({ ...sources["locales/en/operations.ts"],
      "businessCalculator.borderBorderInkPx4Py2Font": "Unreviewed consent" })};`;
    writeFileSync(path.join(root, operations.sourcePath), changedSource);
    operations.sourceSha256 = uiSourceSha256(changedSource);
    operations.nonTranslatableMachineIdentifiers[0].value = "Unreviewed consent";
    writeFileSync(path.join(root, operations.draftPath), JSON.stringify({ status: "machineDraft", review: null,
      sourcePath: operations.sourcePath, sourceSha256: operations.sourceSha256, entries: {} }));
    writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => scanNamespaceDrafts(root), /preserved identifier/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("JSX text, accessibility and visible attribute copy are detected", () => {
  const values = texts('<><h1>Sources</h1><img src="/logo.png" alt="Keryx logo"/><input placeholder={ready ? "Ask a question" : "Wait"} aria-label="Research question" title="Start research"/><span>→</span></>');
  assert.deepEqual(values, ["Sources", "Keryx logo", "Ask a question", "Wait", "Research question", "Start research"]);
});

test("nested JSX does not treat CSS, links, condition codes or event values as copy", () => {
  assert.deepEqual(texts('const C = () => <div>{mode === "paid" ? <button className="font-serif" onClick={() => setMode("quick")} data-testid="buy" href="/ask">Ask</button> : null}</div>'), ["Ask"]);
});

test("literal branches, fallback errors and sentence templates are detected", () => {
  assert.deepEqual(texts('const C = () => <>{ready ? "Ready" : "Waiting"}{error.message || "Could not load"}{count > 0 && "Saved"}{`Read ${count} sources`}</>'),
    ["Ready", "Waiting", "Could not load", "Saved", "Read ${value} sources"]);
  assert.deepEqual(texts('const C = () => <>{`State: ${ready ? "Ready" : "Waiting"}`}</>'), ["State: ${value}", "Ready", "Waiting"]);
});

test("questions, answers, source titles, names and pure interpolation are data", () => {
  assert.deepEqual(texts('const rows = [{ title: "A source title", name: "Creator", question: "Private fixture question" }]; const C = ({ answer, source }) => <>{answer}{source.title}{source.name}{`${answer}`}</>'), []);
});

test("catalogue keys and formatter options are not literal rendered copy", () => {
  assert.deepEqual(texts('import copy from "../locales/en/common.json"; const C = () => <>{copy.title}{t("source.count", {count})}{formatAmount(value, "en-US")}</>'), []);
});

test("local constant aliases and object labels are followed without executing code", () => {
  assert.deepEqual(texts('const LABEL = "Start"; const ALIAS = LABEL; const labels = { ready: "Ready", pending: "Waiting" }; const C = () => { const local = "Local"; return <>{ALIAS}{local}{labels[state]}</>; }'),
    ["Start", "Local", "Ready", "Waiting"]);
  assert.deepEqual(texts('const labels = ({ready: "Ready"} as const) satisfies Record<string, string>; const displayLabels = labels; const C = () => <>{labels[state]}{displayLabels[state]}</>'), ["Ready"]);
  assert.deepEqual(texts('const ready = "Ready"; const labels = {ready}; const alias = labels; const C = () => <>{alias.ready}</>'), ["Ready"]);
});

test("parameters and mutable local bindings do not resolve to an outer label", () => {
  assert.deepEqual(texts('const answer = "Outer"; function C({ source }) { let answer = source.body; return <>{answer}</>; } function D(answer) { return <>{answer}</>; }'), []);
  assert.deepEqual(texts('const label = "Outer"; function C() { const label = "Inner"; return <>{label}</>; }'), ["Inner"]);
  assert.deepEqual(texts('const answer = "Outer"; function C({ answer }) { return <>{answer}</>; } function D([answer]) { return <>{answer}</>; }'), []);
});

test("constant cycles terminate and a reused declaration is counted once", () => {
  assert.deepEqual(texts('const a = b; const b = a; const label = "Label"; const C = () => <>{a}{label}{label}</>'), ["Label"]);
  assert.deepEqual(texts('const a = b; const b = a; const C = () => <>{a[state]}</>'), []);
});

test("toasts, confirmations, state errors and descriptor labels are included", () => {
  assert.deepEqual(texts('toast.success("Saved", { description: "Your draft is saved" }); confirm("Delete draft?"); setError(reason ?? "Request failed"); const options = [{ label: "Download" }];'),
    ["Saved", "Your draft is saved", "Delete draft?", "Request failed", "Download"]);
});

test("metadata titles, descriptions, alt text and static title aliases are included", () => {
  assert.deepEqual(texts('const TITLE = "Sources — Keryx"; export const metadata = { title: TITLE, description: "Reading library", openGraph: { type: "website", images: [{ url: "/og", alt: "Sources preview" }] } };'),
    ["Sources — Keryx", "Reading library", "Sources preview"]);
  assert.deepEqual(texts('export function generateMetadata() { return { title: "Profile", description: "Public researcher" }; }'), ["Profile", "Public researcher"]);
});

test("static Next metadata title objects include default, template and absolute copy", () => {
  assert.deepEqual(texts('export const metadata = { title: { default: "New title", template: "%s | New brand" } };'),
    ["New title", "%s | New brand"]);
  assert.deepEqual(texts('export function generateMetadata() { return { title: { absolute: "Standalone title" } }; }'),
    ["Standalone title"]);
  const original = 'export const metadata = { title: { default: "Existing" } };';
  assert.equal(compareBaseline(scan(original.replace("Existing", "Changed")), baseline(original)).length, 1);
  assert.equal(compareBaseline(scan(original.replace('"Existing"', '"Existing", template: "%s | New brand"')), baseline(original)).length, 1);
});

test("metadata title aliases are static while unrelated default/template data is excluded", () => {
  assert.deepEqual(texts('const defaultTitle = "Fallback"; const template = "%s | Brand"; const titles = ({ default: defaultTitle, template } as const); const alias = titles; export const metadata = { title: alias };'),
    ["Fallback", "%s | Brand"]);
  assert.deepEqual(texts('const data = { title: { default: "Data title", template: "Data template", absolute: "Data absolute" } }; const C = () => <>{data.title}</>;'), []);
  assert.deepEqual(texts('const titles = { default: "Outer title" }; function generateMetadata(titles) { return { title: titles }; }'), []);
});

test("reusing a constant in a new rendered syntax context requires its own allowance", () => {
  const declaration = 'const LABEL = "Existing"; ';
  for (const [original, changed, kinds] of [
    ['const C = () => <>{LABEL}</>;', 'const C = () => <>{LABEL}<input title={LABEL}/></>;', ["jsx-expression", "attribute"]],
    ['const C = () => <input title={LABEL}/>;', 'const C = () => <input title={LABEL}/>; alert(LABEL);', ["attribute", "ui-call"]],
    ['const options = [{ label: LABEL }];', 'const options = [{ label: LABEL }]; const C = () => <>{LABEL}</>;', ["descriptor", "jsx-expression"]],
  ]) {
    const before = declaration + original, after = declaration + changed;
    assert.deepEqual(scan(after).map(finding => finding.kind), kinds);
    const added = compareBaseline(scan(after), baseline(before));
    assert.equal(added.length, 1);
    assert.equal(added[0].kind, kinds[1]);
    assert.equal(added[0].text, "Existing");
  }
  assert.deepEqual(compareBaseline(scan(declaration + 'const C = () => <>{LABEL}{LABEL}</>;'),
    baseline(declaration + 'const C = () => <>{LABEL}</>;')), []);
});

test("existing occurrences are allowed; new, changed and duplicated text fails", () => {
  const original = '<><p>Existing</p><p>Existing</p></>';
  const allowed = baseline(original);
  assert.deepEqual(compareBaseline(scan(original), allowed), []);
  assert.equal(compareBaseline(scan(original.replace('</>', '<p>New</p></>')), allowed).length, 1);
  assert.equal(compareBaseline(scan(original.replace("Existing", "Changed")), allowed).length, 1);
  assert.equal(compareBaseline(scan('<><p>Existing</p><p>Existing</p><p>Existing</p></>'), allowed).length, 1);
  assert.deepEqual(compareBaseline(scan('<p>Existing</p>'), allowed), []);
});

test("baseline identity follows file and syntax context, not line numbers", () => {
  const original = '<p>Existing</p>', allowed = baseline(original);
  assert.deepEqual(compareBaseline(scan('\n\n' + original), allowed), []);
  assert.equal(compareBaseline(extractUiCopy("components/moved.tsx", original), allowed).length, 1);
  assert.equal(compareBaseline(scan('<p title="Existing"/>'), allowed).length, 1);
});

test("malformed source and invalid, duplicate or mismatched baselines fail closed", () => {
  assert.throws(() => scan('<div title="broken>'), /cannot be parsed/);
  const finding = scan('<p>Copy</p>'), allowed = makeBaseline(finding, sourceCommit);
  for (const value of [null, { ...allowed, sourceCommit: "unknown" }, { ...allowed, parserVersion: "0.0" }]) {
    assert.throws(() => compareBaseline(finding, value), /Invalid baseline metadata/);
  }
  assert.throws(() => compareBaseline(finding, { ...allowed, entries: [...allowed.entries, allowed.entries[0]] }), /duplicate baseline entry/);
  for (const count of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => compareBaseline(finding, { ...allowed, entries: [{ ...allowed.entries[0], count }] }), /Invalid or duplicate/);
  }
  assert.throws(() => compareBaseline(finding, { ...allowed, entries: [{ ...allowed.entries[0], file: "components/../outside.tsx" }] }), /Invalid or duplicate/);
  assert.throws(() => compareBaseline(finding, { ...allowed, entries: [{ ...allowed.entries[0], file: "components/other.tsx" }] }), /mismatched source metadata/);
});

test("tracked inventory detects new JSX files and excludes API, secrets and fixtures", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "keryx-copy-guard-"));
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  try {
    mkdirSync(path.join(root, "components")); mkdirSync(path.join(root, "app", "api"), { recursive: true });
    mkdirSync(path.join(root, "lib"));
    const actualLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/typescript": actualLock.packages["node_modules/typescript"] } }));
    writeFileSync(path.join(root, "components", "new.tsx"), '<button aria-label="New control">New label</button>');
    writeFileSync(path.join(root, "app", "api", "route.ts"), 'throw Error("Internal error");');
    writeFileSync(path.join(root, "lib", "fixture.tsx"), '<p>Fixture</p>');
    writeFileSync(path.join(root, ".env.local"), "not JavaScript; must not be loaded");
    git(["init", "--quiet"]); git(["add", "components", "app", "lib"]);
    const result = scanRepository(root);
    assert.equal(result.files, 1); assert.deepEqual(result.findings.map(finding => finding.text), ["New control", "New label"]);
    const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
    lock.packages["node_modules/typescript"].version = "0.0.0";
    writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lock));
    assert.throws(() => scanRepository(root), /match the lockfile parser/);
    lock.packages["node_modules/typescript"].version = actualLock.packages["node_modules/typescript"].version;
    writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lock));
    const blob = git(["hash-object", "components/new.tsx"]).trim();
    git(["update-index", "--cacheinfo", "120000", blob, "components/new.tsx"]);
    assert.throws(() => scanRepository(root), /regular merged Git file/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("actual repository baseline matches its source and includes desktop JSX", () => {
  const inventory = scanRepository();
  const allowed = JSON.parse(readFileSync(new URL("../locales/ui-copy-baseline.json", import.meta.url), "utf8"));
  assert.deepEqual(compareBaseline(inventory.findings, allowed), []);
  assert.ok(inventory.findings.some(finding => finding.file.startsWith("desktop/src/")));
});

test("account/profile/session/key copy is catalogued; only protocol examples and vendor marks remain inline", () => {
  const files = ["app/me/profile/page.tsx", "app/me/profile/private-profile-view.tsx", "app/dev/page.tsx",
    "components/keryx/wallet-menu.tsx", "components/keryx/wallet-picker.tsx", "components/keryx/circle-google-wallet.tsx",
    "components/keryx/session-active-card.tsx", "components/keryx/session-cashout-panel.tsx", "components/keryx/withdrawal-account.tsx"];
  const retained = new Map([
    ["app/dev/page.tsx", ["/api/agent/ask", "payment-signature", "https://keryx.cc/api/v1", "keryx", "kx_live_…",
      "stream:true", "reasoning_content", "kx_live_…"]],
    ["components/keryx/wallet-picker.tsx", ["MetaMask", "WalletConnect"]],
    ["components/keryx/circle-google-wallet.tsx", ["G"]],
  ]);
  for (const file of files) {
    const findings = extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    const examples = findings.filter(finding => finding.text.startsWith("curl https://keryx.cc/"));
    assert.equal(examples.length, file === "app/dev/page.tsx" ? 2 : 0);
    assert.deepEqual(findings.filter(finding => !examples.includes(finding)).map(finding => finding.text), retained.get(file) ?? [], file);
  }
});

test("CLI resolves assets from another cwd and CI cannot rewrite the baseline", () => {
  const script = fileURLToPath(new URL("./check-ui-copy.mjs", import.meta.url));
  const run = (args, env = process.env) => execFileSync(process.execPath, [script, ...args],
    { cwd: new URL("../locales", import.meta.url), env, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  assert.match(run([]), /UI copy guard passed/);
  assert.throws(() => run(["--ignore-new-copy"]), error => error.status === 1 && /Usage:/.test(error.stderr));
  assert.throws(() => run(["--write-baseline"], { ...process.env, CI: "true" }), error => error.status === 1 && /CI cannot rewrite/.test(error.stderr));
});

test("Operator, status, proof and calculator copy is catalogued; numbered layers and protocol examples remain data", () => {
  const files = ["app/operator/page.tsx", "app/economics/page.tsx", "app/status/page.tsx", "app/proof/page.tsx",
    "components/keryx/operator-business-view.tsx", "components/keryx/business-calculator.tsx", "components/keryx/proof-dashboard.tsx",
    "components/keryx/monitoring-status-section.tsx", "components/keryx/registry-status-section.tsx", "components/keryx/dispatch-health-section.tsx",
    "components/keryx/settlement-proof-section.tsx", "components/keryx/pending-reconciliation-section.tsx"];
  for (const file of files) {
    const findings = extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    const examples = findings.filter(finding => finding.text.startsWith("curl -s ${value}/v1/balances"));
    assert.equal(examples.length, file.endsWith("settlement-proof-section.tsx") ? 1 : 0, file);
    assert.deepEqual(findings.filter(finding => !examples.includes(finding)).map(finding => finding.text),
      file === "app/proof/page.tsx" ? ["0"] : file.endsWith("proof-dashboard.tsx") ? ["tang-vu/keryx"] : file.endsWith("settlement-proof-section.tsx") ? ["0x…"] : [], file);
  }
});

test("common shell and observation wrapper copy is catalogued; protocol names, brand and source examples remain data", () => {
  const remaining = {
    "components/keryx/site-header.tsx": ["MCP"],
    "components/keryx/site-footer.tsx": ["Keryx", "κῆρυξ"],
    "components/keryx/creator-cashouts-panel.tsx": ["/tx/"],
    "components/keryx/testnet-history-summary.tsx": [],
  };
  for (const [file, data] of Object.entries(remaining)) {
    const findings = extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    assert.deepEqual(findings.map(finding => finding.text), data, file);
  }
});

test("personal dispatch metadata, accessibility, empty states and toast copy are catalogued", () => {
  for (const file of ["app/me/asks/page.tsx", "app/me/asks/my-asks-view.tsx"]) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")), [], file);
  }
});

test("research conversation, decision, payment and job recovery copy is catalogued; protocol samples remain data", () => {
  const files = ["app/embed/page.tsx", "app/embed/embed-client.tsx", "components/keryx/a2a-call-card.tsx",
    "components/keryx/budget-meter.tsx", "components/keryx/creators-paid-panel.tsx", "components/keryx/follow-up-form.tsx",
    "components/keryx/gateway-contract-references.tsx", "components/keryx/onboarding-tour.tsx", "components/keryx/paid-stamp.tsx",
    "components/keryx/phase-style.ts", "components/keryx/reasoning-console.tsx", "components/keryx/research-account-jobs.tsx",
    "components/keryx/research-chat.tsx", "components/keryx/research-decisions.tsx", "components/keryx/research-job-details.tsx",
    "components/keryx/research-job.tsx", "components/keryx/research-private-jobs.tsx", "components/keryx/research-saved-jobs.tsx",
    "components/keryx/research-turn.tsx", "components/keryx/selection-failure-download.tsx", "components/keryx/sponsored-trial-notice.tsx",
    "components/keryx/trace-row.tsx"];
  const retained = new Map([
    ["app/embed/embed-client.tsx", ["Keryx"]],
    ["components/keryx/a2a-call-card.tsx", ["https://keryx.cc", 'claude mcp add --transport http keryx &quot;https://keryx.cc/mcp?client=claude&quot;', "/api/docs ↗"]],
    ["components/keryx/research-job.tsx", ["a2a_…"]],
  ]);
  for (const file of files) {
    const findings = extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    const samples = findings.filter(finding => finding.text.startsWith("# 1 · inspect the default package"));
    assert.equal(samples.length, file.endsWith("a2a-call-card.tsx") ? 1 : 0, file);
    assert.deepEqual(findings.filter(finding => !samples.includes(finding)).map(finding => finding.text), retained.get(file) ?? [], file);
  }
});

test("funding, consent, checkout, request and evidence inspection copy is catalogued; currencies and protocol identities remain data", () => {
  const retained = {
    "app/research/page.tsx": ["USDC"],
    "components/keryx/arc-card-onramp-panel.tsx": [],
    "components/keryx/faucet-panel.tsx": ["USDC"],
    "components/keryx/grant-spend-dialog.tsx": [],
    "components/keryx/research-budget-fields.tsx": [],
    "components/keryx/research-checkout.tsx": [],
    "components/keryx/research-evidence-browser.tsx": [],
    "components/keryx/research-funding-activity.tsx": [],
    "components/keryx/research-funding.tsx": ["0x…"],
    "components/keryx/research-monthly.tsx": [],
    "components/keryx/research-private-checkout.tsx": [],
    "components/keryx/research-request.tsx": ["POST /api/agent/ask"],
  };
  for (const [file, data] of Object.entries(retained)) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8"))
      .map(finding => finding.text), data, file);
  }
});

test("report/archive/export/paper-workspace copy is catalogued; only brand, network, currency and record limits remain data", () => {
  const files = ["app/answers/page.tsx", "app/answers/page/[n]/page.tsx", "app/answers/topic/[slug]/page.tsx",
    "app/dispatch/[id]/page.tsx", "app/dispatch/[id]/dispatch-view.tsx", "app/dispatch/[id]/opengraph-image.tsx",
    "app/history/testnet/page.tsx", "app/literature/page.tsx",
    ...["report-actions", "research-citation-export", "bibliography-exports", "portable-receipt-panel",
      "evidence-matrix-export", "answer-delta", "mode-badge", "confidence-badge", "answer-markdown",
      "historical-dispatch-note", "related-dispatches", "archive-answer-row", "dispatch-history",
      "research-private-result", "answer-feedback", "scholarly-metadata", "answer-card", "citation-evidence-panel",
      "paper-card", "paper-save-button", "paper-search-panel", "literature-comparison-preview", "archive-index-view",
      "archive-search", "archive-topic-chips", "archive-pagination", "dispatch-wire", "freshness-note",
      "literature-workspace", "source-evidence-lens"].map(name => `components/keryx/${name}.tsx`)];
  const retained = {
    "app/dispatch/[id]/opengraph-image.tsx": ["K", "Keryx"],
    "app/dispatch/[id]/page.tsx": ["KERYX", "Arc testnet", "Arc mainnet"],
    "components/keryx/dispatch-wire.tsx": ["USDC"],
    "components/keryx/literature-comparison-preview.tsx": ["arXiv"],
    "components/keryx/literature-workspace.tsx": ["/50"],
  };
  for (const file of files) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8"))
      .map(finding => finding.text), retained[file] ?? [], file);
  }
});

test("source discovery, retained-feed and market copy is catalogued; vendor links, currency and example year remain data", () => {
  const files = ["app/sources/page.tsx", "app/market/page.tsx", ...["source-library-filters",
    "public-reference-card", "cited-source-card", "explore-source-card", "source-registry-row",
    "sources-list", "source-directory-preview"].map(name => `components/keryx/${name}.tsx`)];
  const retained = {
    "app/sources/page.tsx": ["OpenAlex ↗", "DOAJ ↗", "USDC"],
    "components/keryx/source-library-filters.tsx": ["2024"],
  };
  for (const file of files) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8"))
      .map(finding => finding.text), retained[file] ?? [], file);
  }
});

test("native Desktop copy is catalogued; executable buyer command remains invariant protocol data", () => {
  const file = "desktop/src/renderer.tsx";
  const findings = extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
  assert.deepEqual(findings.map(finding => finding.text), [
    "$env:KERYX_NETWORK=${value}; $env:NEXT_PUBLIC_KERYX_NETWORK=${value}; npm run buyer -- buy --request ${value} --payee ${value} --max-total ${value} --state ${value}",
  ]);
  assert.deepEqual(extractUiCopy("desktop/src/sponsored-research.tsx",
    readFileSync(new URL("../desktop/src/sponsored-research.tsx", import.meta.url), "utf8")), []);
});

test("public source claim proof, policy, status and accessible controls are catalogued", () => {
  for (const file of ["app/claim-source/page.tsx", "components/keryx/public-source-claim-form.tsx",
    "components/keryx/public-source-claim-policy.tsx", "components/keryx/public-source-claim-status.tsx",
    "components/keryx/public-source-claims.tsx"]) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).map(finding => finding.text),
      file.endsWith("public-source-claim-form.tsx") ? ["https://your-site.example/article"] : [], file);
  }
});

test("registration, bulk import and feed verification copy is catalogued; protocol and source examples stay data", () => {
  const retained = {
    "app/register/page.tsx": ["https://your-site.example/feed.xml"],
    "components/keryx/register-form.tsx": ["register-tx", "register-tx", "https://yourblog.com/feed.xml",
      "Stablecoin Ledger", "https://yourblog.com", "$0.005", "$0.040", "https://your-agent.com/keryx-hook",
      "X-Keryx-Signature", "sha256=hex(hmac_sha256(secret, rawBody))"],
    "components/keryx/bulk-import-form.tsx": [],
    "components/keryx/bulk-import-results.tsx": [],
    "components/keryx/feed-verification-panel.tsx": [],
    "components/keryx/owner-feed-verification.tsx": [],
    "components/keryx/claim-onchain-panel.tsx": [],
  };
  for (const [file, data] of Object.entries(retained)) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).map(finding => finding.text), data, file);
  }
});

test("creator management copy is catalogued; protocol, contact, currency and brand data remain inline", () => {
  const retained = {
    "app/creator/[id]/page.tsx": ["KERYX"],
    "app/creator/[id]/creator-detail-view.tsx": ["tx"],
    "app/creator/[id]/article-content-panel.tsx": [],
    "app/creator/[id]/article-offers-panel.tsx": [],
    "app/creator/[id]/scholarly-rights-panel.tsx": ["submitted", "submitted"],
    "app/creator/[id]/listing-controls-panel.tsx": ["listing-tx", "listing-tx", "$0.001", "$0.040"],
    "app/creator/[id]/decision-feedback-panel.tsx": [],
    "app/creator/[id]/notify-email-panel.tsx": ["you@example.com"],
    "app/creator/[id]/notify-webhook-panel.tsx": ["https://your-agent.com/keryx-hook", "sha256=hex(hmac_sha256(secret, rawBody))"],
    "app/creator/[id]/preview-depth-panel.tsx": [],
    "app/creator/[id]/embed-badge-panel.tsx": ["Markdown", "HTML"],
    "app/creator/[id]/embed-widget-panel.tsx": ['<script src="${value}/keryx-widget.js" data-keryx-source="${value}" async></script>'],
    "app/creator/[id]/opengraph-image.tsx": ["K", "Keryx"],
    "app/me/sources/page.tsx": [],
    "app/me/sources/my-sources-view.tsx": ["you@example.com"],
    "components/keryx/creator-leaderboard.tsx": [],
  };
  for (const [file, data] of Object.entries(retained)) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).map(finding => finding.text), data, file);
  }
  const proof = "app/creator/[id]/gateway-proof-panel.tsx";
  const findings = extractUiCopy(proof, readFileSync(new URL(`../${proof}`, import.meta.url), "utf8"));
  assert.equal(findings.length, 1);
  assert.match(findings[0].text, /^curl -s \$\{value\}\/v1\/balances/u);
});

test("withdrawal instructions, accessibility and recovery states are catalogued; network and currency identities remain data", () => {
  const retained = {
    "app/me/withdrawals/page.tsx": [],
    "components/keryx/withdrawal-workspace.tsx": [],
    // Amount currency codes are emitted by shared SigningAmount, covered by its consumer tests.
    "components/keryx/withdrawal-review-panel.tsx": ["Arc Testnet · USDC"],
    "components/keryx/withdrawal-recovery-panel.tsx": ["USDC"],
    "components/keryx/withdrawal-history-panel.tsx": [],
    "components/keryx/withdrawal-history-progress.tsx": [],
    "components/keryx/withdraw-earnings-panel.tsx": [],
    "components/keryx/creator-owner-withdrawal-panel.tsx": [],
  };
  for (const [file, data] of Object.entries(retained)) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).map(finding => finding.text), data, file);
  }
});

test("landing, metadata, fallback and dialog copy is catalogued; protocol and brand data remain inline", () => {
  const retained = {
    "app/layout.tsx": ["%s · Keryx"],
    "app/error.tsx": [],
    "app/global-error.tsx": [],
    "app/not-found.tsx": ["404"],
    "app/opengraph-image.tsx": ["K", "Keryx"],
    "components/keryx/landing-sections.tsx": [],
    "components/keryx/hero-stats.tsx": [],
    "components/keryx/activity-ticker.tsx": [],
    "components/keryx/keryx-mark.tsx": ["K", "Keryx"],
    "components/keryx/herald-seal.tsx": ["K"],
    "components/keryx/product-hunt-badge.tsx": [],
    "components/ui/dialog.tsx": [],
  };
  for (const [file, data] of Object.entries(retained)) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).map(finding => finding.text), data, file);
  }
});

test("Wanted copy is catalogued while brand, address and feed example data remain inline", () => {
  const retained = {
    "app/wanted/page.tsx": [],
    "app/wanted/[id]/page.tsx": [],
    "app/wanted/[id]/opengraph-image.tsx": ["K", "Keryx", "keryx.cc/wanted"],
    "components/keryx/feed-match-form.tsx": ["https://yourblog.com/feed.xml"],
    "components/keryx/existing-article-response-form.tsx": [],
    "components/keryx/wanted-share-button.tsx": [],
  };
  for (const [file, data] of Object.entries(retained)) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).map(finding => finding.text), data, file);
  }
});

test("integration setup and playground copy is catalogued; protocols, URLs and example prompts stay data", () => {
  const retained = {
    "app/integrations/mcp/page.tsx": [],
    "app/integrations/mcp/mcp-integration-client.tsx": ["Remote MCP", "io.github.tang-vu/keryx", "MCP Registry", "https://keryx.cc/mcp", "paper_lookup", "searchRepositories: true", "Use Keryx research to explain how micropayments make citation rewards practical for AI agents. Include the paid sources and dispatch receipt."],
    "app/playground/page.tsx": ["https://keryx.cc/api/v1", "/chat/completions", "keryx", "stream:true", "kx_live_…", "/dev", "/api/docs"],
  };
  for (const [file, data] of Object.entries(retained)) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).map(finding => finding.text), data, file);
  }
});

test("localized leaves and native attribute boundaries retain copy-guard coverage", () => {
  const findings = extractUiCopy("components/example.tsx", `const Example = () => <><UiText source={"New label"} /><UiElement as="a" names={["title"]} attributes={{ title: "New tooltip", href: "/original", className: "layout-only" }}>child</UiElement></>;`);
  assert(findings.some(finding => finding.text === "New label" && finding.kind === "jsx-expression"));
  assert(findings.some(finding => finding.text === "New tooltip" && finding.kind === "attribute"));
  assert(!findings.some(finding => ["/original", "layout-only"].includes(finding.text)));
});

test("dashboard notices, counts, payment labels and accessibility copy are catalogued", () => {
  for (const file of ["app/dashboard/page.tsx", "components/keryx/dashboard-view.tsx", "components/keryx/payments-feed.tsx"]) {
    assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")), [], file);
  }
});

test("public researcher profile consent, ownership and ledger qualifications are catalogued without a baseline exception", () => {
  const files = ["app/me/public-profile/page.tsx", "app/me/public-profile/public-profile-editor.tsx",
    "app/u/[handle]/page.tsx", "app/u/[handle]/opengraph-image.tsx", "components/keryx/public-researcher-profile.tsx"];
  for (const file of files) assert.deepEqual(extractUiCopy(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")), [], file);
  const editor = readFileSync(new URL("../app/me/public-profile/public-profile-editor.tsx", import.meta.url), "utf8");
  assert.equal(editor.split("{copy.fieldsLegend}").length, 2);
  const regressed = editor.replace("{copy.fieldsLegend}", "Fields to publish");
  assert(extractUiCopy(files[1], regressed).some(finding => finding.kind === "jsx-text" && finding.text === "Fields to publish"),
    "A new inline label must still fail the unchanged source guard");
});
