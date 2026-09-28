/** Synthetic, private differential acceptance for the read-only Rust Operator engine. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdtemp, mkdir, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { build, version as esbuildVersion } from "esbuild";
import { a2aResearchPackage } from "../lib/a2a/research-package-definition.ts";
import { createBuyerJournal, readBuyerJournal } from "../lib/buyer/journal.ts";
import { buyerJobId } from "../lib/buyer/policy.ts";
import { authorizationWithNonce, BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC } from "../lib/buyer/protocol.ts";
import { createOperatorTask, formatOperatorBrief, operatorTaskStatus, readOperatorResult, resumeOperatorTask } from "../lib/operator/task.ts";
import { RESEARCH_RECEIPT_CANONICALIZATION, RESEARCH_RECEIPT_SCHEMA } from "../lib/research-receipt-types.ts";
import { researchReceiptDigest, sha256 } from "../lib/research-receipt-integrity.ts";
import { canonicalJson } from "../lib/canonical-json.ts";
import { resumeResearch } from "../lib/buyer/client.ts";
import { padJsonFileToByteLength } from "./rust-file-boundary-fixtures.mts";
import { defaultCitation, resultFixtures, type ResultFixture } from "./rust-result-acceptance-fixtures.mts";
import { invalidV1Files, truncatedJson, unsupportedVersion } from "./rust-invalid-v1-fixtures.mts";

const repo = resolve(import.meta.dirname, "..");
const tsxLoader = import.meta.resolve("tsx");
const offlineGuard = pathToFileURL(join(repo, "scripts", "rust-offline-fallback-guard.mjs")).href;
const rustExe = resolve(process.env.KERYX_RUST_ENGINE ?? join(repo, "rust", "target", "release", process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine"));
const payer = `0x${"1".repeat(40)}`;
const payee = `0x${"2".repeat(40)}`;
const noEnv = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" };
const benchmarkBundle = process.argv.includes("--bundled-baseline");
let bundledOperator: string | undefined;
let parityChecks = 0;
let refusalChecks = 0;
let incompatibilityChecks = 0;
let offlineFallbackChecks = 0;
let offlineGuardChecks = 0;
let exportBoundaryChecks = 0;
let exportSkippedChecks = 0;

function run(kind: "ts" | "rust" | "bundle", command: "status" | "result" | "brief", state: string, file?: string,
  binary = rustExe, environment = noEnv, workingDirectory = repo, preloads: string[] = []) {
  const argv = kind === "ts"
    ? [...preloads.flatMap(preload => ["--import", preload]), "--import", tsxLoader, "--no-warnings",
      join(repo, "scripts", "operator.mts"), command, "--state", state, ...(file ? ["--file", file] : [])]
    : kind === "bundle"
      ? [bundledOperator!, command, "--state", state, ...(file ? ["--file", file] : [])]
      : [command, "--state", state, ...(file ? ["--file", file] : [])];
  const start = performance.now();
  const p = spawnSync(kind === "rust" ? binary : process.execPath, argv, {
    cwd: workingDirectory, env: environment, encoding: "utf8", maxBuffer: 4_000_000, windowsHide: true,
  });
  if (p.error) throw p.error;
  return { code: p.status, stdout: p.stdout, stderr: p.stderr, ms: performance.now() - start };
}

async function treeDigest(directory: string): Promise<string> {
  const entries: string[] = [];
  async function walk(path: string, relative: string) {
    for (const name of (await readdir(path)).sort()) {
      const child = join(path, name);
      const key = join(relative, name);
      const kind = await lstat(child);
      if (kind.isSymbolicLink()) entries.push(`link ${key} ${await readlink(child)}`);
      else if (kind.isDirectory()) { entries.push(`dir ${key}`); await walk(child, key); }
      else if (kind.isFile()) entries.push(`file ${key} ${createHash("sha256").update(await readFile(child)).digest("hex")}`);
      else entries.push(`other ${key}`);
    }
  }
  await walk(directory, "");
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function fresh(root: string, label: string, mode: "quick" | "deep" = "quick", question = "What is Arc doing?") {
  const state = join(root, label);
  const request = { question, budget: 0.03, researchMode: mode, packageVersion: "1.0.0", responseMode: "async" } as const;
  await createOperatorTask(state, { request, payee, maxTotalMicros: "100000" });
  return { state, request };
}

async function journal(state: string, request: ReturnType<typeof fresh> extends Promise<infer T> ? T["request"] : never) {
  const requirement = { scheme: "exact" as const, network: BUYER_NETWORK as "eip155:5042002", asset: BUYER_USDC,
    amount: "50000", payTo: payee, maxTimeoutSeconds: 604860,
    extra: { name: "GatewayWalletBatched" as const, version: "1" as const, verifyingContract: BUYER_GATEWAY } };
  const authorization = authorizationWithNonce(payer, requirement, `0x${"a".repeat(64)}`);
  await createBuyerJournal(join(state, "buyer"), { schema: "keryx-buyer-intent-v1", request,
    requirement, authorization, queryId: buyerJobId(authorization) });
}

/** Uses the production GET verifier and snapshot writer against synthetic Response objects only. */
async function complete(state: string, request: Awaited<ReturnType<typeof fresh>>["request"], answer: string,
  extras: Record<string, unknown> = {}, fixture?: ResultFixture) {
  // The production snapshot writer requires exact realpath equality. Windows CI
  // TEMP may use an alias/casing that is not the path returned by realpath.
  assert.equal(await realpath(state), resolve(state), "fixture task path is not canonical for the TypeScript snapshot writer");
  assert.equal(await realpath(join(state, "buyer")), join(resolve(state), "buyer"),
    "fixture buyer path is not canonical for the TypeScript snapshot writer");
  for (const boundField of ["schema", "dispatch", "citations", "settlement"]) {
    assert.ok(!Object.hasOwn(extras, boundField), `receipt extras cannot replace ${boundField}`);
  }
  const intent = await readBuyerJournal(join(state, "buyer"));
  const job = { queryId: intent.queryId, status: "completed", answer, researchPackage: a2aResearchPackage(request.researchMode),
    pricing: { totalPriceUsdc: 0.05, serviceFeeUsdc: 0.02, creatorBudgetUsdc: 0.03,
      settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.005, unusedCreatorReserveUsdc: 0.015,
      ...fixture?.pricing }, ...fixture?.jobFields };
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA,
    dispatch: { id: intent.queryId, question: request.question, answer, answerSha256: sha256(answer),
      budgetUsdc: request.budget, researchMode: request.researchMode },
    ...(fixture?.citations === "omit" ? {} : { citations: fixture?.citations ?? [defaultCitation] }),
    settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0.01,
      pendingCreatorUsdc: 0.005, simulatedCreatorUsdc: 0 }, ...extras };
  const digest = researchReceiptDigest(payload);
  assert.equal(digest, sha256(canonicalJson(payload)));
  const receipt = { payload, integrity: { algorithm: "sha256", canonicalization: RESEARCH_RECEIPT_CANONICALIZATION,
    scope: "payload", digest } };
  let calls = 0;
  const http = async () => ++calls === 1 ? Response.json(job)
    : Response.json(receipt, { headers: { "x-keryx-receipt-digest": digest } });
  const result = await resumeOperatorTask(state, buyer => resumeResearch(buyer, http as typeof fetch));
  assert.equal(calls, 2);
  assert.equal(result.localResult.state, "saved");
  return digest;
}

