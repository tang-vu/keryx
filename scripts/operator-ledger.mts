/** Public read-only HTTP/export client. No env-file loader or wallet/private-store dependency. */
import { fetchOperatorLedger } from "../lib/operator-ledger/client.ts";
import { operatorLedgerCsv, operatorLedgerJson, verifyOperatorLedger } from "../lib/operator-ledger/export.ts";

const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log("Usage: npm run operator:ledger -- [--days 1..31] [--csv] [--expect sha256:DIGEST]\nPublic selected-network transfer evidence only. No wallet, private invoices, customer history or execution. KERYX_OPERATOR_URL selects the hosted origin.");
  process.exit(0);
}
let days = 7, csv = false, expected: string | undefined;
const seen = new Set<string>();
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (seen.has(flag) || !["--days", "--csv", "--expect"].includes(flag)) throw new Error("Invalid ledger arguments; use --help");
  seen.add(flag);
  if (flag === "--csv") csv = true;
  if (flag === "--days") { const value = args[++index]; if (!/^(?:[1-9]|[12][0-9]|3[01])$/.test(value ?? "")) throw new Error("Invalid ledger window"); days = Number(value); }
  if (flag === "--expect") { expected = args[++index]; if (!/^sha256:[0-9a-f]{64}$/.test(expected ?? "")) throw new Error("Invalid retained digest"); }
}
try {
  const ledger = verifyOperatorLedger(await fetchOperatorLedger(process.env.KERYX_OPERATOR_URL ?? "https://keryx.cc", days), expected);
  process.stdout.write(csv ? operatorLedgerCsv(ledger) : operatorLedgerJson(ledger));
} catch { console.error("Public transfer ledger unavailable or verification failed."); process.exitCode = 1; }
