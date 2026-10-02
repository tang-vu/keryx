/** Ordinary headless web entry. Network is selected only by matched deployment labels. */
import { paymentRuntimeConfig } from "../lib/payment-runtime-config";
if (process.argv.includes("--help")) {
  console.log("Usage: npm run web -- QUESTION [BUDGET] (testnet); mainnet: prepare | status | recover | ask QUESTION BUDGET_MICROS CAP_MICROS. Matched KERYX_NETWORK and NEXT_PUBLIC_KERYX_NETWORK select the rail. Mainnet uses dedicated environment custody and retained private state; it never requests a faucet or broadcasts funding transactions.");
} else {
  try {
    if (paymentRuntimeConfig().profile.testnet) await import("./web-client-testnet.mts");
    else await (await import("./web-client-mainnet.mts")).runHeadlessMainnet(process.argv.slice(2));
  } catch {
    console.error("Headless web client unavailable. Preserve session custody and original attempts; private details omitted.");
    process.exitCode = 1;
  }
}
