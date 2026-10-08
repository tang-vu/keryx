import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assertRunnerContext, browserAptPlan, prepareBrowserApt } from "./ci-browser-apt.mjs";

const context = { platform: "linux", arch: "x64", env: { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" } };
const original = {
  osRelease: 'ID=ubuntu\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\n',
  sources: "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-backports noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n",
  mirrors: "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n",
};

test("only GitHub-hosted Ubuntu Linux x64 is admitted before filesystem effects", () => {
  assert.doesNotThrow(() => assertRunnerContext(context));
  for (const invalid of [
    { platform: "win32" }, { arch: "arm64" },
    ...["GITHUB_ACTIONS", "RUNNER_ENVIRONMENT", "RUNNER_OS"].map(key => ({ env: { ...context.env, [key]: "unexpected" } })),
  ]) {
    let effects = 0;
    assert.throws(() => prepareBrowserApt({ ...context, ...invalid, read: () => { effects++; }, stat: () => { effects++; }, install: () => { effects++; } }), /GitHub-hosted/);
    assert.equal(effects, 0);
  }
});

test("refuses unknown OS, mirrors, source URI or pre-existing network configuration", () => {
  for (const invalid of [
    { osRelease: original.osRelease.replace("24.04", "26.04") },
    { osRelease: original.osRelease + "ID=ubuntu\n" },
    { mirrors: original.mirrors.replace("azure.archive.ubuntu.com", "example.test") },
    { sources: original.sources.replace("mirror+file:/etc/apt/apt-mirrors.txt", "https://example.test/ubuntu") },
    { sources: original.sources + "URIs: https://example.test/ubuntu\n" },
    { sources: original.sources.replace("\nSuites:", "\n https://example.test/ubuntu\nSuites:") },
    { sources: original.sources + "\nTypes: deb\nuris: https://example.test/ubuntu\nSuites: noble\n" },
    { network: 'Acquire::https::Verify-Peer "false";\n' },
  ]) assert.throws(() => browserAptPlan({ ...original, ...invalid }));
});

function fixture() {
  const files = new Map([
    ["/etc/os-release", original.osRelease],
    ["/etc/apt/sources.list.d/ubuntu.sources", original.sources],
    ["/etc/apt/apt-mirrors.txt", original.mirrors],
  ]);
  const writes = [];
  const missing = () => Object.assign(new Error("missing fixture file"), { code: "ENOENT" });
  return {
    files, writes,
    io: {
      ...context,
      read(path) { if (!files.has(path)) throw missing(); return files.get(path); },
      stat(path) { if (!files.has(path)) throw missing(); return { isFile: () => true, size: Buffer.byteLength(files.get(path)) }; },
      install(entry) { writes.push(entry); files.set(entry.path, entry.content); },
    },
  };
}

test("fixed runner files get HTTPS failover and bounded transport without changing source trust; repeat is safe", () => {
  const { io, files, writes } = fixture();
  prepareBrowserApt(io);
  assert.deepEqual(writes.map(entry => entry.path), ["/etc/apt/apt-mirrors.txt", "/etc/apt/apt.conf.d/99-keryx-ci-network"]);
  assert.match(files.get(writes[0].path), /^https:\/\/archive\.ubuntu\.com\/ubuntu\/\tpriority:1\nhttps:\/\/security\.ubuntu\.com\/ubuntu\/\tpriority:2\n$/);
  const options = files.get(writes[1].path).trim().split("\n");
  assert.deepEqual(options, ['Acquire::http::Timeout "60";', 'Acquire::https::Timeout "60";', 'Acquire::Retries "2";']);
  assert.equal(files.get("/etc/apt/sources.list.d/ubuntu.sources"), original.sources);
  assert.equal(files.size, 4);
  assert.doesNotThrow(() => prepareBrowserApt(io));
});

test("drift and symlink/oversize files refuse before any privileged write", () => {
  for (const kind of ["mirrors", "folded-uri", "lowercase-uri", "symlink", "oversize"]) {
    const { io, files, writes } = fixture();
    if (kind === "mirrors") files.set("/etc/apt/apt-mirrors.txt", "unknown\n");
    else if (kind === "folded-uri") files.set("/etc/apt/sources.list.d/ubuntu.sources", original.sources.replace("\nSuites:", "\n# retained comment\n https://example.test/ubuntu\nSuites:"));
    else if (kind === "lowercase-uri") files.set("/etc/apt/sources.list.d/ubuntu.sources", original.sources + "\nTypes: deb\nuris: https://example.test/ubuntu\nSuites: noble\n");
    else {
      const stat = io.stat;
      io.stat = path => path === "/etc/apt/apt-mirrors.txt" ? { isFile: () => kind !== "symlink", size: kind === "oversize" ? 16385 : 144 } : stat(path);
    }
    assert.throws(() => prepareBrowserApt(io));
    assert.equal(writes.length, 0);
  }
});

test("failed installation or mismatched readback stops before the next write", () => {
  for (const failure of ["install", "readback"]) {
    const { io } = fixture();
    let calls = 0;
    io.install = () => { calls++; if (failure === "install") throw new Error("fixture install failed"); };
    assert.throws(() => prepareBrowserApt(io), /fixture install failed|readback/);
    assert.equal(calls, 1);
  }
});

test("actual CLI refuses ordinary local execution", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./ci-browser-apt.mjs", import.meta.url))], {
    env: { ...process.env, GITHUB_ACTIONS: "false" }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitHub-hosted Linux x64 runner/);
});

