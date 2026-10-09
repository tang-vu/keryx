import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import retained from "../fixtures/purchase-outcomes/retained-testnet.json";
import { projectPurchaseOutcomes } from "../lib/research/purchase-outcomes-projector";

const loader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
const script = resolve("scripts/inspect-purchase-outcomes.mts"), run = promisify(execFile);
describe("offline public-snapshot CLI", () => {
  it("has no reachable environment, storage, agent, HTTP, signer or provider authority", async () => {
    const result = await build({ entryPoints: [script], bundle: true, platform: "node", format: "esm", packages: "external", write: false, metafile: true });
    const graph = Object.keys(result.metafile!.inputs).join("\n");
    expect(graph).not.toMatch(/lib\/(db|agent|payments|gateway|llm\/[^w]|config|history\/read-dispatch)|env-file|dotenv/);
  });
  it("executes the bounded local inspector and refuses URLs/private malformed data without echoing them", async () => {
    const folder = await mkdtemp(join(tmpdir(), "purchase-outcome-cli-")), file = join(folder, "snapshot.json");
    await writeFile(file, JSON.stringify(retained.snapshot));
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: folder, TMP: folder, TSX_DISABLE_CACHE: "1" };
    const options = { cwd: folder, env, timeout: 10_000, maxBuffer: 1024 * 1024 };
    const result = await run(process.execPath, ["--import", loader, script, file, "--network", "eip155:5042"], options);
    expect(JSON.parse(result.stdout)).toEqual(projectPurchaseOutcomes(retained.snapshot, "eip155:5042")); expect(result.stderr).toBe("");
    const privateFile = join(folder, "PRIVATE-PATH.json"); await writeFile(privateFile, '{"private":"PRIVATE DATA"');
    for (const args of [["https://foreign.test/private", "--network", "eip155:5042"], [privateFile, "--network", "eip155:5042"],
      [folder, "--network", "eip155:5042"], [file, "--network", "unknown"]]) {
      await expect(run(process.execPath, ["--import", loader, script, ...args], options)).rejects.toMatchObject({ code: 1,
        stdout: "", stderr: "Purchase outcomes refused. Supply a bounded public dispatch JSON file and --network eip155:5042 or eip155:5042002.\n" });
    }
  });
});
