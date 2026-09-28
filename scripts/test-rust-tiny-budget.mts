/** Synthetic positive-budget v1 fallback and one-micro Rust control. No live requests. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, readlink, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { a2aResearchPackage } from "../lib/a2a/research-package-definition.ts";
import { createBuyerJournal, readBuyerJournal } from "../lib/buyer/journal.ts";
import { buyerJobId } from "../lib/buyer/policy.ts";
import { authorizationWithNonce, BUYER_ENDPOINT, BUYER_ORIGIN, BUYER_GATEWAY,
  BUYER_NETWORK, BUYER_USDC } from "../lib/buyer/protocol.ts";
import { resumeResearch } from "../lib/buyer/client.ts";
import { createOperatorTask, formatOperatorBrief, operatorTaskStatus, readOperatorResult,
  resumeOperatorTask } from "../lib/operator/task.ts";
import { RESEARCH_RECEIPT_CANONICALIZATION, RESEARCH_RECEIPT_SCHEMA } from "../lib/research-receipt-types.ts";
import { researchReceiptDigest, sha256 } from "../lib/research-receipt-integrity.ts";

const repo = resolve(import.meta.dirname, "..");
const rustExe = resolve(process.env.KERYX_RUST_ENGINE ?? join(repo, "rust", "target", "release",
  process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine"));
const tsxLoader = import.meta.resolve("tsx");
const offlineGuard = pathToFileURL(join(repo, "scripts", "rust-offline-fallback-guard.mjs")).href;
const payer = `0x${"1".repeat(40)}`;
const payee = `0x${"2".repeat(40)}`;
const noEnv = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "",
  WINDIR: process.env.WINDIR ?? "" };
let tinyRefusals = 0;
let controlParity = 0;
let offlineFallback = 0;

function run(kind: "ts" | "rust", command: "status" | "result" | "brief", state: string,
  file?: string, environment: NodeJS.ProcessEnv = noEnv, guarded = false) {
  const args = kind === "ts"
    ? [...(guarded ? ["--import", offlineGuard] : []), "--import", tsxLoader, "--no-warnings",
      join(repo, "scripts", "operator.mts"), command, "--state", state,
      ...(file ? ["--file", file] : [])]
    : [command, "--state", state, ...(file ? ["--file", file] : [])];
  const p = spawnSync(kind === "ts" ? process.execPath : rustExe, args,
    { cwd: repo, env: environment, encoding: "utf8", timeout: 20_000,
      maxBuffer: 4_000_000, windowsHide: true });
  if (p.error) throw new Error(`${kind} ${command} did not finish: ${p.error.message}`);
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
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

async function completedFixture(root: string, label: string, budget: number,
  amountMicros: string, creatorBudgetUsdc: number) {
  const state = join(root, label);
  const request = { question: `Synthetic ${label} question`, budget, researchMode: "quick",
    packageVersion: "1.0.0", responseMode: "async" } as const;
  await createOperatorTask(state, { request, payee, maxTotalMicros: "100000" });
  const requirement = { scheme: "exact" as const, network: BUYER_NETWORK as "eip155:5042002",
    asset: BUYER_USDC, amount: amountMicros, payTo: payee, maxTimeoutSeconds: 604860,
    extra: { name: "GatewayWalletBatched" as const, version: "1" as const,
      verifyingContract: BUYER_GATEWAY } };
  const authorization = authorizationWithNonce(payer, requirement, `0x${"a".repeat(64)}`);
  await createBuyerJournal(join(state, "buyer"), { schema: "keryx-buyer-intent-v1", request,
    requirement, authorization, queryId: buyerJobId(authorization) });
  assert.equal(await realpath(state), resolve(state));
  const intent = await readBuyerJournal(join(state, "buyer"));
  const answer = `Synthetic ${label} answer [1]`;
  const job = { queryId: intent.queryId, status: "completed", answer,
    researchPackage: a2aResearchPackage(request.researchMode),
    pricing: { totalPriceUsdc: Number(amountMicros) / 1e6, serviceFeeUsdc: 0.02,
      creatorBudgetUsdc, settledCreatorSpendUsdc: 0, pendingCreatorSpendUsdc: 0,
      unusedCreatorReserveUsdc: creatorBudgetUsdc } };
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA,
    dispatch: { id: intent.queryId, question: request.question, answer, answerSha256: sha256(answer),
      budgetUsdc: budget, researchMode: request.researchMode },
    citations: [{ marker: "[1]", sourceName: "Synthetic creator" }],
    settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0,
      pendingCreatorUsdc: 0, simulatedCreatorUsdc: 0 } };
  const digest = researchReceiptDigest(payload);
  const receipt = { payload, integrity: { algorithm: "sha256",
    canonicalization: RESEARCH_RECEIPT_CANONICALIZATION, scope: "payload", digest } };
  let calls = 0;
  const http = async (url: string, init: RequestInit = {}) => {
    calls++;
    assert.equal(init.method ?? "GET", "GET", "synthetic recovery must stay GET-only");
    assert.deepEqual(init.headers, { accept: "application/json" });
    assert.equal(init.body, undefined);
    if (url === `${BUYER_ENDPOINT}?queryId=${intent.queryId}`) {
      assert.equal(calls, 1, "job GET must be first and unique");
      return Response.json(job);
    }
    assert.equal(url, `${BUYER_ORIGIN}/api/dispatch/${intent.queryId}/receipt`, "unexpected GET URL");
    assert.equal(calls, 2, "receipt GET must be second and unique");
    return Response.json(receipt, { headers: { "x-keryx-receipt-digest": digest } });
  };
  const saved = await resumeOperatorTask(state, buyer => resumeResearch(buyer, http as typeof fetch));
  assert.equal(calls, 2);
  assert.equal(saved.localResult.state, "saved");
  const persistedTask = JSON.parse(await readFile(join(state, "task.json"), "utf8"));
  assert.equal(persistedTask.request.budget, budget);
  const expectedStatus = await operatorTaskStatus(state);
  const expectedResult = await readOperatorResult(state);
  assert(expectedResult);
  assert.equal(expectedResult.answer, answer);
  assert.equal(expectedStatus.savedResult, "present_unchecked");
  return { state, status: expectedStatus, result: expectedResult,
    briefBytes: Buffer.from(formatOperatorBrief(expectedResult), "utf8") };
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
    console.log("offline guard denied all five probes before connection or launch");
  `;
  const p = spawnSync(process.execPath, ["--import", offlineGuard, "--input-type=module", "-e", probe],
    { cwd: repo, env: noEnv, encoding: "utf8", timeout: 20_000, maxBuffer: 100_000,
      windowsHide: true });
  if (p.error) throw p.error;
  assert.equal(p.status, 0, `offline guard self-check: ${p.stderr}`);
  assert.match(p.stdout, /offline guard denied all five probes/);
  assert.match(p.stderr, /keryx offline fallback guard active/);
}

async function main() {
  await stat(rustExe).catch(() => { throw new Error(`Build release Rust binary first: ${rustExe}`); });
  const root = await realpath(await mkdtemp(join(tmpdir(), "keryx-tiny-budget-")));
  try {
    const tiny = await completedFixture(root, "legacy-positive-rounds-zero", 1e-15, "20000", 0);
    const control = await completedFixture(root, "one-micro-control", 0.000001, "20001", 0.000001);
    assert.equal(tiny.status.creatorBudgetMicros, 0);
    assert.equal(control.status.creatorBudgetMicros, 1);
    for (const fixture of [tiny, control]) {
      const before = await treeDigest(fixture.state);
      for (const command of ["status", "result"] as const) {
        const ts = run("ts", command, fixture.state);
        assert.equal(ts.code, 0, `${fixture.state}: TS ${command}: ${ts.stderr}`);
        assert.deepEqual(JSON.parse(ts.stdout), fixture[command]);
        const rust = run("rust", command, fixture.state);
        if (fixture === tiny) {
          assert.notEqual(rust.code, 0, `Rust accepted zero-micro ${command}`);
          assert.equal(rust.stdout, "", `Rust emitted partial ${command}`);
          assert.match(rust.stderr, /creator budget rounds to zero micro-USDC/);
          assert.match(rust.stderr, /TypeScript Operator status\/result\/brief/);
          assert.match(rust.stderr, /do not rewrite files or repurchase/);
          tinyRefusals++;
        } else {
          assert.equal(rust.code, 0, `one-micro Rust ${command}: ${rust.stderr}`);
          assert.deepEqual(JSON.parse(rust.stdout), fixture[command]);
          controlParity++;
        }
      }
      const tsFile = join(root, `${fixture === tiny ? "tiny" : "control"}-ts.md`);
      const rustFile = join(root, `${fixture === tiny ? "tiny" : "control"}-rust.md`);
      const ts = run("ts", "brief", fixture.state, tsFile);
      assert.equal(ts.code, 0, `TS brief refused: ${ts.stderr}`);
      assert.deepEqual(JSON.parse(ts.stdout), { saved: resolve(tsFile), private: true });
      assert.deepEqual(await readFile(tsFile), fixture.briefBytes);
      const rust = run("rust", "brief", fixture.state, rustFile);
      if (fixture === tiny) {
        assert.notEqual(rust.code, 0, "Rust accepted zero-micro brief");
        assert.equal(rust.stdout, "", "Rust emitted a brief success response");
        assert.match(rust.stderr, /creator budget rounds to zero micro-USDC/);
        assert.match(rust.stderr, /TypeScript Operator status\/result\/brief/);
        assert.match(rust.stderr, /do not rewrite files or repurchase/);
        await assert.rejects(stat(rustFile), { code: "ENOENT" });
        tinyRefusals++;
      } else {
        assert.equal(rust.code, 0, `one-micro Rust brief: ${rust.stderr}`);
        assert.deepEqual(JSON.parse(rust.stdout), { saved: resolve(rustFile), private: true });
        assert.deepEqual(await readFile(rustFile), fixture.briefBytes);
        controlParity++;
      }
      assert.equal(await treeDigest(fixture.state), before, "inspection changed original v1 files");
    }

    assertOfflineGuard();
    const disabledCandidate = join(root, process.platform === "win32" ? "disabled-candidate.exe" : "disabled-candidate");
    await assert.rejects(stat(disabledCandidate), { code: "ENOENT" });
    const unavailable = spawnSync(disabledCandidate, ["status", "--state", tiny.state],
      { cwd: repo, env: noEnv, encoding: "utf8", timeout: 20_000, maxBuffer: 100_000,
        windowsHide: true });
    assert.equal((unavailable.error as NodeJS.ErrnoException | undefined)?.code, "ENOENT");
    const fallbackEnv = { ...noEnv, KERYX_RUST_ENGINE: disabledCandidate, KERYX_FORCE_OFFLINE: "1" };
    const beforeFallback = await treeDigest(tiny.state);
    for (let restart = 0; restart < 2; restart++) {
      for (const command of ["status", "result"] as const) {
        const ts = run("ts", command, tiny.state, undefined, fallbackEnv, true);
        assert.equal(ts.code, 0, `offline TS ${command}: ${ts.stderr}`);
        assert.match(ts.stderr, /keryx offline fallback guard active/);
        assert.deepEqual(JSON.parse(ts.stdout), tiny[command]);
        offlineFallback++;
      }
      const file = join(root, `offline-brief-${restart}.md`);
      const ts = run("ts", "brief", tiny.state, file, fallbackEnv, true);
      assert.equal(ts.code, 0, `offline TS brief: ${ts.stderr}`);
      assert.match(ts.stderr, /keryx offline fallback guard active/);
      assert.deepEqual(JSON.parse(ts.stdout), { saved: resolve(file), private: true });
      assert.deepEqual(await readFile(file), tiny.briefBytes);
      assert.equal(await treeDigest(tiny.state), beforeFallback, "offline fallback changed original files");
      offlineFallback++;
    }
    assert.deepEqual({ tinyRefusals, controlParity, offlineFallback },
      { tinyRefusals: 3, controlParity: 3, offlineFallback: 6 });
    console.log(JSON.stringify({ fixtureKind: "synthetic only; no payment or settlement evidence",
      candidateOnlyTinyRefusals: tinyRefusals, oneMicroControlParity: controlParity,
      explicitGuardedTypeScriptFallback: offlineFallback, guardSelfCheck: 1,
      authority: "TypeScript production reader; Rust remains a read-only candidate" }));
  } finally { await rm(root, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
