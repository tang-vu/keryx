import { afterEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { createHash } from "node:crypto";
import { runAgent } from "../agent/run-agent";
import type { AgentDeps } from "../agent/deps";
import { HeuristicEngine } from "./heuristic-engine";
import { JsonChatEngine } from "./json-chat-engine";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { MemoryReasoningCircuitStore } from "./reasoning-circuit-store";
import { ReasoningInputLimitError, ReasoningOutputValidationError, ReasoningTransportError } from "./reasoning-engine";
import { ResilientEngine, reasoningAttempts, reasoningCalls, reasoningUsage } from "./resilient-engine";
import { boundedResearchPlan, parseResearchPlan, ResearchPlanningError, researchFailureMessage } from "./research-plan";
import { SQLITE_SELECTION_QUESTION, SQLITE_SELECTION_QUESTION_SHA256 } from "../../test-support/sqlite-selection-fixture";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Synthetic Vietnamese comparisons, not historical provider output or vendor advice.
const systemd = {
  question: "Đối chiếu default, TimeoutStopSec=infinity và SendSIGKILL=no theo tài liệu chính thức phiên bản X: hành vi khi worker còn chạy, rủi ro deploy, và điều kiện kiểm tra trước khi sửa cấu hình.",
  claims: ["Default: hành vi khi worker còn chạy theo phiên bản X?", "TimeoutStopSec=infinity: hành vi khi worker còn chạy theo phiên bản X?",
    "SendSIGKILL=no: hành vi khi worker còn chạy theo phiên bản X?", "Default: rủi ro deploy theo phiên bản X?",
    "TimeoutStopSec=infinity: rủi ro deploy theo phiên bản X?", "SendSIGKILL=no: rủi ro deploy theo phiên bản X?", "Điều kiện kiểm tra trước khi sửa cấu hình phiên bản X?"],
};
const sqlite = {
  question: "Đọc https://example.org/wal.html và https://example.org/backup.html phiên bản X; so sánh copy live.db và Online Backup API về tính nhất quán, ghi đồng thời, khóa, và bước xác minh khôi phục. Trình bày bảng ngắn.",
  claims: ["Copy live.db: tính nhất quán theo hai tài liệu phiên bản X?", "Online Backup API: tính nhất quán theo hai tài liệu phiên bản X?",
    "Copy live.db: ghi đồng thời theo hai tài liệu phiên bản X?", "Online Backup API: ghi đồng thời theo hai tài liệu phiên bản X?",
    "Copy live.db: khóa theo hai tài liệu phiên bản X?", "Online Backup API: khóa theo hai tài liệu phiên bản X?",
    "Các bước xác minh khôi phục cho cả hai phương pháp theo phiên bản X?"],
};

class Fixture extends JsonChatEngine {
  readonly name = "synthetic-planning";
  constructor(private output: Record<string, unknown>) { super(); }
  protected async chatJson() { return this.output; }
}
function provider(name = "primary") {
  return new OpenAICompatibleEngine({ name: `llm:${name}`, baseUrl: `https://${name}.synthetic.invalid`, apiKey: "synthetic", model: "synthetic" });
}
function response(content: unknown, finish_reason = "stop") {
  return Response.json({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason }],
    usage: { prompt_tokens: 23, completion_tokens: 11 } });
}

type PartRole = "subject" | "dimension" | "shared" | "scope" | "framing";
type CallerPart = { text: string; role: PartRole };
// Test-only annotation of exact caller spans. The transport never returns final
// target strings; the production parser/assembler constructs them itself.
function callerProposal(question: string, subjects: string[], dimensions: string[], shared: string[], scope: string[]) {
  const spans = ([...subjects.map(text => ({ text, role: "subject" as const })),
    ...dimensions.map(text => ({ text, role: "dimension" as const })), ...shared.map(text => ({ text, role: "shared" as const })),
    ...scope.map(text => ({ text, role: "scope" as const }))]).map(part => ({ ...part, start: question.indexOf(part.text) }))
    .sort((a, b) => a.start - b.start);
  const parts: CallerPart[] = []; let offset = 0;
  for (const span of spans) {
    if (span.start < offset || span.start < 0 || question.indexOf(span.text, span.start + 1) !== -1) throw new Error("Invalid synthetic caller annotation");
    if (span.start > offset) parts.push({ text: question.slice(offset, span.start), role: "framing" });
    parts.push({ text: span.text, role: span.role }); offset = span.start + span.text.length;
  }
  if (offset < question.length) parts.push({ text: question.slice(offset), role: "framing" });
  return { status: "complete", comparison: { parts } };
}
const originalSystemd = "Tôi phải dừng một worker Node.js dưới systemd để deploy nhưng có thể còn việc đang chạy. Theo tài liệu chính thức systemd, TimeoutStopSec= và SendSIGKILL= phối hợp thế nào khi dừng quá lâu? Cho tôi một bảng ngắn cho cấu hình mặc định, TimeoutStopSec=infinity và SendSIGKILL=no: worker còn chạy thì điều gì xảy ra, rủi ro khi deploy, và tôi cần kiểm tra gì trước khi thay mã. Không giả định worker đã hoàn tất và không mua nguồn trả phí.";
const systemdSubjects = ["cấu hình mặc định", "TimeoutStopSec=infinity", "SendSIGKILL=no"];
const systemdDimensions = ["worker còn chạy thì điều gì xảy ra", "rủi ro khi deploy"];
const systemdShared = ["tôi cần kiểm tra gì trước khi thay mã"];
const systemdScope = [originalSystemd.slice(0, originalSystemd.indexOf(" Cho tôi")),
  "Không giả định worker đã hoàn tất và không mua nguồn trả phí."];
