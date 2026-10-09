/** Actual cross-process journal races in one owned synthetic SQLite file; no shared DB/provider. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, writeFileSync, realpathSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { SqliteAdapter } from "../lib/db/sqlite-adapter.ts";
import { acceptanceAuthoritySchema, acceptanceInputSchema } from "../lib/deliverable-acceptance/contracts.ts";
import { acceptanceFixture } from "../lib/deliverable-acceptance/test-fixture.ts";

const temporary = resolve(tmpdir());
const checkDirectory = (directory: string) => {
  assert.ok(resolve(directory).startsWith(temporary + sep)); assert.ok(/^keryx-acceptance-race-/.test(directory.split(/[\\/]/).at(-1)!));
  assert.equal(realpathSync(directory), resolve(directory));
  const descriptor = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8"));
  assert.equal(descriptor.format, "synthetic-acceptance-race-v1"); return descriptor;
};
if (process.argv[2] === "--internal-worker") {
  assert.equal(process.argv.length, 4); assert.equal(process.env.KERYX_TEST_ACCEPTANCE_RACE, "1"); assert.equal(process.env.KERYX_FORCE_OFFLINE, "1");
  assert.equal(process.env.KERYX_NETWORK, "arcTestnet"); assert.equal(process.env.NEXT_PUBLIC_KERYX_NETWORK, "arcTestnet");
  const directory = resolve(process.argv[3]), descriptor = checkDirectory(directory), db = new SqliteAdapter(join(directory, "fixture.sqlite"));
  await db.init(); assert.ok(process.send);
  try {
    process.send!({ ready: true });
    const raw = await new Promise<unknown>(resolveMessage => process.once("message", resolveMessage));
    const input = acceptanceInputSchema.parse(raw), auth = acceptanceAuthoritySchema.parse(descriptor.authority);
    try { const result = await db.deliverableAcceptance!.submit(descriptor.owner, descriptor.network, descriptor.id, input, auth);
      process.send!({ state: result.state, revision: result.revision, success: true }); }
    catch (error) { assert.match(String(error), /acceptance_conflict|acceptance_unauthenticated/); process.send!({ success: false, conflict: String(error).includes("acceptance_conflict"), unauthenticated: String(error).includes("acceptance_unauthenticated") }); }
  } finally { db.close(); process.disconnect!(); }
} else {
  assert.equal(process.argv.length, 2);
  const directory = mkdtempSync(join(temporary, "keryx-acceptance-race-")), file = join(directory, "fixture.sqlite");
  const fixture = await acceptanceFixture(file), owner = fixture.fixture.order.payer, network = fixture.fixture.binding.network, id = fixture.fixture.order.id;
  writeFileSync(join(directory, "fixture.json"), JSON.stringify({ format: "synthetic-acceptance-race-v1", owner, network, id, authority: fixture.authority }));
  fixture.db.close();
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec", "PATHEXT", "LOCALAPPDATA", "USERPROFILE"]) if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, { KERYX_TEST_ACCEPTANCE_RACE: "1", KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" });
  const children = new Set<ReturnType<typeof spawn>>();
  const worker = () => {
    const child = spawn(process.execPath, ["--import", "tsx", resolve(import.meta.filename), "--internal-worker", directory], { cwd: process.cwd(), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"], timeout: 30000 });
    children.add(child); let errors = "", result: { success: boolean; conflict?: boolean; unauthenticated?: boolean; revision?: number } | undefined;
    child.stderr!.on("data", chunk => { errors += chunk; }); child.stdout!.on("data", chunk => { errors += chunk; });
    const ready = new Promise<void>((resolveReady, rejectReady) => { child.once("error", rejectReady); child.on("message", message => {
      if (message && typeof message === "object" && Reflect.get(message, "ready") === true) resolveReady();
      else result = message as typeof result;
    }); child.once("close", code => { if (code !== 0) rejectReady(new Error(errors || `Owned worker exited${code}`)); }); });
    const exited = new Promise<void>((resolveExit, rejectExit) => { child.once("error", rejectExit); child.once("close", (code, signal) => {
      children.delete(child); if (code !== 0 || signal) rejectExit(new Error(errors || `Owned worker failed${code}/${signal}`)); else resolveExit();
    }); }); void exited.catch(() => {});
    return { child, ready, exited, result: () => { assert.ok(result); return result; } };
  };
  let current: SqliteAdapter | undefined;
  try {
    const first = worker(), second = worker(); await Promise.all([first.ready, second.ready]);
    first.child.send!(fixture.input); second.child.send!({ ...fixture.input, idempotencyKey: "synthetic-request-0002", choice: "reject" });
    await Promise.all([first.exited, second.exited]); assert.equal([first.result(), second.result()].filter(result => result.success).length, 1);
    current = new SqliteAdapter(file); await current.init(); assert.equal((await current.deliverableAcceptance!.read(owner, network, id)).revision, 1); current.close(); current = undefined;
    const duplicate = { ...fixture.input, expectedRevision: 1, idempotencyKey: "synthetic-request-0003", choice: "revise" };
    const third = worker(), fourth = worker(); await Promise.all([third.ready, fourth.ready]); third.child.send!(duplicate); fourth.child.send!(duplicate);
    await Promise.all([third.exited, fourth.exited]); assert.equal(third.result().success, true); assert.equal(fourth.result().success, true); assert.equal(third.result().revision, 2); assert.equal(fourth.result().revision, 2);
    current = new SqliteAdapter(file); await current.init(); assert.equal((await current.deliverableAcceptance!.read(owner, network, id)).revision, 2);
    const payments = await current.listCreatorPaymentAttemptsByQuery(id); assert.equal(payments.length, 0);
    assert.equal((await current.getA2aOrder(id))!.transaction, fixture.fixture.order.transaction);
    const session = { kind: "session", id: "bc".repeat(32) };
    writeFileSync(join(directory, "fixture.json"), JSON.stringify({ format: "synthetic-acceptance-race-v1", owner, network, id, authority: session }));
    const waiting = worker(); await waiting.ready;
    const expiresAt = Date.now() + 600;
    await current.createWebSession({ hash: session.id, wallet: owner, issuedAt: Date.now() - 1000, expiresAt });
    const raw = Reflect.get(current, "db") as DatabaseSync;
    raw.exec("BEGIN IMMEDIATE");
    try { waiting.child.send!({ ...duplicate, expectedRevision: 2, idempotencyKey: "synthetic-expiry-request" });
      assert.ok(Date.now() < expiresAt); await new Promise(resolveDelay => setTimeout(resolveDelay, 900)); }
    finally { raw.exec("COMMIT"); }
    await waiting.exited; assert.equal(waiting.result().unauthenticated, true);
    assert.equal((await current.deliverableAcceptance!.read(owner, network, id)).revision, 2);
    assert.equal(children.size, 0);
  } finally {
    current?.close();
    for (const child of children) {
      const exited = new Promise<void>(resolveExit => child.once("close", () => resolveExit())); child.kill();
      let observed = false; await Promise.race([exited.then(() => { observed = true; }), new Promise(resolveDelay => setTimeout(resolveDelay, 5000))]);
      if (!observed) { child.kill("SIGKILL"); await Promise.race([exited.then(() => { observed = true; }), new Promise(resolveDelay => setTimeout(resolveDelay, 5000))]); }
      assert.ok(observed, "Owned worker exit must be observed before fixture cleanup");
    }
    checkDirectory(directory); for (const name of readdirSync(directory)) { assert.ok(["fixture.json", "fixture.sqlite", "fixture.sqlite-wal", "fixture.sqlite-shm"].includes(name)); unlinkSync(join(directory, name)); } rmdirSync(directory);
  }
  process.stdout.write("PASS actual five-process SQLite competing-choice CAS, same-key duplicate replay and session expiry across write-lock wait; same original and no creator call/payment; owned fixture removed after observed worker exit.\n");
}
