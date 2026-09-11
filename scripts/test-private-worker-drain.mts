import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { privateWorkerScenario } from "./test-fixtures/private-worker-scenario.mts";

if (process.platform !== "linux") throw new Error("Run this signal acceptance on Linux (including WSL), not Windows signal emulation.");
globalThis.fetch = async () => { throw new Error("Parent test network forbidden"); };
const project = resolve(import.meta.dirname, "..");
const workerPath = join(project, "scripts/private-research-worker.mts");
const loader = pathToFileURL(join(project, "node_modules/tsx/dist/loader.mjs")).href;
const preload = pathToFileURL(join(project, "scripts/test-fixtures/private-worker-network.mjs")).href;
type Scenario = Awaited<ReturnType<typeof privateWorkerScenario>>;
type Event = { status: string; providerCalls?: number; forbiddenCalls?: number };

function launch(scenario: Scenario, hold: boolean, once = false, command?: { path: string; args: string[] }) {
  // Do not inherit wallet, provider, Supabase, NODE_OPTIONS or production environment.
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", TSX_TSCONFIG_PATH: join(project, "tsconfig.json"), ...scenario.env,
    KERYX_TEST_HOLD_PROVIDER: hold ? "1" : "0" };
  for (const name of ["PATH", "ESBUILD_BINARY_PATH"]) if (process.env[name]) env[name] = process.env[name];
  const child = fork(command?.path ?? workerPath, command?.args ?? (once ? ["--once"] : []), { cwd: scenario.root, env,
    execArgv: ["--no-warnings", "--import", loader, "--import", preload], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const events: Event[] = []; let stdout = "", stderr = "";
  child.on("message", message => { events.push(message as Event); });
  child.stdout!.on("data", value => { stdout += String(value); });
  child.stderr!.on("data", value => { stderr += String(value); });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
  });
  async function event(status: string) {
    const started = Date.now();
    while (!events.some(value => value.status === status)) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Worker exited before ${status}: ${stderr}`);
      if (Date.now() - started > 120000) throw new Error(`Worker observation timed out: ${status}; events=${JSON.stringify(events)}; output=${stdout}; errors=${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return events.find(value => value.status === status)!;
  }
  async function finish() {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([closed, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Worker termination not yet observed")), 120000);
      })]);
    } finally { clearTimeout(timer!); }
  }
  return { child, event, closed, finish, events, get stderr() { return stderr; },
    summaries: () => stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) as Array<Event & Record<string, unknown>>,
    async cleanup() {
      // Only this unfunded test child, never an operator worker. Reap before touching its files.
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    } };
}
type Process = ReturnType<typeof launch>;
function cleanNetwork(process: Process) {
  assert.equal(process.stderr, "[keryx llm] decompose fell back to heuristic after provider failure: provider (HTTP 503)\n");
  assert.equal(process.events.some(event => event.status === "forbidden-network"), false);
  const summary = process.summaries().find(row => row.status === "test-network-summary");
  // A job may continue through multiple reasoning stages while draining. Job claims,
  // stored results and the queued-job check below, not model-call count, prove no replay.
  assert.ok(typeof summary?.providerCalls === "number" && summary.providerCalls > 0);
  assert.equal(summary?.forbiddenCalls, 0);
}

