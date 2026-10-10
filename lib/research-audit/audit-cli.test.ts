import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { createReadCheckpointCapture } from "../agent/read-checkpoint-capture";
import { actualReadCheckpoint } from "./actual-read-policy";

let directory: string;
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "keryx-offline-audit-")); });
afterAll(async () => {
  const path = relative(tmpdir(), directory);
  if (!path.startsWith("keryx-offline-audit-") || path.includes("..") || isAbsolute(path)) throw new Error("Unsafe fixture cleanup");
  await rm(directory, { recursive: true, force: true });
});
const command = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/research-audit.mts", ...args],
  { cwd: process.cwd(), encoding: "utf8", timeout: 15000, maxBuffer: 128 * 1024 });

it("verifies actual checkpoints offline only against a separately retained digest", async () => {
  const collector = createReadCheckpointCapture(true), check = { kind: "channel", creatorFree: false, cache: false } as const;
  collector.append(check, actualReadCheckpoint(check), { candidate: 1, round: 0, proposal: "BUY", plan: "BUY", price: 0.002 });
  const capture = collector.finish(); if (!capture || capture.status !== "available") throw Error("Fixture unavailable");
  const file = join(directory, "actual-checkpoint.json"); await writeFile(file, JSON.stringify(capture.packet));
  const verified = command(["verify-actual", file, capture.retainedDigest]); expect(verified.status).toBe(0);
  expect(JSON.parse(verified.stdout)).toMatchObject({ verified: true, sourceAuthenticity: "unproven", paymentAnchoring: "unproven" });
  expect(command(["verify-actual", file]).status).toBe(1);
  await writeFile(file, JSON.stringify(capture)); // An uploaded packet/hash pair cannot self-attest.
  expect(command(["verify-actual", file, capture.retainedDigest]).status).toBe(1);
  await writeFile(file, JSON.stringify(capture.packet).padEnd(256 * 1024 + 1, " "));
  expect(command(["verify-actual", file, capture.retainedDigest]).status).toBe(1);
});

it("creates and verifies a record in a fresh process using a retained digest", async () => {
  const input = await readFile("examples/research-audit/read-input.json", "utf8"), file = join(directory, "input.json");
  await writeFile(file, input);
  const creation = command(["record", file]);
  expect(creation.error).toBeUndefined(); expect(creation.status).toBe(0);
  const output = JSON.parse(creation.stdout), recordFile = join(directory, "record.json");
  await writeFile(recordFile, JSON.stringify(output.record));
  const verified = command(["verify", recordFile, output.hash]);
  expect(verified.status).toBe(0); expect(JSON.parse(verified.stdout)).toEqual({ verified: true });
  output.record.input.priceMicros = "12";
  await writeFile(recordFile, JSON.stringify(output.record));
  expect(command(["verify", recordFile, output.hash]).status).toBe(1);
});
it("refuses private unexpected fields without echoing their input or path", async () => {
  const input = JSON.parse(await readFile("examples/research-audit/read-input.json", "utf8"));
  input.question = "private sentinel question";
  const file = join(directory, "private-sentinel-path.json"); await writeFile(file, JSON.stringify(input));
  const result = command(["record", file]);
  expect(result.status).toBe(1); expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("private sentinel"); expect(result.stderr).not.toContain("private-sentinel-path");
});
it("bounds the actual file and rejects malformed UTF-8", async () => {
  const file = join(directory, "oversized.json"); await writeFile(file, Buffer.alloc(2 * 1024 * 1024 + 1, 32));
  expect(command(["record", file]).status).toBe(1);
  await writeFile(file, Buffer.from([123, 34, 0xff, 34, 58, 49, 125]));
  expect(command(["record", file]).status).toBe(1);
});
