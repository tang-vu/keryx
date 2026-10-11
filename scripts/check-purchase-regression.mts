/** Offline release comparison: no env, database, HTTP, provider or wallet imports. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { comparePurchaseScores } from "../lib/research-audit/purchase-regression.ts";
import { cohortPurchaseScore, validatePurchaseAggregate, PURCHASE_AGGREGATE_COHORTS,
  type PurchaseAggregateCohort } from "../lib/research/purchase-outcome-aggregate.ts";

const MAX_BYTES = 1024 * 1024;
const usage = "Purchase regression check refused. Usage: <baseline.json> <candidate.json> --cohort outside|team|scripted|unknown "
  + "--max-hit-rate-drop <0..1> --max-calibration-gap-rise <0..1> --min-scored <integer>. "
  + "Inputs are saved purchase-outcome aggregate JSON files; every margin is required.\n";

async function aggregate(file: string) {
  if (/^https?:/i.test(file)) throw new Error();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error();
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > MAX_BYTES) throw new Error();
    return validatePurchaseAggregate(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))));
  } finally { await handle.close(); }
}

try {
  const [baselineFile, candidateFile, ...flags] = process.argv.slice(2);
  const options = new Map<string, string>();
  if (!baselineFile || !candidateFile || flags.length !== 8) throw new Error();
  for (let index = 0; index < flags.length; index += 2) {
    if (!["--cohort", "--max-hit-rate-drop", "--max-calibration-gap-rise", "--min-scored"].includes(flags[index])
      || options.has(flags[index])) throw new Error();
    options.set(flags[index], flags[index + 1]);
  }
  const decimal = (value: string | undefined) => {
    if (!value || !/^(0|1)(\.\d{1,6})?$/.test(value)) throw new Error();
    return Number(value);
  };
  const cohort = options.get("--cohort") as PurchaseAggregateCohort, minimum = options.get("--min-scored") ?? "";
  if (!PURCHASE_AGGREGATE_COHORTS.includes(cohort) || !/^[1-9]\d{0,4}$/.test(minimum)) throw new Error();
  const baseline = await aggregate(baselineFile), candidate = await aggregate(candidateFile);
  // Different rails are different money and different catalogues; they are never compared.
  if (baseline.network !== candidate.network) throw new Error();
  const result = comparePurchaseScores(cohortPurchaseScore(baseline, cohort), cohortPurchaseScore(candidate, cohort), {
    maxHitRateDrop: decimal(options.get("--max-hit-rate-drop")),
    maxCalibrationGapRise: decimal(options.get("--max-calibration-gap-rise")), minScoredPurchases: Number(minimum) });
  process.stdout.write(JSON.stringify({ ...result, cohort, network: baseline.network,
    baselinePeriod: { since: baseline.since, until: baseline.until }, candidatePeriod: { since: candidate.since, until: candidate.until },
    basis: "recorded exact-version citations and settlements; not expert-judged usefulness and not a significance test" }, null, 2) + "\n");
  // 0 pass, 1 flagged, 2 not evaluable. A sample too small to compare is never reported as a pass.
  process.exitCode = result.status === "pass" ? 0 : result.status === "flagged" ? 1 : 2;
} catch {
  process.stderr.write(usage);
  process.exitCode = 3;
}
