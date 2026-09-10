import { parseArgs } from "node:util";
import { runPrivateWorkerLoop } from "../lib/a2a/private-worker-loop";
import { privateResultSpoolFromEnv } from "../lib/a2a/private-result-spool-config";
import { createPrivateResultRecovery } from "../lib/a2a/private-result-recovery";

async function main() {
  const { values } = parseArgs({ options: { once: { type: "boolean" }, help: { type: "boolean" },
    restore: { type: "string" } }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log("Usage: npm run private-worker -- [--once | --restore <backup-token>]\nUses explicit operator environment configuration. Worker disabled by default. Restore only saves an existing encrypted result; never executes research or payments.");
    return;
  }
  if (values.restore !== undefined) {
    if (values.once || !/^[a-f0-9]{64}$/.test(values.restore)) throw new Error();
    const spool = await privateResultSpoolFromEnv();
    // Authenticate the local backup before opening or initializing any database.
    await spool.read(values.restore);
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    try { console.log(JSON.stringify(await spool.restore(db, values.restore))); }
    finally { (db as { close?: () => void }).close?.(); }
    return;
  }
  const flag = process.env.KERYX_PRIVATE_WORKER_ENABLED;
  if (flag === undefined || flag === "0") { console.log(JSON.stringify({ status: "disabled" })); return; }
  if (flag !== "1") throw new Error();
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  let db: Awaited<ReturnType<typeof import("../lib/db")["getDb"]>> | undefined;
  try {
    const spool = await privateResultSpoolFromEnv();
    const { getDb } = await import("../lib/db");
    const { privateWorkerBootstrap } = await import("../lib/a2a/private-worker-bootstrap");
    db = await getDb();
    const worker = privateWorkerBootstrap(db, spool);
    if (!worker) throw new Error();
    await runPrivateWorkerLoop(worker, { signal: stop.signal, once: values.once,
      recovery: createPrivateResultRecovery(db, spool),
      report: summary => {
        console.log(JSON.stringify(summary));
        if (summary.status === "tick-unavailable" || summary.status === "scan-unavailable"
          || ("errors" in summary && summary.errors > 0) || ("unpersisted" in summary && summary.unpersisted > 0)) process.exitCode = 1;
      } });
  } finally {
    (db as { close?: () => void } | undefined)?.close?.();
    process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown);
  }
}
main().catch(() => { console.error("Private worker unavailable. Inspect operator configuration and recovery state; private details omitted."); process.exitCode = 1; });
