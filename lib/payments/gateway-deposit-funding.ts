import { erc20Abi, type Address, type Hash, type PublicClient, type WalletClient } from "viem";
import { assertGuardedEvmWallet, type EvmAuthorityGuard } from "./guarded-evm-authority";

export const GATEWAY_DEPOSIT_USDC = "0x3600000000000000000000000000000000000000" as const;
export const GATEWAY_DEPOSIT_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
// Installed @circle-fin/x402-batching 3.5.0 client/index.js GatewayWallet ABI
// and deposit() implementation. No depositFor or arbitrary token/payee input.
export const GATEWAY_DEPOSIT_ABI = [{ name: "deposit", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "token", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }] as const;

export interface GatewayDepositProgress {
  readonly stage: "not-started" | "reading" | "approval-send-started" | "approval-pending" | "approval-confirmed"
    | "deposit-send-started" | "deposit-pending" | "confirmed" | "refused" | "failed" | "uncertain";
  readonly amountMicros: bigint;
  readonly approvalTxHash?: Hash;
  readonly depositTxHash?: Hash;
}

type DepositReadClient = Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
type DepositWalletClient = Pick<WalletClient, "writeContract" | "account" | "chain" | "transport">;

/** One explicit attempt, not a durable funding journal. Repeated/concurrent run()
 * calls share the same promise, including rejection. Never automatically replace
 * a nonce, resend a lost acknowledgement, or retry an uncertain deposit. Caller
 * must retain its attempt/evidence; restart/new-handle deduplication remains an
 * external release gate. On-chain receipt is not Circle off-chain credit proof.
 * Supplied wallet MUST use guardedLocalAccount + guardedEvmTransport: outer
 * checks alone cannot cover viem's asynchronous nonce/gas/fee preparation. */
export function createGatewayDepositAttempt(options: {
  address: Address;
  amountMicros: bigint;
  maxAmountMicros: bigint;
  publicClient: DepositReadClient;
  walletClient: DepositWalletClient;
  guard: EvmAuthorityGuard;
}) {
  const { address, amountMicros, maxAmountMicros, publicClient, walletClient, guard } = options;
  assertGuardedEvmWallet(walletClient, guard);
  if (typeof amountMicros !== "bigint" || typeof maxAmountMicros !== "bigint" || amountMicros <= BigInt(0)
    || amountMicros > maxAmountMicros || maxAmountMicros >= BigInt(2) ** BigInt(256)
    || walletClient.chain?.id !== 5042002 || walletClient.account?.type !== "local"
    || walletClient.account.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error("Invalid pinned Gateway deposit request");
  }
  let progress: GatewayDepositProgress = Object.freeze({ stage: "not-started", amountMicros });
  let attempt: Promise<GatewayDepositProgress> | undefined;
  const update = (stage: GatewayDepositProgress["stage"], extra: Partial<GatewayDepositProgress> = {}) => {
    progress = Object.freeze({ ...progress, ...extra, stage });
  };
  const admit = async () => { guard.assertAuthority(); await guard.attestChain(); guard.assertAuthority(); };
  async function receipt(hash: Hash): Promise<void> {
    const result = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (result.transactionHash.toLowerCase() === hash.toLowerCase() && result.status === "reverted") {
      update("failed");
      throw new Error("Gateway funding transaction reverted");
    }
    if (result.transactionHash.toLowerCase() !== hash.toLowerCase() || result.status !== "success") {
      throw new Error("Gateway funding receipt unavailable or reverted");
    }
  }
  async function execute(): Promise<GatewayDepositProgress> {
    try {
      guard.assertAuthority(); update("reading");
      const balance = await publicClient.readContract({ address: GATEWAY_DEPOSIT_USDC, abi: erc20Abi,
        functionName: "balanceOf", args: [address] });
      guard.assertAuthority();
      if (balance < amountMicros) throw new Error("Insufficient deposit balance");
      const allowance = await publicClient.readContract({ address: GATEWAY_DEPOSIT_USDC, abi: erc20Abi,
        functionName: "allowance", args: [address, GATEWAY_DEPOSIT_WALLET] });
      guard.assertAuthority();
      if (allowance < amountMicros) {
        await admit(); guard.assertAuthority(); update("approval-send-started");
        const hash = await walletClient.writeContract({ account: walletClient.account!, chain: walletClient.chain,
          address: GATEWAY_DEPOSIT_USDC, abi: erc20Abi, functionName: "approve",
          args: [GATEWAY_DEPOSIT_WALLET, amountMicros] });
        update("approval-pending", { approvalTxHash: hash });
        await receipt(hash); guard.assertAuthority(); update("approval-confirmed");
        // Receipt success does not substitute for the allowance used by deposit.
        const approved = await publicClient.readContract({ address: GATEWAY_DEPOSIT_USDC, abi: erc20Abi,
          functionName: "allowance", args: [address, GATEWAY_DEPOSIT_WALLET] });
        guard.assertAuthority();
        if (approved < amountMicros) throw new Error("Gateway allowance unavailable");
      }
      await admit(); guard.assertAuthority(); update("deposit-send-started");
      const hash = await walletClient.writeContract({ account: walletClient.account!, chain: walletClient.chain,
        address: GATEWAY_DEPOSIT_WALLET, abi: GATEWAY_DEPOSIT_ABI, functionName: "deposit",
        args: [GATEWAY_DEPOSIT_USDC, amountMicros], gas: BigInt(120000) });
      update("deposit-pending", { depositTxHash: hash });
      await receipt(hash); guard.assertAuthority(); update("confirmed");
      return progress;
    } catch {
      // Any started send may have reached the node despite response loss. Keep
      // known hashes and exposure; never return a misleading empty success.
      const exposure = progress.approvalTxHash || progress.depositTxHash
        || progress.stage === "approval-send-started" || progress.stage === "deposit-send-started";
      if (progress.stage !== "failed") update(exposure ? "uncertain" : "refused");
      throw new Error(progress.stage === "failed" ? "Gateway deposit transaction reverted; retain original evidence"
        : exposure ? "Gateway deposit attempt unresolved; retain original evidence"
        : "Gateway deposit attempt refused");
    }
  }
  return Object.freeze({ run: () => attempt ??= execute(), snapshot: () => progress });
}
