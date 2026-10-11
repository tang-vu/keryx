/** Score related-work drafts against supplied reference sections and reviewer judgments.
 * Offline and read-only: one local JSON file in, one JSON report out. No provider,
 * database, wallet or network call. See docs/evidence-drafts.md. */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { evaluateRelatedWorkDrafts } from "../lib/research/related-work-evaluation";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith("--")) {
  process.stderr.write("Usage: npm run eval:related-work -- <evaluation.json>\n");
  process.exit(2);
}
try {
  const file = path.resolve(args[0]);
  if (statSync(file).size > MAX_INPUT_BYTES) throw new Error();
  const report = evaluateRelatedWorkDrafts(JSON.parse(readFileSync(file, "utf8")));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.aggregate.status !== "measured")
    process.stderr.write("Not measured: no expert-written review has every citing statement judged. These counts are not issue acceptance.\n");
} catch {
  // Private draft text is never echoed in a diagnostic.
  process.stderr.write("Invalid evaluation input. Use the version-1 related-work-evaluation contract in docs/evidence-drafts.md.\n");
  process.exit(1);
}
