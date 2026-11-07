import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyChanges, determineScope, parseRawDiff } from "./ci-scope.mjs";
import { assertCiGate, requiredJobs } from "./ci-gate.mjs";

const regular = filename => ({ path: filename, beforeMode: "100644", afterMode: "100644" });
test("only regular prose documents qualify for the light lane", () => {
  assert.equal(classifyChanges([regular("DECISIONS.md"), regular("docs/engineering/ci-workflow.md")]), "docs");
  for (const filename of ["lib/payment.ts", "components/answer.tsx", "app/globals.css", "package-lock.json", "docs/schema.sql", "docs/engineering/feed.xml", ".github/workflows/ci.yml", ".agents/skills/review/SKILL.md", "docs/../lib/pay.ts", "docs\\a.md"]) {
    assert.equal(classifyChanges([regular("README.md"), regular(filename)]), "full", filename);
  }
  assert.equal(classifyChanges([]), "full");
  assert.equal(classifyChanges([{ ...regular("docs/a.md"), afterMode: "120000" }]), "full");
  assert.equal(classifyChanges([{ ...regular("docs/a.md"), afterMode: "100755" }]), "full");
});

test("unknown or incomplete change evidence requests full checks", () => {
  assert.equal(determineScope("0".repeat(40), "1".repeat(40), false), "full");
  assert.equal(determineScope("1".repeat(40), "2".repeat(40), true, () => { throw new Error("missing base"); }), "full");
  assert.equal(determineScope("1".repeat(40), "2".repeat(40), true, () => "truncated"), "full");
  assert.throws(() => parseRawDiff(":100644 100644 bad bad R100\0docs/a.md\0docs/b.md\0"));
});

test("main always stays full; actual PR merge-tree diff includes renamed/deleted runtime files", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "keryx-ci-scope-"));
  const git = args => execFileSync("git", args, { cwd: directory, encoding: "utf8", windowsHide: true });
  const commit = message => { git(["add", "-A"]); git(["-c", "user.name=CI fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", message]); return git(["rev-parse", "HEAD"]).trim(); };
  try {
    git(["init", "-q"]);
    git(["config", "core.autocrlf", "false"]);
    mkdirSync(path.join(directory, "docs"));
    writeFileSync(path.join(directory, "README.md"), "base\n");
    writeFileSync(path.join(directory, "runtime.js"), "base\n");
    const base = commit("base");
    writeFileSync(path.join(directory, "docs/a.md"), "docs\n");
    const docs = commit("docs");
    assert.equal(determineScope(base, docs, false, git), "full");
    assert.equal(determineScope(base, docs, true, git), "docs");
    git(["mv", "runtime.js", "docs/renamed.md"]);
    const renamed = commit("rename runtime");
    assert.equal(determineScope(docs, renamed, true, git), "full");
    git(["checkout", "-q", "-b", "runtime-main", base]);
    writeFileSync(path.join(directory, "runtime.js"), "updated runtime\n");
    const changedMain = commit("runtime main");
    git(["checkout", "-q", "-b", "docs-pr", docs]);
    git(["-c", "user.name=CI fixture", "-c", "user.email=fixture@example.invalid", "merge", "-q", "--no-edit", changedMain]);
    const merged = git(["rev-parse", "HEAD"]).trim();
    assert.equal(determineScope(changedMain, merged, true, git), "docs");
    assert.equal(determineScope(base, merged, false, git), "full");
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.match(path.basename(directory), /^keryx-ci-scope-/);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("aggregate gate rejects failed, cancelled, missing and unexpected skipped jobs", () => {
  const results = scope => Object.fromEntries(["scope", ...requiredJobs].map(name => [name, { result: scope === "docs" && name !== "checks" && name !== "scope" ? "skipped" : "success" }]));
  for (const scope of ["docs", "full"]) {
    assert.doesNotThrow(() => assertCiGate(scope, results(scope)));
    for (const name of ["scope", ...requiredJobs]) {
      for (const result of ["failure", "cancelled", "missing", scope === "full" || ["checks", "scope"].includes(name) ? "skipped" : "success"]) {
        const invalid = results(scope);
        if (result === "missing") delete invalid[name]; else invalid[name].result = result;
        assert.throws(() => assertCiGate(scope, invalid), `${scope} / ${name} / ${result}`);
      }
    }
  }
  assert.throws(() => assertCiGate("unknown", results("full")));
});

test("gate dependency inventory stays aligned with the workflow", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const gate = workflow.split("\n  build-and-test:\n")[1]?.split("\n  publish-release:\n")[0];
  assert(gate, "the stable build-and-test gate exists");
  assert.match(gate, /if: always\(\)/);
  assert(!gate.includes("concurrency:"), "the aggregate cannot hold a PR workflow lock");
  assert.match(gate, /if: cancelled\(\)\s+run: exit 1/);
  assert.match(gate, /needs: \[scope, checks, unit-tests, integration, browser-source, production\]/);
  for (const name of requiredJobs) assert(workflow.includes(`\n  ${name}:\n`), name);
});

