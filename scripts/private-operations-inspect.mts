import { parseArgs } from "node:util";
import { isAbsolute } from "node:path";

async function main() {
  const { values } = parseArgs({ options: { help: { type: "boolean" } }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log("Usage: npm run private:inspect\nLoad the operator environment explicitly. Reports private worker/configuration and Gateway backing observations. Never starts a worker, signs, funds or submits a payment. This is not checkout or mainnet approval.");
    return;
  }
  const env = process.env;
  if (env.KERYX_PRIVATE_RESEARCH_ENABLED === undefined || env.KERYX_PRIVATE_RESEARCH_ENABLED === "0") {
    console.log(JSON.stringify({ status: "disabled", checkoutReady: false })); return;
  }
  if (env.KERYX_PRIVATE_RESEARCH_ENABLED !== "1" || !env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY
    || !isAbsolute(env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY) || !/^[a-f0-9]{7,40}$/.test(env.KERYX_COMMIT ?? "")) throw new Error();
  const { privateKeyToAccount } = await import("viem/accounts");
  const { config } = await import("../lib/config");
  const { privateRuntimePolicy } = await import("../lib/a2a/private-runtime-policy");
  const { inspectPrivateOperations } = await import("../lib/a2a/private-operations-inspection");
  const key = env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY;
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key) || !/^0x[a-fA-F0-9]{64}$/.test(config.funderKey)) throw new Error();
  if (config.privateResearchReservedPayees !== env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES) throw new Error();
  const policy = privateRuntimePolicy(env, { network: config.networkId, publicSeller: config.sellerAddress,
    publicTreasurySigners: [privateKeyToAccount(config.funderKey as `0x${string}`).address],
    privateTreasurySigner: privateKeyToAccount(key as `0x${string}`).address });
  if (!policy) throw new Error();
  const stop = new AbortController(), shutdown = () => stop.abort();
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  let db: Awaited<ReturnType<typeof import("../lib/db")["getDb"]>> | undefined;
  try {
    const { getDb } = await import("../lib/db"); db = await getDb();
    const report = await inspectPrivateOperations(db, policy, env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY, env.KERYX_COMMIT!, stop.signal);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "inspected" || report.worker.status !== "matched" || report.worker.phase !== "idle"
      || report.treasury.status !== "backed" || BigInt(report.treasury.unallocatedMicros) === BigInt(0)) process.exitCode = 1;
  } finally {
    (db as { close?: () => void } | undefined)?.close?.();
    process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown);
  }
}
main().catch(() => { console.error("Private operations inspection unavailable. Check operator configuration; private details omitted."); process.exitCode = 1; });