test("both browser-dependency workflows exercise the helper before the unchanged real install", () => {
  for (const name of ["ci.yml", "browser-signing-originals-sqlite.yml"]) {
    const yaml = readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const setup = yaml.indexOf("run: node scripts/ci-browser-apt.mjs");
    assert(setup > 0);
    assert(yaml.indexOf("node --test scripts/ci-browser-apt.test.mjs") < setup);
    assert(yaml.indexOf("npx playwright install --with-deps chromium") > setup);
    assert.match(yaml, /- name: Install (?:Chromium for unit and browser checks|actual Chromium)\s+timeout-minutes: 5\s+run: npx playwright install --with-deps chromium/);
    assert(!yaml.includes("ubuntu-latest") || name === "ci.yml"); // release-only job may retain its image
    if (name === "ci.yml") {
      const boundaries = [...yaml.matchAll(/^  ([a-z][a-z0-9-]*):\n/gm)];
      const browserJobs = boundaries.map((match, index) => ({
        name: match[1],
        body: yaml.slice(match.index, boundaries[index + 1]?.index ?? yaml.length),
      })).filter(job => job.body.includes("npx playwright install --with-deps chromium"));
      assert.deepEqual(browserJobs.map(job => job.name), ["unit-tests", "browser-source", "production"]);
      for (const job of browserJobs) {
        assert.match(job.body, /runs-on: ubuntu-24\.04/);
        const check = job.body.indexOf("node --test scripts/ci-browser-apt.test.mjs");
        const prepare = job.body.indexOf("run: node scripts/ci-browser-apt.mjs");
        const install = job.body.indexOf("npx playwright install --with-deps chromium");
        assert(check > 0 && prepare > check && install > prepare, job.name);
        assert.match(job.body, /- name: Install Chromium for unit and browser checks\s+timeout-minutes: 5\s+run: npx playwright install --with-deps chromium/);
      }
    }
    else {
      assert.match(yaml, /os: \[ubuntu-24\.04, windows-latest\]/);
      assert.match(yaml, /timeout-minutes: 15/);
      assert.match(yaml, /if: runner\.os == 'Linux'\s+run: node scripts\/ci-browser-apt\.mjs/);
      assert(yaml.includes('"scripts/ci-browser-apt*"'));
    }
  }
});
