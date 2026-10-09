import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compareBaseline, extractUiCopy, makeBaseline, scanRepository } from "./check-ui-copy.mjs";

const filename = "components/example.tsx";
const sourceCommit = "a".repeat(40);
const scan = source => extractUiCopy(filename, source);
const texts = source => scan(source).map(finding => finding.text);
const baseline = source => makeBaseline(scan(source), sourceCommit);

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

test("CLI resolves assets from another cwd and CI cannot rewrite the baseline", () => {
  const script = fileURLToPath(new URL("./check-ui-copy.mjs", import.meta.url));
  const run = (args, env = process.env) => execFileSync(process.execPath, [script, ...args],
    { cwd: new URL("../locales", import.meta.url), env, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  assert.match(run([]), /UI copy guard passed/);
  assert.throws(() => run(["--ignore-new-copy"]), error => error.status === 1 && /Usage:/.test(error.stderr));
  assert.throws(() => run(["--write-baseline"], { ...process.env, CI: "true" }), error => error.status === 1 && /CI cannot rewrite/.test(error.stderr));
});
