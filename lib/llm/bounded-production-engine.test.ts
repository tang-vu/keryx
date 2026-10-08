import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoundedProductionEngine, configuredProductionModelAllowance, ProductionModelAllowance,
  type ProductionModelAllowancePolicy } from "./bounded-production-engine";
import { ReasoningOutputValidationError, ReasoningTransportError } from "./reasoning-engine";
import { ResearchPlanningError } from "./research-plan";

const roots: string[] = [];
const now = "2026-10-04T12:00:00.000Z";
const perCall = 20660;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function fixture(calls = 2, changes: Partial<ProductionModelAllowancePolicy> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-bounded-production-")); roots.push(root);
  fs.chmodSync(root, 0o700);
  const journalDirectory = path.join(root, "journal"); fs.mkdirSync(journalDirectory, { mode: 0o700 });
  const policy: ProductionModelAllowancePolicy = { format: "keryx-production-model-allowance-v1",
    priceCheckedOn: "2026-10-04", pricePolicyId: "deepseek-flash-observed-2026-09-30-v1",
    provider: "deepseek", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash",
    expiresAt: "2026-10-04T23:59:59.000Z", maximumMicroUsd: perCall * calls,
    maximumCalls: 45, maximumInputBytes: 32000, maximumOutputTokens: 8192, journalDirectory, ...changes };
  const file = path.join(root, "policy.json"); const text = JSON.stringify(policy);
  fs.writeFileSync(file, text, { mode: 0o600 });
  vi.stubEnv("KERYX_MODEL_ALLOWANCE_FILE", file); vi.stubEnv("KERYX_MODEL_ALLOWANCE_SHA256", sha(text));
  return { root, policy, file, digest: sha(text) };
}