const sqliteSubjects = ["chỉ copy file .db đang chạy", "Online Backup API"];
const sqliteDimensions = ["tạo snapshot nhất quán", "checklist thao tác", "điều kiện đồng thời/khóa cần chú ý"];
const sqliteShared = ["cách kiểm tra bản sao trước khi dùng để phục hồi"];
const sqliteScope = ["SQLite của tôi đang dùng WAL và vẫn nhận ghi khi sao lưu.",
  "Dựa trên hai tài liệu chính thức https://sqlite.org/wal.html và https://sqlite.org/backup.html",
  "mà không dừng cả service", "Nói rõ bước nào tài liệu hỗ trợ và bước nào còn cần kiểm chứng; không mua nguồn trả phí."];
const finiteComparisons = [
  { name: "exact Systemd05f", question: originalSystemd, subjects: systemdSubjects, dimensions: systemdDimensions, shared: systemdShared, scope: systemdScope },
  { name: "Systemd supplied synthetic reference", question: originalSystemd + " Tham chiếu https://example.org/systemd-service.",
    subjects: systemdSubjects, dimensions: systemdDimensions, shared: systemdShared, scope: [...systemdScope, "Tham chiếu https://example.org/systemd-service."] },
  { name: "Systemd reordered settings", question: originalSystemd.replace("cấu hình mặc định, TimeoutStopSec=infinity và SendSIGKILL=no", "SendSIGKILL=no, cấu hình mặc định và TimeoutStopSec=infinity"),
    subjects: [systemdSubjects[2], systemdSubjects[0], systemdSubjects[1]], dimensions: systemdDimensions, shared: systemdShared, scope: systemdScope },
  { name: "exact SQLite733b", question: SQLITE_SELECTION_QUESTION, subjects: sqliteSubjects, dimensions: sqliteDimensions, shared: sqliteShared, scope: sqliteScope },
  { name: "SQLite without supplied URLs", question: SQLITE_SELECTION_QUESTION.replace(sqliteScope[1], "Dựa trên tài liệu chính thức SQLite"),
    subjects: sqliteSubjects, dimensions: sqliteDimensions, shared: sqliteShared, scope: [sqliteScope[0], "Dựa trên tài liệu chính thức SQLite", ...sqliteScope.slice(2)] },
  ...[["Lantern", "Harbor"], ["Harbor", "Lantern"], ["Aspen", "Birch"]].map(subjects => ({ name: `unrelated finite comparison ${subjects.join("/")}`,
    question: `Compare ${subjects[0]} and ${subjects[1]} for reliability and latency. What compatibility checks apply to both before switching? Use workload W and the official guides only.`,
    subjects, dimensions: ["reliability", "latency"], shared: ["What compatibility checks apply to both before switching"], scope: ["Use workload W and the official guides only."] })),
];

