import { parseArgs } from "node:util";
import { open } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { checkoutPrivateBuyer } from "../lib/buyer/private-checkout-workflow";

const help = `Private research checkout (Arc testnet)

npm run buyer:private:checkout -- --request ./private-request.json --state ./new-private-job --private-payee 0x... --public-payee 0x... --max-total-micros 50000 --max-fee-micros 20000

Requires KERYX_BUYER_PRIVATE_KEY in an explicitly loaded environment file.
The request JSON contains your question, budget, package and independently selected
model/provider policy. See docs/private-buyer-checkout.md for its format.
The state directory must be NEW. The command signs in, checks the quote and availability,
then signs and journals one payment before submitting once and confirming sign-out.
It never funds wallets or enables mainnet. An unavailable checkout creates no payment
signature or journal. After any attempted submission, use buyer:private:recover.
Keep request and journal files private; they contain plaintext research and authorization.
Output omits your question, job ID and signatures. A server response is not chain proof.`;

try {
  const { values } = parseArgs({ options: { help: { type: "boolean" }, request: { type: "string" }, state: { type: "string" },
    "private-payee": { type: "string" }, "public-payee": { type: "string" }, "max-total-micros": { type: "string" },
    "max-fee-micros": { type: "string" } }, strict: true, allowPositionals: false });
  if (values.help) console.log(help);
  else {
    if (!values.request || !values.state || !values["private-payee"] || !values["public-payee"]
      || !values["max-total-micros"] || !values["max-fee-micros"]) throw new Error();
    const key = process.env.KERYX_BUYER_PRIVATE_KEY;
    if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error();
    const handle = await open(values.request, "r");
    let request: unknown;
    try {
      if (!(await handle.stat()).isFile()) throw new Error();
      const bytes = Buffer.alloc(16385); let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, null);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset > 16384) throw new Error();
      request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)));
    } finally { await handle.close(); }
    const result = await checkoutPrivateBuyer(values.state, request,
      { privatePayee: values["private-payee"], publicResearchPayee: values["public-payee"] },
      { maxTotalMicros: values["max-total-micros"], maxServiceFeeMicros: values["max-fee-micros"] },
      privateKeyToAccount(key as `0x${string}`));
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "response-received") process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof Error && error.message === "Private account session revocation could not be confirmed") console.error(error.message);
  console.error("Private checkout did not finish. Preserve any state directory and use private recovery after an attempted submission; never regenerate its authorization. Private error details omitted. Use --help for usage.");
  process.exitCode = 1;
}