async function resultCorpus(root: string) {
  for (const fixture of resultFixtures) {
    const state = await fresh(root, `result-${fixture.label.replaceAll(" ", "-")}`);
    await journal(state.state, state.request);
    await complete(state.state, state.request, `Optional v1 ${fixture.label} [1]`, {}, fixture);
    const snapshot = JSON.parse(await readFile(join(state.state, "result.json"), "utf8"));
    assert.equal(snapshot.job.pricing.unusedCreatorReserveUsdc,
      fixture.pricing ? fixture.pricing.unusedCreatorReserveUsdc : 0.015, `${fixture.label}: writer reserve field`);
    assert.equal(snapshot.job.pricing.accountingComplete, fixture.pricing?.accountingComplete,
      `${fixture.label}: writer optional accounting field`);
    for (const field of ["serviceStatus", "serviceReceipt", "claimCoverage", "evidence", "message", "error"] as const) {
      assert.deepEqual(snapshot.job[field], fixture.jobFields?.[field], `${fixture.label}: writer ${field}`);
    }
    assert.deepEqual((await readOperatorResult(state.state))?.citations, fixture.expectedCitations,
      `${fixture.label}: TypeScript receipt citation selection`);
    await parity(state.state, "result", fixture.label);
    await briefParity(state.state, root, fixture.label);
  }
}

async function offlineFallback(state: string, root: string, label: string) {
  const before = await treeDigest(state);
  const disabledNative = join(root, "candidate-disabled-native.exe");
  await assert.rejects(stat(disabledNative), { code: "ENOENT" }, `${label}: native candidate is present`);
  const unavailable = spawnSync(disabledNative, ["status", "--state", state],
    { cwd: repo, env: noEnv, encoding: "utf8", windowsHide: true });
  assert.equal((unavailable.error as NodeJS.ErrnoException | undefined)?.code, "ENOENT",
    `${label}: disabled candidate unexpectedly launched`);
  const environment = { ...noEnv, KERYX_RUST_ENGINE: disabledNative, KERYX_FORCE_OFFLINE: "1" };
  const expected = await readOperatorResult(state);
  assert(expected, `${label}: fallback needs a saved result`);
  // Each invocation starts a new guarded Node process. The second pass proves
  // the original v1 directory remains readable after the first process exits.
  for (let restart = 0; restart < 2; restart++) {
    for (const command of ["status", "result"] as const) {
      const cli = run("ts", command, state, undefined, rustExe, environment, repo, [offlineGuard]);
      assert.equal(cli.code, 0, `${label}: offline ${command} refused: ${cli.stderr}`);
      assert.match(cli.stderr, /keryx offline fallback guard active/, `${label}: missing network guard`);
      assert.deepEqual(JSON.parse(cli.stdout), command === "status"
        ? await operatorTaskStatus(state) : expected, `${label}: offline ${command} changed result`);
      offlineFallbackChecks++;
    }
    const file = join(root, `${label}-offline-brief-${restart}.md`);
    const brief = run("ts", "brief", state, file, rustExe, environment, repo, [offlineGuard]);
    assert.equal(brief.code, 0, `${label}: offline brief refused: ${brief.stderr}`);
    assert.match(brief.stderr, /keryx offline fallback guard active/, `${label}: missing network guard`);
    assert.deepEqual(JSON.parse(brief.stdout), { saved: resolve(file), private: true }, `${label}: offline brief response`);
    assert.deepEqual(await readFile(file), Buffer.from(formatOperatorBrief(expected), "utf8"),
      `${label}: offline brief changed contents`);
    assert.equal(await treeDigest(state), before, `${label}: offline fallback changed source tree`);
    offlineFallbackChecks++;
  }
}

function assertOfflineGuard() {
  const probe = `
    import assert from "node:assert/strict";
    import { request as httpRequest } from "node:http";
    import { request as httpsRequest } from "node:https";
    import { Socket } from "node:net";
    import { spawnSync as nestedSpawn } from "node:child_process";
    for (const action of [
      () => fetch("http://127.0.0.1:1"),
      () => httpRequest("http://127.0.0.1:1"),
      () => httpsRequest("https://127.0.0.1:1"),
      () => new Socket().connect(1, "127.0.0.1"),
      () => nestedSpawn(process.execPath, ["-e", ""]),
    ]) assert.throws(action, /offline acceptance forbids network or child process access/);
    console.log("offline guard denied all five probes before connection or process launch");
  `;
  const child = spawnSync(process.execPath, ["--import", offlineGuard, "--input-type=module", "-e", probe],
    { cwd: repo, env: noEnv, encoding: "utf8", windowsHide: true });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, `offline guard self-check failed: ${child.stderr}`);
  assert.match(child.stderr, /keryx offline fallback guard active/);
  assert.match(child.stdout, /offline guard denied all five probes/);
  offlineGuardChecks++;
}

function withoutProtocol(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { engineProtocol: _protocol, ...rest } = value as Record<string, unknown>;
  return rest;
}

async function parity(state: string, command: "status" | "result", label: string) {
  const before = await treeDigest(state);
  const expected = command === "status" ? await operatorTaskStatus(state) : await readOperatorResult(state);
  const ts = run("ts", command, state);
  const rust = run("rust", command, state);
  assert.equal(ts.code, 0, `${label}: TypeScript ${command} refused: ${ts.stderr}`);
  assert.equal(rust.code, 0, `${label}: Rust ${command} refused: ${rust.stderr}`);
  assert.deepEqual(JSON.parse(ts.stdout), expected, `${label}: production TS CLI differs from helper`);
  assert.deepEqual(withoutProtocol(JSON.parse(rust.stdout)), expected, `${label}: Rust ${command} parity`);
  assert.equal(await treeDigest(state), before, `${label}: ${command} modified source tree`);
  parityChecks++;
  return { ts: ts.ms, rust: rust.ms };
}

