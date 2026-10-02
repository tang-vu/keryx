/** Caller-wallet monthly status/redemption. Purchase stays in the reviewed web checkout. */
import { readFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { fetchMonthlyQuote, monthlyStatus, submitMonthly } from "../lib/monthly/client.ts";
import { monthlyIdSchema, monthlyRecoveryRequestSchema } from "../lib/monthly/protocol.ts";
import { addressSchema } from "../lib/buyer/protocol.ts";

const [command, ...args] = process.argv.slice(2);
const usage = `Research Monthly (Arc testnet, four public Deep requests, 30 days)
  npm run monthly -- quote --payee 0x...
  npm run monthly -- status --id monthly_...
  npm run monthly -- redeem --request original-request-recovery.json
Purchase: https://keryx.cc/research#monthly (review exact price and keep recovery).
status/redeem require KERYX_BUYER_PRIVATE_KEY in .env.buyer.local for the plan's payer.
redeem uses the exact saved question and requestId, including for recovery. It never
submits another debit or retries a failed/ambiguous research execution. Job output
is recovered at /research using the returned a2a_ ID. Keep recovery files private.`;
async function main() {
  if (!command || command === "--help") { console.log(usage); return; }
  const flag = command === "quote" ? "--payee" : command === "status" ? "--id" : command === "redeem" ? "--request" : null;
  if (!flag || args.length !== 2 || args[0] !== flag) throw new Error("Invalid arguments");
  if (command === "quote") {
    const quote = await fetchMonthlyQuote();
    if (quote.payee.toLowerCase() !== addressSchema.parse(args[1]).toLowerCase()) throw new Error("Payee mismatch");
    console.log(JSON.stringify({ paid: false, quote, handoff: "https://keryx.cc/research#monthly" }, null, 2)); return;
  }
  const key = process.env.KERYX_BUYER_PRIVATE_KEY;
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("Set caller-wallet key");
  const account = privateKeyToAccount(key as `0x${string}`);
  const sign = (message: string) => account.signMessage({ message });
  if (command === "status") {
    const status = await monthlyStatus(monthlyIdSchema.parse(args[1]), account.address, sign);
    console.log(JSON.stringify(status, null, 2)); return;
  }
  const raw = await readFile(args[1], "utf8"); if (raw.length > 16384) throw new Error("Request too large");
  const request = monthlyRecoveryRequestSchema.parse(JSON.parse(raw));
  if (request.payer.toLowerCase() !== account.address.toLowerCase()) throw new Error("Wrong payer");
  console.log(JSON.stringify(await submitMonthly(request, sign), null, 2));
}
main().catch(() => { console.error("Monthly operation refused or uncertain. Keep the original plan/request file; use --help. Never buy another plan to recover a missing acknowledgement."); process.exitCode = 1; });
