/** Local scenario calculator; no environment keys, network requests or pricing mutations. */
import { readFile } from "node:fs/promises";
import { calculateBusinessScenario } from "../lib/economics/business-scenario";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: npm run economics:plan -- --input scenario.json\nStart with docs/business-scenario-template.json. Use null for unknown costs. Output is a planning scenario, not realized profit.");
  process.exit(0);
}
try {
  if (args.length !== 2 || args[0] !== "--input") throw new Error("Invalid arguments");
  const text = await readFile(args[1], "utf8");
  if (text.length > 8192) throw new Error("Oversized input");
  console.log(JSON.stringify(calculateBusinessScenario(JSON.parse(text.replace(/^\uFEFF/, ""))), null, 2));
} catch {
  console.error("Scenario refused. Use: node --import tsx scripts/plan-business.mts --input scenario.json. Supply every field; use null for unknown inputs and nonnegative USD decimal strings with at most six decimal places.");
  process.exitCode = 1;
}