describe("caller-bound comparison construction", () => {
  it("binds the two exact originals and separately maps substantive dimensions rather than table cells or reference count", () => {
    expect(createHash("sha256").update(originalSystemd).digest("hex")).toBe("05f8ce09b6cea622818d605f213c298fdab43ce4f6988f47e179150f3d57136d");
    expect(createHash("sha256").update(SQLITE_SELECTION_QUESTION).digest("hex")).toBe(SQLITE_SELECTION_QUESTION_SHA256);
    // Semantic maps: per-setting behavior/risk plus common pre-replacement
    // checks; per-method consistency/operations/concurrent-write-locking plus
    // common restore verification. Shared targets name every subject below.
    expect(systemdSubjects.length * systemdDimensions.length + systemdShared.length).toBe(7);
    expect(sqliteSubjects.length * sqliteDimensions.length + sqliteShared.length).toBe(7);
  });

  it.each(finiteComparisons)("constructs every requested need for $name through one synthetic planning call and normal discovery", async fixture => {
    const proposal = callerProposal(fixture.question, fixture.subjects, fixture.dimensions, fixture.shared, fixture.scope);
    expect(proposal.comparison.parts.map(part => part.text).join("")).toBe(fixture.question);
    const transport = vi.fn<typeof fetch>(async () => response(proposal)); vi.stubGlobal("fetch", transport);
    const primary = provider(), alternate = provider("alternate"), store = new MemoryReasoningCircuitStore();
    const failed = vi.spyOn(store, "failed"), engine = new ResilientEngine(primary, alternate, 0, store);
    const boundary = new Error("synthetic discovery boundary");
    const listSources = vi.fn().mockRejectedValue(boundary), payFetch = vi.fn(), payCitations = vi.fn();
    const iterator = runAgent({ question: fixture.question, budget: 0, researchMode: "quick" },
      { engine, db: { listSources }, gateway: { mode: "offline", payFetch, payCitations } } as unknown as AgentDeps);
    expect((await iterator.next()).value).toMatchObject({ phase: "decompose" });
    const planned = (await iterator.next()).value;
    expect(planned).toMatchObject({ phase: "decompose" });
    const targets = (planned as { detail: string[] }).detail;
    expect(targets).toHaveLength(fixture.subjects.length * fixture.dimensions.length + fixture.shared.length);
    // Check exact semantic coverage and independently inspectable pairs, not
    // just span presence or equality to a prewritten good target array.
    for (const subject of fixture.subjects) for (const dimension of fixture.dimensions) {
      const own = targets.filter(target => target.startsWith(`${subject}: ${dimension}?`));
      expect(own).toHaveLength(1);
      for (const other of fixture.dimensions.filter(value => value !== dimension)) expect(own[0].split("\n")[0]).not.toContain(other);
    }
    for (const need of fixture.shared) {
      const common = targets.filter(target => target.split("\n")[0].endsWith(`: ${need}?`));
      expect(common).toHaveLength(1);
      for (const subject of fixture.subjects) expect(common[0].split("\n")[0]).toContain(subject);
    }
    for (const target of targets) for (const qualification of fixture.scope) expect(target).toContain(qualification);
    expect((await iterator.next()).value).toMatchObject({ phase: "decompose", detail: { researchMode: "quick" } });
    await expect(iterator.next()).rejects.toBe(boundary);
    expect(listSources).toHaveBeenCalledOnce(); expect(payFetch).not.toHaveBeenCalled(); expect(payCitations).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledOnce(); expect(alternate.calls).toEqual([]); expect(failed).not.toHaveBeenCalled();
    expect(reasoningCalls(engine)).toMatchObject([{ outcome: "returned" }]); expect(reasoningCalls(engine)).toHaveLength(1);
    expect(reasoningUsage(engine)).toMatchObject([{ inputTokens: 23, outputTokens: 11 }]); expect(reasoningUsage(engine)).toHaveLength(1);
    expect(reasoningAttempts(engine)).toMatchObject([{ step: "decompose", outcome: "served" }]);
    const wire = JSON.parse(transport.mock.calls[0][1]!.body as string);
    expect(wire.messages[1].content).toContain(JSON.stringify(fixture.question));
    expect(wire.messages[0].content).toContain("concatenating all text must reproduce the question");
    expect(wire.max_tokens).toBe(2048);
  });

  const valid = callerProposal(originalSystemd, systemdSubjects, systemdDimensions, systemdShared, systemdScope);
  const changeParts = (mutate: (parts: CallerPart[]) => unknown) => ({ status: "complete", comparison: { parts: mutate(structuredClone(valid.comparison.parts)) } });
  it.each([
    { name: "foreign span", output: changeParts(parts => parts.map((part, index) => index === 0 ? { ...part, text: "foreign private supplier wording" } : part)) },
    { name: "missing scope span", output: changeParts(parts => parts.filter(part => part.role !== "scope")) },
    { name: "omitted risk dimension", output: changeParts(parts => parts.filter(part => part.text !== systemdDimensions[1])) },
    { name: "omitted shared precheck", output: changeParts(parts => parts.filter(part => part.role !== "shared")) },
    { name: "subject dropped", output: changeParts(parts => parts.filter(part => part.text !== systemdSubjects[2])) },
    { name: "malformed parts array", output: { status: "complete", comparison: { parts: "private output" } } },
    { name: "missing parts", output: { status: "complete", comparison: {} } },
    { name: "malformed comparison array", output: { status: "complete", comparison: [] } },
    { name: "unknown role", output: changeParts(parts => parts.map((part, index) => index === 0 ? { ...part, role: "invented" } : part)) },
    { name: "malformed element", output: changeParts(parts => [null, ...parts]) },
    { name: "excessive parts", output: changeParts(parts => [...parts, ...Array(65).fill({ role: "scope", text: "x" })]) },
    { name: "opaque supplemental constraint", output: { ...valid, constraints: ["foreign scope"] } },
    { name: "expanded model claims alongside structure", output: { ...valid, claims: Array.from({ length: 9 }, (_, index) => `Expanded ${index}?`) } },
    { name: "missing dimensions despite full text binding", output: changeParts(parts => parts.map(part => part.role === "dimension" ? { ...part, role: "framing" } : part)) },
  ])("honestly refuses $name before discovery/payment without another simulated planning call", async ({ output, name }) => {
    const transport = vi.fn(async () => response(output)); vi.stubGlobal("fetch", transport);
    const alternate = provider("alternate"), store = new MemoryReasoningCircuitStore();
    const failed = vi.spyOn(store, "failed"), succeeded = vi.spyOn(store, "succeeded");
    const engine = new ResilientEngine(provider(), alternate, 0, store);
    const listSources = vi.fn(), payFetch = vi.fn(), payCitations = vi.fn();
    const iterator = runAgent({ question: originalSystemd, budget: 0, researchMode: "quick" },
      { engine, db: { listSources }, gateway: { mode: "offline", payFetch, payCitations } } as unknown as AgentDeps);
    await iterator.next(); const error = await iterator.next().catch(error => error);
    expect(error).toBeInstanceOf(ResearchPlanningError);
    expect(error).toMatchObject({ reason: name.startsWith("expanded") ? "expanded_output" : "invalid_output", maximumTargets: 8 });
    expect((error as ResearchPlanningError).scopeChoices.length).toBeGreaterThan(0);
    expect(transport).toHaveBeenCalledOnce(); expect(alternate.calls).toEqual([]);
    expect(listSources).not.toHaveBeenCalled(); expect(payFetch).not.toHaveBeenCalled(); expect(payCitations).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled(); expect(succeeded).not.toHaveBeenCalled();
    expect(reasoningCalls(engine)).toMatchObject([{ outcome: "returned" }]); expect(reasoningCalls(engine)).toHaveLength(1);
    expect(reasoningUsage(engine)).toMatchObject([{ inputTokens: 23, outputTokens: 11 }]);
    expect(reasoningAttempts(engine)).toMatchObject([{ step: "decompose", outcome: "failed", error: "output_validation", status: 422 }]);
    expect(JSON.stringify(error)).not.toContain("Node.js");
  });

  it("refines a genuinely oversized explicitly per-subject comparison without converting a dimension to shared or slicing it", async () => {
    const question = "Compare Aspen, Birch and Cedar on throughput, latency and durability for each item separately. Use version V and official documents only.";
    const proposal = callerProposal(question, ["Aspen", "Birch", "Cedar"], ["throughput", "latency", "durability"], [], ["for each item separately.", "Use version V and official documents only."]);
    const transport = vi.fn(async () => response(proposal)); vi.stubGlobal("fetch", transport);
    const alternate = provider("alternate"), engine = new ResilientEngine(provider(), alternate, 0, new MemoryReasoningCircuitStore());
    const listSources = vi.fn(), payFetch = vi.fn(), payCitations = vi.fn();
    const iterator = runAgent({ question, budget: 0, researchMode: "quick" },
      { engine, db: { listSources }, gateway: { mode: "offline", payFetch, payCitations } } as unknown as AgentDeps);
    await iterator.next(); const error = await iterator.next().catch(error => error);
    expect(error).toMatchObject({ reason: "needs_refinement", maximumTargets: 8 });
    expect(researchFailureMessage(error)).toContain("Aspen");
    expect(transport).toHaveBeenCalledOnce(); expect(alternate.calls).toEqual([]);
    expect(listSources).not.toHaveBeenCalled(); expect(payFetch).not.toHaveBeenCalled(); expect(payCitations).not.toHaveBeenCalled();
    expect(reasoningCalls(engine)).toHaveLength(1); expect(reasoningUsage(engine)).toMatchObject([{ inputTokens: 23, outputTokens: 11 }]);
  });

  it.each(["subject", "framing"] as const)("refuses a supplied documentation URL assigned %s authority instead of source scope", role => {
    const output = callerProposal(SQLITE_SELECTION_QUESTION, sqliteSubjects, sqliteDimensions, sqliteShared, sqliteScope);
    output.comparison.parts = output.comparison.parts.map(part => part.text.includes("https://") ? { ...part, role } : part);
    expect(() => parseResearchPlan(SQLITE_SELECTION_QUESTION, output)).toThrow(ResearchPlanningError);
  });
});

