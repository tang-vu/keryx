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
const splitSources = [
  "# Main Ubuntu pockets\nTypes: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-backports\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n",
  "# Security stays on its official host\nTypes: deb\nURIs: http://security.ubuntu.com/ubuntu\nSuites: noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n",
].join("\n");

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

test("unexpected source diagnostics identify the host with bounded credential-free output", () => {
  const sources = original.sources.replace("mirror+file:/etc/apt/apt-mirrors.txt", "https://runner-user:secret-password@us-west-2.ec2.archive.ubuntu.com/ubuntu/?token=private-token#private-fragment");
  assert.throws(() => browserAptPlan({ ...original, sources }), error => {
    assert.match(error.message, /refusing to replace mirrors/);
    assert.match(error.message, /https:\/\/us-west-2\.ec2\.archive\.ubuntu\.com\/ubuntu\//);
    assert.doesNotMatch(error.message, /runner-user|secret-password|private-token|private-fragment/);
    return true;
  });
  for (const uri of ["not-a-uri", "file:/private-runner-path", `https://example.test/${"x".repeat(2000)}`]) {
    const { io, files, writes } = fixture();
    const copies = uri.length > 2000 ? 1 : 20;
    files.set("/etc/apt/sources.list.d/ubuntu.sources", `URIs: ${Array(copies).fill(uri).join(" ")}\n`.repeat(copies));
    assert.throws(() => prepareBrowserApt(io), error => {
      assert.match(error.message, /refusing to replace mirrors/);
      assert(error.message.length < 1200);
      assert.doesNotMatch(error.message, /private-runner-path/);
      return true;
    });
    assert.equal(writes.length, 0);
  }
});

test("fixed runner files get HTTPS failover and bounded transport without changing source trust; repeat is safe", () => {
  const { io, files, writes } = fixture();
  prepareBrowserApt(io);
  assert.deepEqual(writes.map(entry => entry.path), ["/etc/apt/apt-mirrors.txt", "/etc/apt/sources.list.d/ubuntu.sources", "/etc/apt/apt.conf.d/99-keryx-ci-network"]);
  assert.match(files.get(writes[0].path), /^https:\/\/archive\.ubuntu\.com\/ubuntu\/\tpriority:1\nhttps:\/\/security\.ubuntu\.com\/ubuntu\/\tpriority:2\n$/);
  const options = files.get(writes[2].path).trim().split("\n");
  assert.deepEqual(options, ['Acquire::http::Timeout "60";', 'Acquire::https::Timeout "60";', 'Acquire::Retries "2";']);
  assert.equal(files.get("/etc/apt/sources.list.d/ubuntu.sources"), original.sources + "By-Hash: force\n");
  assert.equal(files.size, 4);
  assert.doesNotThrow(() => prepareBrowserApt(io));
});

test("split Ubuntu sources preserve metadata and line endings while securing transport and immutable indexes", () => {
  for (const newline of ["\n", "\r\n"]) for (const slash of ["", "/"]) {
    const sources = splitSources.replace("http://security.ubuntu.com/ubuntu", `http://security.ubuntu.com/ubuntu${slash}`).replaceAll("\n", newline);
    const plan = browserAptPlan({ ...original, sources });
    assert.deepEqual(plan.map(entry => entry.path), ["/etc/apt/apt-mirrors.txt", "/etc/apt/sources.list.d/ubuntu.sources", "/etc/apt/apt.conf.d/99-keryx-ci-network"]);
    assert.equal(plan[1].content.replace(/^By-Hash: force\r?\n/gm, ""), sources.replace("http://security.ubuntu.com/ubuntu", "https://security.ubuntu.com/ubuntu"));
    assert.equal([...plan[1].content.matchAll(/^By-Hash: force\r?$/gm)].length, 2);
    assert.equal(plan[0].content, browserAptPlan(original)[0].content);
    assert.equal(plan[2].content, browserAptPlan(original)[2].content);
  }
});

test("split-source setup is idempotent, including already HTTPS security and optional official architectures", () => {
  const { io, files, writes } = fixture();
  const sources = splitSources.replaceAll("Types: deb\n", "Types: deb\nArchitectures: amd64 i386\n");
  files.set("/etc/apt/sources.list.d/ubuntu.sources", sources);
  prepareBrowserApt(io);
  assert.equal(writes.length, 3);
  const expected = sources.replace("http://security.ubuntu.com/ubuntu", "https://security.ubuntu.com/ubuntu")
    .replace("\n\n", "\nBy-Hash: force\n\n") + "By-Hash: force\n";
  assert.equal(files.get("/etc/apt/sources.list.d/ubuntu.sources"), expected);
  prepareBrowserApt(io);
  assert.equal(writes.length, 5);
  assert.equal(files.size, 4);
  assert.equal(files.get("/etc/apt/sources.list.d/ubuntu.sources"), expected);
  assert(!writes.slice(3).some(entry => entry.path.endsWith("ubuntu.sources")));
});

test("split-source host, suite, signature and extra-field drift refuses before any privileged write", () => {
  for (const sources of [
    splitSources.replace("http://security.ubuntu.com/ubuntu", "https://example.test/ubuntu"),
    ...["http://security.ubuntu.com/ubuntu?token=secret", "http://user:secret@security.ubuntu.com/ubuntu", "https://security.ubuntu.com:444/ubuntu", "https://security.ubuntu.com/other"].map(uri => splitSources.replace("http://security.ubuntu.com/ubuntu", uri)),
    splitSources.replace("Suites: noble-security", "Suites: noble"),
    splitSources.replace("Suites: noble-security", "Suites: noble-security noble-updates"),
    splitSources.replace("noble-backports", "resolute-backports"),
    splitSources.replaceAll("ubuntu-archive-keyring.gpg", "other-keyring.gpg"),
    splitSources + "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n",
    splitSources + "Trusted: yes\n",
    splitSources + 'Allow-Insecure: yes\n',
    splitSources.replace("Types: deb\n", "Types: deb deb-src\n"),
    splitSources.replace("Components: main restricted universe multiverse", "Components: main restricted universe multiverse extra"),
    splitSources.replace("URIs: http://security.ubuntu.com/ubuntu", "uris: http://security.ubuntu.com/ubuntu\n https://example.test/ubuntu"),
    splitSources.replace("URIs: http://security.ubuntu.com/ubuntu", "URIs: http://security.ubuntu.com/ubuntu\nURIs: http://security.ubuntu.com/ubuntu"),
    splitSources.replace("Types: deb\n", "Types: deb\nArchitectures: arm64\n"),
    splitSources.replace("mirror+file:/etc/apt/apt-mirrors.txt", "http://security.ubuntu.com/ubuntu"),
  ]) {
    const { io, files, writes } = fixture(); files.set("/etc/apt/sources.list.d/ubuntu.sources", sources);
    assert.throws(() => prepareBrowserApt(io), /refusing to replace mirrors/);
    assert.equal(writes.length, 0);
  }
});

test("split-source installation or readback failure never continues to network configuration", () => {
  for (const failure of ["install", "readback"]) {
    const { io, files, writes } = fixture(); files.set("/etc/apt/sources.list.d/ubuntu.sources", splitSources);
    const install = io.install;
    io.install = entry => {
      if (entry.path.endsWith("ubuntu.sources")) {
        writes.push(entry); if (failure === "install") throw new Error("fixture source install failed"); return;
      }
      install(entry);
    };
    assert.throws(() => prepareBrowserApt(io), /fixture source install failed|readback/);
    assert.equal(writes.length, 2);
    assert(!writes.some(entry => entry.path.endsWith("99-keryx-ci-network")));
  }
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

test("official Azure and Canonical regional EC2 mirror shapes retain the same fixed HTTPS destinations", () => {
  const destinations = browserAptPlan(original)[0].content;
  for (const primary of [
    "http://azure.archive.ubuntu.com/ubuntu/", "https://azure.archive.ubuntu.com/ubuntu/",
    "http://us-west-2.ec2.archive.ubuntu.com/ubuntu/", "https://us-east-1.ec2.archive.ubuntu.com/ubuntu/",
    "http://ap-south-1.ec2.archive.ubuntu.com/ubuntu/", "http://us-gov-west-1.ec2.archive.ubuntu.com/ubuntu/",
    "http://archive.ubuntu.com/ubuntu",
  ]) for (const newline of ["\n", "\r\n"]) for (const separator of ["\t", " "]) {
    const mirrors = original.mirrors.replace("http://azure.archive.ubuntu.com/ubuntu/", primary)
      .replaceAll("\t", separator).replaceAll("\n", newline);
    assert.equal(browserAptPlan({ ...original, mirrors })[0].content, destinations);
    assert.equal(browserAptPlan({ ...original, mirrors: mirrors.trimEnd() })[0].content, destinations);
  }
});

test("mirror host, path, credential, priority and extra-row drift refuses before privileged effects", () => {
  for (const mirrors of [
    ...[
      "https://example.test/ubuntu/", "http://us-west-2.ec2.archive.ubuntu.com.example.test/ubuntu/",
      "https://runner-user:secret-password@us-west-2.ec2.archive.ubuntu.com/ubuntu/",
      "https://us-west-2.ec2.archive.ubuntu.com/ubuntu/?token=private-token#private-fragment",
      "https://us-west-2.ec2.archive.ubuntu.com:444/ubuntu/", "https://archive.ubuntu.com/private-secret-path",
    ].map(uri => original.mirrors.replace("http://azure.archive.ubuntu.com/ubuntu/", uri)),
    original.mirrors.replace("priority:2", "priority:1"),
    original.mirrors.replace("priority:1", "priority:1 extra-private-option"),
    original.mirrors + "https://archive.ubuntu.com/ubuntu/\tpriority:3\n",
    original.mirrors.replace("\n", "\n\n"), "https://archive.ubuntu.com/ubuntu/\tpriority:1\n", "",
  ]) {
    const { io, files, writes } = fixture(); files.set("/etc/apt/apt-mirrors.txt", mirrors);
    assert.throws(() => prepareBrowserApt(io), error => {
      assert.match(error.message, /Unexpected Ubuntu runner mirror list; refusing/);
      assert(error.message.length < 1200);
      assert.doesNotMatch(error.message, /runner-user|secret-password|private-token|private-fragment|private-secret-path|extra-private-option/);
      return true;
    });
    assert.equal(writes.length, 0);
  }
});

test("immutable index policy is per validated Ubuntu stanza and never disables source authentication", () => {
  for (const sources of [original.sources, splitSources]) {
    const plan = browserAptPlan({ ...original, sources });
    const rewritten = plan.find(row => row.path.endsWith("ubuntu.sources")).content;
    assert.equal([...rewritten.matchAll(/^By-Hash: force$/gm)].length, sources === original.sources ? 1 : 2);
    assert.equal(rewritten.replace(/^By-Hash: force\n/gm, ""), sources.replace("http://security.ubuntu.com/ubuntu", "https://security.ubuntu.com/ubuntu"));
    assert.doesNotMatch(plan.find(row => row.path.endsWith("99-keryx-ci-network")).content, /By-Hash|Trusted|Allow-Insecure|Verify-Peer/);
    assert.doesNotMatch(rewritten, /Trusted|Allow-Insecure|Allow-Weak|Allow-Downgrade/);
    assert.equal([...rewritten.matchAll(/^Signed-By: \/usr\/share\/keyrings\/ubuntu-archive-keyring\.gpg$/gm)].length, sources === original.sources ? 1 : 2);
  }
});

test("immutable source policy preserves missing final newline and is idempotent", () => {
  for (const newline of ["\n", "\r\n"]) {
    const { io, files, writes } = fixture();
    const sources = original.sources.trimEnd().replaceAll("\n", newline);
    files.set("/etc/apt/sources.list.d/ubuntu.sources", sources);
    prepareBrowserApt(io);
    assert.equal(files.get("/etc/apt/sources.list.d/ubuntu.sources"), sources + newline + "By-Hash: force");
    const first = [...files];
    prepareBrowserApt(io);
    assert.deepEqual([...files], first);
    assert.equal(writes.length, 5);
    assert(!writes.slice(3).some(row => row.path.endsWith("ubuntu.sources")));
  }
});

test("combined source trust, suite and duplicate or downgraded hash-policy drift refuses before writes", () => {
  for (const sources of [
    original.sources.replace("ubuntu-archive-keyring.gpg", "other-keyring.gpg"),
    original.sources.replace("noble-backports", "other-backports"),
    original.sources.replace("noble-updates", "noble noble-updates"),
    original.sources.replace("Types: deb", "Types: deb deb-src"),
    original.sources.replace("Components: main restricted universe multiverse", "Components: main universe"),
    original.sources + "Trusted: yes\n", original.sources + "Allow-Insecure: yes\n",
    original.sources + "By-Hash: no\n", original.sources + "By-Hash: yes\n",
    original.sources + "By-Hash: force\nby-hash: force\n",
    splitSources + "By-Hash: no\n", splitSources + "By-Hash: force\nBy-Hash: force\n",
  ]) {
    const { io, files, writes } = fixture(); files.set("/etc/apt/sources.list.d/ubuntu.sources", sources);
    assert.throws(() => prepareBrowserApt(io), /refusing to replace mirrors/);
    assert.equal(writes.length, 0);
  }
});

test("existing owned immutable fields and folded metadata keep their exact bytes", () => {
  const sources = splitSources.replace("noble noble-updates noble-backports", "noble\n noble-updates noble-backports")
    .replaceAll("Types: deb\n", "# Existing comment\nTypes: deb\nby-hash: force\n").replace("http://security.ubuntu.com/ubuntu", "https://security.ubuntu.com/ubuntu");
  const { io, files, writes } = fixture(); files.set("/etc/apt/sources.list.d/ubuntu.sources", sources);
  prepareBrowserApt(io);
  assert.equal(files.get("/etc/apt/sources.list.d/ubuntu.sources"), sources);
  assert.equal(writes.length, 2);
});

test("successful setup reports original official mirror identity only after verified readback", () => {
  const { io, files } = fixture();
  files.set("/etc/apt/apt-mirrors.txt", original.mirrors.replace("azure.archive.ubuntu.com", "us-west-2.ec2.archive.ubuntu.com"));
  const result = prepareBrowserApt(io);
  assert.equal(result.format, "keryx-ci-browser-apt-setup-v1");
  assert.deepEqual(result.initialMirrorUris, { fields: 3, values: [
    ["http://us-west-2.ec2.archive.ubuntu.com/ubuntu/"],
    ["https://archive.ubuntu.com/ubuntu/"], ["https://security.ubuntu.com/ubuntu/"],
  ] });
  assert.equal(result.immutableUbuntuIndexes, true);
  assert.equal(result.configurationReadbackVerified, true);
  assert.equal(files.get("/etc/apt/sources.list.d/ubuntu.sources"), original.sources + "By-Hash: force\n");
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
      const boundaries = [...yaml.matchAll(/^  ([A-Za-z_][A-Za-z0-9_-]*):\n/gm)];
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
