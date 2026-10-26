import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { canonicalJson } from "../lib/canonical-json";
import { RESEARCH_RECEIPT_SCHEMA } from "../lib/research-receipt-types";
import { compareResearchCli } from "./compare-research.mts";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Test cleanup outside its temporary root");
  await rm(target, { recursive: true, force: true });
} });
async function files() {
  const directory = await mkdtemp(join(tmpdir(), "keryx-comparison-test-")); directories.push(directory);
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA, dispatch: { question: "Local question" }, claims: [], citations: [] };
  const receipt = JSON.stringify({ payload, integrity: { algorithm: "sha256", canonicalization: "keryx-json-v1", scope: "payload",
    digest: `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}` } });
  const before = join(directory, "before.json"), after = join(directory, "after.json");
  await Promise.all([writeFile(before, receipt), writeFile(after, receipt)]);
  return { directory, before, after, args: ["--before", before, "--after", after] };
}
it("returns portable JSON on stdout by default and leaves input files unchanged", async () => {
  const f = await files(), initial = await readFile(f.before, "utf8");
  const output = await compareResearchCli(f.args);
  expect(JSON.parse(output!)).toMatchObject({ format: "keryx-report-comparison-v1", sameReceipt: true });
  expect(await readFile(f.before, "utf8")).toBe(initial);
  expect(await compareResearchCli(["--help"])).toContain("--matches");
});
it("writes a requested new file and refuses to overwrite an existing file", async () => {
  const f = await files(), path = join(f.directory, "comparison.md"), args = [...f.args, "--format", "markdown", "--output", path];
  expect(await compareResearchCli(args)).toBeNull(); const content = await readFile(path, "utf8");
  expect(content).toContain("# Saved research comparison");
  await expect(compareResearchCli(args)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(path, "utf8")).toBe(content);
});
it("exports a text-free matching plan, restores it and refuses a different receipt before writing output", async () => {
  const f = await files(), planFile = join(f.directory, "matching.json");
  await compareResearchCli([...f.args, "--format", "matches", "--output", planFile]);
  const plan = JSON.parse(await readFile(planFile, "utf8"));
  expect(plan).toMatchObject({ format: "keryx-report-matching-v1", matches: [] });
  expect(JSON.stringify(plan)).not.toContain("Local question");
  expect(await compareResearchCli([...f.args, "--matches", planFile])).toEqual(await compareResearchCli(f.args));
  const changed = JSON.parse(await readFile(f.after, "utf8")); changed.payload.dispatch.question = "Changed question";
  changed.integrity.digest = `sha256:${createHash("sha256").update(canonicalJson(changed.payload)).digest("hex")}`;
  await writeFile(f.after, JSON.stringify(changed));
  const output = join(f.directory, "refused.json");
  await expect(compareResearchCli([...f.args, "--matches", planFile, "--output", output])).rejects.toMatchObject({ code: "matching-receipts-mismatch" });
  await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(planFile, "[]");
  expect(JSON.parse((await compareResearchCli([...f.args, "--matches", planFile]))!).format).toBe("keryx-report-comparison-v1");
});
it.each([["--before", "x"], ["--before", "x", "--after", "y", "--format", "html"], ["--before", "x", "--after", "y", "--before", "z"]].map(args => ({ args })))("refuses invalid CLI arguments before reading files: %j", async ({ args }) => {
  await expect(compareResearchCli(args)).rejects.toThrow("usage");
});
it("rejects oversize files, invalid UTF-8 and malformed mapping files", async () => {
  const f = await files();
  await writeFile(f.after, "x".repeat(524_289));
  await expect(compareResearchCli(f.args)).rejects.toMatchObject({ code: "input-too-large" });
  await writeFile(f.after, Buffer.from([0xc0, 0xaf]));
  await expect(compareResearchCli(f.args)).rejects.toThrow();
  await writeFile(f.after, await readFile(f.before));
  const pairs = join(f.directory, "pairs.json"); await writeFile(pairs, "null");
  await expect(compareResearchCli([...f.args, "--matches", pairs])).rejects.toMatchObject({ code: "invalid-target-matches" });
});
it("executes the real CLI entry point and keeps private input and OS file paths out of stderr", async () => {
  const f = await files();
  const output = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/compare-research.mts", ...f.args], { timeout: 10_000 });
  expect(output.stderr).toBe(""); expect(JSON.parse(output.stdout).sameReceipt).toBe(true);
  await writeFile(f.after, "FORBIDDEN_PRIVATE_CONTENT");
  const failure = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/compare-research.mts", ...f.args], { timeout: 10_000 }).catch(error => error);
  expect(failure.code).toBe(1); expect(failure.stdout).toBe("");
  expect(failure.stderr).toContain("invalid-receipt"); expect(failure.stderr).not.toContain("FORBIDDEN_PRIVATE_CONTENT");
  expect(failure.stderr).not.toContain(f.directory);
});

for (const option of ["--before", "--after", "--matches"]) {
  async function refuseInput(f: Awaited<ReturnType<typeof files>>, input: string) {
    const output = join(f.directory, "must-not-be-created.json");
    const args = option === "--matches" ? [...f.args, option, input] : f.args.map((value, index) =>
      index > 0 && f.args[index - 1] === option ? input : value);
    const failure = await promisify(execFile)(process.execPath,
      ["--import", "tsx", "scripts/compare-research.mts", ...args, "--output", output],
      { timeout: 5000, maxBuffer: 65_536 }).catch(error => error);
    expect(failure.code).toBe(1); expect(failure.killed).not.toBe(true);
    expect(failure.stdout).toBe(""); expect(failure.stderr).toContain("Comparison refused (");
    expect(failure.stderr).not.toContain(f.directory);
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  }
  it(`refuses a directory at ${option} without creating output`, async () => {
    const f = await files(); await refuseInput(f, f.directory);
  }, 10_000);
  it.runIf(process.platform !== "win32")(`refuses a FIFO at ${option} without waiting for a writer`, async () => {
    const f = await files(), fifo = join(f.directory, "private-input.fifo");
    await promisify(execFile)("mkfifo", [fifo]);
    await refuseInput(f, fifo);
  }, 10_000);
}
