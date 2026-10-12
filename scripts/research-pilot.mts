import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { evaluateResearchPilot } from "../lib/economics/research-pilot";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const HELP = "Usage: npm run research:pilot -- --input PRIVATE_JSON_FILE\nEvaluate a bounded local JSON cohort without loading environment, database, network or payment services. Prints private aggregate JSON only; customer, question, buyer/job and evidence IDs are omitted. Entered receipts and cost evidence are not independently verified. This does not establish sustainability, realized profit or authorize pricing, spending or outreach. Keep private input/output outside tracked files. docs/research-pilot-template.json contains illustrative empty cohorts only.";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(HELP);
    return;
  }
  if (args.length !== 2 || args[0] !== "--input" || args[1].length === 0
      || args[1].length > 4096 || args[1].startsWith("-") || args[1].includes("\0")) {
    throw new Error("Invalid arguments");
  }
  // Nonblocking open prevents a FIFO from hanging before the regular-file check.
  const handle = await open(args[1], constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > MAX_INPUT_BYTES) throw new Error("Invalid file size/type");
    // Bounded reads also refuse a file that grows after the size check.
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length === 0 || length > MAX_INPUT_BYTES) throw new Error("Invalid file size");
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
    console.log(JSON.stringify(evaluateResearchPilot(parsed), null, 2));
  } finally {
    await handle.close();
  }
}

main().catch(() => {
  console.error("Research pilot evaluation unavailable. Use --help and a regular UTF-8 JSON file up to 2 MiB with complete bounded inputs. Private details omitted.");
  process.exitCode = 1;
});
