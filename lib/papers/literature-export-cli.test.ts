import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { literatureBackupFixture } from "../../test-support/literature-backup-fixture";
import { exportLiteratureCli, MAX_LITERATURE_SELECTION_BYTES } from "./literature-export-cli";
import { MAX_LITERATURE_BYTES, serializeLiteratureWorkspace } from "./literature-workspace";

const folders: string[] = [], execute = promisify(execFile);
afterEach(async () => { for (const folder of folders.splice(0)) {
  expect(resolve(folder).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  await rm(folder, { recursive: true, force: true });
} });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "keryx-library-export-")); folders.push(dir);
  const input = join(dir, "private-library.json"), raw = serializeLiteratureWorkspace(literatureBackupFixture());
  await writeFile(input, raw); return { dir, input, raw, args: ["--input", input, "--format", "ris"] };
}
it.each(["bibtex", "ris", "csl-json"])("deliberately exports %s without changing private input", async format => {
  const f = await fixture(); const output = await exportLiteratureCli(["--input", f.input, "--format", format, "--screening", "include"]);
  expect(output).not.toContain("PRIVATE_"); expect(output).toContain("Peer review unknown"); expect(output).not.toContain("v99");
  expect(await readFile(f.input, "utf8")).toBe(f.raw);
});
it("writes a new selected output and refuses to overwrite it or its input", async () => {
  const f = await fixture(), output = join(f.dir, "chosen.ris");
  expect(await exportLiteratureCli([...f.args, "--output", output])).toBeNull();
  const retained = await readFile(output, "utf8"); expect(retained).not.toContain("PRIVATE_");
  await expect(exportLiteratureCli([...f.args, "--output", output])).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(output, "utf8")).toBe(retained);
  await expect(exportLiteratureCli([...f.args, "--output", f.input])).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(f.input, "utf8")).toBe(f.raw);
});
it("rejects malformed arguments before opening any path and provides explicit help", async () => {
  for (const args of [[], ["--input", "PRIVATE_NONEXISTENT"], ["--input", "PRIVATE_NONEXISTENT", "--format", "csv"],
    ["--input", "PRIVATE_NONEXISTENT", "--format", "ris", "--format", "bibtex"],
    ["--input", "PRIVATE_NONEXISTENT", "--format", "ris", "--screening", "invalid"],
    ["--input", "PRIVATE_NONEXISTENT", "--format", "ris", "--output"], ["--help", "extra"], ["--unknown", "x"]])
    await expect(exportLiteratureCli(args)).rejects.toThrow("usage");
  expect(await exportLiteratureCli(["--help"])).toContain("--format bibtex|ris|csl-json");
});
it("refuses nonregular, oversized and malformed UTF-8 inputs without creating output", async () => {
  const f = await fixture(), output = join(f.dir, "must-not-exist.ris");
  await expect(exportLiteratureCli(["--input", f.dir, "--format", "ris", "--output", output])).rejects.toThrow();
  await writeFile(f.input, Buffer.alloc(MAX_LITERATURE_BYTES + 1, 32));
  await expect(exportLiteratureCli([...f.args, "--output", output])).rejects.toThrow();
  await writeFile(f.input, Buffer.concat([Buffer.from(f.raw.slice(0, -1)), Buffer.from([0xc3, 0x28]), Buffer.from("}")]));
  await expect(exportLiteratureCli([...f.args, "--output", output])).rejects.toThrow();
  await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(f.input, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(f.raw)]));
  expect(await exportLiteratureCli(f.args)).toContain("Literal metadata 🧪");
});
it.skipIf(process.platform === "win32")("refuses a POSIX FIFO without waiting for a writer", async () => {
  const f = await fixture(), fifo = join(f.dir, "private-fifo"); await execute("mkfifo", [fifo]);
  await expect(exportLiteratureCli(["--input", fifo, "--format", "ris"])).rejects.toThrow();
});
it("runs the actual CLI with metadata-only stdout and fixed private stderr", async () => {
  const f = await fixture();
  const good = await execute(process.execPath, ["--import", "tsx", "scripts/export-literature.mts", ...f.args], { timeout: 10_000 });
  expect(good.stdout).toContain("TY  - MANSCPT"); expect(good.stdout).not.toContain("PRIVATE_"); expect(good.stderr).toBe("");
  await writeFile(f.input, "PRIVATE_BROKEN_BACKUP");
  const bad = await execute(process.execPath, ["--import", "tsx", "scripts/export-literature.mts", ...f.args], { timeout: 10_000 }).catch(error => error);
  expect(bad.code).toBe(1); expect(bad.stdout).toBe("");
  expect(bad.stderr).toContain("invalid-backup-or-file-unavailable");
  expect(bad.stderr).not.toContain(f.input); expect(bad.stderr).not.toContain("PRIVATE_BROKEN_BACKUP");
});
it("reads exact URL selections, including BOM/empty lists, without changing either input", async () => {
  const f = await fixture(), selected = join(f.dir, "selected.json"), url = literatureBackupFixture().entries[1].paper.url;
  const raw = "\uFEFF" + JSON.stringify([url]); await writeFile(selected, raw);
  const output = await exportLiteratureCli([...f.args, "--selection", selected]);
  expect(output).toContain("v99"); expect(output).not.toContain("PRIVATE_");
  expect(await readFile(selected, "utf8")).toBe(raw); expect(await readFile(f.input, "utf8")).toBe(f.raw);
  const filtered = await exportLiteratureCli([...f.args, "--selection", selected, "--screening", "include"]);
  expect(filtered).toBe(""); await writeFile(selected, "[]");
  expect(await exportLiteratureCli([...f.args, "--selection", selected])).toBe("");
});
it("bounds original selection bytes and refuses malformed, duplicate or nonregular selections before output", async () => {
  const f = await fixture(), selected = join(f.dir, "selected.json"), output = join(f.dir, "must-not-exist.ris");
  const raw = JSON.stringify([literatureBackupFixture().entries[0].paper.url]);
  const padded = raw + " ".repeat(MAX_LITERATURE_SELECTION_BYTES - Buffer.byteLength(raw));
  await writeFile(selected, padded); expect(await exportLiteratureCli([...f.args, "--selection", selected])).toContain("TI  - ");
  for (const invalid of ["\uFEFF" + padded, Buffer.from([0xc0, 0xaf]), "{}", JSON.stringify(["https://arxiv.org/abs/PRIVATE_NOT_SAVED"]),
    JSON.stringify([literatureBackupFixture().entries[0].paper.url, literatureBackupFixture().entries[0].paper.url])]) {
    await writeFile(selected, invalid);
    await expect(exportLiteratureCli([...f.args, "--selection", selected, "--output", output])).rejects.toThrow();
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  }
  await expect(exportLiteratureCli([...f.args, "--selection", f.dir, "--output", output])).rejects.toThrow();
  for (const args of [[...f.args, "--selection"], [...f.args, "--selection", "PRIVATE_MISSING", "--selection", selected]])
    await expect(exportLiteratureCli(args)).rejects.toThrow("usage");
});
it("keeps missing selection URLs and selection paths out of real CLI stderr", async () => {
  const f = await fixture(), selected = join(f.dir, "PRIVATE_SELECTION_PATH.json");
  await writeFile(selected, '["https://arxiv.org/abs/PRIVATE_SELECTION_TOKEN"]');
  const bad = await execute(process.execPath, ["--import", "tsx", "scripts/export-literature.mts", ...f.args, "--selection", selected], { timeout: 10_000 }).catch(error => error);
  expect(bad.code).toBe(1); expect(bad.stdout).toBe("");
  expect(bad.stderr).toContain("invalid-backup-or-file-unavailable");
  expect(bad.stderr).not.toContain("PRIVATE_SELECTION"); expect(bad.stderr).not.toContain(f.dir);
});
it.skipIf(process.platform === "win32")("refuses an unwritten POSIX selection FIFO in the real CLI", async () => {
  const f = await fixture(), fifo = join(f.dir, "selection.fifo"); await execute("mkfifo", [fifo]);
  const bad = await execute(process.execPath, ["--import", "tsx", "scripts/export-literature.mts", ...f.args, "--selection", fifo], { timeout: 5000 }).catch(error => error);
  expect(bad.code).toBe(1); expect(bad.killed).not.toBe(true); expect(bad.stdout).toBe("");
}, 10_000);
