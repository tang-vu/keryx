import { afterAll, beforeAll, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { actualReadPacketHash, MAX_READ_PACKET_BYTES } from "../lib/research-audit/actual-read-record.ts";
import { MAX_SIGNED_DECISION_BUNDLE_BYTES } from "../lib/research-audit/signed-decision-bundle.ts";

let directory: string;
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "keryx-decision-bundle-")); });
afterAll(async () => {
  const path = relative(tmpdir(), directory);
  if (!path.startsWith("keryx-decision-bundle-") || path.includes("..") || isAbsolute(path)) throw Error("Unsafe fixture cleanup");
  await rm(directory, { recursive: true, force: true });
});
const key = generateKeyPairSync("ed25519"), signingKeyPem = key.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeyPem = key.publicKey.export({ format: "pem", type: "spki" }).toString();
const packet = { schema: 1, policy: "actual-post-portfolio-read-v1", coverage: "post-portfolio-checkpoints", monetaryAuthority: "qualified-assertions-only",
  records: [{ sequence: 0, candidate: 1, round: 0, proposal: "BUY", plan: "BUY", facts: "assertions",
    check: { kind: "channel", creatorFree: false, cache: false }, outcome: { action: "BUY", rule: "delivery-channel" },
    amounts: { priceMicros: null, remainingMicros: null } }] };
const command = (args: string[], env: NodeJS.ProcessEnv = {}, timeout = 15000) => spawnSync(process.execPath, ["--import", "tsx", "scripts/decision-bundle.mts", ...args],
  { cwd: process.cwd(), encoding: "utf8", timeout, maxBuffer: 400 * 1024,
    env: { ...process.env, KERYX_AUDIT_SIGNING_KEY_PEM: "", KERYX_AUDIT_TRUSTED_PUBLIC_KEY_PEM: "", ...env } });

it("documents offline commands and never prints a key or touches application state for help", () => {
  const result = command(["--help"], { KERYX_AUDIT_SIGNING_KEY_PEM: "SECRET_SENTINEL", KERYX_AUDIT_TRUSTED_PUBLIC_KEY_PEM: "PUBLIC_SENTINEL" });
  expect(result.status).toBe(0); expect(result.stdout).toContain("Signature/integrity cannot prove settlement");
  expect(result.stdout).not.toContain("SECRET_SENTINEL"); expect(result.stdout).not.toContain("PUBLIC_SENTINEL");
  expect(command(["--help", "extra"]).status).toBe(1);
});

it.skipIf(process.platform === "win32")("refuses a FIFO without waiting for a writer", () => {
  const fifo = join(directory, "unsupported-input.fifo");
  const created = spawnSync("mkfifo", [fifo], { encoding: "utf8", timeout: 2000 });
  expect(created.error).toBeUndefined(); expect(created.status).toBe(0);
  const result = command(["anchor", fifo], {}, 5000);
  expect(result.error).toBeUndefined(); expect(result.signal).toBeNull();
  expect(result.status).toBe(1); expect(result.stdout).toBe("");
  expect(result.stderr).toBe("Decision bundle refused the input. Run --help for the offline contract.\n");
});

it("exports only a signed public snapshot and verifies offline against separate public PEM and retained digests", async () => {
  const packetFile = join(directory, "packet.json"), publicFile = join(directory, "public.pem"), bundleFile = join(directory, "bundle.json"), reportDigest = "a".repeat(64);
  await writeFile(packetFile, JSON.stringify(packet)); await writeFile(publicFile, publicKeyPem);
  const signed = command(["sign", packetFile, reportDigest], { KERYX_AUDIT_SIGNING_KEY_PEM: signingKeyPem });
  expect(signed.error).toBeUndefined(); expect(signed.status).toBe(0); expect(signed.stderr).toBe("");
  expect(signed.stdout).not.toContain("PRIVATE KEY"); const bundle = JSON.parse(signed.stdout); await writeFile(bundleFile, signed.stdout);
  const trusted = command(["anchor", publicFile]); expect(trusted.status).toBe(0); expect(JSON.parse(trusted.stdout).keyId).toBe(bundle.envelope.keyId);
  const digest = await actualReadPacketHash(packet), verified = command(["verify", bundleFile, publicFile, digest, reportDigest]);
  expect(verified.status).toBe(0); expect(JSON.parse(verified.stdout)).toMatchObject({ verified: true, signatureScope: "export-snapshot",
    settlement: "unproven", truth: "unproven", completeness: "unproven", independentTimestamp: "unproven" });
  const fromEnv = command(["verify", bundleFile, "--env"], { KERYX_AUDIT_TRUSTED_PUBLIC_KEY_PEM: publicKeyPem });
  expect(fromEnv.status).toBe(0);
  expect(command(["verify", bundleFile]).status).toBe(1);
  expect(command(["verify", bundleFile, publicFile, "b".repeat(64)]).status).toBe(1);
  bundle.envelope.exportedAt = "2026-10-13T12:00:00.000Z"; await writeFile(bundleFile, JSON.stringify(bundle));
  expect(command(["verify", bundleFile, publicFile]).status).toBe(1);
});

it("refuses absent audit key, embedded self-anchor, malformed/truncated/private/oversized input and invalid UTF8 without context", async () => {
  const file = join(directory, "PRIVATE_PATH_SENTINEL.json"), publicFile = join(directory, "trusted.pem");
  await writeFile(publicFile, publicKeyPem); await writeFile(file, JSON.stringify(packet));
  for (const result of [command(["sign", file]), command(["sign", file], { KERYX_AUDIT_SIGNING_KEY_PEM: "PRIVATE_KEY_SENTINEL" })]) {
    expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("PRIVATE");
  }
  const inputs = ["{", JSON.stringify({ ...packet, question: "PRIVATE_BODY_SENTINEL" }),
    Buffer.alloc(MAX_READ_PACKET_BYTES + 1, 32), Buffer.from([123, 34, 255, 34, 58, 49, 125])];
  for (const input of inputs) {
    await writeFile(file, input);
    const result = command(["sign", file], { KERYX_AUDIT_SIGNING_KEY_PEM: signingKeyPem });
    expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("PRIVATE");
  }
  await writeFile(file, Buffer.alloc(MAX_SIGNED_DECISION_BUNDLE_BYTES + 1, 32));
  expect(command(["verify", file, publicFile]).status).toBe(1);
  expect(command(["anchor", directory]).status).toBe(1);
  await writeFile(file, JSON.stringify(packet));
  const signed = command(["sign", file], { KERYX_AUDIT_SIGNING_KEY_PEM: signingKeyPem }); await writeFile(file, signed.stdout);
  // The bundle contains a public key, but --env without an external PEM refuses it.
  expect(command(["verify", file, "--env"]).status).toBe(1);
});
