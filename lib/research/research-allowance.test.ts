import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindBoundedResearchAdmission, configuredResearchAllowance, ResearchAllowance,
  RESEARCH_ALLOWANCE_REVIEW as review, reserveBoundedSearch, type ResearchAllowancePolicy } from "./research-allowance";
import { BoundedProductionEngine, configuredProductionModelAllowance, ProductionModelAllowance } from "../llm/bounded-production-engine";
import { tavilyProvider } from "../web-research/tavily-provider";

const roots: string[] = [];
const now = "2026-10-05T12:00:00.000Z";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const questions = ["First reviewed question?", "Second reviewed question?", "Third reviewed question?"];
const flush = process.platform === "win32" ? () => {} : undefined;

function fixture(change: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-research-allowance-")); roots.push(root);
  fs.chmodSync(root, 0o700);
  const journalDirectory = path.join(root, "journal"); fs.mkdirSync(journalDirectory, { mode: 0o700 });
  const policy: ResearchAllowancePolicy = {
    format: "keryx-production-research-allowance-v2", policyId: review.policyId,
    priceCheckedOn: review.priceCheckedOn, pricePolicyId: review.modelPricePolicyId,
    modelEvidenceSha256: review.modelEvidenceSha256, provider: "deepseek",
    endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash",
    expiresAt: "2026-10-05T23:59:59.000Z", maximumMicroUsd: 1000000, maximumCalls: 46,
    maximumInputBytes: 32000, maximumOutputTokens: 8192, journalDirectory,
    search: { provider: "tavily", endpoint: "https://api.tavily.com/search", pricePolicyId: review.searchPricePolicyId,
      evidenceSha256: review.searchEvidenceSha256, searchDepth: "basic", maximumCalls: 6, reservePerCallMicroUsd: 8000 },
    research: { origin: "web", mode: "quick", sourceBudgetMicroUsdc: 0, maximumQuestions: 3,
      maximumSearchCallsPerQuestion: 2, questionSha256: questions.map(sha) },
  };
  const file = path.join(root, "policy.json"); const text = JSON.stringify({ ...policy, ...change });
  fs.writeFileSync(file, text, { mode: 0o600 });
  vi.stubEnv("KERYX_MODEL_ALLOWANCE_FILE", file); vi.stubEnv("KERYX_MODEL_ALLOWANCE_SHA256", sha(text));
  return { root, policy, file, digest: sha(text) };
}
const input = (question = questions[0], queryId = "query-one") => ({ question, queryId,
  origin: "web", researchMode: "quick", budget: 0, fundingOwner: "treasury", privateScope: false } as const);
