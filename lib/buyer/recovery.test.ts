import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { authorizationWithNonce, type BuyerRequirement } from "./protocol";
import { buyerJobId } from "./policy";
import { createBuyerJournal, writeBuyerFile } from "./journal";
import { importBuyerRecovery, exportBuyerRecovery } from "./recovery-file";
import { encodeBuyerRecovery, parseBuyerRecovery } from "./recovery";
import { resumeResearch } from "./client";

const requirement: BuyerRequirement = { scheme: "exact", network: "eip155:5042002",
  asset: "0x3600000000000000000000000000000000000000", amount: "50000", payTo: `0x${"b".repeat(40)}`,
  maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } };
const authorization = authorizationWithNonce(`0x${"a".repeat(40)}`, requirement, `0x${"1".repeat(64)}`);
const intent = { schema: "keryx-buyer-intent-v1" as const,
  request: { question: "How does recovery work?", budget: 0.03, researchMode: "quick" as const, packageVersion: "1.0.0" as const, responseMode: "async" as const },
  requirement, authorization, queryId: buyerJobId(authorization) };
const acknowledgement = { httpStatus: 202, evidence: { success: true as const, payer: authorization.from, network: requirement.network, transaction: "synthetic-ack" } };
const roots: string[] = [];
async function root() { const path = await mkdtemp(join(tmpdir(), "keryx-recovery-")); roots.push(path); return path; }
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });

it("round trips saved seller evidence through Node and retains GET-only recovery", async () => {
  const path = await root(); const original = join(path, "original"); const restored = join(path, "restored"); const file = join(path, "recovery.json");
  await createBuyerJournal(original, intent);
  await writeBuyerFile(original, "payment-response.json", { ...acknowledgement, evidence: { ...acknowledgement.evidence, authority: "seller-relayed-payment-response", independentlyVerified: false } });
  await exportBuyerRecovery(original, file);
  expect(parseBuyerRecovery(await readFile(file, "utf8"))).toEqual({ schema: "keryx-buyer-recovery-v1", intent, acknowledgement });
  await importBuyerRecovery(file, restored);
  const http = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 404 }));
  const result = await resumeResearch(restored, http);
  expect(result.status).toBe("not_found_uncertain");
  expect(result.payment.state).toBe("seller_reported_settled");
  expect(result.payment.evidence?.independentlyVerified).toBe(false);
  expect(http).toHaveBeenCalledTimes(1);
  expect(http.mock.calls[0][1]).toEqual({ headers: { accept: "application/json" } });
  expect(await readdir(restored)).not.toContain("submission.json");
  await expect(importBuyerRecovery(file, restored)).rejects.toThrow();
  await expect(exportBuyerRecovery(original, file)).rejects.toThrow();
  await expect(createBuyerJournal(restored, intent)).rejects.toThrow();
});

it("keeps legacy or null-acknowledgement recovery uncertain", async () => {
  const path = await root();
  for (const [name, text] of [["legacy", JSON.stringify(intent)], ["null", encodeBuyerRecovery(intent, { httpStatus: 500, evidence: null })]]) {
    const file = join(path, `${name}.json`); const state = join(path, name);
    await writeFile(file, text);
    await importBuyerRecovery(file, state);
    const result = await resumeResearch(state, async () => new Response("{}", { status: 404 }));
    expect(result.payment).toEqual({ state: "unconfirmed", evidence: null });
  }
});

it.each([
  { schema: "keryx-buyer-recovery-v2", intent },
  { schema: "keryx-buyer-recovery-v1", intent, signature: "forbidden" },
  { schema: "keryx-buyer-recovery-v1", intent, submission: "prepared" },
  { schema: "keryx-buyer-recovery-v1", intent, acknowledgement: { ...acknowledgement, evidence: { ...acknowledgement.evidence, payer: requirement.payTo } } },
  { schema: "keryx-buyer-recovery-v1", intent, acknowledgement: { ...acknowledgement, evidence: { ...acknowledgement.evidence, independentlyVerified: true } } },
  { schema: "keryx-buyer-recovery-v1", intent, acknowledgement: { ...acknowledgement, evidence: { ...acknowledgement.evidence, signature: "forbidden" } } },
])("refuses unsupported authority or payload fields", value => {
  expect(() => parseBuyerRecovery(JSON.stringify(value))).toThrow();
});

it("refuses malformed, oversized and mismatched identity before creating a state directory", async () => {
  const path = await root(); const file = join(path, "input.json"); const state = join(path, "rejected");
  for (const text of ["{", " ".repeat(65537), JSON.stringify({ ...intent, queryId: "wrong" })]) {
    await writeFile(file, text);
    await expect(importBuyerRecovery(file, state)).rejects.toThrow();
    expect(await readdir(path)).not.toContain("rejected");
  }
});

it("executes actual CLI import and export without a wallet or network", async () => {
  const path = await root(); const input = join(path, "input.json"); const state = join(path, "cli"); const output = join(path, "output.json");
  const guard = join(path, "deny-network.mjs");
  await writeFile(guard, "globalThis.fetch=()=>{throw new Error('Network forbidden')};\n");
  await writeFile(input, encodeBuyerRecovery(intent, acknowledgement));
  for (const args of [["import", "--file", input, "--state", state], ["export", "--state", state, "--file", output]]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--import", pathToFileURL(guard).href, "scripts/buyer-agent.mts", ...args], {
      encoding: "utf8", timeout: 30000, env: { ...process.env, KERYX_BUYER_PRIVATE_KEY: "" },
    });
    expect(result.stderr).toBe(""); expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(intent.queryId);
  }
  expect(parseBuyerRecovery(await readFile(output, "utf8"))).toEqual(parseBuyerRecovery(await readFile(input, "utf8")));
}, 60000);