async function graceful() {
  const scenario = await privateWorkerScenario(), processes: Process[] = [];
  try {
    const running = launch(scenario, true); processes.push(running);
    await running.event("network-guard-installed"); console.log("Graceful drain: network guard installed; waiting for active execution.");
    await running.event("provider-held");
    const [active, queued] = scenario.jobs;
    const claim = await scenario.db.getPrivateResearchExecution(active, scenario.payer);
    assert.ok(claim); assert.equal(await scenario.db.getPrivateResearchExecution(queued, scenario.payer), null);
    assert.equal(await scenario.db.getPrivateResearchResult(active, scenario.payer), null);
    assert.equal((await scenario.db.getPrivateTreasurySummary(scenario.treasury))?.allocatedMicros, "60000");
    assert.equal(running.child.kill("SIGTERM"), true);
    await running.event("shutdown-observed");
    // Signal acknowledgement is an event barrier, not a sleep interpreted as completion.
    assert.equal(running.child.exitCode, null); assert.equal(running.child.signalCode, null);
    assert.equal(await scenario.db.getPrivateResearchResult(active, scenario.payer), null);
    running.child.send({ status: "resume-provider" });
    assert.deepEqual(await running.finish(), { code: 0, signal: null }); cleanNetwork(running);
    const saved = await scenario.db.getPrivateResearchResult(active, scenario.payer);
    assert.ok(saved); assert.equal(await scenario.db.getPrivateResearchExecution(queued, scenario.payer), null);
    assert.ok(running.summaries().some(row => row.status === "paused" && row.completed === 1 && row.visited === 1));
    const lock = join(scenario.env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY, "private-worker.lock");
    await assert.rejects(readFile(lock), { code: "ENOENT" });
    assert.equal((await readdir(scenario.env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).length, 0);
    const resumed = launch(scenario, false, true); processes.push(resumed);
    assert.deepEqual(await resumed.finish(), { code: 0, signal: null }); cleanNetwork(resumed);
    assert.deepEqual(await scenario.db.getPrivateResearchExecution(active, scenario.payer), claim);
    assert.deepEqual(await scenario.db.getPrivateResearchResult(active, scenario.payer), saved);
    assert.ok(await scenario.db.getPrivateResearchResult(queued, scenario.payer));
    assert.equal((await scenario.db.getPrivateTreasurySummary(scenario.treasury))?.allocatedMicros, "30000");
    console.log("PASS: SIGTERM drains the active prepaid synthetic job, persists its result, leaves queued work untouched, closes the lock and resumes without replay.");
  } finally { for (const process of processes) await process.cleanup(); await scenario.close(); }
}

async function crash() {
  const scenario = await privateWorkerScenario(), processes: Process[] = [];
  try {
    const running = launch(scenario, true); processes.push(running);
    await running.event("network-guard-installed"); console.log("Crash drill: network guard installed; waiting for active execution.");
    await running.event("provider-held");
    const [active, queued] = scenario.jobs;
    const claim = await scenario.db.getPrivateResearchExecution(active, scenario.payer); assert.ok(claim);
    const lock = join(scenario.env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY, "private-worker.lock");
    const originalLock = await readFile(lock, "utf8"); assert.equal(JSON.parse(originalLock).pid, running.child.pid);
    running.child.kill("SIGKILL");
    assert.deepEqual(await running.finish(), { code: null, signal: "SIGKILL" });
    assert.equal(running.events.some(event => event.status === "forbidden-network"), false);
    assert.equal(await readFile(lock, "utf8"), originalLock);
    assert.equal(await scenario.db.getPrivateResearchResult(active, scenario.payer), null);
    assert.equal((await scenario.db.getPrivateTreasurySummary(scenario.treasury))?.allocatedMicros, "60000");
    const refused = launch(scenario, false, true); processes.push(refused);
    assert.deepEqual(await refused.finish(), { code: 1, signal: null });
    assert.equal(await readFile(lock, "utf8"), originalLock);
    assert.equal(refused.summaries().find(row => row.status === "test-network-summary")?.providerCalls, 0);
    assert.equal(refused.summaries().find(row => row.status === "test-network-summary")?.forbiddenCalls, 0);
    assert.match(refused.stderr, /^Private worker unavailable\./);
    // Only the verified-dead test holder's unchanged lock is removed. Never delete a claim.
    await unlink(lock);
    const restarted = launch(scenario, false, true); processes.push(restarted);
    assert.deepEqual(await restarted.finish(), { code: 0, signal: null }); cleanNetwork(restarted);
    assert.deepEqual(await scenario.db.getPrivateResearchExecution(active, scenario.payer), claim);
    assert.equal(await scenario.db.getPrivateResearchResult(active, scenario.payer), null);
    assert.ok(await scenario.db.getPrivateResearchResult(queued, scenario.payer));
    assert.equal((await scenario.db.getPrivateTreasurySummary(scenario.treasury))?.allocatedMicros, "60000");
    console.log("PASS: SIGKILL retains the original claim, missing-result state and capacity; stale-lock restart is refused; verified-stop cleanup does not rerun the interrupted job.");
    const locator = join(scenario.root, "operator-locator.json");
    await writeFile(locator, JSON.stringify({ id: active, payer: scenario.payer }), { flag: "wx", mode: 0o600 });
    const operatorPath = join(project, "scripts/private-interruption.mts");
    for (const apply of [false, true]) {
      const operator = launch(scenario, false, false, { path: operatorPath, args: ["--locator", locator, ...(apply ? ["--apply"] : [])] });
      processes.push(operator);
      assert.deepEqual(await operator.finish(), { code: 0, signal: null });
      assert.equal(operator.stderr, "");
      assert.ok(operator.summaries().some(row => row.status === (apply ? "interrupted" : "interruption-proposed") && row.paymentRequestsSent === 0));
      assert.equal(operator.summaries().find(row => row.status === "test-network-summary")?.forbiddenCalls, 0);
      assert.equal(operator.summaries().find(row => row.status === "test-network-summary")?.providerCalls, 0);
      assert.equal(Boolean(await scenario.db.getPrivateResearchInterruption(active, scenario.payer)), apply);
    }
    assert.deepEqual(await scenario.db.getPrivateResearchExecution(active, scenario.payer), claim);
    assert.equal(await scenario.db.getPrivateResearchResult(active, scenario.payer), null);
    assert.equal((await scenario.db.getPrivateTreasurySummary(scenario.treasury))?.allocatedMicros, "30000");
    console.log("PASS: the operator CLI previews, then records interruption of the crashed job without replay or refund; only never-committed capacity is released.");
  } finally { for (const process of processes) await process.cleanup(); await scenario.close(); }
}

await graceful(); await crash();
console.log("No live funds, customer data, production worker, external provider or settlement network was used. Operator interruption is not a completed answer or a refund.");
