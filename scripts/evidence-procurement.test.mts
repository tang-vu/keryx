import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEvidenceProcurementPacket, runEvidenceProcurement } from "./evidence-procurement.mts";
import { MAX_PROCUREMENT_BYTES } from "../lib/evidence-procurement/contracts.ts";
import { buildEvidenceProcurement } from "../lib/evidence-procurement/engine.ts";
import { exportEvidenceProcurement } from "../lib/evidence-procurement/export.ts";

const packet = () => ({ version: 1, scope: "private-evidence-procurement", request: {
  id: "cli-fixture", network: "eip155:5042002", decision: "PRIVATE_DECISION: identify missing benchmark evidence.",
  budgetMicroUsdc: "50000", expiresAt: "2099-10-13T12:00:00.000Z",
  requirements: [{ id: "latency", question: "What is measured latency?", priority: 10, status: "missing" }],
}, offers: [], selectedOfferIds: [], deliveries: [], reviews: [] });
let folder: string, input: string;
beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-12T12:00:00.000Z"));
  folder = await mkdtemp(join(tmpdir(), "keryx-procurement-")); input = join(folder, "input.json");
  await writeFile(input, JSON.stringify(packet()), { mode: 0o600 });
});
afterEach(async () => { vi.restoreAllMocks(); await rm(folder, { recursive: true, force: true }); });

it("prints only the recomputed private shared result without provider calls", async () => {
  const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No provider request"));
  await runEvidenceProcurement(["--file", input]);
  expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual({ procurement: await buildEvidenceProcurement(packet()) });
  expect(http).not.toHaveBeenCalled();
});
it("exports only validated original inputs for roundtrip and refuses to overwrite", async () => {
  const output = join(folder, "export.json"); await runEvidenceProcurement(["--file", input, "--out", output]);
  expect(JSON.parse(await readFile(output, "utf8"))).toEqual(packet());
  expect(await readEvidenceProcurementPacket(output)).toEqual(packet());
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("PRIVATE_DECISION");
  if (process.platform !== "win32") expect((await stat(output)).mode & 0o077).toBe(0);
  const before = await readFile(output);
  await expect(runEvidenceProcurement(["--file", input, "--out", output])).rejects.toThrow();
  expect(await readFile(output)).toEqual(before);
});
it("rejects special files, oversized bytes, invalid UTF-8 and derived outputs", async () => {
  await expect(readEvidenceProcurementPacket(folder)).rejects.toThrow();
  for (const bytes of [Buffer.alloc(MAX_PROCUREMENT_BYTES + 1, 32), Buffer.from([0xc3, 0x28]),
    Buffer.from(JSON.stringify(await buildEvidenceProcurement(packet())))]) {
    await writeFile(input, bytes); await expect(runEvidenceProcurement(["--file", input])).rejects.toThrow();
  }
  expect(console.log).not.toHaveBeenCalled();
});
it("rejects ambiguous or unsupported options before reading a file", async () => {
  for (const args of [[], ["--file"], ["--file", input, "--file", input], ["--file", input, "--pay"],
    ["--help", "--file", input], ["--out", input], ["--file", "--out"], ["--file", "missing", "--format", "SECRET_FORMAT"],
    ["--file", input, "--format", "csv", "--format", "csv"], ["--file", input, "--format"]])
    await expect(runEvidenceProcurement(args)).rejects.toThrow();
  expect(console.log).not.toHaveBeenCalled();
});
it.each(["markdown", "csv"])("prints and privately saves the same %s receipt without overwrite or provider I/O", async format => {
  const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No transport"));
  const receipt = await exportEvidenceProcurement(packet(), format);
  await runEvidenceProcurement(["--file", input, "--format", format]);
  expect(vi.mocked(console.log).mock.calls[0][0]).toBe(receipt.text); vi.mocked(console.log).mockClear();
  const output = join(folder, `receipt.${receipt.extension}`);
  await runEvidenceProcurement(["--file", input, "--format", format, "--out", output]);
  expect(await readFile(output, "utf8")).toBe(receipt.text); expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("PRIVATE_DECISION");
  if (process.platform !== "win32") expect((await stat(output)).mode & 0o077).toBe(0);
  await expect(runEvidenceProcurement(["--file", input, "--format", format, "--out", output])).rejects.toThrow();
  expect(await readFile(output, "utf8")).toBe(receipt.text);
  await expect(readEvidenceProcurementPacket(output)).rejects.toThrow(); expect(http).not.toHaveBeenCalled();
});
it("retains explicit JSON packet output and creates no file when formatted export refuses private controls", async () => {
  const output = join(folder, "packet.json");
  await runEvidenceProcurement(["--file", input, "--format", "json", "--out", output]);
  expect(await readEvidenceProcurementPacket(output)).toEqual(packet());
  const privatePacket = packet(); privatePacket.request.decision += "\u0000";
  await writeFile(input, JSON.stringify(privatePacket));
  const refused = join(folder, "refused.csv");
  await expect(runEvidenceProcurement(["--file", input, "--format", "csv", "--out", refused])).rejects.toThrow("non-displayable");
  await expect(stat(refused)).rejects.toMatchObject({ code: "ENOENT" }); expect(await readEvidenceProcurementPacket(input)).toEqual(privatePacket);
});