async function briefParity(state: string, root: string, label: string) {
  const result = await readOperatorResult(state);
  assert(result);
  const before = await treeDigest(state);
  const tsFile = join(root, `${label}-ts.md`);
  const rustFile = join(root, `${label}-rust.md`);
  const ts = run("ts", "brief", state, tsFile);
  const rust = run("rust", "brief", state, rustFile);
  assert.equal(ts.code, 0, `${label}: TypeScript brief refused: ${ts.stderr}`);
  assert.equal(rust.code, 0, `${label}: Rust brief refused: ${rust.stderr}`);
  assert.deepEqual(JSON.parse(ts.stdout), { saved: resolve(tsFile), private: true }, `${label}: TypeScript export response`);
  assert.deepEqual(JSON.parse(rust.stdout), { saved: resolve(rustFile), private: true }, `${label}: Rust export response`);
  assert.equal(await readFile(tsFile, "utf8"), formatOperatorBrief(result), `${label}: TS brief`);
  assert.equal(await readFile(rustFile, "utf8"), formatOperatorBrief(result), `${label}: Rust brief`);
  const stdoutOnly = run("rust", "brief", state);
  assert.equal(stdoutOnly.code, 0, `${label}: Rust stdout brief refused: ${stdoutOnly.stderr}`);
  assert.equal(stdoutOnly.stdout, `${formatOperatorBrief(result)}\n`, `${label}: Rust stdout brief extension`);
  assert.equal(await treeDigest(state), before, `${label}: brief modified source tree`);
  const overwrite = run("rust", "brief", state, rustFile);
  assert.notEqual(overwrite.code, 0, `${label}: Rust overwrote existing export`);
  assert.equal(await readFile(rustFile, "utf8"), formatOperatorBrief(result));
  parityChecks++;
  return { ts: ts.ms, rust: rust.ms };
}

async function briefPathParity(state: string, root: string) {
  const before = await treeDigest(state);
  const expectedBrief = formatOperatorBrief((await readOperatorResult(state))!);
  const linkedParent = join(root, "export-linked-parent");
  const foreignParent = join(root, "export-foreign-parent", "child");
  await mkdir(foreignParent, { recursive: true });
  await symlink(foreignParent, linkedParent, process.platform === "win32" ? "junction" : "dir");
  const absolute = join(root, "absolute brief.md");
  const cases = [
    { label: "relative path", file: "relative brief.md" },
    { label: "relative dot segments and missing intermediate directory", file: `.${sep}missing${sep}..${sep}dot brief.md` },
    { label: "spaces and Unicode", file: `.${sep}missing${sep}..${sep}café 😀 brief.md` },
    { label: "absolute path", file: absolute },
    { label: "absolute dot segments", file: `${root}${sep}missing${sep}..${sep}absolute dot brief.md` },
    { label: "linked parent followed by dot dot", file: `export-linked-parent${sep}..${sep}lexical target.md` },
    ...(process.platform === "win32" ? [
      { label: "drive-relative path", file: `${root.slice(0, 2)}drive relative brief.md` },
      { label: "drive-rooted path", file: `${root.slice(2)}${sep}..${sep}${root.split(sep).at(-1)}${sep}drive rooted brief.md` },
    ] : []),
  ];
  for (const { label, file } of cases) {
    const expectedPath = resolve(root, file);
    const ts = run("ts", "brief", state, file, rustExe, noEnv, root);
    assert.equal(ts.code, 0, `${label}: TypeScript brief refused: ${ts.stderr}`);
    assert.deepEqual(JSON.parse(ts.stdout), { saved: expectedPath, private: true }, `${label}: TypeScript export response`);
    assert.equal(await readFile(expectedPath, "utf8"), expectedBrief, `${label}: TypeScript brief content`);
    await rm(expectedPath);
    const rust = run("rust", "brief", state, file, rustExe, noEnv, root);
    assert.equal(rust.code, ts.code, `${label}: Rust exit differs: ${rust.stderr}`);
    assert.deepEqual(JSON.parse(rust.stdout), JSON.parse(ts.stdout), `${label}: exact Rust export response`);
    assert.equal(await readFile(expectedPath, "utf8"), expectedBrief, `${label}: Rust brief content`);
    const prior = await readFile(expectedPath);
    for (const kind of ["ts", "rust"] as const) {
      const overwrite = run(kind, "brief", state, file, rustExe, noEnv, root);
      assert.notEqual(overwrite.code, 0, `${label}: ${kind} overwrote an existing export`);
      assert.equal(overwrite.stdout, "", `${label}: ${kind} emitted success after refusal`);
      assert.deepEqual(await readFile(expectedPath), prior, `${label}: ${kind} changed existing export`);
    }
    refusalChecks++;
    assert.equal(await treeDigest(state), before, `${label}: export modified source tree`);
    parityChecks++;
  }
}

async function statePathParity(state: string, root: string) {
  const before = await treeDigest(state);
  const name = basename(state);
  const cases = [
    { label: "relative task path", path: name },
    ...(process.platform === "win32" ? [{ label: "drive-relative task path", path: `${root.slice(0, 2)}${name}` }] : []),
  ];
  for (const { label, path } of cases) {
    for (const command of ["status", "result"] as const) {
      const ts = run("ts", command, path, undefined, rustExe, noEnv, root);
      const rust = run("rust", command, path, undefined, rustExe, noEnv, root);
      assert.equal(ts.code, 0, `${label}: TypeScript ${command} refused: ${ts.stderr}`);
      assert.equal(rust.code, ts.code, `${label}: Rust ${command} exit differs: ${rust.stderr}`);
      assert.deepEqual(JSON.parse(ts.stdout), command === "status"
        ? await operatorTaskStatus(state) : await readOperatorResult(state), `${label}: TypeScript ${command} response`);
      assert.deepEqual(withoutProtocol(JSON.parse(rust.stdout)), JSON.parse(ts.stdout),
        `${label}: Rust ${command} response`);
      parityChecks++;
    }
    assert.equal(await treeDigest(state), before, `${label}: task path read modified source tree`);
  }
}

