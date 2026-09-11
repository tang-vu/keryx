import { createPublicClient, maxUint256, type PublicClient } from "viem";
import { withPrivateWorkerLock } from "../a2a/private-worker-lock";
import type { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { validateWithdrawalRequest, type WithdrawalRequestRecord } from "./withdrawal-request";
import { withdrawalRpcTransport } from "./withdrawal-rpc-transport";

type Journal = ReturnType<typeof createWithdrawalMintJournal>;
type Client = Pick<PublicClient, "getChainId" | "getBlock" | "getBalance">;

/** Server-owned dependencies only. All signers and admission writers must use the
 * protected journal and cooperative directory lock. This is an RPC/custody-backed
 * snapshot, not proof of exclusive off-host key custody or future gas prices. */
export function createBackedWithdrawalAdmission(directory: string, journal: Journal, ceilingWei: string,
  clientForSignal: (signal: AbortSignal) => Client) {
  if (!/^[1-9][0-9]{0,77}$/.test(ceilingWei) || BigInt(ceilingWei) > maxUint256) throw new Error("Mint gas ceiling unavailable");
  return async (value: WithdrawalRequestRecord, signal: AbortSignal) => {
    const record = await validateWithdrawalRequest(structuredClone(value));
    signal.throwIfAborted();
    return withPrivateWorkerLock(directory, async () => {
      const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 10000);
      const combined = AbortSignal.any([signal, stop.signal]);
      const live = () => combined.throwIfAborted();
      try {
        live(); const snapshot = await journal.gasBackingSnapshot(); live();
        const held = await journal.getGasAdmission(record.id); live();
        const slot = await journal.getSlot(record.id); live();
        // An existing slot already contains transfer evidence. It cannot authorize
        // a fresh Circle admission if application claim history was lost/replaced.
        if (slot) throw new Error();
        const needed = BigInt(snapshot.outstandingGasWei) + (held ? BigInt(0) : BigInt(ceilingWei));
        const client = clientForSignal(combined);
        if (await client.getChainId() !== 5042002) throw new Error(); live();
        const block = await client.getBlock({ blockTag: "latest" }); live();
        const fresh = () => {
          const age = Date.now() - Number(block.timestamp) * 1000;
          if (!Number.isFinite(age) || age < -5000 || age > 60000) throw new Error();
        };
        fresh();
        if (block.number === null || !block.hash || block.number < BigInt(snapshot.minimumBlockNumber)) throw new Error();
        const balance = await client.getBalance({ address: snapshot.relayer, blockNumber: block.number }); live();
        if (typeof balance !== "bigint" || balance < needed) throw new Error();
        const rechecked = await client.getBlock({ blockNumber: block.number }); live(); fresh();
        if (rechecked.hash !== block.hash || rechecked.number !== block.number || rechecked.timestamp !== block.timestamp
          || await client.getChainId() !== 5042002) throw new Error(); live();
        // The immutable ceiling/count snapshot is compared again inside the SQLite
        // admission transaction, so a competing writer cannot invalidate this balance check.
        await journal.admitGas(record, ceilingWei, combined, snapshot);
      } catch { throw new Error("Withdrawal gas backing unavailable; retain the original request"); }
      finally { clearTimeout(timer); }
    });
  };
}

export function withdrawalGasAdmissionForRpc(directory: string, journal: Journal, ceilingWei: string, rpcUrl: string) {
  return createBackedWithdrawalAdmission(directory, journal, ceilingWei,
    signal => createPublicClient({ transport: withdrawalRpcTransport(rpcUrl, signal) }));
}
