import { parseArgs } from "node:util";
import { isAbsolute, resolve } from "node:path";
import { freshWithdrawalRelayForRpc } from "../lib/gateway/withdrawal-relay-preflight";
import { validateWithdrawalMintJournalPolicy } from "../lib/gateway/withdrawal-mint-journal";

async function main() {
  const { values } = parseArgs({ strict: true, options: {
    help: { type: "boolean" }, initialize: { type: "boolean" },
    "fresh-key-custody-verified": { type: "boolean" }, directory: { type: "string" },
    address: { type: "string" }, rpc: { type: "string" },
    "lifetime-gas-budget-wei": { type: "string" }, "max-slots": { type: "string" },
  } });
  if (values.help) {
    console.log(`Usage: node --import tsx scripts/withdrawal-provision.mts
  --address PUBLIC_ADDRESS --rpc RPC_URL --lifetime-gas-budget-wei INTEGER
Default: read-only Arc Testnet preflight; underfunding exits 2.
Optional initialization requires ALL of:
  --initialize --directory ABSOLUTE_NEW_PATH --max-slots 1..1000
  --fresh-key-custody-verified
The last flag asserts the operator has separately verified a newly generated,
never-used dedicated key and exclusive custody. RPC cannot prove that assertion.
Keep output private. No keys are accepted or loaded, no transactions are signed,
and no relay or HTTP enable flags are changed. Existing/partial directories are
never reused or erased. Missing history for a used key requires recovery.`);
    return;
  }
  if (!values.address || !values.rpc || !values["lifetime-gas-budget-wei"]) throw new Error();
  if (!values.initialize && [values.directory, values["max-slots"], values["fresh-key-custody-verified"]]
    .some(value => value !== undefined)) throw new Error();
  let policy: ReturnType<typeof validateWithdrawalMintJournalPolicy> | undefined;
  if (values.initialize) {
    if (!values["fresh-key-custody-verified"] || !values.directory || !isAbsolute(values.directory)
      || resolve(values.directory) !== values.directory || !/^[1-9][0-9]{0,3}$/.test(values["max-slots"] ?? "")) throw new Error();
    policy = validateWithdrawalMintJournalPolicy({ format: "creator-mint-journal-v1", chainId: 5042002,
      relayer: values.address.toLowerCase(), initialNonce: 0,
      lifetimeGasBudgetWei: values["lifetime-gas-budget-wei"], maxSlots: Number(values["max-slots"]) });
  }
  const stop = new AbortController(), shutdown = () => stop.abort();
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  try {
    const observation = await freshWithdrawalRelayForRpc(values.rpc, values.address, values["lifetime-gas-budget-wei"], stop.signal);
    stop.signal.throwIfAborted();
    if (observation.state !== "funded") {
      console.log(JSON.stringify({ observation, initialized: false })); process.exitCode = 2; return;
    }
    if (policy) {
      const { provisionFreshWithdrawalJournal } = await import("../lib/gateway/withdrawal-provision");
      const journal = await provisionFreshWithdrawalJournal(values.directory!, policy, stop.signal);
      console.log(JSON.stringify({ observation, journal, initialized: true }));
    } else console.log(JSON.stringify({ observation, initialized: false }));
  } finally { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); }
}

main().catch(() => {
  console.error("Withdrawal provisioning unavailable. Inspect configuration and retain any existing files; never recreate missing history for a used key.");
  process.exitCode = 1;
});