describe("comparison reference token boundaries", () => {
  const sqliteUrls = ["https://sqlite.org/wal.html", "https://sqlite.org/backup.html"];
  const boundaries = sqliteUrls.flatMap(url => [
    { boundary: "scheme", at: url.indexOf(":") + 1 },
    { boundary: "host", at: url.indexOf(".org") },
    { boundary: "path", at: url.lastIndexOf("/") + 1 },
  ].flatMap(({ boundary, at }) => ([
    ["scope", "scope"], ["scope", "framing"], ["scope", "subject"], ["framing", "framing"],
  ] as const).map(([left, right]) => ({ name: `${url} ${boundary} ${left}/${right}`, url, at, left, right }))));

  it.each(boundaries)("refuses the exact original URL split at $name before discovery with one synthetic response", async ({ url, at, left, right }) => {
    const proposal = callerProposal(SQLITE_SELECTION_QUESTION, sqliteSubjects, sqliteDimensions, sqliteShared, sqliteScope);
    proposal.comparison.parts = proposal.comparison.parts.flatMap(part => {
      const start = part.text.indexOf(url);
      if (start < 0) return [part];
      return [{ text: part.text.slice(0, start), role: part.role },
        { text: url.slice(0, at), role: left }, { text: url.slice(at), role: right },
        { text: part.text.slice(start + url.length), role: part.role }].filter(part => part.text.length > 0);
    });
    expect(proposal.comparison.parts.map(part => part.text).join("")).toBe(SQLITE_SELECTION_QUESTION);
    const transport = vi.fn<typeof fetch>(async () => response(proposal)); vi.stubGlobal("fetch", transport);
    const alternate = provider("alternate"), store = new MemoryReasoningCircuitStore();
    const failed = vi.spyOn(store, "failed"), succeeded = vi.spyOn(store, "succeeded");
    const engine = new ResilientEngine(provider(), alternate, 0, store);
    const listSources = vi.fn(), payFetch = vi.fn(), payCitations = vi.fn();
    const iterator = runAgent({ question: SQLITE_SELECTION_QUESTION, budget: 0, researchMode: "quick" },
      { engine, db: { listSources }, gateway: { mode: "offline", payFetch, payCitations } } as unknown as AgentDeps);
    expect((await iterator.next()).value).toMatchObject({ phase: "decompose" });
    const error = await iterator.next().catch(error => error);
    expect(error).toBeInstanceOf(ResearchPlanningError);
    expect(error).toMatchObject({ reason: "invalid_output", maximumTargets: 8 });
    expect(transport).toHaveBeenCalledOnce(); expect(alternate.calls).toEqual([]);
    expect(listSources).not.toHaveBeenCalled(); expect(payFetch).not.toHaveBeenCalled(); expect(payCitations).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled(); expect(succeeded).not.toHaveBeenCalled();
    expect(reasoningCalls(engine)).toMatchObject([{ outcome: "returned" }]); expect(reasoningCalls(engine)).toHaveLength(1);
    expect(reasoningUsage(engine)).toMatchObject([{ inputTokens: 23, outputTokens: 11 }]); expect(reasoningUsage(engine)).toHaveLength(1);
    expect(reasoningAttempts(engine)).toMatchObject([{ step: "decompose", outcome: "failed", error: "output_validation", status: 422 }]);
  });

  it("preserves intact mixed-case HTTP(S) tokens, query/fragment bytes and multiple separate scope parts", () => {
    const scope = ["Use <HtTpS://example.org/A%20B?x=1&y=2#Frag>", "and `http://example.net/guide`. Keep version V."];
    const question = `Compare Aspen and Birch on latency. ${scope.join(" ")}`;
    const proposal = callerProposal(question, ["Aspen", "Birch"], ["latency"], [], scope);
    const targets = parseResearchPlan(question, proposal);
    expect(targets).toHaveLength(2);
    for (const target of targets) for (const qualification of scope) expect(target).toContain(qualification);
  });

  it.each([
    { name: "a repeated token", prefix: "Use https://example.org/guide " },
    { name: "a token after sixteen earlier references", prefix: "Use " + "https://example.org/guide ".repeat(16) },
  ])("checks every original occurrence, including $name, rather than deduplicating or capping the scan", ({ prefix }) => {
    const question = `Compare Aspen and Birch on latency. ${prefix}then https://example.org/guide`;
    // The final occurrence is deliberately discarded framing, even though an
    // identical intact token is already present in scope. No target injection.
    const proposal = callerProposal(question, ["Aspen", "Birch"], ["latency"], [], [prefix]);
    expect(proposal.comparison.parts.map(part => part.text).join("")).toBe(question);
    expect(() => parseResearchPlan(question, proposal)).toThrow(ResearchPlanningError);
  });
});