async function refusal(state: string, command: "status" | "result", label: string) {
  const before = await treeDigest(state);
  const ts = run("ts", command, state);
  const rust = run("rust", command, state);
  assert.notEqual(ts.code, 0, `${label}: TypeScript accepted malformed input`);
  assert.notEqual(rust.code, 0, `${label}: Rust accepted malformed input`);
  assert.equal(ts.stdout, "", `${label}: TypeScript emitted partial success output`);
  assert.equal(rust.stdout, "", `${label}: Rust emitted partial success output`);
  assert.equal(await treeDigest(state), before, `${label}: refusal modified source tree`);
  refusalChecks++;
}

async function exportBoundaryCases(state: string, root: string) {
  const before = await treeDigest(state);
  const brief = formatOperatorBrief((await readOperatorResult(state))!);
  const noStaging = async (parent: string, label: string) => {
    assert.deepEqual((await readdir(parent)).filter(name => name.startsWith(".keryx-brief-")), [],
      `${label}: staging file remained`);
  };
  const refused = async (file: string, label: string) => {
    const ts = run("ts", "brief", state, file);
    const rust = run("rust", "brief", state, file);
    assert.notEqual(ts.code, 0, `${label}: TypeScript accepted invalid export target`);
    assert.equal(rust.code, ts.code, `${label}: Rust exit state differs: ${rust.stderr}`);
    assert.equal(ts.stdout, "", `${label}: TypeScript emitted success response`);
    assert.equal(rust.stdout, "", `${label}: Rust emitted success response`);
    assert.equal(await treeDigest(state), before, `${label}: refusal changed source task`);
    exportBoundaryChecks++;
  };

  const absentParent = join(root, "absent-export-parent");
  const absentFile = join(absentParent, "brief.md");
  await refused(absentFile, "missing export parent");
  await assert.rejects(stat(absentParent), { code: "ENOENT" });
  await assert.rejects(stat(absentFile), { code: "ENOENT" });
  await noStaging(root, "missing export parent");

  const directoryTarget = join(root, "existing-export-directory");
  await mkdir(directoryTarget);
  await refused(directoryTarget, "existing directory as export target");
  assert.ok((await stat(directoryTarget)).isDirectory());
  assert.deepEqual(await readdir(directoryTarget), []);
  await noStaging(root, "directory target");

  const symlinkSource = join(root, "existing-link-source.md");
  const symlinkTarget = join(root, "existing-export-link.md");
  await writeFile(symlinkSource, "preserve existing linked contents");
  let linkedTargetCreated = false;
  try {
    await symlink(symlinkSource, symlinkTarget, "file");
    linkedTargetCreated = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    console.error("Existing file-symlink export fixture skipped: host denied symlink creation (EPERM)");
    exportSkippedChecks++;
  }
  if (linkedTargetCreated) {
    const targetBefore = await readFile(symlinkSource);
    const linkBefore = await readlink(symlinkTarget);
    await refused(symlinkTarget, "existing symlink as export target");
    assert.ok((await lstat(symlinkTarget)).isSymbolicLink());
    assert.equal(await readlink(symlinkTarget), linkBefore);
    assert.deepEqual(await readFile(symlinkSource), targetBefore);
    await noStaging(root, "symlink target");
  }

  const actualParent = join(root, "export-actual-parent");
  const linkedParent = join(root, "export-direct-linked-parent");
  await mkdir(actualParent);
  await symlink(actualParent, linkedParent, process.platform === "win32" ? "junction" : "dir");
  const linkedFile = join(linkedParent, "brief via linked parent.md");
  const expected = { saved: resolve(linkedFile), private: true };
  const ts = run("ts", "brief", state, linkedFile);
  assert.equal(ts.code, 0, `linked output parent: TypeScript refused: ${ts.stderr}`);
  assert.deepEqual(JSON.parse(ts.stdout), expected);
  assert.equal(await readFile(linkedFile, "utf8"), brief);
  await rm(linkedFile);
  const rust = run("rust", "brief", state, linkedFile);
  assert.equal(rust.code, ts.code, `linked output parent: Rust refused: ${rust.stderr}`);
  assert.deepEqual(JSON.parse(rust.stdout), JSON.parse(ts.stdout));
  assert.equal(await readFile(linkedFile, "utf8"), brief);
  await noStaging(actualParent, "linked output parent");
  assert.equal(await treeDigest(state), before, "linked output parent changed source task");
  console.error(`Direct linked output parent ${process.platform === "win32" ? "junction" : "symlink"} exercised successfully`);
  exportBoundaryChecks++;
}

async function malformedV1Corpus(root: string) {
  const fixture = await fresh(root, "malformed-v1-baseline");
  await journal(fixture.state, fixture.request);
  await complete(fixture.state, fixture.request, "Stable completed v1 answer [1]");
  const snapshot = JSON.parse(await readFile(join(fixture.state, "result.json"), "utf8"));
  const baseline = await treeDigest(fixture.state);
  for (const entry of invalidV1Files) {
    const file = join(fixture.state, entry.file === "receipt" ? join("buyer", snapshot.receiptFile) : entry.file);
    const original = await readFile(file);
    for (const [kind, mutate] of [
      ["unsupported version", (text: string) => unsupportedVersion(text, entry.versionPath)],
      ["truncated JSON", truncatedJson],
    ] as const) {
      try {
        await writeFile(file, mutate(original.toString("utf8")));
        await refusal(fixture.state, entry.command, `${entry.label}: ${kind}`);
      } finally { await writeFile(file, original); }
      assert.equal(await treeDigest(fixture.state), baseline, `${entry.label}: restore changed baseline`);
    }
  }

  // Keep the duplicated request value consistent so the version check, rather
  // than the task/request equality check, is the reason to refuse this input.
  const taskPath = join(fixture.state, "task.json");
  const requestPath = join(fixture.state, "request.json");
  const originalTask = await readFile(taskPath);
  const originalRequest = await readFile(requestPath);
  const taskWithUnsupportedRequest = JSON.parse(originalTask.toString("utf8"));
  taskWithUnsupportedRequest.request.packageVersion = "unsupported-v2";
  try {
    await writeFile(taskPath, JSON.stringify(taskWithUnsupportedRequest));
    await writeFile(requestPath, unsupportedVersion(originalRequest.toString("utf8"), ["packageVersion"]));
    await refusal(fixture.state, "status", "consistent unsupported request package version");
  } finally {
    await writeFile(taskPath, originalTask);
    await writeFile(requestPath, originalRequest);
  }
  assert.equal(await treeDigest(fixture.state), baseline, "consistent request version restore changed baseline");

  // Rebind the snapshot to a newly hashed wrong-schema receipt, so refusal
  // cannot be explained merely by a stale digest or filename.
  const snapshotPath = join(fixture.state, "result.json");
  const originalSnapshot = await readFile(snapshotPath);
  const receiptPath = join(fixture.state, "buyer", snapshot.receiptFile);
  const wrongSchemaReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
  wrongSchemaReceipt.payload.schema = "unsupported-v2";
  const wrongDigest = researchReceiptDigest(wrongSchemaReceipt.payload);
  wrongSchemaReceipt.integrity.digest = wrongDigest;
  const wrongReceiptName = `receipt-${wrongDigest.slice(7)}.json`;
  const wrongReceiptPath = join(fixture.state, "buyer", wrongReceiptName);
  assert.notEqual(wrongReceiptPath, receiptPath);
  try {
    await writeFile(wrongReceiptPath, JSON.stringify(wrongSchemaReceipt));
    await writeFile(snapshotPath, JSON.stringify({ ...snapshot, receiptDigest: wrongDigest, receiptFile: wrongReceiptName }));
    await refusal(fixture.state, "result", "internally consistent unsupported receipt schema");
  } finally {
    await writeFile(snapshotPath, originalSnapshot);
    await rm(wrongReceiptPath, { force: true });
  }
  assert.equal(await treeDigest(fixture.state), baseline, "consistent receipt version restore changed baseline");
  await parity(fixture.state, "status", "restored malformed-input baseline");
  await parity(fixture.state, "result", "restored malformed-input baseline");
}

