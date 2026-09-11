import { createPublicClient, maxUint256, type PublicClient } from "viem";
import { withdrawalRpcTransport } from "./withdrawal-rpc-transport";

type Client = Pick<PublicClient, "getChainId" | "getBlock" | "getBalance" | "getTransactionCount" | "getCode">;

/** Read-only prerequisites for a newly generated key. This cannot prove exclusive
 * custody, absence of off-chain signatures or continued backing after the read. */
export async function readFreshWithdrawalRelay(clientForSignal: (signal: AbortSignal) => Client,
  address: string, lifetimeGasBudgetWei: string, signal: AbortSignal) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address) || /^0x0{40}$/i.test(address)
    || !/^[1-9][0-9]{0,77}$/.test(lifetimeGasBudgetWei) || BigInt(lifetimeGasBudgetWei) > maxUint256) {
    throw new Error("Withdrawal preflight policy unavailable");
  }
  const relayer = address.toLowerCase() as `0x${string}`;
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 10000);
  const combined = AbortSignal.any([signal, stop.signal]);
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Preflight aborted")); });
  combined.addEventListener("abort", rejectAbort, { once: true });
  try {
    combined.throwIfAborted();
    return await Promise.race([aborted, (async () => {
      const client = clientForSignal(combined);
      if (await client.getChainId() !== 5042002) throw new Error(); combined.throwIfAborted();
      const block = await client.getBlock({ blockTag: "latest" }); combined.throwIfAborted();
      const fresh = () => {
        const age = Date.now() - Number(block.timestamp) * 1000;
        if (!Number.isFinite(age) || age < -5000 || age > 60000) throw new Error();
      };
      fresh();
      if (block.number === null || !/^0x[a-fA-F0-9]{64}$/.test(block.hash ?? "")) throw new Error();
      const balance = await client.getBalance({ address: relayer, blockNumber: block.number }); combined.throwIfAborted();
      // Check current and pending state twice: a used or delegated account must
      // never be provisioned as an empty nonce-zero journal.
      let pendingBalance = maxUint256;
      for (let pass = 0; pass < 2; pass++) {
        for (const blockTag of ["latest", "pending"] as const) {
          if (await client.getTransactionCount({ address: relayer, blockTag }) !== 0) throw new Error(); combined.throwIfAborted();
          const code = await client.getCode({ address: relayer, blockTag }); combined.throwIfAborted();
          if (code !== undefined && code !== "0x") throw new Error();
        }
        const currentBalance = await client.getBalance({ address: relayer, blockTag: "pending" }); combined.throwIfAborted();
        if (currentBalance < pendingBalance) pendingBalance = currentBalance;
      }
      const again = await client.getBlock({ blockNumber: block.number }); combined.throwIfAborted(); fresh();
      if (again.hash !== block.hash || again.number !== block.number || again.timestamp !== block.timestamp
        || await client.getChainId() !== 5042002) throw new Error(); combined.throwIfAborted(); fresh();
      if (balance < BigInt(0) || pendingBalance < BigInt(0)) throw new Error();
      return { state: balance >= BigInt(lifetimeGasBudgetWei) && pendingBalance >= BigInt(lifetimeGasBudgetWei)
        ? "funded" as const : "underfunded" as const,
      chainId: 5042002 as const, relayer, lifetimeGasBudgetWei, balanceWei: balance.toString(),
      pendingBalanceWei: pendingBalance.toString(), observedBlockNumber: block.number.toString(),
      observedBlockHash: block.hash!, observedAt: new Date().toISOString() };
    })()]);
  } catch { throw new Error("Fresh withdrawal relay preflight unavailable; inspect before provisioning"); }
  finally { clearTimeout(timer); combined.removeEventListener("abort", rejectAbort); }
}

export function freshWithdrawalRelayForRpc(rpcUrl: string, address: string, lifetimeGasBudgetWei: string, signal: AbortSignal) {
  return readFreshWithdrawalRelay(current => createPublicClient({ transport: withdrawalRpcTransport(rpcUrl, current) }),
    address, lifetimeGasBudgetWei, signal);
}
