import { createPublicClient, encodeFunctionData, type PublicClient } from "viem";
import { withdrawalRpcTransport } from "./withdrawal-rpc-transport";
import type { PrivateKeyAccount } from "viem/accounts";
import { withPrivateWorkerLock } from "../a2a/private-worker-lock";
import type { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { WITHDRAWAL_MINTER_ABI, withdrawalMintObserverForRpc, type createWithdrawalMintObserver } from "./withdrawal-mint-observation";
import { withdrawalReceiptObserverForRpc, type createWithdrawalReceiptObserver } from "./withdrawal-receipt-observation";

type Journal = ReturnType<typeof createWithdrawalMintJournal>;
type Client = Pick<PublicClient, "getChainId" | "getBlock" | "getBalance" | "getTransactionCount" | "call" | "sendRawTransaction">;
type Dependencies = { client: Client; observeMint: ReturnType<typeof createWithdrawalMintObserver>;
  observeReceipt: ReturnType<typeof createWithdrawalReceiptObserver> };

/** Real testnet transport wiring; constructing it performs no network operation. */
export function withdrawalRelayDependenciesForRpc(rpcUrl: string, signal: AbortSignal): Dependencies {
  try {
    const url = new URL(rpcUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    const endpoint = url.toString();
    return { client: createPublicClient({ transport: withdrawalRpcTransport(endpoint, signal) }),
      observeMint: withdrawalMintObserverForRpc(endpoint), observeReceipt: withdrawalReceiptObserverForRpc(endpoint) };
  } catch { throw new Error("Withdrawal RPC unavailable"); }
}

/** One bounded pass under a cooperative lock in the dedicated relay directory.
 * Runtime provisioning must bind this directory to the key's actual journal and
 * inventory. `otherSigners` must come from loaded operator configuration, not HTTP.
 * RPC transport must honor signal, timeout and retryCount=0, including broadcast. */
export async function runWithdrawalRelayWorker(directory: string, journal: Journal, signer: PrivateKeyAccount,
  otherSigners: readonly string[], dependencies: Dependencies, signal: AbortSignal, maxSteps = 4) {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 16 || !otherSigners.length
    || otherSigners.some(value => !/^0x[a-fA-F0-9]{40}$/.test(value) || value.toLowerCase() === signer.address.toLowerCase()))
    throw new Error("Dedicated mint signer unavailable");
  return withPrivateWorkerLock(directory, async () => {
    let observed = 0, signed = 0, broadcastAttempts = 0, visited = 0;
    const report = (state: "idle" | "limited" | "waiting" | "aborted", reason?: string) => ({ state, reason, observed, signed, broadcastAttempts });
    const live = () => { if (signal.aborted) throw new Error("aborted"); };
    try {
      for (const id of journal.listRequestIds()) {
        live();
        const slot = await journal.getSlot(id); live();
        if (!slot || slot.terms.relayer !== signer.address.toLowerCase()) throw new Error("authority");
        if (await journal.getObserved(id)) { observed++; continue; } live();
        if (visited++ >= maxSteps) return report("limited");
        let prepared = await journal.getPrepared(id); live();
        if (prepared) {
          const checked = await journal.reconcile(id, dependencies.observeReceipt, signal); live();
          if (checked.observation) { observed++; continue; }
        }
        const { client } = dependencies;
        if (await client.getChainId() !== 5042002) throw new Error("chain"); live();
        const latestNonce = await client.getTransactionCount({ address: signer.address, blockTag: "latest" }); live();
        const pendingNonce = await client.getTransactionCount({ address: signer.address, blockTag: "pending" }); live();
        if (!Number.isSafeInteger(latestNonce) || !Number.isSafeInteger(pendingNonce)
          || latestNonce !== slot.terms.nonce || pendingNonce !== slot.terms.nonce)
          return report("waiting", "nonce-needs-reconciliation");
        const eligible = await dependencies.observeMint(slot.request, slot.attestation, signer.address, signal); live();
        if (!eligible || eligible.requestId !== id || eligible.relayer !== slot.terms.relayer
          || eligible.transferSpecHash !== slot.attestation.transferSpecHash || eligible.minter !== slot.request.policy.gatewayMinter)
          return report("waiting", "mint-not-observed-eligible");
        const blockNumber = BigInt(eligible.blockNumber);
        const block = await client.getBlock({ blockNumber }); live();
        const gas = BigInt(slot.terms.gas), maxFeePerGas = BigInt(slot.terms.maxFeePerGas);
        if (block.hash !== eligible.blockHash || block.number !== blockNumber || block.gasLimit < gas
          || block.baseFeePerGas === null || block.baseFeePerGas === undefined || block.baseFeePerGas > maxFeePerGas)
          return report("waiting", "gas-terms-unavailable");
        const balance = await client.getBalance({ address: signer.address, blockNumber }); live();
        if (balance < BigInt(slot.maxGasCostWei)) return report("waiting", "gas-funding-unavailable");
        const transaction = { type: "eip1559" as const, chainId: 5042002, nonce: slot.terms.nonce,
          to: slot.request.policy.gatewayMinter, value: BigInt(0), gas, maxFeePerGas,
          maxPriorityFeePerGas: BigInt(slot.terms.maxPriorityFeePerGas),
          data: encodeFunctionData({ abi: WITHDRAWAL_MINTER_ABI, functionName: "gatewayMint",
            args: [slot.attestation.attestation, slot.attestation.signature] }) };
        const simulated = await client.call({ ...transaction, account: signer.address, blockNumber }); live();
        if (simulated.data !== undefined && simulated.data !== "0x") return report("waiting", "mint-simulation-unavailable");
        if (!prepared) {
          const raw = await signer.signTransaction(transaction); signed++; live();
          prepared = await journal.savePrepared(id, raw); live();
        }
        // Never use an in-memory signed candidate or a caller-provided hash here.
        prepared = await journal.getPrepared(id); live();
        if (!prepared) throw new Error("prepared");
        broadcastAttempts++;
        const hash = await client.sendRawTransaction({ serializedTransaction: prepared.serializedTransaction }); live();
        if (hash.toLowerCase() !== prepared.transactionHash) return report("waiting", "submission-needs-reconciliation");
        const checked = await journal.reconcile(id, dependencies.observeReceipt, signal); live();
        if (!checked.observation) return report("waiting", "receipt-not-observed");
        observed++;
      }
      return report("idle");
    } catch {
      // A possibly sent transaction remains in the journal. No new nonce, Circle
      // request, gas release or replacement is inferred from any thrown RPC error.
      return report(signal.aborted ? "aborted" : "waiting", "original-state-retained");
    }
  });
}
