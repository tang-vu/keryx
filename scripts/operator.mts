/** Private local task handoff to the existing caller-funded buyer CLI. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createOperatorTask, formatOperatorResearchExport, operatorTaskStatus, readOperatorResult, readOperatorResearchResult, resumeOperatorTask } from "../lib/operator/task.ts";
import { parseBuyerBudget } from "../lib/a2a/buyer-workspace.ts";
import { addressSchema } from "../lib/buyer/protocol.ts";
import { PrivateTextExportError, publishPrivateText } from "../lib/operator/private-text-export.ts";
import { NativeTaskWriterError, repositoryNativeTaskWriter } from "../lib/operator/native-task-writer.ts";

const writer = () => repositoryNativeTaskWriter(resolve(import.meta.dirname, ".."));

const usage = `Keryx Operator task alpha (trusted configured Arc network)
  npm run operator -- workspace --state operator-workspace
  npm run operator -- create --request request.json --payee 0x... --max-total 0.10 --state operator-workspace/task-1
  npm run operator -- status --state operator-workspace/task-1
  npm run operator -- resume --state operator-workspace/task-1
  npm run operator -- export --json --state operator-workspace/task-1
  npm run operator -- result --state operator-workspace/task-1
  npm run operator -- brief --state operator-workspace/task-1 --file private-brief.md
  npm run operator -- brief --state operator-workspace/task-1 --format bibtex --file private-references.bib
  Formats: brief (default), bibtex, ris, csl-json, evidence-csv
  Bibliography metadata only: bibliography-bibtex, bibliography-ris, bibliography-csl-json

Build the trusted writer from a clean checkout with npm run native:build.
Workspace creates a new private directory; create adds one immutable private task.
Neither command signs or spends.
For a deliberate purchase, use the existing buyer CLI with --request <task>/request.json,
the same pinned --payee and --max-total, and --state <task>/buyer. Keep that journal.
Status/export are private local snapshots, not public redacted reports or portable recovery.
They cannot establish settlement. Resume is GET-only.
Result and brief recheck the saved local result and original buyer receipt without a network call.
The brief is private plaintext and refuses to overwrite an existing file.
The native writer admits only supported private parents and refuses existing names.`;

async function readRequest(path: string) {
  // On Unix, opening a FIFO for reading can wait forever for a writer. Its
  // nonblocking open still yields a handle, which the regular-file check rejects.
  const file = await open(path, process.platform === "win32" ? "r" : constants.O_RDONLY | constants.O_NONBLOCK);
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
  if (!["workspace", "create", "status", "resume", "export", "result", "brief"].includes(command)) throw new Error("Unknown command; use --help");
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json" && command === "export" && !options["--json"]) { options["--json"] = "true"; continue; }
    if (!["--state", ...(command === "create" ? ["--request", "--payee", "--max-total"] : []),
      ...(command === "brief" ? ["--file", "--format"] : [])].includes(args[i])
      || options[args[i]] || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid or duplicate option; use --help");
    options[args[i]] = args[++i];
  }
  if (!options["--state"] || (command === "export" && !options["--json"]) || (command === "brief" && !options["--file"])) throw new Error("Missing required option; use --help");
  if (command === "workspace") {
    const target = resolve(options["--state"]);
    const result = await writer().createWorkspace(dirname(target), basename(target));
    console.log(JSON.stringify({ ...result, path: target }, null, 2));
    return;
  }
  if (command === "create") {
    if (!options["--request"] || !options["--payee"] || !options["--max-total"]) throw new Error("Missing create option; use --help");
    const request = await readRequest(options["--request"]);
    const payee = addressSchema.parse(options["--payee"]);
    const total = parseBuyerBudget(options["--max-total"], 1);
    if (total === null) throw new Error("Invalid total cap");
    const result = await createOperatorTask(options["--state"], { request, payee,
      maxTotalMicros: String(Math.round(total * 1e6)) }, writer());
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
  if (command === "result" || command === "brief") {
    const format = options["--format"] ?? "brief";
    const result = command === "brief" && format !== "brief"
      ? await readOperatorResearchResult(options["--state"])
      : await readOperatorResult(options["--state"]);
    if (!result) throw new Error("No saved completed result; resume the original journal first");
    if (command === "result") console.log(JSON.stringify(result, null, 2));
    else {
      const exported = await publishPrivateText(options["--file"], formatOperatorResearchExport(result, format));
      console.log(JSON.stringify(exported));
    }
    return;
  }
  const status = await operatorTaskStatus(options["--state"]);
  console.log(JSON.stringify(status, null, command === "export" ? undefined : 2));
}

main().catch((error: unknown) => {
  if (error instanceof NativeTaskWriterError) console.error(JSON.stringify({ state: error.state, stage: error.stage, message: error.reason }));
  else if (error instanceof PrivateTextExportError) console.error(error.message);
  else console.error("Operator task refused or unavailable. Check the private task directory, request binding, saved result and buyer journal; never repurchase to recover an uncertain payment.");
  process.exitCode = 1;
});