async function fileBoundaryParity(root: string) {
  const files = [
    { label: "task", name: "task.json", limit: 8_192, command: "status" },
    { label: "request", name: "request.json", limit: 8_192, command: "status" },
    { label: "buyer intent", name: join("buyer", "intent.json"), limit: 65_536, command: "status" },
    { label: "observation", name: "last-observation.json", limit: 8_192, command: "status" },
    { label: "saved result", name: "result.json", limit: 150_000, command: "result" },
    { label: "archived receipt", name: "receipt", limit: 2_000_000, command: "result" },
  ] as const;
  for (const { label, name, limit, command } of files) {
    const fixture = await fresh(root, `bound-${label.replaceAll(" ", "-")}`, "quick", "Boundary café 😀?");
    await journal(fixture.state, fixture.request);
    await complete(fixture.state, fixture.request, "Boundary answer café 😀 [1]");
    const receiptName = name === "receipt"
      ? JSON.parse(await readFile(join(fixture.state, "result.json"), "utf8")).receiptFile as string
      : undefined;
    const file = join(fixture.state, name === "receipt" ? join("buyer", receiptName!) : name);
    await padJsonFileToByteLength(file, limit);
    assert.equal((await stat(file)).size, limit, `${label}: exact byte limit fixture`);
    await parity(fixture.state, command, `${label} exactly ${limit} bytes`);
    await padJsonFileToByteLength(file, limit + 1);
    assert.equal((await stat(file)).size, limit + 1, `${label}: over-limit fixture`);
    await refusal(fixture.state, command, `${label} ${limit + 1} bytes`);
  }
}

const surrogateFallback = "This Rust candidate cannot represent unpaired UTF-16 surrogates. If this is a TypeScript-readable v1 directory, use the TypeScript Operator status/result/brief commands on the original directory. Do not rewrite files.";

async function surrogateRefusal(state: string, command: "status" | "result" | "brief", label: string, root: string) {
  const before = await treeDigest(state);
  const file = command === "brief" ? join(root, `${label}-rust-refused.md`) : undefined;
  const tsFile = command === "brief" ? join(root, `${label}-ts-readable.md`) : undefined;
  const ts = run("ts", command, state, tsFile);
  const rust = run("rust", command, state, file);
  assert.equal(ts.code, 0, `${label}: TypeScript must read this v1 directory: ${ts.stderr}`);
  if (command === "result") {
    assert.equal(JSON.parse(ts.stdout).answer, (await readOperatorResult(state))?.answer,
      `${label}: TypeScript result changed the saved answer`);
  }
  if (tsFile) {
    const result = await readOperatorResult(state);
    assert(result);
    assert.deepEqual(await readFile(tsFile), Buffer.from(formatOperatorBrief(result), "utf8"),
      `${label}: TypeScript brief bytes differ from its UTF-8 encoding`);
  }
  assert.notEqual(rust.code, 0, `${label}: Rust unexpectedly accepted unpaired UTF-16`);
  assert.equal(rust.stdout, "", `${label}: Rust emitted partial output`);
  assert.match(rust.stderr, /invalid or unsupported local JSON:/, `${label}: missing parse diagnostic`);
  assert.ok(rust.stderr.includes(surrogateFallback), `${label}: missing actionable TypeScript fallback`);
  if (file) await assert.rejects(stat(file), { code: "ENOENT" }, `${label}: Rust created a brief after refusal`);
  assert.equal(await treeDigest(state), before, `${label}: refusal modified source tree`);
  incompatibilityChecks++;
}

async function insertOverwrittenString(path: string, field: string, escapedValue: string) {
  const original = await readFile(path, "utf8");
  const needle = `"${field}":`;
  assert.ok(original.includes(needle), `${path}: missing ${field}`);
  // JSON.parse keeps the final occurrence. This preserves the TypeScript view
  // while exercising the Rust parser on a preceding UTF-16-only string.
  await writeFile(path, original.replace(needle, `${needle}"${escapedValue}", ${needle}`));
}