const allowance = () => new ResearchAllowance(configuredResearchAllowance()!, flush);
const names = (directory: string, prefix: string) => fs.readdirSync(directory).filter(name => name.startsWith(prefix));
async function within<T>(admission: ReturnType<ResearchAllowance["admit"]>, operation: () => Promise<T>) {
  async function* body() { return await operation(); }
  return (await bindBoundedResearchAdmission(admission, body()).next()).value as T;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (!path.isAbsolute(root) || !root.startsWith(path.join(os.tmpdir(), "keryx-research-allowance-"))) throw Error("Unsafe test cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("shared dated research allowance", () => {
  it("refuses out-of-scope channels, funding, questions and payments before consuming any question", () => {
    const { policy } = fixture(); const budget = allowance();
    for (const change of [{ origin: "mcp" }, { origin: "engine" }, { researchMode: "deep" }, { budget: 0.01 },
      { fundingOwner: "browser" }, { fundingOwner: "offline" }, { privateScope: true }, { privateScope: undefined },
      { paidScholarly: true }, { question: "unapproved" }, { question: questions[0] + " " }, { queryId: "" }])
      expect(() => budget.admit({ ...input(), ...change })).toThrow("Bounded research allowance");
    expect(names(policy.journalDirectory, "question-")).toEqual([]);
    budget.admit(input());
    expect(() => allowance().admit(input())).toThrow("already consumed");
    fs.writeFileSync(path.join(policy.journalDirectory, `question-${sha(questions[1])}.json`), "", { mode: 0o600 });
    expect(() => allowance().admit(input(questions[1]))).toThrow("already consumed");
    expect(names(policy.journalDirectory, "question-")).toHaveLength(2);
  });

  it("rejects unreviewed tariffs, expanded counts, unknown fields and expired historical policy without new holds", () => {
    const original = fixture();
    for (const change of [{ priceCheckedOn: "2026-10-06" }, { pricePolicyId: "unreviewed" },
      { modelEvidenceSha256: "a".repeat(64) }, { maximumCalls: 47 }, { maximumMicroUsd: 1000001 },
      { expiresAt: "2026-10-06T00:00:00.000Z" }, { retry: true },
      { research: { ...original.policy.research, questionSha256: [sha(questions[0]), sha(questions[0]), sha(questions[2])] } },
      { search: { ...original.policy.search, searchDepth: "advanced" } }]) {
      fixture(change);
      expect(() => configuredResearchAllowance()).toThrow("Bounded research allowance");
    }
    fixture({ format: "keryx-production-model-allowance-v1", expiresAt: "2026-10-05T23:59:59.000Z" });
    expect(() => configuredResearchAllowance()).toThrow("historical model-only allowance is closed");
    fixture(); vi.setSystemTime("2026-10-06T00:00:00.000Z");
    expect(() => configuredResearchAllowance()).toThrow("expired");
  });

  it("holds actual failed/successful model and basic Tavily HTTP requests before dispatch, without retries", async () => {
    const { policy } = fixture(); const budget = allowance(); const admission = budget.admit(input());
    const engine = new BoundedProductionEngine("synthetic-model-key",
      new ProductionModelAllowance(configuredProductionModelAllowance()!, flush));
    let modelCalls = 0, searchCalls = 0;
    const request = vi.fn(async (url: string, init: RequestInit) => {
      expect(names(policy.journalDirectory, "question-")).toHaveLength(1);
      if (url === "https://api.deepseek.com/chat/completions") {
        modelCalls++;
        expect(names(policy.journalDirectory, "model-")).toHaveLength(modelCalls);
        const retained = JSON.parse(fs.readFileSync(path.join(policy.journalDirectory, `model-000${modelCalls}.json`), "utf8"));
        expect(retained).toMatchObject({ reserveMicroUsd: 20660, questionSha256: sha(questions[0]), queryIdSha256: sha("query-one") });
        expect(init.redirect).toBe("error");
        expect(JSON.parse(init.body as string)).toMatchObject({ model: "deepseek-v4-flash", max_tokens: 2048 });
        if (modelCalls === 1) throw Error("uncertain private provider detail");
        return Response.json({ choices: [{ message: { content: '{"claims":["Reviewed target"]}' }, finish_reason: "stop" }] });
      }
      searchCalls++;
      expect(url).toBe("https://api.tavily.com/search");
      expect(init.redirect).toBe("error");
      expect(names(policy.journalDirectory, "search-")).toHaveLength(searchCalls);
      expect(JSON.parse(init.body as string)).toMatchObject({ search_depth: "basic", auto_parameters: false,
        include_answer: false, include_raw_content: false, include_images: false, max_results: 10 });
      if (searchCalls === 1) throw Error("unknown search outcome with secret detail");
      return Response.json({ results: [] });
    });
    vi.stubGlobal("fetch", request);
    await expect(engine.decompose(questions[0])).rejects.toThrow("current admitted question");
    await expect(tavilyProvider("synthetic-search-key").search(questions[0])).rejects.toThrow("current admitted question");
    expect(request).not.toHaveBeenCalled();
    await within(admission, async () => {
      await expect(engine.decompose(questions[0])).rejects.toThrow("reservation retained");
      await expect(engine.decompose(questions[0])).resolves.toEqual(["Reviewed target"]);
      await expect(tavilyProvider("synthetic-search-key").search("first")).rejects.toThrow("Search provider unavailable");
      await expect(tavilyProvider("synthetic-search-key").search("second")).resolves.toEqual([]);
      await expect(tavilyProvider("synthetic-search-key").search("third")).rejects.toThrow("search exhausted");
    });
    expect([modelCalls, searchCalls]).toEqual([2, 2]);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("retains the combined ceiling across restarts and empty holds, with at most two searches per question", async () => {
    const { policy } = fixture(); const budget = allowance();
    fs.writeFileSync(path.join(policy.journalDirectory, "model-0001.json"), "", { mode: 0o600 });
    const first = budget.admit(input());
    await within(first, async () => {
      for (let i = 0; i < 45; i++) expect(allowance().reserveModel("", "", 1).reserveMicroUsd).toBe(20660);
      expect(() => budget.reserveModel("", "", 1)).toThrow("model exhausted");
      budget.reserveSearch("first"); budget.reserveSearch("second");
      expect(() => budget.reserveSearch("third")).toThrow("search exhausted");
    });
    for (let i = 1; i < questions.length; i++) {
      const restarted = allowance(); const admission = restarted.admit(input(questions[i], `query-${i}`));
      if (i === 2) fs.writeFileSync(path.join(policy.journalDirectory, `search-${sha(questions[i])}-01.json`), "", { mode: 0o600 });
      await within(admission, async () => {
        restarted.reserveSearch("one"); if (i !== 2) restarted.reserveSearch("two");
        expect(() => restarted.reserveSearch("extra")).toThrow("search exhausted");
      });
    }
    expect(names(policy.journalDirectory, "model-")).toHaveLength(46);
    expect(names(policy.journalDirectory, "search-")).toHaveLength(6);
    expect(names(policy.journalDirectory, "question-")).toHaveLength(3);
    expect(46 * 20660 + 6 * 8000).toBe(998360);
  });

  it("fences policy/receipt mutation, removed configuration, unexpected state and foreign/forged admission", async () => {
    const { policy, file } = fixture(); const budget = allowance(); const admission = budget.admit(input());
    async function* body() { yield "one"; return "done"; }
    expect(() => bindBoundedResearchAdmission({ ...admission }, body())).toThrow("invalid question admission");
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    await within(admission, async () => {
      const questionFile = path.join(policy.journalDirectory, `question-${sha(questions[0])}.json`);
      const receipt = fs.readFileSync(questionFile); fs.appendFileSync(questionFile, " ");
      expect(() => reserveBoundedSearch("mutation")).toThrow("question receipt changed");
      fs.writeFileSync(questionFile, receipt);
      vi.stubEnv("KERYX_MODEL_ALLOWANCE_FILE", undefined); vi.stubEnv("KERYX_MODEL_ALLOWANCE_SHA256", undefined);
      expect(() => reserveBoundedSearch("removed")).toThrow("configuration removed");
      vi.stubEnv("KERYX_MODEL_ALLOWANCE_FILE", file); vi.stubEnv("KERYX_MODEL_ALLOWANCE_SHA256", admission.policySha256);
      fs.writeFileSync(path.join(policy.journalDirectory, "unexpected.json"), "", { mode: 0o600 });
      await expect(tavilyProvider("synthetic-key").search("unexpected")).rejects.toThrow("unexpected journal state");
      fs.unlinkSync(path.join(policy.journalDirectory, "unexpected.json"));
      fs.appendFileSync(file, " ");
      expect(() => budget.reserveModel("", "", 1)).toThrow("policy changed");
    });
    expect(request).not.toHaveBeenCalled();
    expect(names(policy.journalDirectory, "model-")).toHaveLength(0);
    expect(names(policy.journalDirectory, "search-")).toHaveLength(0);
  });

  it("retains question/model/search holds when persistence fails or crosses expiry, without HTTP", async () => {
    const { policy } = fixture(); allowance();
    let fail = true;
    const budget = new ResearchAllowance(configuredResearchAllowance()!, () => { if (fail) throw Error("directory flush failed"); });
    expect(() => budget.admit(input())).toThrow("directory flush failed");
    expect(names(policy.journalDirectory, "question-")).toHaveLength(1);
    fail = false;
    const admission = budget.admit(input(questions[1]));
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    await within(admission, async () => {
      fail = true;
      expect(() => budget.reserveModel("", "", 1)).toThrow("directory flush failed");
      expect(() => budget.reserveSearch("unknown")).toThrow("directory flush failed");
      fail = false;
      const expired = new ResearchAllowance(configuredResearchAllowance()!, () => vi.setSystemTime("2026-10-06T00:00:00.000Z"));
      expect(() => expired.reserveModel("", "", 1)).toThrow("expired");
    });
    expect(names(policy.journalDirectory, "model-")).toHaveLength(2);
    expect(names(policy.journalDirectory, "search-")).toHaveLength(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses journal-policy reuse and foreign context without silently opening a new allowance", async () => {
    const original = fixture(); const budget = allowance(); const admission = budget.admit(input());
    const changed = JSON.stringify({ ...original.policy, expiresAt: "2026-10-05T22:00:00.000Z" });
    fs.writeFileSync(original.file, changed); vi.stubEnv("KERYX_MODEL_ALLOWANCE_SHA256", sha(changed));
    expect(() => allowance()).toThrow("different policy");
    fs.writeFileSync(original.file, JSON.stringify(original.policy)); vi.stubEnv("KERYX_MODEL_ALLOWANCE_SHA256", original.digest);
    await within(admission, async () => {
      const foreign = fixture();
      expect(() => reserveBoundedSearch("different allowance")).toThrow("current admitted question");
      expect(() => budget.reserveModel("", "", 1)).toThrow("policy changed");
      expect(names(foreign.policy.journalDirectory, "search-")).toHaveLength(0);
      expect(names(foreign.policy.journalDirectory, "model-")).toHaveLength(0);
    });
  });

  it("refuses an in-memory policy snapshot that no longer matches the protected hash-bound policy", () => {
    const { policy } = fixture(); const configured = configuredResearchAllowance()!;
    configured.policy.research.questionSha256[0] = sha("unapproved question");
    expect(() => new ResearchAllowance(configured, flush)).toThrow("policy snapshot mismatch");
    expect(names(policy.journalDirectory, "question-")).toHaveLength(0);
    expect(names(policy.journalDirectory, "model-")).toHaveLength(0);
    expect(names(policy.journalDirectory, "search-")).toHaveLength(0);
  });

  it("consumes an uncertain file-fsync model hold and refuses oversized UTF-8/output and unsafe retained storage", async () => {
    const { policy } = fixture(); const budget = allowance(); const admission = budget.admit(input());
    await within(admission, async () => {
      expect(() => budget.reserveModel("", "é".repeat(16000), 1)).toThrow("request bound exceeded");
      expect(() => budget.reserveModel("", "", 8193)).toThrow("request bound exceeded");
      const sync = vi.spyOn(fs, "fsyncSync").mockImplementation(() => { throw Error("file flush failed"); });
      expect(() => budget.reserveModel("", "", 1)).toThrow("file flush failed");
      sync.mockRestore();
      expect(budget.reserveModel("", "", 1).slot).toBe(2);
      const file = path.join(policy.journalDirectory, "model-0001.json");
      const link = path.join(path.dirname(policy.journalDirectory), "retained-hardlink.json");
      fs.linkSync(file, link);
      expect(() => budget.reserveSearch("unsafe hardlink")).toThrow("storage type refused");
      fs.unlinkSync(link);
      if (process.platform !== "win32") {
        fs.chmodSync(file, 0o644);
        expect(() => budget.reserveSearch("unsafe permissions")).toThrow("storage permissions refused");
      }
    });
    expect(names(policy.journalDirectory, "model-")).toHaveLength(2);
    expect(names(policy.journalDirectory, "search-")).toHaveLength(0);
  });

  it("keeps concurrent generator resumes and await descendants in their own question, then fences late work", async () => {
    const { policy } = fixture(); const budget = allowance();
    const first = budget.admit(input()); const second = budget.admit(input(questions[1], "query-two"));
    let late: Promise<unknown> | undefined;
    let release: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    async function* body(label: string) {
      await Promise.resolve();
      budget.reserveSearch(`${label}-one`); yield label;
      await Promise.all([Promise.resolve().then(() => budget.reserveModel("", label, 1))]);
      budget.reserveSearch(`${label}-two`);
      if (label === "first") late = pending.then(() => reserveBoundedSearch("late"));
      return label;
    }
    const a = bindBoundedResearchAdmission(first, body("first"));
    const b = bindBoundedResearchAdmission(second, body("second"));
    expect(await Promise.all([a.next(), b.next()])).toEqual([{ done: false, value: "first" }, { done: false, value: "second" }]);
    await Promise.all([b.next(), a.next()]);
    for (const [admission, label] of [[first, "first"], [second, "second"]] as const) {
      const retained = JSON.parse(fs.readFileSync(path.join(policy.journalDirectory, `search-${admission.questionSha256}-01.json`), "utf8"));
      expect(retained).toMatchObject({ questionSha256: admission.questionSha256, queryIdSha256: admission.queryIdSha256,
        querySha256: sha(`${label}-one`) });
    }
    release!(); await expect(late).rejects.toThrow("current admitted question");
    await expect(a.next()).rejects.toThrow("closed");
  });

  it("fences fresh holds on cancellation, including late await descendants, and permits generator cleanup", async () => {
    const { policy } = fixture(); const budget = allowance(); const admission = budget.admit(input());
    const controller = new AbortController();
    let release: (() => void) | undefined, late: Promise<unknown> | undefined, cleaned = false;
    const pending = new Promise<void>(resolve => { release = resolve; });
    async function* body() {
      try {
        late = pending.then(() => budget.reserveModel("", "late", 1));
        yield "ready";
        budget.reserveSearch("after abort");
      } finally { cleaned = true; }
    }
    const generator = bindBoundedResearchAdmission(admission, body(), controller.signal);
    await generator.next(); controller.abort(); release!();
    await expect(late).rejects.toThrow("current admitted question");
    await expect(generator.next()).rejects.toThrow("closed");
    await generator.return(undefined);
    expect(cleaned).toBe(true);
    expect(names(policy.journalDirectory, "model-")).toHaveLength(0);
    expect(names(policy.journalDirectory, "search-")).toHaveLength(0);
  });

  it("revokes admission before return/throw/disposal cleanup can dispatch another paid attempt", async () => {
    const { policy } = fixture(); const budget = allowance();
    for (const [index, action] of ["return", "throw", "dispose"].entries()) {
      const admission = budget.admit(input(questions[index], `cleanup-${index}`));
      let cleaned = false;
      async function* body() {
        try { yield "ready"; }
        finally { cleaned = true; expect(() => budget.reserveModel("", "cleanup", 1)).toThrow("current admitted question"); }
      }
      const generator = bindBoundedResearchAdmission(admission, body()); await generator.next();
      if (action === "return") await generator.return(undefined);
      else if (action === "throw") await expect(generator.throw(Error("cancelled"))).rejects.toThrow("cancelled");
      else await generator[Symbol.asyncDispose]();
      expect(cleaned).toBe(true);
    }
    expect(names(policy.journalDirectory, "model-")).toHaveLength(0);
  });

  it.skipIf(process.platform === "win32")("runs the full public agent with the ordinary v2 factory and actual POSIX persistence before mocked model/search HTTP", async () => {
    const { policy } = fixture(); vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-model-key");
    const { getReasoningEngine } = await import("../llm");
    const { runAgent } = await import("../agent/run-agent");
    const { config } = await import("../config");
    const previous = { webSearchProvider: config.webSearchProvider, tavilyApiKey: config.tavilyApiKey };
    Object.assign(config, { webSearchProvider: "tavily", tavilyApiKey: "synthetic-search-key" });
    const engine = getReasoningEngine("deepseek-flash");
    const ensureFunded = vi.fn(), payFetch = vi.fn(), payCitation = vi.fn();
    const gateway = { mode: "real", ensureFunded, payFetch, payCitation } as unknown as import("../payments/payment-gateway").PaymentGateway;
    const db = { listSources: async () => [], listPublicReferences: async () => [] } as unknown as import("../db/keryx-db").KeryxDB;
    let modelCalls = 0, searchCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url === "https://api.tavily.com/search") {
        searchCalls++;
        expect(names(policy.journalDirectory, "search-")).toHaveLength(searchCalls);
        return Response.json({ results: [{ url: "https://example.com/reviewed", title: "Unverified preview", content: "No body evidence" }] });
      }
      expect(url).toBe("https://api.deepseek.com/chat/completions"); modelCalls++;
      expect(names(policy.journalDirectory, "model-")).toHaveLength(modelCalls);
      expect(names(policy.journalDirectory, "question-")).toHaveLength(1);
      const prompt = JSON.parse(init.body as string).messages[1].content;
      const content = modelCalls === 1 ? { claims: ["Reviewed target"] }
        : { decisions: JSON.parse(prompt).candidates.map((candidate: { sourceId: string }) => ({ sourceId: candidate.sourceId,
          action: "SKIP", expectedValue: 0, confidence: 0.8, rationale: "No original evidence selected", targets: [] })) };
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] });
    }));
    try {
      const generator = runAgent(input(), { engine, db, gateway });
      const initial = await generator.next();
      expect(initial.done).toBe(false);
      expect(names(policy.journalDirectory, "question-")).toHaveLength(1);
      let result = await generator.next();
      while (!result.done) result = await generator.next();
      expect(result.value).toMatchObject({ question: questions[0], budget: 0, researchMode: "quick",
        paymentMode: "real", fundingOwner: "treasury", totalSpent: 0, paymentAttempts: 0 });
      expect([modelCalls, searchCalls]).toEqual([2, 2]);
      expect(ensureFunded).not.toHaveBeenCalled(); expect(payFetch).not.toHaveBeenCalled(); expect(payCitation).not.toHaveBeenCalled();
      await expect(runAgent(input(), { engine, db, gateway }).next()).rejects.toThrow("already consumed");
    } finally { Object.assign(config, previous); }
  });

  it("caps all question and request holds across independent processes", async () => {
    const value = fixture(); allowance();
    const moduleUrl = new URL("./research-allowance.ts", import.meta.url).href;
    const program = `const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(now)}]));}};
      const {ResearchAllowance,configuredResearchAllowance,bindBoundedResearchAdmission}=await import(${JSON.stringify(moduleUrl)});
      const allowance=new ResearchAllowance(configuredResearchAllowance(),process.platform==='win32'?()=>{}:undefined);
      let questions=0,models=0,searches=0;
      for(const question of ${JSON.stringify(questions)}){let admission;try{admission=allowance.admit({question,queryId:process.pid+'',origin:'web',researchMode:'quick',budget:0,fundingOwner:'treasury',privateScope:false});questions++;}catch(error){if(!error.message.includes('already consumed'))throw error;continue;}
        async function* body(){for(let n=0;n<46;n++){try{allowance.reserveModel('','',1);models++;}catch(error){if(!error.message.includes('exhausted'))throw error;}}
          for(let n=0;n<3;n++){try{allowance.reserveSearch('bounded');searches++;}catch(error){if(!error.message.includes('exhausted'))throw error;}}}
        await bindBoundedResearchAdmission(admission,body()).next();}
      console.log(JSON.stringify({questions,models,searches}));`;
    const worker = () => new Promise<{ questions: number; models: number; searches: number }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program], {
        cwd: process.cwd(), env: { ...process.env, KERYX_MODEL_ALLOWANCE_FILE: value.file, KERYX_MODEL_ALLOWANCE_SHA256: value.digest },
        windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "", error = ""; child.stdout.on("data", text => out += text); child.stderr.on("data", text => error += text);
      child.on("error", reject); child.on("exit", status => status === 0 ? resolve(JSON.parse(out.trim())) : reject(Error(error)));
    });
    const counts = await Promise.all([worker(), worker(), worker()]);
    expect(counts.reduce((sum, count) => sum + count.questions, 0)).toBe(3);
    expect(counts.reduce((sum, count) => sum + count.models, 0)).toBe(46);
    expect(counts.reduce((sum, count) => sum + count.searches, 0)).toBe(6);
    expect(names(value.policy.journalDirectory, "question-")).toHaveLength(3);
  }, 20000);
});
