import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { recoverPrivateBuyerWorkflow } from "../lib/buyer/private-recovery-workflow.ts";

const help = `Private research recovery (Arc testnet)

npm run buyer:private:recover -- --state ./private-job --private-payee 0x... --public-payee 0x... [--output ./private-result.json]

Requires KERYX_BUYER_PRIVATE_KEY in the environment and an existing private buyer journal.
To load an environment file explicitly:
node --env-file=.env.buyer-private.local --import tsx scripts/private-buyer-recover.mts --state ./private-job --private-payee 0x... --public-payee 0x...

Signs a short-lived SIWE login, reads the saved job and confirms sign-out. Never signs
or submits a payment, creates a wallet or changes the original journal.
Merchant addresses must be pinned from trusted configuration. Public buyer journals
are a different format. Default output is a redacted summary; --output writes a NEW
plaintext private snapshot after sign-out. Its parent directory must already exist.
Snapshots contain private research and server-reported evidence, not verified receipts.
Private purchasing is not enabled by this command.`;

try {
  const { values } = parseArgs({ options: { help: { type: "boolean" }, state: { type: "string" },
    "private-payee": { type: "string" }, "public-payee": { type: "string" }, output: { type: "string" } }, strict: true, allowPositionals: false });
  if (values.help) console.log(help);
  else {
    if (!values.state || !values["private-payee"] || !values["public-payee"] || values.output === "") throw new Error("arguments");
    const key = process.env.KERYX_BUYER_PRIVATE_KEY;
    if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("key");
    const account = privateKeyToAccount(key as `0x${string}`);
    const summary = await recoverPrivateBuyerWorkflow(values.state,
      { privatePayee: values["private-payee"], publicResearchPayee: values["public-payee"] }, account, { output: values.output });
    console.log(JSON.stringify(summary, null, 2));
  }
} catch (error) {
  if (error instanceof Error && error.message === "Private account session revocation could not be confirmed") console.error(error.message);
  else console.error("Private recovery failed. Check arguments, wallet, merchant settings and the existing journal. Private error details omitted. Use --help for usage.");
  process.exitCode = 1;
}
