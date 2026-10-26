import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { literatureBackupFixture } from "../../test-support/literature-backup-fixture";
import { MAX_LITERATURE_BYTES, serializeLiteratureWorkspace } from "./literature-workspace";
import { inspectLiteratureCli } from "./literature-inspection-cli";

const execute = promisify(execFile), folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) {
  expect(resolve(folder).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  await rm(folder, { recursive: true, force: true });
} });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "keryx-library-inspection-")); folders.push(dir);
  const input = join(dir, "PRIVATE_BACKUP_PATH.json"), raw = serializeLiteratureWorkspace(literatureBackupFixture());
  await writeFile(input, raw); return { dir, input, raw, args: ["--input", input] };
}
it("returns aggregate JSON without private text or input mutation, including BOM files", async () => {
  const f = await fixture(); await writeFile(f.input, "\uFEFF" + f.raw);
  const result = await inspectLiteratureCli(f.args);
  expect(JSON.parse(result!)).toMatchObject({ format: "keryx-literature-inspection-v1", count: 2, screening: { include: 1, exclude: 1 } });
  expect(result).not.toContain("PRIVATE_"); expect(result).not.toContain("https://");
  expect(await readFile(f.input, "utf8")).toBe("\uFEFF" + f.raw);
});
it("creates only a new requested output and preserves existing output/input bytes", async () => {
  const f = await fixture(), output = join(f.dir, "summary.json");
  expect(await inspectLiteratureCli([...f.args, "--output", output])).toBeNull();
  const raw = await readFile(output, "utf8"); expect(JSON.parse(raw).count).toBe(2);
  if (process.platform !== "win32") expect((await stat(output)).mode & 0o077).toBe(0);
  await expect(inspectLiteratureCli([...f.args, "--output", output])).rejects.toMatchObject({ code: "EEXIST" });
  await expect(inspectLiteratureCli([...f.args, "--output", f.input])).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(output, "utf8")).toBe(raw); expect(await readFile(f.input, "utf8")).toBe(f.raw);
});
it("rejects malformed arguments before file I/O and offers explicit help", async () => {
  for (const args of [[], ["--input"], ["--output", "PRIVATE_PATH"], ["--input", "PRIVATE_PATH", "--format", "json"],
    ["--input", "PRIVATE_PATH", "--input", "OTHER_PATH"], ["--input", "PRIVATE_PATH", "--output"], ["--help", "extra"]])
    await expect(inspectLiteratureCli(args)).rejects.toThrow("usage");
  expect(await inspectLiteratureCli(["--help"])).toContain("--input library.json");
});
it("refuses nonregular, oversized or malformed UTF-8 files before creating output", async () => {
  const f = await fixture(), output = join(f.dir, "must-not-exist.json");
  await expect(inspectLiteratureCli(["--input", f.dir, "--output", output])).rejects.toThrow();
  for (const invalid of [Buffer.alloc(MAX_LITERATURE_BYTES + 1, 32), Buffer.from([0xc3, 0x28]), "PRIVATE_INVALID_BACKUP"]) {
    await writeFile(f.input, invalid);
    await expect(inspectLiteratureCli([...f.args, "--output", output])).rejects.toThrow();
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  }
});
it("executes the actual CLI and keeps private data and OS paths out of stderr", async () => {
  const f = await fixture();
  const good = await execute(process.execPath, ["--import", "tsx", "scripts/inspect-literature.mts", ...f.args], { timeout: 10_000 });
  expect(JSON.parse(good.stdout).count).toBe(2); expect(good.stdout).not.toContain("PRIVATE_"); expect(good.stderr).toBe("");
  await writeFile(f.input, "PRIVATE_BROKEN_CONTENT");
  const bad = await execute(process.execPath, ["--import", "tsx", "scripts/inspect-literature.mts", ...f.args], { timeout: 10_000 }).catch(error => error);
  expect(bad.code).toBe(1); expect(bad.stdout).toBe(""); expect(bad.stderr).toContain("invalid-backup-or-file-unavailable");
  expect(bad.stderr).not.toContain("PRIVATE_"); expect(bad.stderr).not.toContain(f.dir);
  const missing = await execute(process.execPath, ["--import", "tsx", "scripts/inspect-literature.mts", "--input", join(f.dir, "PRIVATE_MISSING_FILE")], { timeout: 10_000 }).catch(error => error);
  expect(missing.code).toBe(1); expect(missing.stdout).toBe("");
  expect(missing.stderr).not.toContain("PRIVATE_"); expect(missing.stderr).not.toContain(f.dir);
}, 35_000);
it.skipIf(process.platform === "win32")("refuses an unwritten FIFO in the real CLI without waiting for a writer", async () => {
  const f = await fixture(), fifo = join(f.dir, "private.fifo"); await execute("mkfifo", [fifo]);
  const bad = await execute(process.execPath, ["--import", "tsx", "scripts/inspect-literature.mts", "--input", fifo], { timeout: 5000 }).catch(error => error);
  expect(bad.code).toBe(1); expect(bad.killed).not.toBe(true); expect(bad.stdout).toBe(""); expect(bad.stderr).not.toContain(f.dir);
}, 10_000);
