import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { afterAll, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SqliteAdapter } from "./sqlite-adapter";
import { authChallengeHash } from "../auth-challenge";

const directory = mkdtempSync(join(tmpdir(), "keryx-auth-db-"));
const file = join(directory, "db.sqlite");
const database = new SqliteAdapter(file);
await database.init();
afterAll(() => {
  database.close();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
  rmdirSync(directory);
});

it("persists issued challenges across reopen, preserves an active duplicate and prunes expired hashes", async () => {
  const hash = authChallengeHash("DurableNonce12345");
  await database.createAuthChallenge(hash, 1000, 2000);
  await expect(database.createAuthChallenge(hash, 1001, 3000)).rejects.toThrow();
  const reopened = new SqliteAdapter(file); await reopened.init();
  try {
    expect(await reopened.consumeAuthChallenge(hash, 999)).toBe(false);
    expect(await reopened.consumeAuthChallenge(hash, 1999)).toBe(true);
    expect(await database.consumeAuthChallenge(hash, 1999)).toBe(false);
  } finally { reopened.close(); }
  const expired = authChallengeHash("ExpiredNonce12345");
  await database.createAuthChallenge(expired, 1000, 2000);
  expect(await database.consumeAuthChallenge(expired, 2000)).toBe(false);
  const current = authChallengeHash("CurrentNonce12345");
  await database.createAuthChallenge(current, 2000, 3000);
  const inspection = new DatabaseSync(file);
  try {
    const rows = inspection.prepare("SELECT hash FROM auth_challenges").all();
    expect(rows.map(row => row.hash)).not.toContain(expired);
    expect(rows.map(row => row.hash)).toContain(current);
    expect(inspection.prepare("PRAGMA table_info(auth_challenges)").all().map(row => row.name))
      .toEqual(["hash", "issued_at", "expires_at"]);
  } finally { inspection.close(); }
});

it("allows exactly one independent process to consume a shared challenge", async () => {
  const hash = authChallengeHash("ConcurrentNonce12345");
  const now = Date.now(); await database.createAuthChallenge(hash, now, now + 300000);
  const code = `import {SqliteAdapter} from ${JSON.stringify(pathToFileURL(resolve("lib/db/sqlite-adapter.ts")).href)};
    const db = new SqliteAdapter(${JSON.stringify(file)}); await db.init();
    process.on('message',async()=>{try {const result=await db.consumeAuthChallenge(${JSON.stringify(hash)},Date.now());db.close();process.send(result,()=>process.exit(0));}catch{process.exit(1);}});
    process.send('ready');`;
  const workers = Array.from({ length: 2 }, () => {
    const processHandle = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const ready = new Promise<void>((yes, no) => {
      processHandle.on("message", message => { if (message === "ready") yes(); });
      processHandle.on("error", no); processHandle.on("exit", code => { if (code !== 0) no(new Error("Child initialization failed")); });
    });
    const result = new Promise<boolean>((yes, no) => {
      processHandle.on("message", message => { if (typeof message === "boolean") yes(message); });
      processHandle.on("error", no); processHandle.on("exit", code => { if (code !== 0) no(new Error("Child consumption failed")); });
    });
    // An initialization failure can reject result before the ready barrier is awaited.
    void result.catch(() => undefined);
    const deadline = setTimeout(() => processHandle.kill(), 15000);
    const closed = new Promise<void>(yes => processHandle.on("close", () => yes()));
    return { processHandle, ready, result, closed, deadline };
  });
  try {
    await Promise.all(workers.map(worker => worker.ready));
    for (const worker of workers) worker.processHandle.send("consume");
    expect((await Promise.all(workers.map(worker => worker.result))).sort()).toEqual([false, true]);
  } finally {
    for (const worker of workers) {
      clearTimeout(worker.deadline);
      if (worker.processHandle.exitCode === null) worker.processHandle.kill();
    }
    await Promise.all(workers.map(worker => worker.closed));
  }
}, 30000);