describe("bounded planning contract", () => {
  it("returns targeted refinement for the exact original Systemd scope without bundling dimensions or another provider call", async () => {
    // Exact normalized q2-intent/q2-run question from the genuine 0.26.17 run.
    // Its saved eight-target plan bundled the final setting's three dimensions;
    // this controlled proposal exposes all nine pairs, not a successful answer
    // or proof that a complete plan with shared prechecks cannot fit in eight.
    const question = "Tôi phải dừng một worker Node.js dưới systemd để deploy nhưng có thể còn việc đang chạy. Theo tài liệu chính thức systemd, TimeoutStopSec= và SendSIGKILL= phối hợp thế nào khi dừng quá lâu? Cho tôi một bảng ngắn cho cấu hình mặc định, TimeoutStopSec=infinity và SendSIGKILL=no: worker còn chạy thì điều gì xảy ra, rủi ro khi deploy, và tôi cần kiểm tra gì trước khi thay mã. Không giả định worker đã hoàn tất và không mua nguồn trả phí.";
    expect(createHash("sha256").update(question).digest("hex"))
      .toBe("05f8ce09b6cea622818d605f213c298fdab43ce4f6988f47e179150f3d57136d");
    const subjects = ["cấu hình mặc định", "TimeoutStopSec=infinity", "SendSIGKILL=no"];
    const dimensions = ["worker còn chạy thì điều gì xảy ra", "rủi ro khi deploy", "tôi cần kiểm tra gì trước khi thay mã"];
    const qualification = "Không giả định worker đã hoàn tất và không mua nguồn trả phí.";
    for (const excerpt of [...subjects, ...dimensions, qualification]) expect(question).toContain(excerpt);
    const claims = subjects.flatMap(subject => dimensions.map(dimension =>
      `Theo tài liệu chính thức systemd, với ${subject} khi worker còn chạy: ${dimension}?`));
    expect(claims).toHaveLength(9);
    const transport = vi.fn<typeof fetch>(async () => response({ status: "complete", claims,
      constraints: ["Bảng ngắn theo tài liệu chính thức systemd.", qualification] }));
    vi.stubGlobal("fetch", transport);
    const primary = provider(), alternate = provider("alternate"), store = new MemoryReasoningCircuitStore();
    const failed = vi.spyOn(store, "failed"), succeeded = vi.spyOn(store, "succeeded");
    const engine = new ResilientEngine(primary, alternate, 0, store);
    const listSources = vi.fn(), payFetch = vi.fn(), payCitations = vi.fn();
    const iterator = runAgent({ question, budget: 0, researchMode: "quick" },
      { engine, db: { listSources }, gateway: { mode: "offline", payFetch, payCitations } } as unknown as AgentDeps);
    expect((await iterator.next()).value).toMatchObject({ phase: "decompose" });
    const error = await iterator.next().catch(error => error);
    expect(error).toBeInstanceOf(ResearchPlanningError);
    expect(error).toMatchObject({ reason: "expanded_output", code: "research_plan_refinement_required", maximumTargets: 8, language: "vi" });
    const choices = (error as ResearchPlanningError).scopeChoices;
    expect(choices).toHaveLength(3);
    dimensions.forEach((dimension, index) => {
      expect(choices[index]).toContain(dimension);
      for (const subject of subjects) expect(choices[index]).toContain(subject);
      expect(choices[index]).toContain(qualification);
      expect(choices[index].length).toBeLessThanOrEqual(240);
    });
    const message = researchFailureMessage(error);
    for (const dimension of dimensions) expect(message).toContain(dimension);
    expect(message).toContain("giữ các URL/phiên bản và điều kiện nguồn");
    expect(message).toContain("không phải câu hỏi mới hay lần thử tự động");
    expect(error.message).not.toContain("Node.js");
    expect(JSON.stringify(error)).not.toContain("SendSIGKILL");
    expect(transport).toHaveBeenCalledOnce();
    const wire = JSON.parse(transport.mock.calls[0][1]!.body as string);
    expect(wire.messages[1].content).toContain(`User question (data): ${JSON.stringify(question)}`);
    expect(wire.messages[0].content).toContain("never silently drop dimensions, hide them in an umbrella target");
    expect(wire.max_tokens).toBe(2048);
    expect(reasoningCalls(engine)).toMatchObject([{ outcome: "returned" }]);
    expect(reasoningCalls(engine)).toHaveLength(1);
    expect(reasoningUsage(engine)).toMatchObject([{ inputTokens: 23, outputTokens: 11 }]);
    expect(reasoningUsage(engine)).toHaveLength(1); // Synthetic response counters, no invoice/live usage.
    expect(reasoningAttempts(engine)).toMatchObject([{ step: "decompose", outcome: "failed", error: "output_validation", status: 422 }]);
    expect(reasoningAttempts(engine)).toHaveLength(1);
    expect(alternate.calls).toEqual([]);
    expect(failed).not.toHaveBeenCalled(); expect(succeeded).not.toHaveBeenCalled();
    expect(listSources).not.toHaveBeenCalled(); expect(payFetch).not.toHaveBeenCalled(); expect(payCitations).not.toHaveBeenCalled();
  });

  it.each([systemd, sqlite])("preserves all supplied atomic targets and reaches discovery without changing the claim limit", async fixture => {
    const engine = new Fixture({ status: "complete", claims: fixture.claims, constraints: ["Use the original source versions; keep all substantive conditions."] });
    const boundary = new Error("synthetic discovery boundary");
    const listSources = vi.fn().mockRejectedValue(boundary), payFetch = vi.fn(), payCitations = vi.fn();
    const deps = { engine, db: { listSources }, gateway: { mode: "offline", payFetch, payCitations } } as unknown as AgentDeps;
    const iterator = runAgent({ question: fixture.question, budget: 0, researchMode: "quick" }, deps);
    expect((await iterator.next()).value).toMatchObject({ phase: "decompose" });
    expect((await iterator.next()).value).toMatchObject({ phase: "decompose", detail: fixture.claims });
    expect((await iterator.next()).value).toMatchObject({ phase: "decompose", detail: { researchMode: "quick", reevaluateRounds: 0 } });
    await expect(iterator.next()).rejects.toBe(boundary);
    expect(listSources).toHaveBeenCalledOnce(); expect(payFetch).not.toHaveBeenCalled(); expect(payCitations).not.toHaveBeenCalled();
  });

  it.each([
    {}, { claims: [] }, { claims: "private-model-body" }, { claims: ["valid", null] }, { claims: ["valid", " "] },
    { claims: ["valid", "x".repeat(601)] }, { claims: Array(65).fill("valid") },
    { status: "invented", claims: ["valid"] }, { claims: ["valid"], constraints: "private-model-body" },
    { claims: ["valid"], constraints: [null] }, { claims: ["valid"], constraints: Array(17).fill("valid") },
  ])("refuses malformed scope without filtering or aggregate fallback: %j", output => {
    expect(() => parseResearchPlan("Original caller request", output)).toThrow(ResearchPlanningError);
  });

  it("deduplicates only exact trimmed repeats and keeps distinct case or paraphrased targets", () => {
    expect(parseResearchPlan("request", { claims: [" Target A? ", "Target A?", "target a?", "Reworded A?", ...Array.from({ length: 5 }, (_, i) => `Other ${i}?`)] }))
      .toEqual(["Target A?", "target a?", "Reworded A?", ...Array.from({ length: 5 }, (_, i) => `Other ${i}?`)]);
    expect(() => parseResearchPlan("request", { claims: Array.from({ length: 9 }, (_, i) => `Target ${i}?`) })).toThrow("proposed research plan exceeded 8");
    expect(() => parseResearchPlan("request", { status: "needs_refinement", claims: ["aggregate question"] })).toThrow(ResearchPlanningError);
  });

  it("keeps suggestions bounded, caller-derived and out of generic error logs and accounting", () => {
    const question = `Private-caller-marker compare versions?\nKeep original qualifications;\nRead https://user:secret@example.org/private?q=secret#section, ${"😀".repeat(140)}.`;
    const error = new ResearchPlanningError(question, "expanded_output");
    expect(error.message).not.toContain("Private-caller-marker");
    expect(error.message).not.toContain("secret");
    expect(JSON.stringify(error)).not.toContain("Private-caller-marker");
    expect(inspect(error)).not.toContain("Private-caller-marker");
    expect(error.scopeChoices.length).toBeLessThanOrEqual(3);
    for (const choice of error.scopeChoices) { expect(choice.length).toBeLessThanOrEqual(241); expect(choice.isWellFormed()).toBe(true); }
    const message = researchFailureMessage(error);
    expect(message).toContain("Private-caller-marker"); expect(message).toContain("not a new question or an automatic retry");
    expect(message).not.toContain("https://user"); expect(message).not.toContain("secret");
    expect(researchFailureMessage(new Error("unchanged unknown error"))).toBe("unchanged unknown error");
  });

  it("wraps planning output validation only, retaining transport and input-limit distinctions", async () => {
    await expect(boundedResearchPlan("original", async () => { throw new ReasoningOutputValidationError("private-model-body"); })).rejects.toThrow(ResearchPlanningError);
    for (const error of [new ReasoningInputLimitError("input bound"), new ReasoningTransportError("timeout"), new TypeError("unknown")]) {
      await expect(boundedResearchPlan("original", async () => { throw error; })).rejects.toBe(error);
    }
  });
});

