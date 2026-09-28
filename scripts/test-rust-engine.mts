/** Synthetic, private differential acceptance for the read-only Rust Operator engine. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdtemp, mkdir, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
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

const repo = resolve(import.meta.dirname, "..");
const rustExe = resolve(process.env.KERYX_RUST_ENGINE ?? join(repo, "rust", "target", "release", process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine"));
const payer = `0x${"1".repeat(40)}`;
const payee = `0x${"2".repeat(40)}`;
const noEnv = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" };
const benchmarkBundle = process.argv.includes("--bundled-baseline");
let bundledOperator: string | undefined;
let checks = 0;

function run(kind: "ts" | "rust" | "bundle", command: "status" | "result" | "brief", state: string, file?: string,
  binary = rustExe, environment = noEnv) {
  const argv = kind === "ts"
    ? ["--import", "tsx", "--no-warnings", join(repo, "scripts", "operator.mts"), command, "--state", state, ...(file ? ["--file", file] : [])]
    : kind === "bundle"
      ? [bundledOperator!, command, "--state", state, ...(file ? ["--file", file] : [])]
      : [command, "--state", state, ...(file ? ["--file", file] : [])];
  const start = performance.now();
  const p = spawnSync(kind === "rust" ? binary : process.execPath, argv, {
    cwd: repo, env: environment, encoding: "utf8", maxBuffer: 4_000_000, windowsHide: true,
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
async function complete(state: string, request: Awaited<ReturnType<typeof fresh>>["request"], answer: string, extras: Record<string, unknown> = {}) {
  // The production snapshot writer requires exact realpath equality. Windows CI
  // TEMP may use an alias/casing that is not the path returned by realpath.
  assert.equal(await realpath(state), resolve(state), "fixture task path is not canonical for the TypeScript snapshot writer");
  assert.equal(await realpath(join(state, "buyer")), join(resolve(state), "buyer"),
    "fixture buyer path is not canonical for the TypeScript snapshot writer");
  const intent = await readBuyerJournal(join(state, "buyer"));
  const job = { queryId: intent.queryId, status: "completed", answer, researchPackage: a2aResearchPackage(request.researchMode),
    pricing: { totalPriceUsdc: 0.05, serviceFeeUsdc: 0.02, creatorBudgetUsdc: 0.03,
      settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.005, unusedCreatorReserveUsdc: 0.015 } };
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA,
    dispatch: { id: intent.queryId, question: request.question, answer, answerSha256: sha256(answer),
      budgetUsdc: request.budget, researchMode: request.researchMode },
    citations: [{ marker: "[1]", sourceName: "Créateur <source> * one" }],
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
  checks++;
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
  assert.equal(await readFile(tsFile, "utf8"), formatOperatorBrief(result), `${label}: TS brief`);
  assert.equal(await readFile(rustFile, "utf8"), formatOperatorBrief(result), `${label}: Rust brief`);
  assert.equal(await treeDigest(state), before, `${label}: brief modified source tree`);
  const overwrite = run("rust", "brief", state, rustFile);
  assert.notEqual(overwrite.code, 0, `${label}: Rust overwrote existing export`);
  assert.equal(await readFile(rustFile, "utf8"), formatOperatorBrief(result));
  checks++;
  return { ts: ts.ms, rust: rust.ms };
}

async function refusal(state: string, command: "status" | "result", label: string) {
  const before = await treeDigest(state);
  const ts = run("ts", command, state);
  const rust = run("rust", command, state);
  assert.notEqual(ts.code, 0, `${label}: TypeScript accepted malformed input`);
  assert.notEqual(rust.code, 0, `${label}: Rust accepted malformed input`);
  assert.equal(await treeDigest(state), before, `${label}: refusal modified source tree`);
  checks++;
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
      checks++;
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

    // Strict Rust JSON parsing can reject cases the existing JSON.parse reader accepts.
    // Record these as explicit compatibility differences, never count them as parity.
    const parserDifferences: Array<{ probe: string; tsAccepted: boolean; rustAccepted: boolean }> = [];
    const duplicate = await fresh(root, "duplicate-key");
    const duplicateTask = (await readFile(join(duplicate.state, "task.json"), "utf8"))
      .replace('"schema": "keryx-operator-task-v1",', '"schema": "keryx-operator-task-v1", "schema": "keryx-operator-task-v1",');
    await writeFile(join(duplicate.state, "task.json"), duplicateTask);
    const lone = await fresh(root, "lone-surrogate");
    const loneTask = (await readFile(join(lone.state, "task.json"), "utf8")).replace("What is Arc doing?", "\\ud800");
    const loneRequest = (await readFile(join(lone.state, "request.json"), "utf8")).replace("What is Arc doing?", "\\ud800");
    await writeFile(join(lone.state, "task.json"), loneTask);
    await writeFile(join(lone.state, "request.json"), loneRequest);
    for (const [probe, state] of [["duplicate JSON key", duplicate.state], ["lone UTF-16 surrogate", lone.state]] as const) {
      const before = await treeDigest(state);
      const ts = run("ts", "status", state);
      const rust = run("rust", "status", state);
      parserDifferences.push({ probe, tsAccepted: ts.code === 0, rustAccepted: rust.code === 0 });
      assert.equal(await treeDigest(state), before, `${probe} modified source tree`);
      checks++;
    }

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
      strictChecks: checks - parserDifferences.length, parserProbes: parserDifferences.length,
      digest, parserDifferences,
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