async function main() {
  await stat(rustExe).catch(() => { throw new Error(`Build release Rust binary first: ${rustExe}`); });
  const root = await realpath(await mkdtemp(join(tmpdir(), "keryx-rust-parity-")));
  try {
    const quick = await fresh(root, "quick");
    await parity(quick.state, "status", "ready quick");
    await journal(quick.state, quick.request);
    await parity(quick.state, "status", "journaled quick");
    const digest = await complete(quick.state, quick.request, "Arc answer [1]\r\nSecond line * <literal>", {
      canonicalProbe: { "\uE000": 1e-7, "😀": 0.000001, a: "naïve \u2028 café" },
    });
    assert.equal((await readOperatorResult(quick.state))?.receiptDigest, digest);
    await parity(quick.state, "status", "completed quick");
    await parity(quick.state, "result", "completed quick");
    await briefParity(quick.state, root, "quick");
    await briefPathParity(quick.state, root);
    await exportBoundaryCases(quick.state, root);
    await statePathParity(quick.state, root);
    await fileBoundaryParity(root);
    await resultCorpus(root);
    await malformedV1Corpus(root);
    assertOfflineGuard();
    await offlineFallback(quick.state, root, "valid-v1");

    const deep = await fresh(root, "deep", "deep", "Việt Nam nghiên cứu Arc — nguồn nào? 😀");
    await journal(deep.state, deep.request);
    await complete(deep.state, deep.request, "# Answer with café & [1]", { probe: { negativeZero: -0, exp: 1e21 } });
    await parity(deep.state, "status", "completed deep Unicode");
    await parity(deep.state, "result", "completed deep Unicode");
    await briefParity(deep.state, root, "deep");

    const lexical = await fresh(root, "numeric-lexical");
    await journal(lexical.state, lexical.request);
    await complete(lexical.state, lexical.request, "Numeric lexical parity");
    const lexicalIntentFile = join(lexical.state, "buyer", "intent.json");
    const lexicalIntent = (await readFile(lexicalIntentFile, "utf8"))
      .replace('"maxTimeoutSeconds": 604860', '"maxTimeoutSeconds": 604860.0');
    assert.match(lexicalIntent, /"maxTimeoutSeconds": 604860\.0/);
    await writeFile(lexicalIntentFile, lexicalIntent);
    const lexicalResultFile = join(lexical.state, "result.json");
    const lexicalResult = (await readFile(lexicalResultFile, "utf8"))
      .replace('"totalPriceUsdc": 0.05', '"totalPriceUsdc": 5e-2');
    assert.match(lexicalResult, /"totalPriceUsdc": 5e-2/);
    await writeFile(lexicalResultFile, lexicalResult);
    await parity(lexical.state, "status", "integer timeout encoded as JSON float");
    await parity(lexical.state, "result", "economic value encoded in exponent notation");

    const binary64 = await fresh(root, "binary64-boundaries");
    await journal(binary64.state, binary64.request);
    await complete(binary64.state, binary64.request, "Binary64 boundary receipt", {
      numericProbe: [9007199254740992, 0.10000000000000002, 1.0000000000000002,
        1e-7, 1e21, 2.2250738585072014e-308, 5e-324, 1.7976931348623157e308],
    });
    await parity(binary64.state, "result", "binary64 integer and decimal boundaries");
    const binary64Snapshot = JSON.parse(await readFile(join(binary64.state, "result.json"), "utf8"));
    const binary64ReceiptFile = join(binary64.state, "buyer", binary64Snapshot.receiptFile);
    const binary64Receipt = await readFile(binary64ReceiptFile, "utf8");
    assert.match(binary64Receipt, /9007199254740992/);
    await writeFile(binary64ReceiptFile, binary64Receipt.replace("9007199254740992", "9007199254740993"));
    await parity(binary64.state, "result", "raw unsafe integer rounds to same JS binary64");

    const u64max = await fresh(root, "u64-max");
    await journal(u64max.state, u64max.request);
    await complete(u64max.state, u64max.request, "Unsigned maximum receipt", {
      numericProbe: Number("18446744073709551615"),
    });
    const u64Snapshot = JSON.parse(await readFile(join(u64max.state, "result.json"), "utf8"));
    const u64ReceiptFile = join(u64max.state, "buyer", u64Snapshot.receiptFile);
    const u64Receipt = await readFile(u64ReceiptFile, "utf8");
    assert.match(u64Receipt, /18446744073709552000/);
    await writeFile(u64ReceiptFile, u64Receipt.replace("18446744073709552000", "18446744073709551615"));
    await parity(u64max.state, "result", "raw u64 maximum rounds to JS binary64");

    const standalone = join(root, process.platform === "win32" ? "standalone-engine.exe" : "standalone-engine");
    await copyFile(rustExe, standalone);
    const systemPath = process.platform === "win32"
      ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32;${process.env.SystemRoot ?? "C:\\Windows"}`
      : "/usr/bin:/bin";
    const isolatedEnv = { PATH: systemPath, SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" };
    for (const command of ["status", "result"] as const) {
      const native = run("rust", command, quick.state, undefined, standalone, isolatedEnv);
      assert.equal(native.code, 0, `copied standalone ${command} failed: ${native.stderr}`);
      assert.deepEqual(withoutProtocol(JSON.parse(native.stdout)), command === "status"
        ? await operatorTaskStatus(quick.state) : await readOperatorResult(quick.state));
      parityChecks++;
    }

    const incomplete = await fresh(root, "incomplete");
    await mkdir(join(incomplete.state, "buyer"));
    await parity(incomplete.state, "status", "incomplete journal");
    await refusal(incomplete.state, "result", "incomplete has no result");

    const tampered = await fresh(root, "tampered");
    await journal(tampered.state, tampered.request);
    await complete(tampered.state, tampered.request, "Original answer");
    const saved = join(tampered.state, "result.json");
    const original = await readFile(saved);
    const changed = JSON.parse(original.toString("utf8"));
    changed.job.answer = "Changed answer";
    await writeFile(saved, JSON.stringify(changed));
    await refusal(tampered.state, "result", "edited answer");
    await writeFile(saved, original);
    const receiptFile = join(tampered.state, "buyer", changed.receiptFile);
    const receipt = await readFile(receiptFile);
    await writeFile(receiptFile, receipt.toString("utf8").replace("Original answer", "Changed answer"));
    await refusal(tampered.state, "result", "edited receipt");
    await writeFile(receiptFile, receipt);
    await writeFile(join(tampered.state, "request.json"), JSON.stringify({ ...tampered.request, question: "Changed question" }));
    await refusal(tampered.state, "status", "mismatched request");
    await refusal(tampered.state, "result", "mismatched result request");
    await writeFile(join(tampered.state, "request.json"), JSON.stringify(tampered.request));
    const taskFile = join(tampered.state, "task.json");
    const originalTask = await readFile(taskFile);
    const invalidTask = JSON.parse(originalTask.toString("utf8"));
    invalidTask.createdAt = "2026-99-99T99:99:99Z";
    await writeFile(taskFile, JSON.stringify(invalidTask));
    await refusal(tampered.state, "status", "invalid task datetime");
    await writeFile(taskFile, originalTask);
    invalidTask.id = "00000000-0000-0000-0000-00000000000g";
    await writeFile(taskFile, JSON.stringify(invalidTask));
    await refusal(tampered.state, "status", "invalid task UUID shape");
    await writeFile(taskFile, originalTask);
    const payeeTask = JSON.parse(originalTask.toString("utf8"));
    payeeTask.payee = `0x${"3".repeat(40)}`;
    await writeFile(taskFile, JSON.stringify(payeeTask));
    await refusal(tampered.state, "status", "journal payee mismatch");
    await writeFile(taskFile, originalTask);
    const capTask = JSON.parse(originalTask.toString("utf8"));
    capTask.maxTotalMicros = "40000";
    await writeFile(taskFile, JSON.stringify(capTask));
    await refusal(tampered.state, "status", "journal exceeds task cap");
    await writeFile(taskFile, originalTask);
    const invalidSaved = JSON.parse(original.toString("utf8"));
    invalidSaved.savedAt = "2026-99-99T99:99:99Z";
    await writeFile(saved, JSON.stringify(invalidSaved));
    await refusal(tampered.state, "result", "invalid result datetime");
    invalidSaved.savedAt = JSON.parse(original.toString("utf8")).savedAt;
    invalidSaved.job.pricing.unusedCreatorReserveUsdc = { bad: true };
    await writeFile(saved, JSON.stringify(invalidSaved));
    await refusal(tampered.state, "result", "invalid optional economics field");
    await writeFile(saved, original);
    const observationFile = join(tampered.state, "last-observation.json");
    const originalObservation = await readFile(observationFile);
    const invalidObservation = JSON.parse(originalObservation.toString("utf8"));
    invalidObservation.observedAt = "2026-99-99T99:99:99Z";
    await writeFile(observationFile, JSON.stringify(invalidObservation));
    await refusal(tampered.state, "status", "invalid observation datetime");
    await writeFile(observationFile, originalObservation);
    await rm(receiptFile);
    await refusal(tampered.state, "result", "missing archived receipt");
    await writeFile(receiptFile, receipt);
    await writeFile(saved, Buffer.alloc(150001, 65));
    await parity(tampered.state, "status", "oversized result status");
    await refusal(tampered.state, "result", "oversized result");

    const symlinked = await fresh(root, "symlinked");
    const foreign = join(root, "foreign"); await mkdir(foreign);
    await symlink(foreign, join(symlinked.state, "buyer"), process.platform === "win32" ? "junction" : "dir");
    await refusal(symlinked.state, "status", "linked buyer directory");

    const missing = await fresh(root, "missing");
    await rm(join(missing.state, "request.json"));
    await refusal(missing.state, "status", "missing request");

    const reordered = await fresh(root, "reordered");
    await writeFile(join(reordered.state, "request.json"), JSON.stringify({
      responseMode: reordered.request.responseMode, packageVersion: reordered.request.packageVersion,
      researchMode: reordered.request.researchMode, budget: reordered.request.budget,
      question: reordered.request.question,
    }));
    await parity(reordered.state, "status", "normalized request key order");

    const bom = await fresh(root, "bom-trim");
    for (const name of ["task.json", "request.json"]) {
      const file = join(bom.state, name);
      await writeFile(file, (await readFile(file, "utf8")).replace("What is Arc doing?", "\\ufeffWhat is Arc doing?"));
    }
    await parity(bom.state, "status", "ECMAScript BOM trim");
    const nel = await fresh(root, "nel-retained", "quick", "\u0085What is Arc doing?\u0085");
    await parity(nel.state, "status", "NEL is not ECMAScript whitespace");
    const astral = await fresh(root, "utf16-limit", "quick", "😀".repeat(1000));
    await parity(astral.state, "status", "2000 UTF-16 code units accepted");
    for (const name of ["task.json", "request.json"]) {
      const file = join(astral.state, name);
      await writeFile(file, (await readFile(file, "utf8")).replace("😀".repeat(1000), "😀".repeat(1001)));
    }
    await refusal(astral.state, "status", "2002 UTF-16 code units refused");

    // Paired escapes and literal backslash-u text remain ordinary compatible v1 data.
    const escapedAstral = await fresh(root, "escaped-astral", "quick", "😀");
    for (const name of ["task.json", "request.json"]) {
      const path = join(escapedAstral.state, name);
      await writeFile(path, (await readFile(path, "utf8")).replace("😀", "\\ud83d\\ude00"));
    }
    await parity(escapedAstral.state, "status", "escaped paired astral question");
    const literalEscape = await fresh(root, "literal-escape", "quick", "\\ud800 is literal text");
    await parity(literalEscape.state, "status", "escaped backslash-u is literal text");
    const escapedReceipt = await fresh(root, "escaped-paired-receipt");
    await journal(escapedReceipt.state, escapedReceipt.request);
    await complete(escapedReceipt.state, escapedReceipt.request, "Paired astral answer", { unicodeProbe: { "😀": "😀" } });
    const escapedReceiptSnapshot = JSON.parse(await readFile(join(escapedReceipt.state, "result.json"), "utf8"));
    const escapedReceiptPath = join(escapedReceipt.state, "buyer", escapedReceiptSnapshot.receiptFile);
    await writeFile(escapedReceiptPath, (await readFile(escapedReceiptPath, "utf8")).replaceAll("😀", "\\ud83d\\ude00"));
    await parity(escapedReceipt.state, "result", "escaped paired astral receipt key and value");

    // JSON.parse accepts unpaired UTF-16 escapes, while Rust strings cannot hold
    // them. These are asserted intentional candidate incompatibilities, not parity.
    const loneHigh = await fresh(root, "lone-high-question", "quick", "\ud800");
    await surrogateRefusal(loneHigh.state, "status", "lone high in task question", root);
    const loneLow = await fresh(root, "lone-low-question", "quick", "\udc00");
    await surrogateRefusal(loneLow.state, "status", "lone low in task question", root);

    const requestSurrogate = await fresh(root, "lone-request");
    await insertOverwrittenString(join(requestSurrogate.state, "request.json"), "question", "\\ud800");
    await surrogateRefusal(requestSurrogate.state, "status", "lone high in request overwritten value", root);

    const journalSurrogate = await fresh(root, "lone-journal");
    await journal(journalSurrogate.state, journalSurrogate.request);
    await insertOverwrittenString(join(journalSurrogate.state, "buyer", "intent.json"), "schema", "\\ud800");
    await surrogateRefusal(journalSurrogate.state, "status", "lone high in journal overwritten value", root);

    const observationSurrogate = await fresh(root, "lone-observation");
    await journal(observationSurrogate.state, observationSurrogate.request);
    await complete(observationSurrogate.state, observationSurrogate.request, "Observation answer");
    await insertOverwrittenString(join(observationSurrogate.state, "last-observation.json"), "schema", "\\udc00");
    await surrogateRefusal(observationSurrogate.state, "status", "lone low in observation overwritten value", root);

    const snapshotSurrogate = await fresh(root, "lone-snapshot-answer");
    await journal(snapshotSurrogate.state, snapshotSurrogate.request);
    await complete(snapshotSurrogate.state, snapshotSurrogate.request, "Answer with \ud800");
    await surrogateRefusal(snapshotSurrogate.state, "result", "lone high in saved answer", root);
    assert.equal((await readOperatorResult(snapshotSurrogate.state))?.answer, "Answer with \ud800",
      "TypeScript saved result lost a UTF-16 code unit");
    await surrogateRefusal(snapshotSurrogate.state, "brief", "lone high in saved answer brief", root);
    await offlineFallback(snapshotSurrogate.state, root, "surrogate-v1");
    assert.match(await readFile(join(root, "lone high in saved answer brief-ts-readable.md"), "utf8"), /\uFFFD/,
      "UTF-8 Markdown cannot preserve the unpaired code unit");

    const snapshotKey = await fresh(root, "lone-snapshot-key");
    await journal(snapshotKey.state, snapshotKey.request);
    await complete(snapshotKey.state, snapshotKey.request, "Snapshot key answer");
    const snapshotPath = join(snapshotKey.state, "result.json");
    const snapshotText = await readFile(snapshotPath, "utf8");
    assert.match(snapshotText, /"job": \{/);
    await writeFile(snapshotPath, snapshotText.replace('"job": {', '"job": { "\\udc00": "ignored",'));
    await surrogateRefusal(snapshotKey.state, "result", "lone low in ignored snapshot job key", root);

    const receiptSurrogate = await fresh(root, "lone-receipt");
    await journal(receiptSurrogate.state, receiptSurrogate.request);
    const surrogateDigest = await complete(receiptSurrogate.state, receiptSurrogate.request,
      "Receipt answer", { unicodeProbe: { "\ud800": "\udc00" } });
    const receiptSnapshot = JSON.parse(await readFile(join(receiptSurrogate.state, "result.json"), "utf8"));
    assert.equal(receiptSnapshot.receiptDigest, surrogateDigest, "surrogate payload changed saved digest");
    await surrogateRefusal(receiptSurrogate.state, "result", "lone surrogate receipt payload key and value", root);

    // A duplicate with the same final value is accepted by both parsers.
    const duplicate = await fresh(root, "duplicate-key");
    const duplicateTask = (await readFile(join(duplicate.state, "task.json"), "utf8"))
      .replace('"schema": "keryx-operator-task-v1",', '"schema": "keryx-operator-task-v1", "schema": "keryx-operator-task-v1",');
    await writeFile(join(duplicate.state, "task.json"), duplicateTask);
    await parity(duplicate.state, "status", "duplicate JSON key with identical final value");

    // Measurements include fresh process startup and installed tsx loader overhead.
    if (benchmarkBundle) {
      bundledOperator = join(root, "operator-bundle.mjs");
      await build({ entryPoints: [join(repo, "scripts", "operator.mts")], bundle: true,
        platform: "node", format: "esm", target: "node20", outfile: bundledOperator,
        logLevel: "silent" });
      for (const command of ["status", "result"] as const) {
        const p = run("bundle", command, quick.state);
        assert.equal(p.code, 0, `bundled JS ${command} failed: ${p.stderr}`);
        assert.deepEqual(JSON.parse(p.stdout), command === "status"
          ? await operatorTaskStatus(quick.state) : await readOperatorResult(quick.state));
      }
    }
    const samples: Record<string, { ts: number[]; rust: number[]; bundle: number[] }> = {};
    const beforeBenchmark = await treeDigest(quick.state);
    for (const command of ["status", "result", "brief"] as const) {
      samples[command] = { ts: [], rust: [], bundle: [] };
      for (let i = 0; i < 7; i++) {
        for (const kind of (benchmarkBundle ? ["ts", "bundle", "rust"] : ["ts", "rust"]) as Array<"ts" | "bundle" | "rust">) {
          const file = command === "brief" ? join(root, `bench-${command}-${kind}-${i}.md`) : undefined;
          const p = run(kind, command, quick.state, file);
          assert.equal(p.code, 0, `${kind} ${command} benchmark invocation failed: ${p.stderr}`);
          samples[command][kind].push(p.ms);
        }
      }
    }
    const nodeBaseline: number[] = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      const child = spawnSync(process.execPath, ["-e", ""], { cwd: repo, env: noEnv, encoding: "utf8", windowsHide: true });
      assert.equal(child.status, 0);
      nodeBaseline.push(performance.now() - start);
    }
    assert.equal(await treeDigest(quick.state), beforeBenchmark, "benchmark modified source tree");
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(1);
    const size = (await stat(rustExe)).size;
    console.log(JSON.stringify({ fixtureKind: "synthetic; no settlement evidence",
      strictChecks: parityChecks + refusalChecks, parityChecks, refusalChecks,
      intentionalIncompatibilityChecks: incompatibilityChecks, offlineFallbackChecks, offlineGuardChecks,
      exportBoundaryChecks, exportSkippedChecks, digest,
      standaloneCopy: "native executable copied to temp and launched on this host with system-only PATH; no clean-VM claim",
      benchmark: { host: `${process.platform}/${process.arch}`, node: process.version, repetitions: 7,
        commands: Object.fromEntries(Object.entries(samples).map(([command, data]) => [command,
          { tsMsMedian: median(data.ts), ...(benchmarkBundle ? { bundledJsMsMedian: median(data.bundle) } : {}),
            rustMsMedian: median(data.rust) }])),
        emptyNodeProcessMsMedian: median(nodeBaseline),
        measure: "fresh process start through output, ms median; brief includes new-file export",
        rustBinaryBytes: size,
        ...(benchmarkBundle ? { bundledJs: { esbuildVersion, target: "node20", bytes: (await stat(bundledOperator!)).size,
          note: "bundled CLI still requires Node; startup measures the CLI path, not domain computation" } } : {}),
        tsArtifact: "source plus installed Node and node_modules; no standalone artifact to compare" } }, null, 2));
  } finally { await rm(root, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
