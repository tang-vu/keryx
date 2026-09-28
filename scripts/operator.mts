/** Private local task handoff to the existing caller-funded buyer CLI. */
import { open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createOperatorTask, operatorTaskStatus, resumeOperatorTask } from "../lib/operator/task.ts";
import { parseBuyerBudget } from "../lib/a2a/buyer-workspace.ts";
import { addressSchema } from "../lib/buyer/protocol.ts";

const usage = `Keryx Operator task alpha (Arc testnet)
  npm run operator -- create --request request.json --payee 0x... --max-total 0.10 --state .buyer-jobs/task-1
  npm run operator -- status --state .buyer-jobs/task-1
  npm run operator -- resume --state .buyer-jobs/task-1
  npm run operator -- export --json --state .buyer-jobs/task-1

Create is local-only and creates a new private task directory. It never signs or spends.
For a deliberate purchase, use the existing buyer CLI with --request <task>/request.json,
the same pinned --payee and --max-total, and --state <task>/buyer. Keep that journal.
Status/export are private local snapshots, not public redacted reports or portable recovery.
They cannot establish settlement. Resume is GET-only.
Use a private parent directory; Windows permissions inherit its ACL.`;

async function readRequest(path: string) {
  const file = await open(path, "r");
  try {
    if (!(await file.stat()).isFile()) throw new Error("Request must be a regular file");
    const buffer = Buffer.alloc(8193);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 8192) throw new Error("Request exceeds 8 KB");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
  } finally { await file.close(); }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help") { console.log(usage); return; }
  if (!["create", "status", "resume", "export"].includes(command)) throw new Error("Unknown command; use --help");
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json" && command === "export" && !options["--json"]) { options["--json"] = "true"; continue; }
    if (!["--state", ...(command === "create" ? ["--request", "--payee", "--max-total"] : [])].includes(args[i])
      || options[args[i]] || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid or duplicate option; use --help");
    options[args[i]] = args[++i];
  }
  if (!options["--state"] || (command === "export" && !options["--json"])) throw new Error("Missing required option; use --help");
  if (command === "create") {
    if (!options["--request"] || !options["--payee"] || !options["--max-total"]) throw new Error("Missing create option; use --help");
    const request = await readRequest(options["--request"]);
    const payee = addressSchema.parse(options["--payee"]);
    const total = parseBuyerBudget(options["--max-total"], 1);
    if (total === null) throw new Error("Invalid total cap");
    const result = await createOperatorTask(options["--state"], { request, payee,
      maxTotalMicros: String(Math.round(total * 1e6)) });
    console.log(JSON.stringify({ ...result, next: {
      command: "buyer buy", request: join(resolve(options["--state"]), "request.json"),
      state: result.buyerState, payee, maxTotal: options["--max-total"] } }, null, 2));
    return;
  }
  if (command === "resume") {
    const result = await resumeOperatorTask(options["--state"]);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "completed") process.exitCode = 2;
    return;
  }
  const status = await operatorTaskStatus(options["--state"]);
  console.log(JSON.stringify(status, null, command === "export" ? undefined : 2));
}

main().catch(() => {
  console.error("Operator task refused or unavailable. Check the private task directory, request binding and buyer journal; never repurchase to recover an uncertain payment.");
  process.exitCode = 1;
});
