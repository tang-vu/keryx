import { parseArgs } from "node:util";
import { runPrivateWorkerLoop } from "../lib/a2a/private-worker-loop";

async function main() {
  const { values } = parseArgs({ options: { once: { type: "boolean" }, help: { type: "boolean" } }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log("Usage: npm run private-worker -- [--once]\nUses explicit operator environment configuration. Disabled by default; never funds wallets or enables checkout.");
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
    const { getDb } = await import("../lib/db");
    const { privateWorkerBootstrap } = await import("../lib/a2a/private-worker-bootstrap");
    db = await getDb();
    const worker = privateWorkerBootstrap(db);
    if (!worker) throw new Error();
    await runPrivateWorkerLoop(worker, { signal: stop.signal, once: values.once,
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
