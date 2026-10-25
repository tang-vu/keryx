#!/usr/bin/env node
/** Explicit local files only. No environment file, credentials or network client. */
import { open, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { MAX_COMPARISON_RECEIPT_BYTES, ReportComparisonError, type TargetMatch } from "../lib/research/report-comparison";
import { exportReportComparison, type ComparisonExportFormat } from "../lib/research/report-comparison-export";
import { compareResearchWithPlan, createReportComparisonPlan, MAX_COMPARISON_PLAN_BYTES, ReportComparisonPlanError } from "../lib/research/report-comparison-plan";

const usage = "Usage: node --import tsx scripts/compare-research.mts --before receipt.json --after receipt.json [--matches pairs-or-matching-plan.json] [--format json|markdown|csv|matches] [--output new-file]";
async function boundedFile(path: string, limit: number): Promise<string> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new ReportComparisonError("input-too-large");
    // Bound the read even when a file grows after stat. Reject non-UTF8 bytes.
    const bytes = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > limit) throw new ReportComparisonError("input-too-large");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset));
  } finally { await file.close(); }
}

export async function compareResearchCli(args: string[]): Promise<string | null> {
  if (args.length === 1 && args[0] === "--help") return usage + "\n";
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!["--before", "--after", "--matches", "--format", "--output"].includes(key) || !value || value.startsWith("--") || options.has(key)) throw new Error("usage");
    options.set(key, value);
  }
  if (!options.has("--before") || !options.has("--after")) throw new Error("usage");
  const format = options.get("--format") ?? "json";
  if (!["json", "markdown", "csv", "matches"].includes(format)) throw new Error("usage");
  const [before, after] = await Promise.all([boundedFile(options.get("--before")!, MAX_COMPARISON_RECEIPT_BYTES), boundedFile(options.get("--after")!, MAX_COMPARISON_RECEIPT_BYTES)]);
  let matches: TargetMatch[] | undefined;
  let matchingPlan: string | undefined;
  if (options.has("--matches")) {
    try {
      const raw = await boundedFile(options.get("--matches")!, MAX_COMPARISON_PLAN_BYTES), parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/u, ""));
      if (Array.isArray(parsed)) matches = parsed;
      else if (parsed && typeof parsed === "object") matchingPlan = raw;
      else throw new Error();
    }
    catch { throw new ReportComparisonError("invalid-target-matches"); }
    // Runtime validation belongs to the shared engine, including [] semantics.
  }
  const comparison = await compareResearchWithPlan({ before, after, matches, matchingPlan });
  const result = format === "matches" ? JSON.stringify(createReportComparisonPlan(comparison), null, 2) + "\n"
    : exportReportComparison(comparison, format as ComparisonExportFormat);
  if (!options.has("--output")) return result;
  await writeFile(options.get("--output")!, result, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await compareResearchCli(process.argv.slice(2)); if (result !== null) process.stdout.write(result); }
  catch (error) {
    const code = error instanceof ReportComparisonError || error instanceof ReportComparisonPlanError ? error.code : error instanceof Error && error.message === "usage" ? "usage" : "file-unavailable-or-output-exists";
    process.stderr.write(`Comparison refused (${code}). No research or purchase started.\n${usage}\n`);
    process.exitCode = 1;
  }
}
