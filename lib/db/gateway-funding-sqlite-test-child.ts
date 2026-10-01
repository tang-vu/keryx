import { openGatewayFundingSqliteLedger, openGatewayFundingSqliteTerminalObserver } from "./gateway-funding-sqlite";
import { syntheticFundingTerminal } from "./gateway-funding-sqlite-test-receipt";
import { DatabaseSync } from "node:sqlite";
import { writeSync } from "node:fs";
import type { StorageIdentity } from "./storage-identity";

// Synthetic test child only: no account, signer, provider, config or network.
const input = JSON.parse(process.argv[2]) as { file: string; identity: StorageIdentity;
  action: "admit" | "reserve" | "claim" | "prepared" | "terminal" | "inspect"; operationId: string; claimId?: string; hold?: boolean;
  point?: "after-terminal-insert" | "before-terminal-commit" | "after-terminal-commit";
  signed?: { rawTransaction: string; transactionHash: string } };
process.stdout.write("READY\n");
process.stdin.once("data", async () => {
  const ledger = openGatewayFundingSqliteLedger(input.file, input.identity, { readOnly: input.action === "inspect" });
  let protectedStore: ReturnType<typeof openGatewayFundingSqliteTerminalObserver> | undefined;
  try {
    if (input.action === "terminal") {
      const snapshot = await ledger.inspectReservation(input.operationId, "nativeTransfer"); if (!snapshot) throw new Error();
      const token = await syntheticFundingTerminal(snapshot);
      protectedStore = openGatewayFundingSqliteTerminalObserver(input.file, input.identity);
      const stop = () => { writeSync(1, "POINT\n"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
      if (input.point === "after-terminal-insert") {
        const prepare = DatabaseSync.prototype.prepare;
        DatabaseSync.prototype.prepare = function (sql) {
          const statement = prepare.call(this, sql);
          if (!sql.startsWith("INSERT INTO gateway_funding_observations")) return statement;
          return new Proxy(statement, { get(target, property) {
            if (property === "run") return (...args: Parameters<typeof statement.run>) => { const result = target.run(...args); stop(); return result; };
            const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
          } });
        };
      } else if (input.point) {
        const exec = DatabaseSync.prototype.exec;
        DatabaseSync.prototype.exec = function (sql) {
          if (sql === "COMMIT" && input.point === "before-terminal-commit") stop();
          exec.call(this, sql); if (sql === "COMMIT" && input.point === "after-terminal-commit") stop();
        };
      }
      await protectedStore.appendVerifiedTerminalObservation(input.operationId, "nativeTransfer", token);
    }
    const result = input.action === "admit" ? await ledger.admitOperation(input.operationId)
      : input.action === "reserve" ? await ledger.reserveStep(input.operationId, "nativeTransfer", "0")
      : input.action === "claim" ? await ledger.claimCrypto(input.operationId, "nativeTransfer", input.claimId!)
      : input.action === "prepared" ? await ledger.savePrepared(input.operationId, "nativeTransfer", input.claimId!, input.signed!)
      : await ledger.inspectReservation(input.operationId, "nativeTransfer");
    process.stdout.write(`RESULT ${JSON.stringify({ ok: true, result, signatures: 0, sends: 0 })}\n`);
    if (input.hold) return;
  } catch { process.stdout.write('RESULT {"ok":false,"signatures":0,"sends":0}\n'); }
  finally { if (!input.hold) { protectedStore?.close(); ledger.close(); process.stdin.destroy(); } }
});
