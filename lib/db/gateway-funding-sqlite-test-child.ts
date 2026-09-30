import { openGatewayFundingSqliteLedger } from "./gateway-funding-sqlite";
import type { StorageIdentity } from "./storage-identity";

// Synthetic test child only: no account, signer, provider, config or network.
const input = JSON.parse(process.argv[2]) as { file: string; identity: StorageIdentity;
  action: "admit" | "reserve" | "claim" | "prepared" | "inspect"; operationId: string; claimId?: string; hold?: boolean;
  signed?: { rawTransaction: string; transactionHash: string } };
process.stdout.write("READY\n");
process.stdin.once("data", async () => {
  const ledger = openGatewayFundingSqliteLedger(input.file, input.identity, { readOnly: input.action === "inspect" });
  try {
    const result = input.action === "admit" ? await ledger.admitOperation(input.operationId)
      : input.action === "reserve" ? await ledger.reserveStep(input.operationId, "nativeTransfer", "0")
      : input.action === "claim" ? await ledger.claimCrypto(input.operationId, "nativeTransfer", input.claimId!)
      : input.action === "prepared" ? await ledger.savePrepared(input.operationId, "nativeTransfer", input.claimId!, input.signed!)
      : await ledger.inspectReservation(input.operationId, "nativeTransfer");
    process.stdout.write(`RESULT ${JSON.stringify({ ok: true, result, signatures: 0, sends: 0 })}\n`);
    if (input.hold) return;
  } catch { process.stdout.write('RESULT {"ok":false,"signatures":0,"sends":0}\n'); }
  finally { if (!input.hold) { ledger.close(); process.stdin.destroy(); } }
});