// Windows has no directory-fsync primitive; production's default refuses before dispatch there.
// The reservation/exclusive-create tests still use actual files on Windows. Linux CI also tests
// the real fsync operation, and the ordinary factory never receives this unit-test substitute.
const flush = process.platform === "win32" ? () => {} : undefined;
function allowance() { return new ProductionModelAllowance(configuredProductionModelAllowance()!, flush); }
function slots(directory: string) { return fs.readdirSync(directory).filter(name => name.startsWith("reservation-")); }

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (!path.isAbsolute(root) || !root.startsWith(path.join(os.tmpdir(), "keryx-bounded-production-"))) throw Error("Unsafe test cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("production model allowance", () => {
  it("reserves the full dated peak ceiling across restarts, including a crash-created empty slot", () => {
    const { policy } = fixture(3);
    const first = allowance();
    expect(first.reservePerCallMicroUsd).toBe(perCall);
    first.reserve("small", "input", 2048);
    fs.writeFileSync(path.join(policy.journalDirectory, "reservation-0002.json"), "", { mode: 0o600 });
    const restarted = allowance();
    expect(restarted.reserve("again", "input", 2048).slot).toBe(3);
    expect(() => restarted.reserve("last", "input", 2048)).toThrow("exhausted");
    expect(slots(policy.journalDirectory)).toHaveLength(3);
  });

  it("holds both failed and successful HTTP calls, with reservation persisted before dispatch and no retries", async () => {
    const { policy } = fixture(2); let attempted = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      attempted++;
      expect(slots(policy.journalDirectory)).toHaveLength(attempted);
      const retained = JSON.parse(fs.readFileSync(path.join(policy.journalDirectory, `reservation-000${attempted}.json`), "utf8"));
      expect(retained.reserveMicroUsd).toBe(perCall);
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect(init.redirect).toBe("error");
      expect(JSON.parse(init.body as string).model).toBe("deepseek-v4-flash");
      if (attempted === 1) throw Error("uncertain network outcome with private provider detail");
      return Response.json({ choices: [{ message: { content: JSON.stringify({ claims: ["What is retained?"] }) }, finish_reason: "stop" }] });
    }));
    await expect(new BoundedProductionEngine("synthetic-test-key", allowance()).decompose("Recovery?"))
      .rejects.toThrow("reservation retained");
    expect(attempted).toBe(1);
    await expect(new BoundedProductionEngine("synthetic-test-key", allowance()).decompose("Recovery?"))
      .resolves.toEqual(["What is retained?"]);
    await expect(new BoundedProductionEngine("synthetic-test-key", allowance()).decompose("Recovery?"))
      .rejects.toThrow("exhausted");
    expect(attempted).toBe(2);
  });

  it("keeps a bounded failure category without the supplier's private detail or another attempt", async () => {
    const { policy } = fixture(4); let attempted = 0;
    const length = { choices: [{ message: { content: '{"claims":["Cut' }, finish_reason: "length" }] };
    vi.stubGlobal("fetch", vi.fn(async () => {
      attempted++;
      if (attempted === 1) throw Object.assign(Error("private timeout detail"), { name: "TimeoutError" });
      if (attempted === 2) throw Error("private network detail");
      if (attempted === 3) return new Response("private provider body", { status: 500 });
      return Response.json(length);
    }));
    const failure = () => new BoundedProductionEngine("synthetic-test-key", allowance()).decompose("Recovery?")
      .then(() => { throw Error("expected a refusal"); }, (error: unknown) => error as Error & { status?: number });
    const timeout = await failure();
    expect(timeout).toBeInstanceOf(ReasoningTransportError);
    expect(timeout).toMatchObject({ category: "timeout", message: "Bounded model provider request failed (timeout); reservation retained" });
    expect(await failure()).toMatchObject({ category: "network", message: "Bounded model provider request failed (network); reservation retained" });
    const provider = await failure();
    expect(provider).not.toBeInstanceOf(ReasoningOutputValidationError);
    expect(provider).toMatchObject({ status: 500, message: "Bounded model provider request failed (500); reservation retained" });
    // A reply cut at the output ceiling is a completed, billed response: planning refuses it
    // locally instead of reporting an unreachable provider.
    const truncated = await failure();
    expect(truncated).toBeInstanceOf(ResearchPlanningError);
    expect(truncated).toMatchObject({ reason: "invalid_output", status: 422 });
    expect([attempted, slots(policy.journalDirectory).length]).toEqual([4, 4]);
  });

  it("refuses excessive UTF-8 input/output, expiry, policy mutation and filesystem failures without HTTP", async () => {
    const { policy, file } = fixture(2); const budget = allowance();
    expect(() => budget.reserve("", "é".repeat(16000), 2048)).toThrow("request bound exceeded");
    expect(() => budget.reserve("", "", 8193)).toThrow("request bound exceeded");
    expect(slots(policy.journalDirectory)).toHaveLength(0);
    vi.setSystemTime("2026-10-05T00:00:00.000Z");
    expect(() => budget.reserve("", "", 2048)).toThrow("expired");
    vi.setSystemTime(now);
    fs.appendFileSync(file, " ");
    expect(() => budget.reserve("", "", 2048)).toThrow("policy changed");
    const other = fixture(1); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const broken = new ProductionModelAllowance(configuredProductionModelAllowance()!, () => {});
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw Error("disk unavailable"); });
    await expect(new BoundedProductionEngine("synthetic-test-key", broken).decompose("Any request?"))
      .rejects.toThrow("disk unavailable");
    write.mockRestore();
    expect(fetch).not.toHaveBeenCalled();
    // A failed write left its exclusive slot consumed. A later worker cannot spend it again.
    expect(slots(other.policy.journalDirectory)).toHaveLength(1);
    expect(() => allowance().reserve("", "", 2048)).toThrow("exhausted");
  });

  it("keeps the configured dollar ceiling even when the requested call count is larger", () => {
    fixture(1, { maximumMicroUsd: 887895, maximumCalls: 45 });
    const budget = allowance(); expect(budget.slots).toBe(42);
    for (let i = 0; i < 42; i++) budget.reserve("", "", 1);
    expect(() => budget.reserve("", "", 1)).toThrow("exhausted");
    expect(budget.slots * budget.reservePerCallMicroUsd).toBe(867720);
  });

  it("retains a slot and refuses HTTP if directory persistence fails or admission crosses expiry", async () => {
    const { policy } = fixture(2); allowance();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const broken = new ProductionModelAllowance(configuredProductionModelAllowance()!, () => { throw Error("directory flush failed"); });
    await expect(new BoundedProductionEngine("synthetic-test-key", broken).decompose("Any request?"))
      .rejects.toThrow("directory flush failed");
    expect(slots(policy.journalDirectory)).toHaveLength(1);
    const expired = new ProductionModelAllowance(configuredProductionModelAllowance()!, () => vi.setSystemTime("2026-10-05T00:00:00.000Z"));
    await expect(new BoundedProductionEngine("synthetic-test-key", expired).decompose("Any request?"))
      .rejects.toThrow("expired");
    expect(slots(policy.journalDirectory)).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects absent halves, wrong digest, endpoint/model changes and journal reuse with a new policy", () => {
    const first = fixture(1); allowance();
    vi.stubEnv("KERYX_MODEL_ALLOWANCE_SHA256", "");
    expect(() => configuredProductionModelAllowance()).toThrow("configuration refused");
    vi.stubEnv("KERYX_MODEL_ALLOWANCE_SHA256", "a".repeat(64));
    expect(() => configuredProductionModelAllowance()).toThrow("digest mismatch");
    const replacement = JSON.stringify({ ...first.policy, maximumMicroUsd: 999999 });
    fs.writeFileSync(first.file, replacement);
    vi.stubEnv("KERYX_MODEL_ALLOWANCE_SHA256", sha(replacement));
    expect(() => allowance()).toThrow("different policy");
    for (const change of [{ endpoint: "https://other.example/chat/completions" }, { model: "deepseek-v4-pro" }]) {
      const text = JSON.stringify({ ...first.policy, ...change }); fs.writeFileSync(first.file, text);
      vi.stubEnv("KERYX_MODEL_ALLOWANCE_SHA256", sha(text));
      expect(() => configuredProductionModelAllowance()).toThrow("policy refused");
    }
  });

  it("enforces one allowance across independent worker processes", async () => {
    const value = fixture(5); allowance();
    const moduleUrl = new URL("./bounded-production-engine.ts", import.meta.url).href;
    const program = `const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(now)}]));}};
      const {ProductionModelAllowance,configuredProductionModelAllowance}=await import(${JSON.stringify(moduleUrl)});
      const budget=new ProductionModelAllowance(configuredProductionModelAllowance(),process.platform==='win32'?()=>{}:undefined);
      let admitted=0;for(let i=0;i<4;i++){try{budget.reserve('small','input',2048);admitted++;}catch(error){if(!error.message.includes('exhausted'))throw error;}}
      console.log(admitted);`;
    const worker = () => new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program], {
        cwd: process.cwd(), env: { ...process.env, KERYX_MODEL_ALLOWANCE_FILE: value.file, KERYX_MODEL_ALLOWANCE_SHA256: value.digest },
        windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "", error = ""; child.stdout.on("data", text => out += text); child.stderr.on("data", text => error += text);
      child.on("error", reject); child.on("exit", status => status === 0 ? resolve(Number(out.trim())) : reject(Error(error)));
    });
    const counts = await Promise.all([worker(), worker(), worker()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(slots(value.policy.journalDirectory)).toHaveLength(5);
    expect(() => allowance().reserve("", "", 1)).toThrow("exhausted");
  }, 20000);

  it("does not let any UI selection bypass bounded mode or silently choose another provider", async () => {
    fixture(1); vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-test-key");
    const { availableModels, getReasoningEngine } = await import("./index");
    expect(availableModels().map(model => model.id)).toEqual(["deepseek-flash"]);
    for (const id of ["deepseek-v4-pro", "mimo-v2.5", "cloudflare-llama-3.3", "cloudflare-gpt-oss-120b", "keryx:cloudflare-gpt-oss-120b", "invalid"])
      expect(() => getReasoningEngine(id)).toThrow("only DeepSeek Flash");
    // On Windows the factory deliberately refuses unsupported directory fsync, before HTTP.
    if (process.platform === "win32") expect(() => getReasoningEngine("deepseek-flash")).toThrow();
    else expect(getReasoningEngine("deepseek-flash")).toBeInstanceOf(BoundedProductionEngine);
    vi.stubEnv("KERYX_MODEL_ALLOWANCE_SHA256", "invalid");
    expect(() => getReasoningEngine()).toThrow("configuration refused");
  });
});
