import { afterEach, expect, it, vi } from "vitest";
import { privateReasoningEngine } from "./private-engine";
import { effectiveEngineName, reasoningAttempts } from "./resilient-engine";
const policy = { modelId: "deepseek-flash", provider: "deepseek" as const, baseUrl: "https://synthetic-provider.example/v1", apiKey: "synthetic-not-a-credential" };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("pins one explicit model and endpoint across planning and synthesis and snapshots mutable caller policy", async () => {
  const input = { ...policy };
  const built = privateReasoningEngine(input);
  input.baseUrl = "https://unexpected.example"; input.apiKey = "replacement"; input.modelId = "mimo-v2.5";
  const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"claims":["Synthetic target"]}' } }] }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"answer":"Synthetic answer","markers":[]}' } }] }));
  vi.stubGlobal("fetch", http);
  expect(await built.engine.decompose("Synthetic question")).toEqual(["Synthetic target"]);
  await built.engine.synthesize({ question: "Synthetic question", subClaims: [], gathered: [] });
  expect(http).toHaveBeenCalledTimes(2);
  for (const [url, init] of http.mock.calls) {
    expect(url).toBe("https://synthetic-provider.example/v1/chat/completions");
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(init?.body as string).model).toBe("deepseek-v4-flash");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer synthetic-not-a-credential" });
  }
  expect(built.disclosure).toMatchObject({ modelId: "deepseek-flash", fallback: "local-heuristic", redirects: "prohibited" });
  expect(JSON.stringify(built.disclosure)).not.toContain(policy.apiKey);
});

it("fails over locally without another provider and keeps circuit decisions local to each job", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const http = vi.fn<typeof fetch>().mockImplementation(async () => new Response("synthetic-private-body", { status: 400 }));
  vi.stubGlobal("fetch", http);
  const first = privateReasoningEngine(policy).engine, second = privateReasoningEngine(policy).engine;
  await first.decompose("Synthetic private question");
  await first.decompose("Synthetic private question");
  expect(http).toHaveBeenCalledTimes(1);
  await second.decompose("Synthetic private question");
  expect(http).toHaveBeenCalledTimes(2);
  expect(http.mock.calls.every(([url]) => String(url) === "https://synthetic-provider.example/v1/chat/completions")).toBe(true);
  expect(effectiveEngineName(first)).toContain("heuristic");
  expect(JSON.stringify(reasoningAttempts(first))).not.toContain("synthetic-private-body");
  expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-private-body");
});

it("rejects unknown/retired aliases, missing credentials and unsafe endpoint forms before HTTP", () => {
  const http = vi.fn(); vi.stubGlobal("fetch", http);
  for (const patch of [{ modelId: "deepseek-chat" }, { modelId: "keryx:deepseek-flash" }, { modelId: "unknown" },
    { provider: "mimo" }, { apiKey: "" }, { baseUrl: "http://synthetic.example" }, { baseUrl: "https://user:secret@synthetic.example" },
    { baseUrl: "https://synthetic.example?token=secret" }, { baseUrl: "https://synthetic.example/#fragment" }]) {
    expect(() => privateReasoningEngine({ ...policy, ...patch } as typeof policy)).toThrow(/Private reasoning/);
  }
  expect(http).not.toHaveBeenCalled();
});
