import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { sha256Text } from "../lib/research-audit/counterfactual-offline";

const script = resolve("scripts/eval-retained-purchase-skips.mts"), run = promisify(execFile);
const loader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
describe("retained skip evaluation CLI", () => {
  it("has no reachable model, provider, wallet, user-budget, reward, DB or environment-loader graph", async () => {
    const result = await build({ entryPoints: [script], bundle: true, platform: "node", format: "esm", packages: "external", write: false, metafile: true });
    const files = Object.keys(result.metafile!.inputs).filter(file => !file.endsWith("lib/llm/well-formed-utf16.ts"));
    expect(files.join("\n")).not.toMatch(/lib\/(db|agent|payments|gateway|llm|config|history)|dotenv|redeploy/);
    const approvedExternals = ["node:fs", "node:fs/promises", "zod"];
    const externalImports = Object.values(result.metafile!.outputs)
      .flatMap(output => output.imports).filter(row => row.external);
    for (const row of externalImports) expect(approvedExternals).toContain(row.path);
    // Repeated imports from separate internal nodes do not add reachable modules.
    expect([...new Set(externalImports.map(row => row.path))].sort()).toEqual(approvedExternals);
  });
  it("reads only bounded local snapshots and reports incomplete or refused input with zero spend", async () => {
    const tempRoot = resolve(tmpdir()), prefix = "retained-skips-cli-";
    const folder = await mkdtemp(join(tempRoot, prefix));
    try {
      const file = join(folder, "input.json");
      const claims = [{ id: "independent-fixture-claim", literal: "Fixed synthetic reference literal." }], body = claims[0].literal;
      const input = { schemaVersion: "keryx-offline-counterfactual-input-v1", run: { id: "synthetic", completedAt: "2026-10-12T00:00:00.000Z",
        answer: "Answer without the reference literal.", decisions: [{ sourceId: "s", itemId: "i", contentVersion: "v1", action: "SKIP", price: 0.002 }],
        observedReads: [] }, reference: { claims, sha256: await sha256Text(JSON.stringify(claims)) },
        snapshots: [{ sourceId: "s", itemId: "i", contentVersion: "v1", body, bodySha256: await sha256Text(body), capturedAt: "2026-10-12T00:00:01.000Z" }] };
      const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: folder, TMP: folder };
      const call = (...args: string[]) => run(process.execPath, ["--import", loader, script, ...args],
        { cwd: folder, env, timeout: 20000, maxBuffer: 1024 * 1024 })
        .then(value => ({ ...value, code: 0 }), (error: { code: number; stdout: string; stderr: string }) => error);
      await writeFile(file, JSON.stringify(input));
      const complete = await call(file);
      expect(complete).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(complete.stdout)).toMatchObject({ actualSpendMicros: "0", rewardEligible: false,
        sampledLiteralMissRate: 1, foundMissingClaimIds: [claims[0].id] });
      expect(complete.stdout).not.toContain(body);
      await writeFile(file, JSON.stringify({ ...input, run: { ...input.run, answer: body } }));
      const alreadyAnswered = await call(file);
      expect(alreadyAnswered).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(alreadyAnswered.stdout)).toMatchObject({ sampledLiteralMissRate: 0, foundMissingClaimIds: [] });
      for (const incomplete of [
        { ...input, snapshots: [] },
        { ...input, run: { ...input.run, decisions: [] } },
        { ...input, run: { ...input.run, decisions: [...input.run.decisions,
          { ...input.run.decisions[0], itemId: "missing", price: 0.003 }] } },
        { ...input, run: { ...input.run, observedReads: [{ sourceId: "s", itemId: "i", contentVersion: "v1" }] } },
      ]) {
        await writeFile(file, JSON.stringify(incomplete));
        const result = await call(file);
        expect(result).toMatchObject({ code: 2, stderr: "" });
        expect(JSON.parse(result.stdout)).toMatchObject({ sampledLiteralMissRate: null, actualSpendMicros: "0", rewardEligible: false });
      }
      for (const refused of [
        { ...input, userBudget: 100 }, { ...input, rewardSink: "PRIVATE-AUTHORITY" },
        { ...input, reference: { ...input.reference, sha256: "0".repeat(64) } },
        { ...input, snapshots: [{ ...input.snapshots[0], body: body + "PRIVATE-CORRUPTION" }] },
        { ...input, snapshots: [{ ...input.snapshots[0], capturedAt: "2026-10-11T23:59:59.000Z" }] },
        { ...input, run: { ...input.run, observedReads: [{ sourceId: "s", itemId: "i" }] } },
      ]) {
        await writeFile(file, JSON.stringify(refused));
        const bad = await call(file);
        expect(bad).toMatchObject({ code: 3, stdout: "" }); expect(bad.stderr).not.toContain("PRIVATE");
      }
      for (const raw of ["{PRIVATE-MALFORMED", "\uFEFF" + JSON.stringify(input),
        Buffer.from([0xc3, 0x28]), "x".repeat(1024 * 1024 + 1)]) {
        await writeFile(file, raw);
        expect(await call(file)).toMatchObject({ code: 3, stdout: "" });
      }
      await writeFile(file, JSON.stringify(input));
      for (const args of [[], [file, "extra"], [join(folder, "PRIVATE-MISSING.json")],
        ["https://PRIVATE-REMOTE.invalid/input"], ["\\\\PRIVATE-SHARE\\input"], [folder]]) {
        const bad = await call(...args);
        expect(bad).toMatchObject({ code: 3, stdout: "" }); expect(bad.stderr).not.toContain("PRIVATE");
      }
    } finally {
      if (dirname(folder) !== tempRoot || !basename(folder).startsWith(prefix)) throw Error("Unexpected test cleanup path");
      await rm(folder, { recursive: true, force: true });
    }
  }, 120000);
});