test("production members keep independent cancellation and complete step selection", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const production = workflow.split("\n  production:\n")[1]?.split("\n  lint:\n")[0];
  assert(production);
  const [header, steps] = production.split("    steps:\n");
  assert.match(header, /timeout-minutes: 30\n/);
  assert.match(header, /fail-fast: false\n/);
  assert.match(header, /lane: \[routes, ui, product\]/);
  assert(header.includes("-production-${{ matrix.lane }}-"), "members cannot cancel or serialize each other");
  assert(header.includes("cancel-in-progress: ${{ github.event_name == 'pull_request' }}"));
  assert(!production.includes("continue-on-error:"));
  assert(!header.includes("max-parallel: 1"));
  const common = new Set(["actions/checkout@v4", "actions/setup-node@v4", "Pin project npm installer", "Install dependencies",
    "Browser runner APT setup tests (no system changes)", "Prepare official Ubuntu HTTPS mirrors for browser dependencies",
    "Install Chromium for unit and browser checks", "Build (Next.js)"]);
  const selected = { routes: 0, ui: 0, product: 0 }, artifacts = new Set(), seen = new Set();
  const product = new Set(["Product discovery, pricing and support (built, offline, no research or payment)",
    "Retain product and language preview phone/desktop screenshots"]);
  for (const block of steps.split(/(?=^      - (?:name|uses):)/m).filter(block => block.trim())) {
    const name = block.match(/^      - (?:name|uses): (.+)/)?.[1]; assert(name);
    assert(!seen.has(name), `${name} cannot run twice`); seen.add(name);
    const conditions = [...block.matchAll(/^        if: (.+)$/gm)].map(match => match[1]);
    if (common.has(name)) {
      assert.deepEqual(conditions, [], `${name} must prepare every isolated checkout`); common.delete(name); continue;
    }
    assert.equal(conditions.length, 1, `${name} must run in exactly one known member`);
    const owner = conditions[0].match(/^(?:always\(\) && )?matrix\.lane == '(routes|ui|product)'$/)?.[1];
    assert(owner, `${name} has an unknown or permissive selector`); selected[owner]++;
    if (owner === "product") assert(product.delete(name), `${name} must stay in its original member`);
    else assert(!product.has(name), `${name} must run only in the isolated product member`);
    if (block.includes("uses: actions/upload-artifact@v4")) {
      assert(conditions[0].startsWith("always() && "), `${name} must retain failure evidence`);
      const artifact = block.match(/^          name: (.+)$/m)?.[1]; assert(artifact);
      assert(!artifacts.has(artifact), `${artifact} cannot collide across members`); artifacts.add(artifact);
    }
  }
  assert.equal(common.size, 0, "all members retain every shared preparation step");
  assert.equal(product.size, 0, "the product check and its failure screenshots must both remain scheduled");
  assert.equal(selected.product, 2, "only the product check and its original artifact move");
  assert(selected.routes > 0 && selected.ui > 0);
});
