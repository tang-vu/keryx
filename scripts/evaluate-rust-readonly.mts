/** Explicit CLI-only evaluation; existing Operator and Electron callers do not import this. */
import { isAbsolute } from "node:path";
import { NativeReadonlyTransport, type NativeReadonlyCommand } from "../lib/operator/native-readonly-transport.ts";

const usage = `Usage: node --import tsx scripts/evaluate-rust-readonly.mts \
  --binary ABS_PATH --manifest ABS_PATH --source-commit 40_HEX \
  --command status|result|brief --state ABS_TASK_PATH [--deadline-ms 1..60000]

This explicitly evaluates a read-only native artifact. On refusal, open the same
private v1 directory with npm run operator -- status|result|brief --state PATH
(brief export additionally needs --file NEW_PATH). Never repurchase to recover.`;

function options() {
  const allowed = new Set(["--binary", "--manifest", "--source-commit", "--command", "--state", "--deadline-ms"]);
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") { console.log(usage); process.exit(0); }
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]; const value = args[i + 1];
    if (!allowed.has(name) || !value || values.has(name)) throw new Error(usage);
    values.set(name, value);
  }
  for (const required of ["--binary", "--manifest", "--source-commit", "--command", "--state"]) {
    if (!values.has(required)) throw new Error(usage);
  }
  const command = values.get("--command")!;
  if (!["status", "result", "brief"].includes(command)) throw new Error(usage);
  const binaryPath = values.get("--binary")!;
  const manifestPath = values.get("--manifest")!;
  const state = values.get("--state")!;
  if (![binaryPath, manifestPath, state].every(isAbsolute)) throw new Error("Binary, manifest and task paths must be absolute");
  const deadlineText = values.get("--deadline-ms");
  const deadlineMs = deadlineText === undefined ? undefined : Number(deadlineText);
  return { command: command as NativeReadonlyCommand, state,
    config: { binaryPath, manifestPath, expectedSourceCommit: values.get("--source-commit")!, deadlineMs } };
}

async function main() {
  const { command, state, config } = options();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const transport = new NativeReadonlyTransport(config);
    const output = await transport.inspect(command, state, controller.signal);
    const bytes = Buffer.isBuffer(output) ? output : Buffer.from(`${JSON.stringify(output, null, 2)}\n`, "utf8");
    await new Promise<void>((resolve, reject) => process.stdout.write(bytes, error => error ? reject(error) : resolve()));
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Native read-only evaluation failed");
  process.exitCode = 1;
});
