/**
 * Classify one reserved onramp transfer without confusing an RPC observation failure with an
 * on-chain failure. Once sendTransaction returns a hash, the transfer may settle even if waiting
 * for its receipt times out; that state must keep its once-per-address and daily-cap reservation.
 */

export type OnrampTransferOutcome<TxHash extends string = string> =
  | { status: "confirmed"; txHash: TxHash }
  | { status: "pending"; txHash: TxHash; error: unknown }
  | { status: "reverted"; txHash: TxHash }
  | { status: "send-failed"; error: unknown };

export async function executeOnrampTransfer<TxHash extends string>(
  send: () => Promise<TxHash>,
  wait: (txHash: TxHash) => Promise<{ status: "success" | "reverted" }>,
): Promise<OnrampTransferOutcome<TxHash>> {
  let txHash: TxHash;
  try {
    txHash = await send();
  } catch (error) {
    return { status: "send-failed", error };
  }

  try {
    const receipt = await wait(txHash);
    return receipt.status === "success"
      ? { status: "confirmed", txHash }
      : { status: "reverted", txHash };
  } catch (error) {
    return { status: "pending", txHash, error };
  }
}
