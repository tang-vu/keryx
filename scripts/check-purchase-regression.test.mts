import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { aggregatePurchaseOutcomes, PURCHASE_AGGREGATE_COHORTS } from "../lib/research/purchase-outcome-aggregate";

const loader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
const script = resolve("scripts/check-purchase-regression.mts"), run = promisify(execFile);
const network = "eip155:5042002" as const;

/** Synthetic scripted-cohort aggregate: one run holding `cited` cited and `uncited` uncited purchases. */
function aggregate(cited: number, uncited: number, expectedValue: number, selected: typeof network | "eip155:5042" = network) {
  const createdAt = "2026-10-05T00:00:00.000Z", total = cited + uncited;
  const purchases = Array.from({ length: total }, (_, index) => ({ sourceId: "s", assetId: `a-${index}`, itemId: `i-${index}`,
    contentVersion: "v1", expectedValue, settledAccessMicros: "2000", cited: index < cited,
    contributionWeight: index < cited ? 1 / cited : 0, settledRewardMicros: "0" }));
  const report = { schemaVersion: "keryx-purchase-outcomes-v1" as const, dispatchId: "run-1", network: selected, runCreatedAt: createdAt,
    basis: "retained-dispatch-trace-exact-version" as const, settlementEvidence: "recorded-only-not-revalidated" as const,
    coverage: "partial-retained-trace" as const, cohort: "unknown" as const, archive: null,
    counts: { recordedBuyDecisions: total, scoredPurchases: total, citedPurchases: cited, unscoredBuyDecisions: 0,
      tracePaymentObservations: total, excludedPaymentObservations: 0 }, purchases, hitRate: null, uncitedAccessMicros: "0",
    calibration: [], missedValue: null, costPerSupportedClaim: null };
  return aggregatePurchaseOutcomes({ window: { network: selected, since: "2026-10-01T00:00:00.000Z", until: "2026-10-11T00:00:00.000Z", period: "custom" },
    cohorts: PURCHASE_AGGREGATE_COHORTS.map(cohort => ({ cohort, windowRuns: cohort === "scripted" ? 1 : 0,
      runs: cohort === "scripted" ? [{ id: "run-1", createdAt, recordedDecisions: total, decisionsWithBasis: total, report }] : [] })) });
}

describe("offline purchase regression CLI", () => {
  it("has no reachable environment, storage, agent, HTTP, signer or provider authority", async () => {
    const result = await build({ entryPoints: [script], bundle: true, platform: "node", format: "esm", packages: "external", write: false, metafile: true });
    expect(Object.keys(result.metafile!.inputs).join("\n")).not.toMatch(/lib\/(db|agent|payments|gateway|llm|config|history)|env-file|dotenv/);
  });

  it("exits 0 for pass, 1 for flagged, 2 for not evaluable and 3 for refused input", async () => {
    const folder = await mkdtemp(join(tmpdir(), "purchase-regression-cli-"));
    const save = async (name: string, value: unknown) => { const file = join(folder, name); await writeFile(file, JSON.stringify(value)); return file; };
    const baseline = await save("baseline.json", aggregate(14, 6, 0.7)), same = await save("same.json", aggregate(14, 6, 0.7));
    const worse = await save("worse.json", aggregate(10, 10, 0.7)), small = await save("small.json", aggregate(3, 1, 0.7));
    const mainnet = await save("mainnet.json", aggregate(14, 6, 0.7, "eip155:5042"));
    const edited = await save("edited.json", { ...aggregate(14, 6, 0.7), columns: aggregate(20, 0, 0.7).columns.map(row => ({ ...row, hitRate: row.hitRate === null ? null : 0.5 })) });
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: folder, TMP: folder, TSX_DISABLE_CACHE: "1" };
    const options = { cwd: folder, env, timeout: 20_000, maxBuffer: 1024 * 1024 };
    const margins = ["--cohort", "scripted", "--max-hit-rate-drop", "0.05", "--max-calibration-gap-rise", "0.05", "--min-scored", "20"];
    const call = (...args: string[]) => run(process.execPath, ["--import", loader, script, ...args], options);

    const pass = await call(baseline, same, ...margins);
    expect(JSON.parse(pass.stdout)).toMatchObject({ status: "pass", reasons: [], cohort: "scripted", network,
      baseline: { scoredPurchases: 20, citedPurchases: 14 }, margins: { maxHitRateDrop: 0.05, maxCalibrationGapRise: 0.05, minScoredPurchases: 20 } });
    await expect(call(baseline, worse, ...margins)).rejects.toMatchObject({ code: 1,
      stdout: expect.stringContaining('"hit-rate-fell"'), stderr: "" });
    await expect(call(baseline, small, ...margins)).rejects.toMatchObject({ code: 2,
      stdout: expect.stringContaining('"candidate-sample-too-small"') });
    // No scored purchases in the selected cohort is never a pass.
    await expect(call(baseline, same, "--cohort", "outside", ...margins.slice(2))).rejects.toMatchObject({ code: 2 });
    const privateFile = join(folder, "PRIVATE-PATH.json"); await writeFile(privateFile, '{"private":"PRIVATE DATA"');
    for (const args of [[baseline, same], [baseline, same, ...margins.slice(0, 6)], [baseline, same, ...margins.slice(0, 7), "0"],
      [baseline, same, ...margins.slice(0, 3), "5", ...margins.slice(4)], [baseline, same, "--cohort", "everyone", ...margins.slice(2)],
      [baseline, same, ...margins.slice(0, 6), "--cohort", "team"], [baseline, privateFile, ...margins], [baseline, edited, ...margins],
      [baseline, mainnet, ...margins], ["https://foreign.test/a.json", same, ...margins], [folder, same, ...margins]]) {
      const refused = await call(...args).then(() => null, error => error);
      expect(refused).toMatchObject({ code: 3, stdout: "" });
      expect(refused.stderr).toMatch(/^Purchase regression check refused\./); expect(refused.stderr).not.toContain("PRIVATE");
    }
  }, 120_000);
});
