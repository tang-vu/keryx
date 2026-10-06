import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { buyResearch, prepareResearch, resumeResearch, submitPreparedResearch } from "./client";
import { readBuyerJournal } from "./journal";
import { exportBuyerRecovery, importBuyerRecovery } from "./recovery-file";
import { BUYER_ENDPOINT, BUYER_NETWORK, BUYER_USDC, BUYER_GATEWAY, buyerTypedData, type BuyerRequest, type BuyerRequirement } from "./protocol";

const guard = vi.hoisted(() => vi.fn());
vi.mock("../business-operator/canary-policy", () => ({ assertPreparedCanarySubmission: guard }));

// Synthetic signer only; fetch is always replaced with local fixtures.
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const payee = `0x${"2".repeat(40)}`;
const request: BuyerRequest = { question: "What does the original journal bind?", budget: 0.03,
  researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" };
const requirement: BuyerRequirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC,
  amount: "50000", payTo: payee, maxTimeoutSeconds: 691200,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const quote = (patch: Partial<BuyerRequirement> = {}) => new Response("{}", { status: 402,
  headers: { "payment-required": encode({ x402Version: 2, resource: { url: "/api/agent/ask" }, accepts: [{ ...requirement, ...patch }] }) } });
const roots: string[] = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "keryx-prepared-buyer-")); roots.push(root); return join(root, "job");
}
async function prepare(path: string) {
  return prepareResearch({ request, payee, maxTotalMicros: "100000", payer: account.address, directory: path }, async () => quote());
}
const sign = (a: Parameters<typeof buyerTypedData>[0]) => account.signTypedData(buyerTypedData(a));
const submission = (path: string, signer = vi.fn(sign)) => ({ directory: path, payer: account.address, sign: signer });
function transport() {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    return (init?.headers as Record<string, string>)["payment-signature"] ? new Response("{}") : quote();
  });
}
function paidCalls(http: ReturnType<typeof transport>) {
  return http.mock.calls.filter(([, init]) => (init?.headers as Record<string, string>)["payment-signature"]);
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const absolute = resolve(root);
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !absolute.includes("keryx-prepared-buyer-")) throw new Error("Unsafe fixture cleanup");
    await rm(absolute, { recursive: true, force: true });
  }
  guard.mockReset(); vi.restoreAllMocks();
});

