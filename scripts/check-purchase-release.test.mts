import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { aggregatePurchaseOutcomes, PURCHASE_AGGREGATE_COHORTS } from "../lib/research/purchase-outcome-aggregate";
import { projectPurchaseOutcomes } from "../lib/research/purchase-outcomes-projector";
import { sha256Text } from "../lib/research-audit/counterfactual-offline";

const script = resolve("scripts/check-purchase-release.mts"), run = promisify(execFile);
const loader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
const source = "1".repeat(40), inputHash = "2".repeat(64);
function aggregate(cited: number, total: number) {
  // Explicit scripted fixtures, never inferred outside/team use or real settlement proof.
  const id = "synthetic", network = "eip155:5042002", createdAt = "2026-10-05T00:00:00.000Z";
  const decisions = Array.from({ length: total }, (_, i) => ({ sourceId: `s${i}`, assetId: `a${i}`,
    itemId: `i${i}`, contentVersion: "v1", action: "BUY", expectedValue: 0.7, price: 0.002 }));
  const payment = (i: number, kind: "fetch" | "citation") => ({ ...decisions[i], id: `${kind}-${i}`,
    queryId: id, network, kind, amountUsdc: kind === "fetch" ? 0.002 : 0.000001,
    settled: true, settlementStatus: "settled", txHash: `synthetic-${kind}-${i}` });
  const report = projectPurchaseOutcomes({ id, createdAt, answer: "Synthetic retained answer.", decisions,
    citations: decisions.slice(0, cited).map(row => ({ sourceId: row.sourceId, itemId: row.itemId,
      contentVersion: row.contentVersion, weight: 1 })),
    trace: decisions.flatMap((_, i) => [{ detail: payment(i, "fetch") },
      ...(i < cited ? [{ detail: payment(i, "citation") }] : [])]) }, network);
  return aggregatePurchaseOutcomes({ window: { network: report.network, since: "2026-10-01T00:00:00.000Z",
    until: "2026-10-11T00:00:00.000Z", period: "custom" }, cohorts: PURCHASE_AGGREGATE_COHORTS.map(cohort => ({ cohort,
    windowRuns: cohort === "scripted" ? 1 : 0, runs: cohort === "scripted" ? [{ id: report.dispatchId, createdAt: report.runCreatedAt,
      recordedDecisions: total, decisionsWithBasis: 0, report }] : [] })) });
}
describe("offline purchase release CLI", () => {
  it("has no reachable provider, model, environment loader, payment, database or deployment graph", async () => {
    const result = await build({ entryPoints: [script], bundle: true, platform: "node", format: "esm", packages: "external", write: false, metafile: true });
    const inputs = Object.keys(result.metafile!.inputs).filter(file => !file.endsWith("lib/llm/well-formed-utf16.ts"));
    expect(inputs.join("\n")).not.toMatch(/lib\/(db|agent|payments|gateway|llm|config|history)|dotenv|redeploy/);
    const approvedExternals = ["node:fs", "node:fs/promises", "zod"];
    const externalImports = Object.values(result.metafile!.outputs)
      .flatMap(output => output.imports).filter(row => row.external);
    for (const row of externalImports) expect(approvedExternals).toContain(row.path);
    // Repeated imports from separate internal nodes do not add reachable modules.
    expect([...new Set(externalImports.map(row => row.path))].sort()).toEqual(approvedExternals);
  });
  it("exits 0/1/2/3 for pinned pass/flagged/insufficient/refused artifacts with no private diagnostics", async () => {
    const tempRoot = resolve(tmpdir()), prefix = "purchase-release-cli-";
    const folder = await mkdtemp(join(tempRoot, prefix));
    try {
      const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: folder, TMP: folder };
      // Qualify the actual documented source entrypoint on the parent's ordinary runner.
      const call = (...args: string[]) => run(process.execPath, ["--import", loader, script, ...args],
        { cwd: folder, env, timeout: 20000, maxBuffer: 1024 * 1024 })
        .then(value => ({ ...value, code: 0 }), (error: { code: number; stdout: string; stderr: string }) => error);
      const baselineJson = JSON.stringify(aggregate(14, 20)), baselineFile = join(folder, "baseline.json");
      await writeFile(baselineFile, baselineJson);
      const candidateFile = join(folder, "candidate.json"), policyFile = join(folder, "policy.json");
      const pinned = async (candidate: ReturnType<typeof aggregate>) => {
        const candidateJson = JSON.stringify(candidate);
        await writeFile(candidateFile, candidateJson);
        const policyJson = JSON.stringify({ schemaVersion: "keryx-purchase-release-policy-v1", network: "eip155:5042002",
          baseline: { sourceCommit: "0".repeat(40), aggregateSha256: await sha256Text(baselineJson), inputSha256: inputHash },
          candidate: { sourceCommit: source, aggregateSha256: await sha256Text(candidateJson), inputSha256: inputHash }, cohorts: ["scripted"],
          margins: { maxHitRateDrop: 0.05, maxCalibrationGapRise: 0.05, minScoredPurchases: 20 } });
        await writeFile(policyFile, policyJson);
        return [policyFile, baselineFile, candidateFile, "--policy-sha256", await sha256Text(policyJson),
          "--candidate-source", source, "--input-sha256", inputHash];
      };
      for (const [cited, total, exit] of [[14, 20, 0], [12, 20, 1], [3, 4, 2]]) {
        const args = await pinned(aggregate(cited, total)), result = await call(...args);
        expect(result.code).toBe(exit); expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject({ deploymentAuthorized: false,
          bindings: { candidateSourceCommit: source, inputSha256: inputHash } });
        const bad = await call(...args.slice(0, -1), "4".repeat(64));
        expect(bad).toMatchObject({ code: 3, stdout: "" }); expect(bad.stderr).toMatch(/^Purchase release check refused/);
      }
      for (const kind of ["incomplete", "unscorable", "unscored"] as const) {
        const candidate = aggregate(14, 20), column = candidate.columns[2];
        if (kind === "incomplete") { column.windowRuns++; column.sampleComplete = false; }
        if (kind === "unscorable") {
          column.windowRuns++; column.sampledRuns++; column.unscorableRuns++; column.recordedDecisions++;
        }
        if (kind === "unscored") { column.recordedBuyDecisions++; column.recordedDecisions++; column.unscoredBuyDecisions++; }
        const result = await call(...await pinned(candidate));
        expect(result).toMatchObject({ code: 2, stderr: "" });
        expect(JSON.parse(result.stdout).comparisons[0].coverageReasons).toHaveLength(1);
      }
      const args = await pinned(aggregate(14, 20));
      const candidateJson = JSON.stringify(aggregate(14, 20));
      for (const text of ["\uFEFF" + candidateJson, "{PRIVATE-MALFORMED", candidateJson + " ",
        "x".repeat(1024 * 1024 + 1)]) {
        await writeFile(candidateFile, text);
        const bad = await call(...args);
        expect(bad).toMatchObject({ code: 3, stdout: "" }); expect(bad.stderr).not.toContain("PRIVATE");
      }
      await pinned(aggregate(14, 20));
      for (const badArgs of [[], args.slice(0, -1), [...args, "extra"],
        [...args.slice(0, 7), "--policy-sha256", inputHash]]) {
        expect(await call(...badArgs)).toMatchObject({ code: 3, stdout: "" });
      }
      for (const file of ["https://PRIVATE-REMOTE.invalid/a", "\\\\PRIVATE-SHARE\\a", folder]) {
        const bad = await call(file, ...args.slice(1));
        expect(bad).toMatchObject({ code: 3, stdout: "" }); expect(bad.stderr).not.toContain("PRIVATE");
      }
      expect(await call(join(folder, "PRIVATE-MISSING.json"), ...args.slice(1))).toMatchObject({ code: 3, stdout: "" });
    } finally {
      if (dirname(folder) !== tempRoot || !basename(folder).startsWith(prefix)) throw Error("Unexpected test cleanup path");
      await rm(folder, { recursive: true, force: true });
    }
  }, 120000);
});
