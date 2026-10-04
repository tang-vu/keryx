/** Ordinary headless web entry. Network is selected only by matched deployment labels. */
import { paymentRuntimeConfig } from "../lib/payment-runtime-config";
if (process.argv.includes("--help")) {
  console.log(`Usage: npm run web -- QUESTION [BUDGET] (testnet)
Mainnet commands:
  prepare | status | recover
  ask QUESTION BUDGET_MICROS CAP_MICROS
  migrate
  withdraw-prepare GRANT_EPOCH AMOUNT_MICROS MAX_FEE_MICROS
  withdraw-sign REQUEST_ID AMOUNT_MICROS MAX_FEE_MICROS
  withdraw-status REQUEST_ID
  withdraw-submit REQUEST_ID
  withdraw-cancel REQUEST_ID
  withdraw-abort REQUEST_ID
  withdraw-mint REQUEST_ID
  withdraw-recover REQUEST_ID
  withdraw-complete REQUEST_ID OWNER_MINT_TX_HASH
Matched KERYX_NETWORK and NEXT_PUBLIC_KERYX_NETWORK select the rail.
Mainnet retains dedicated environment custody and private state. migrate explicitly upgrades v2/v3 state to v4 without replacing funded custody/history. withdraw-abort permanently fences an original whose burn signature was never retained, then requires its exact server acknowledgement; signed or uncertain submissions remain held. withdraw-mint emits an unsigned owner-wallet handoff only; the owner reviews/signs in their existing wallet. No faucet, automatic funding or owner wallet transaction is broadcast.`);
} else {
  try {
    if (paymentRuntimeConfig().profile.testnet) await import("./web-client-testnet.mts");
    else await (await import("./web-client-mainnet.mts")).runHeadlessMainnet(process.argv.slice(2));
  } catch {
    console.error("Headless web client unavailable. Preserve session custody and original attempts; private details omitted.");
    process.exitCode = 1;
  }
}
