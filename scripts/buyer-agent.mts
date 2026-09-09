/** Independent, caller-funded Arc-testnet buyer. No Keryx server config or treasury access. */
import { readFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { buyResearch, quoteBuyer, resumeResearch } from "../lib/buyer/client.ts";
import { reportResearch } from "../lib/buyer/report.ts";
import { addressSchema, BuyerRefusal, buyerRequestSchema, buyerTypedData } from "../lib/buyer/protocol.ts";
import { parseBuyerBudget } from "../lib/a2a/buyer-workspace.ts";

const [command, ...args] = process.argv.slice(2);
const usage = `Keryx buyer agent (Arc testnet only)
  npm run buyer -- quote --request request.json --payee 0x... --max-total 0.10
  npm run buyer -- buy --request request.json --payee 0x... --max-total 0.10 --state ./job-1
  npm run buyer -- resume --state ./job-1 [--watch]
  npm run buyer -- report --state ./job-1

buy needs KERYX_BUYER_PRIVATE_KEY in .env.buyer.local (or the environment) and an
already-funded Gateway balance. No wallet creation, funding, deposits or approvals.
buy --state must name a NEW private directory; its parent must already exist.
resume and report use the original existing journal directory.
resume never signs or sends payments. Keep the directory after any timeout or error.
report uses the same GET-only recovery and prints a redacted diagnostic for review before sharing.
Payee must be pinned from a trusted source, not accepted blindly from the challenge.`;

async function main() {
  if (command === "--help" || !command) { console.log(usage); return; }
  if (!["quote", "buy", "resume", "report"].includes(command)) throw new Error("Unknown command; use --help");
  const options: Record<string, string> = {};
  let watch = false;
  const allowed = command === "resume" || command === "report" ? ["--state"] : ["--request", "--payee", "--max-total", ...(command === "buy" ? ["--state"] : [])];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--watch" && command === "resume" && !watch) { watch = true; continue; }
    if (!allowed.includes(args[i]) || options[args[i]] !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid or duplicate option; use --help");
    options[args[i]] = args[++i];
  }
  for (const key of allowed) if (!options[key]) throw new Error(`Missing ${key}`);
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
  const source = await readFile(options["--request"], "utf8");
  if (source.length > 8192) throw new Error("Request file exceeds 8 KB");
  const request = buyerRequestSchema.parse(JSON.parse(source));
  const payee = addressSchema.parse(options["--payee"]);
  const maxTotal = parseBuyerBudget(options["--max-total"], 1);
  if (maxTotal === null || maxTotal <= request.budget) throw new Error("Total limit must cover creator cap plus service fee, at most 1 testnet USDC");
  const maxTotalMicros = String(Math.round(maxTotal * 1e6));
  if (command === "quote") {
    const requirement = await quoteBuyer(request, payee, maxTotalMicros);
    console.log(JSON.stringify({ decision: "BUY_ELIGIBLE", paid: false, reason: "Challenge matches the pinned recipient, Arc testnet, USDC, signing domain and total limit", totalMicros: requirement.amount, creatorCapMicros: Math.round(request.budget * 1e6), serviceFeeMicros: Number(requirement.amount) - Math.round(request.budget * 1e6), package: `${request.researchMode}@${request.packageVersion}` }, null, 2));
    return;
  }
  const key = process.env.KERYX_BUYER_PRIVATE_KEY;
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("Set a valid KERYX_BUYER_PRIVATE_KEY in .env.buyer.local");
  let account;
  try { account = privateKeyToAccount(key as `0x${string}`); }
  catch { throw new Error("Buyer private key is invalid"); }
  const result = await buyResearch({ request, payee, maxTotalMicros, payer: account.address, directory: options["--state"], sign: (a) => account.signTypedData(buyerTypedData(a)) });
  console.log(JSON.stringify(result, null, 2));
  console.log("Keep your private journal. Open https://keryx.cc/research and paste the job ID, or use buyer resume.");
  if (result.status === "submission_uncertain") process.exitCode = 2;
}

main().catch((error) => {
  // Do not echo arbitrary provider errors: signing errors can contain bearer payloads.
  console.error(error instanceof BuyerRefusal ? error.message : "Buyer operation refused or failed. Check the request, pinned payee, price limit and private state directory. Use --help for syntax. If a journal exists, resume it; never buy again to recover a payment.");
  process.exitCode = 1;
});
