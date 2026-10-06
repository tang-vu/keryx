/** Independent, caller-funded selected-network buyer. No Keryx server config or treasury access. */
import { readFile } from "node:fs/promises";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { buyResearch, prepareResearch, quoteBuyer, resumeResearch, submitPreparedResearch } from "../lib/buyer/client.ts";
import { reportResearch } from "../lib/buyer/report.ts";
import { importBuyerRecovery, exportBuyerRecovery } from "../lib/buyer/recovery-file.ts";
import { addressSchema, BuyerRefusal, buyerRequestSchema, buyerTypedData } from "../lib/buyer/protocol.ts";
import { parseBuyerBudget } from "../lib/a2a/buyer-workspace.ts";

const [command, ...args] = process.argv.slice(2);
const usage = `Keryx buyer agent (trusted configured Arc network)
  npm run buyer -- quote --request request.json --payee 0x... --max-total 0.10
  npm run buyer -- prepare --request request.json --payee 0x... --max-total 0.10 --payer 0x... --state ./job-1
  npm run buyer -- submit --state ./job-1
  npm run buyer -- buy --request request.json --payee 0x... --max-total 0.10 --state ./job-1
  npm run buyer -- resume --state ./job-1 [--watch]
  npm run buyer -- report --state ./job-1
  npm run buyer -- import --file keryx-recovery.json --state ./recovered-job
  npm run buyer -- export --state ./job-1 --file keryx-recovery.json

buy/submit need KERYX_BUYER_PRIVATE_KEY in the dedicated buyer environment and an
already-funded Gateway balance. No wallet creation, funding, deposits or approvals.
prepare never reads a private key or signs. Its --payer is the trusted public buyer address.
prepare/buy --state must name a NEW private directory; its parent must already exist.
submit rechecks the current unsigned quote and consumes exactly one signing/submission attempt.
submit never refreshes the original nonce or retries after any signing/submission error.
Configured finite canary policy applies to submit and buy; imports are recovery-only.
resume and report use the original existing journal directory.
resume never signs or sends payments. Keep the directory after any timeout or error.
report uses the same GET-only recovery and prints a redacted diagnostic for review before sharing.
import/export are local-only and never sign or pay. Import needs a NEW state directory;
export needs a NEW destination file. Keep recovery files private: they grant job access.
Saved payment acknowledgements remain seller assertions, not independent settlement proof.
Payee must be pinned from a trusted source, not accepted blindly from the challenge.`;

async function main() {
  if (command === "--help" || !command) { console.log(usage); return; }
  if (!["quote", "prepare", "submit", "buy", "resume", "report", "import", "export"].includes(command)) throw new Error("Unknown command; use --help");
  const options: Record<string, string> = {};
  let watch = false;
  const allowed = command === "import" || command === "export" ? ["--state", "--file"]
    : command === "resume" || command === "report" || command === "submit" ? ["--state"]
    : ["--request", "--payee", "--max-total", ...(command === "buy" || command === "prepare" ? ["--state"] : []), ...(command === "prepare" ? ["--payer"] : [])];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--watch" && command === "resume" && !watch) { watch = true; continue; }
    if (!allowed.includes(args[i]) || options[args[i]] !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid or duplicate option; use --help");
    options[args[i]] = args[++i];
  }
  for (const key of allowed) if (!options[key]) throw new Error(`Missing ${key}`);
  if (command === "import" || command === "export") {
    if (command === "import") await importBuyerRecovery(options["--file"], options["--state"]);
    else await exportBuyerRecovery(options["--state"], options["--file"]);
    console.log(command === "import" ? "Recovery imported locally. Use resume with this state directory; no payment was sent."
      : "Private recovery file exported with any saved payment acknowledgement. No payment was sent.");
    return;
  }
  if (command === "report") {
    const result = await reportResearch(options["--state"]);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "completed") process.exitCode = 2;
    return;
  }
  if (command === "resume") {
    const stopAt = Date.now() + 600_000;
    for (let attempt = 0; attempt < (watch ? 120 : 1); attempt++) {
      const result = await resumeResearch(options["--state"]);
      console.log(JSON.stringify(result, null, 2));
      if (!["queued", "processing"].includes(result.status)) {
        if (result.status !== "completed") process.exitCode = 2;
        return;
      }
      if (!watch || attempt === 119 || Date.now() >= stopAt) {
        console.log("Polling paused. Resume the same state directory later.");
        process.exitCode = 2;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    return;
  }
  if (command === "submit") {
    const signer = configuredBuyerSigner();
    printSubmission(await submitPreparedResearch({ directory: options["--state"], ...signer }));
    return;
  }
  const source = await readFile(options["--request"], "utf8");
  if (source.length > 8192) throw new Error("Request file exceeds 8 KB");
  const request = buyerRequestSchema.parse(JSON.parse(source));
  const payee = addressSchema.parse(options["--payee"]);
  const maxTotal = parseBuyerBudget(options["--max-total"], 1);
  if (maxTotal === null || maxTotal <= request.budget) throw new Error("Total limit must cover creator cap plus service fee, at most 1 USDC");
  const maxTotalMicros = String(Math.round(maxTotal * 1e6));
  if (command === "quote") {
    const requirement = await quoteBuyer(request, payee, maxTotalMicros);
    console.log(JSON.stringify({ decision: "BUY_ELIGIBLE", paid: false, reason: "Challenge matches the pinned recipient, the configured Arc network, USDC, signing domain and total limit", totalMicros: requirement.amount, creatorCapMicros: Math.round(request.budget * 1e6), serviceFeeMicros: Number(requirement.amount) - Math.round(request.budget * 1e6), package: `${request.researchMode}@${request.packageVersion}` }, null, 2));
    return;
  }
  if (command === "prepare") {
    const result = await prepareResearch({ request, payee, maxTotalMicros, payer: addressSchema.parse(options["--payer"]), directory: options["--state"] });
    console.log(JSON.stringify(result, null, 2));
    console.log("Unsigned original saved privately. Review its intent digest before submit; no payment was sent.");
    return;
  }
  printSubmission(await buyResearch({ request, payee, maxTotalMicros, directory: options["--state"], ...configuredBuyerSigner() }));
}

function configuredBuyerSigner() {
  const key = process.env.KERYX_BUYER_PRIVATE_KEY;
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("Set a valid KERYX_BUYER_PRIVATE_KEY in the dedicated buyer environment");
  let payer: `0x${string}`;
  try { payer = privateKeyToAddress(key as `0x${string}`); }
  catch { throw new Error("Buyer private key is invalid"); }
  // Construct the signer only after original readback, trusted admission and exclusive attempt claim.
  return { payer, sign: (a: Parameters<typeof buyerTypedData>[0]) => privateKeyToAccount(key as `0x${string}`).signTypedData(buyerTypedData(a)) };
}

function printSubmission(result: Awaited<ReturnType<typeof submitPreparedResearch>>) {
  console.log(JSON.stringify(result, null, 2));
  console.log("Keep your private journal. Open https://keryx.cc/research and paste the job ID, or use buyer resume.");
  if (result.status === "submission_uncertain") process.exitCode = 2;
}

main().catch((error) => {
  // Do not echo arbitrary provider errors: signing errors can contain bearer payloads.
  console.error(error instanceof BuyerRefusal ? error.message : "Buyer operation refused or failed. Check the request, pinned payee, price limit and private state directory. Use --help for syntax. If a journal exists, resume it; never buy again to recover a payment.");
  process.exitCode = 1;
});