describe("original prepared buyer submission", () => {
  it("prepares a frozen durable original without signing, payment header or attempt", async () => {
    const path = await directory(); const http = vi.fn<typeof fetch>().mockResolvedValue(quote());
    const prepared = await prepareResearch({ request, payee, maxTotalMicros: "100000", payer: account.address, directory: path }, http);
    expect(prepared.status).toBe("prepared");
    expect(prepared.intentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await readBuyerJournal(path)).toEqual(prepared.intent);
    expect(await readdir(path)).toEqual(["intent.json", "prepared.json"]);
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0][1]?.headers).toEqual({ "content-type": "application/json" });
    expect(guard).not.toHaveBeenCalled();
    expect(Object.isFrozen(prepared.intent.authorization)).toBe(true);
    expect(() => { prepared.intent.request.question = "replace original"; }).toThrow();
    for (const name of await readdir(path)) {
      const text = await readFile(join(path, name), "utf8");
      expect(text).not.toContain('"signature"'); expect(text).not.toContain("1".repeat(64));
    }
  });

  it("claims before signing and sends exactly the original body, nonce and terms once under concurrent submit", async () => {
    const path = await directory(); const prepared = await prepare(path); const http = transport();
    const signer = vi.fn(async (a: Parameters<typeof sign>[0]) => {
      const attempt = JSON.parse(await readFile(join(path, "submission.json"), "utf8"));
      expect(attempt).toMatchObject({ state: "submission_possible", queryId: prepared.queryId, intentDigest: prepared.intentDigest });
      expect(a).toEqual(prepared.intent.authorization);
      return sign(a);
    });
    const input = { ...submission(path, signer), expectedIntentDigest: prepared.intentDigest };
    const results = await Promise.allSettled([submitPreparedResearch(input, http), submitPreparedResearch(input, http)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(signer).toHaveBeenCalledTimes(1); expect(paidCalls(http)).toHaveLength(1);
    const [, init] = paidCalls(http)[0];
    expect(JSON.parse(init!.body as string)).toEqual(prepared.intent.request);
    const payment = JSON.parse(Buffer.from((init!.headers as Record<string, string>)["payment-signature"], "base64").toString());
    expect(payment.authorization).toEqual(prepared.intent.authorization);
    expect(await readBuyerJournal(path)).toEqual(prepared.intent);
    const retry = transport(); await expect(submitPreparedResearch(input, retry)).rejects.toThrow("one submission attempt");
    expect(retry).not.toHaveBeenCalled(); expect(signer).toHaveBeenCalledTimes(1);
  });

  it("trusted admission refusal leaves the unsigned original and foreign files untouched", async () => {
    const path = await directory(); const prepared = await prepare(path); const http = transport(); const input = submission(path);
    const foreign = join(roots[roots.length - 1], "foreign.json"); await writeFile(foreign, "owner data");
    const beforeDispatch = vi.fn((intent: typeof prepared.intent) => {
      expect(intent).toEqual(prepared.intent); expect(Object.isFrozen(intent.request)).toBe(true);
      throw new Error("No protected ledger admission");
    });
    await expect(submitPreparedResearch({ ...input, beforeDispatch }, http)).rejects.toThrow("No protected ledger admission");
    expect(input.sign).not.toHaveBeenCalled(); expect(paidCalls(http)).toHaveLength(0);
    expect(await readdir(path)).not.toContain("submission.json");
    expect(await readBuyerJournal(path)).toEqual(prepared.intent);
    expect(await readFile(foreign, "utf8")).toBe("owner data"); expect(guard).not.toHaveBeenCalled();
  });

  it.each(["submit", "buy"])("mandatory finite policy refuses %s even without an optional callback", async (mode) => {
    const path = await directory(); const http = transport(); const signer = vi.fn(sign);
    guard.mockImplementation(() => { throw new Error("Frozen finite policy"); });
    if (mode === "submit") await prepare(path);
    const operation = mode === "submit" ? submitPreparedResearch(submission(path, signer), http)
      : buyResearch({ request, payee, maxTotalMicros: "100000", payer: account.address, directory: path, sign: signer }, http);
    await expect(operation).rejects.toThrow("Frozen finite policy");
    expect(guard).toHaveBeenCalledTimes(1); expect(signer).not.toHaveBeenCalled();
    expect(paidCalls(http)).toHaveLength(0); expect(await readdir(path)).not.toContain("submission.json");
  });

  it.each([
    { amount: "60000" }, { maxTimeoutSeconds: 604860 }, { payTo: account.address },
    { asset: payee }, { network: "eip155:1" },
    { extra: { ...requirement.extra, verifyingContract: payee } },
  ])("refuses changed current quote before admission or signature: %j", async (patch) => {
    const path = await directory(); const prepared = await prepare(path); const input = submission(path);
    const http = vi.fn<typeof fetch>().mockResolvedValue(quote(patch as Partial<BuyerRequirement>));
    await expect(submitPreparedResearch(input, http)).rejects.toThrow();
    expect(input.sign).not.toHaveBeenCalled(); expect(guard).not.toHaveBeenCalled();
    expect(await readBuyerJournal(path)).toEqual(prepared.intent); expect(await readdir(path)).not.toContain("submission.json");
  });

  it.each(["request", "package", "requirement", "preparation", "expected-digest"])("refuses changed %s/readback before signing", async (field) => {
    const path = await directory(); const prepared = await prepare(path); const input = submission(path); const http = transport();
    if (field === "request") await writeFile(join(path, "intent.json"), JSON.stringify({ ...prepared.intent, request: { ...request, question: "Different paid original?" } }));
    if (field === "package") await writeFile(join(path, "intent.json"), JSON.stringify({ ...prepared.intent, request: { ...request, packageVersion: "changed" } }));
    if (field === "requirement") await writeFile(join(path, "intent.json"), JSON.stringify({ ...prepared.intent, requirement: { ...requirement, maxTimeoutSeconds: 604860 } }));
    if (field === "preparation") await writeFile(join(path, "prepared.json"), "{\"partial\":");
    await expect(submitPreparedResearch({ ...input, expectedIntentDigest: field === "expected-digest" ? `sha256:${"0".repeat(64)}` : prepared.intentDigest }, http)).rejects.toThrow();
    expect(http).not.toHaveBeenCalled(); expect(input.sign).not.toHaveBeenCalled(); expect(guard).not.toHaveBeenCalled();
    expect(await readdir(path)).not.toContain("submission.json");
  });

  it("refuses a different payer or a stale original authorization before quoting or signing", async () => {
    const path = await directory(); await prepare(path); const input = submission(path); const http = transport();
    await expect(submitPreparedResearch({ ...input, payer: payee }, http)).rejects.toThrow("payer");
    const later = Date.now() + 2 * 86400_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await expect(submitPreparedResearch(input, http)).rejects.toThrow("authorization");
    expect(input.sign).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled(); expect(guard).not.toHaveBeenCalled();
    expect(await readdir(path)).not.toContain("submission.json");
  });

  it("refuses original mutation during admission before claiming or signing", async () => {
    const path = await directory(); const prepared = await prepare(path); const input = submission(path); const http = transport();
    await expect(submitPreparedResearch({ ...input, beforeDispatch: async () => {
      await writeFile(join(path, "intent.json"), JSON.stringify({ ...prepared.intent, request: { ...request, question: "Changed during review?" } }));
    } }, http)).rejects.toThrow("changed");
    expect(input.sign).not.toHaveBeenCalled(); expect(paidCalls(http)).toHaveLength(0);
    expect(await readdir(path)).not.toContain("submission.json");
  });

  it("a failed signing attempt stays claimed and recovery only GETs the original", async () => {
    const path = await directory(); const prepared = await prepare(path); const http = transport();
    const signer = vi.fn(async () => { throw new Error("Signing interrupted"); });
    const input = submission(path, signer);
    await expect(submitPreparedResearch(input, http)).rejects.toThrow("Signing interrupted");
    expect(JSON.parse(await readFile(join(path, "submission.json"), "utf8")).queryId).toBe(prepared.queryId);
    expect(paidCalls(http)).toHaveLength(0);
    const retry = transport(); await expect(submitPreparedResearch(input, retry)).rejects.toThrow("one submission attempt");
    expect(retry).not.toHaveBeenCalled(); expect(signer).toHaveBeenCalledTimes(1);
    const recovery = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 404 }));
    expect((await resumeResearch(path, recovery)).status).toBe("not_found_uncertain");
    expect(recovery.mock.calls).toEqual([[`${BUYER_ENDPOINT}?queryId=${prepared.queryId}`, { headers: { accept: "application/json" } }]]);
  });

  it("refuses changed readback after signing without exposing its bearer or reopening the attempt", async () => {
    const path = await directory(); const prepared = await prepare(path); const http = transport();
    const signer = vi.fn(async (a: Parameters<typeof sign>[0]) => {
      await writeFile(join(path, "intent.json"), JSON.stringify({ ...prepared.intent, request: { ...request, question: "Changed while signing?" } }));
      return sign(a);
    });
    await expect(submitPreparedResearch(submission(path, signer), http)).rejects.toThrow("changed");
    expect(signer).toHaveBeenCalledTimes(1); expect(paidCalls(http)).toHaveLength(0);
    expect(await readdir(path)).toContain("submission.json");
  });

  it("a different EOA signature is rejected before exposure and permanently consumes the attempt", async () => {
    const path = await directory(); await prepare(path); const http = transport();
    const foreign = privateKeyToAccount(`0x${"3".repeat(64)}`);
    const signer = vi.fn((a: Parameters<typeof sign>[0]) => foreign.signTypedData(buyerTypedData(a)));
    const input = submission(path, signer);
    await expect(submitPreparedResearch(input, http)).rejects.toThrow("signature does not bind");
    await expect(submitPreparedResearch(input, transport())).rejects.toThrow("one submission attempt");
    expect(signer).toHaveBeenCalledTimes(1); expect(paidCalls(http)).toHaveLength(0);
    expect(await readdir(path)).toContain("submission.json");
  });

  it("policy freeze during signing retains the attempt and refuses bearer exposure", async () => {
    const path = await directory(); await prepare(path); const http = transport();
    const signer = vi.fn(async (a: Parameters<typeof sign>[0]) => {
      guard.mockImplementation(() => { throw new Error("Policy frozen during signing"); });
      return sign(a);
    });
    await expect(submitPreparedResearch(submission(path, signer), http)).rejects.toThrow("Policy frozen during signing");
    expect(signer).toHaveBeenCalledTimes(1); expect(paidCalls(http)).toHaveLength(0);
    expect(await readdir(path)).toContain("submission.json");
  });

  it.each(["", "{\"partial\":"])("a retained partial crash marker never permits signing (%j)", async (marker) => {
    const path = await directory(); await prepare(path); await writeFile(join(path, "submission.json"), marker);
    const input = submission(path); const http = transport();
    await expect(submitPreparedResearch(input, http)).rejects.toThrow("one submission attempt");
    expect(input.sign).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
    expect(await readFile(join(path, "submission.json"), "utf8")).toBe(marker);
  });

  it("lost POST acknowledgement stays uncertain and does not permit another signature/POST", async () => {
    const path = await directory(); const prepared = await prepare(path); const input = submission(path);
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(quote()).mockRejectedValueOnce(new Error("Transport lost"));
    expect((await submitPreparedResearch(input, http)).status).toBe("submission_uncertain");
    await expect(submitPreparedResearch(input, transport())).rejects.toThrow("one submission attempt");
    expect(input.sign).toHaveBeenCalledTimes(1); expect(http).toHaveBeenCalledTimes(2);
    expect(await readBuyerJournal(path)).toEqual(prepared.intent);
  });

  it("imported recovery never gains submission capability, even with a copied preparation record", async () => {
    const path = await directory(); await prepare(path); const parent = roots[roots.length - 1];
    const file = join(parent, "recovery.json"), restored = join(parent, "restored");
    await exportBuyerRecovery(path, file); await importBuyerRecovery(file, restored);
    await writeFile(join(restored, "prepared.json"), await readFile(join(path, "prepared.json")));
    const input = submission(restored); const http = transport();
    await expect(submitPreparedResearch(input, http)).rejects.toThrow("recovery-only");
    expect(input.sign).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
  });

  it("actual CLI prepare succeeds with private-key access forbidden and only an unsigned fixture quote", async () => {
    const path = await directory(); const parent = roots[roots.length - 1];
    const input = join(parent, "request.json"), bootstrap = join(parent, "unsigned-only.mjs");
    await writeFile(input, JSON.stringify(request));
    const paymentRequired = encode({ x402Version: 2, resource: { url: "/api/agent/ask" }, accepts: [requirement] });
    await writeFile(bootstrap, `process.env = new Proxy(process.env,{get(target,key){if(key==='KERYX_BUYER_PRIVATE_KEY')throw new Error('Private key read forbidden');return Reflect.get(target,key);}});\nglobalThis.fetch=async(url,init)=>{if(url!==${JSON.stringify(BUYER_ENDPOINT)}||init?.method!=='POST'||init?.headers?.['payment-signature'])throw new Error('Unexpected network operation');return new Response('{}',{status:402,headers:{'payment-required':${JSON.stringify(paymentRequired)}}});};\n`);
    const result = spawnSync(process.execPath, ["--import", "tsx", "--import", pathToFileURL(bootstrap).href,
      "scripts/buyer-agent.mts", "prepare", "--request", input, "--payee", payee, "--max-total", "0.10", "--payer", account.address, "--state", path],
      { encoding: "utf8", timeout: 30000, env: { ...process.env, KERYX_BUYER_PRIVATE_KEY: "", KERYX_BUSINESS_CANARY_FILE: "", KERYX_BUSINESS_CANARY_SHA256: "" } });
    expect(result.stderr).toBe(""); expect(result.status).toBe(0); expect(result.stdout).toContain('"status": "prepared"');
    expect(await readdir(path)).not.toContain("submission.json");
  }, 40000);
});