describe("billable planning refusal lifecycle", () => {
  it.each([
    { content: { claims: Array.from({ length: 9 }, (_, i) => `Private-provider-body target ${i}?`) }, finish: "stop" },
    { content: { claims: ["valid", null] }, finish: "stop" },
    { content: "{private-provider-body malformed", finish: "stop" },
    { content: { claims: sqlite.claims }, finish: "length" },
  ])("stops before discovery and extra paid tiers while retaining the returned call and usage: %j", async ({ content, finish }) => {
    const transport = vi.fn(async () => response(content, finish)); vi.stubGlobal("fetch", transport);
    const store = new MemoryReasoningCircuitStore(), failed = vi.spyOn(store, "failed"), succeeded = vi.spyOn(store, "succeeded");
    const primary = provider(), alternate = provider("alternate");
    const fallback = new ResilientEngine(alternate, new HeuristicEngine(), 1, store);
    const engine = new ResilientEngine(primary, fallback, 0, store);
    const listSources = vi.fn(), payFetch = vi.fn(), payCitations = vi.fn();
    const iterator = runAgent({ question: sqlite.question, budget: 0, researchMode: "quick" },
      { engine, db: { listSources }, gateway: { mode: "offline", payFetch, payCitations } } as unknown as AgentDeps);
    await iterator.next();
    await expect(iterator.next()).rejects.toBeInstanceOf(ResearchPlanningError);
    expect(transport).toHaveBeenCalledOnce(); expect(listSources).not.toHaveBeenCalled();
    expect(payFetch).not.toHaveBeenCalled(); expect(payCitations).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled(); expect(succeeded).not.toHaveBeenCalled();
    expect(reasoningAttempts(engine)).toMatchObject([{ step: "decompose", outcome: "failed", error: "output_validation", status: 422 }]);
    expect(reasoningAttempts(engine)).toHaveLength(1);
    // Valid JSON returns before local target validation; malformed/truncated JSON
    // fails inside chatJson. Both retain the billable provider-reported usage.
    expect(reasoningCalls(engine)).toMatchObject([{ outcome: typeof content === "string" || finish === "length" ? "failed" : "returned" }]);
    expect(reasoningCalls(engine)).toHaveLength(1);
    expect(reasoningUsage(engine)).toMatchObject([{ inputTokens: 23, outputTokens: 11 }]);
    expect(JSON.stringify({ attempts: reasoningAttempts(engine), calls: reasoningCalls(engine), usage: reasoningUsage(engine) })).not.toContain("Private-provider-body");
    expect(alternate.calls).toEqual([]);
    transport.mockImplementation(async () => response({ claims: sqlite.claims }));
    expect(await new ResilientEngine(provider(), fallback, 0, store).decompose(sqlite.question)).toEqual(sqlite.claims);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("preserves a prior failure and half-open lease on request-local planning refusal", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1001);
    const primary = provider(), store = new MemoryReasoningCircuitStore(), key = JSON.stringify([primary.name, "decompose"]);
    await store.failed(key, { transient: true, now: 0, failureThreshold: 1, baseCooldownMs: 1000, maxCooldownMs: 10000 });
    const failed = vi.spyOn(store, "failed"), succeeded = vi.spyOn(store, "succeeded");
    vi.stubGlobal("fetch", vi.fn(async () => response({ claims: Array.from({ length: 9 }, (_, i) => `Target ${i}?`) })));
    await expect(new ResilientEngine(primary, provider("alternate"), 0, store).decompose(sqlite.question)).rejects.toBeInstanceOf(ResearchPlanningError);
    expect(failed).not.toHaveBeenCalled(); expect(succeeded).not.toHaveBeenCalled();
    expect((await store.acquire(key, 1002, 1000)).allowed).toBe(false);
    expect((await store.failed(key, { transient: true, now: 1002, failureThreshold: 1, baseCooldownMs: 1000, maxCooldownMs: 10000 })).failures).toBe(2);
  });

  it("continues normal transport fallback for planning without classifying it as a scope refusal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = vi.fn().mockResolvedValueOnce(new Response("private-provider-body", { status: 503 }))
      .mockImplementation(async () => response({ claims: systemd.claims }));
    vi.stubGlobal("fetch", transport);
    const store = new MemoryReasoningCircuitStore(), failed = vi.spyOn(store, "failed");
    const engine = new ResilientEngine(provider(), provider("alternate"), 0, store);
    expect(await engine.decompose(systemd.question)).toEqual(systemd.claims);
    expect(transport).toHaveBeenCalledTimes(2); expect(failed).toHaveBeenCalledOnce();
    expect(reasoningAttempts(engine)).toMatchObject([{ error: "provider", status: 503 }, { outcome: "served" }]);
  });
});
