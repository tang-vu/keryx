import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SQLITE_SELECTION_QUESTION, SQLITE_SELECTION_QUESTION_SHA256, SQLITE_SELECTION_TARGETS } from "../../test-support/sqlite-selection-fixture";
import { MAX_SELECTION_DIAGNOSTIC_COUNT, parseSelectionDiagnostic, type SelectionDiagnostic } from "../research/selection-diagnostic";
import { JsonChatEngine } from "./json-chat-engine";
import { ReasoningOutputValidationError, ReasoningTransportError, type DecideInput } from "./reasoning-engine";
import { MemoryReasoningCircuitStore } from "./reasoning-circuit-store";
import { ResilientEngine, reasoningAttempts, reasoningUsage } from "./resilient-engine";
import { MAX_SELECTION_DIAGNOSTIC_HISTORY, ResearchSelectionError, parseResearchSelection, readSelectionDiagnostics } from "./research-selection";

/** Representative eight-target offline case, not the missing original live model payload. */
function sqliteInput(): DecideInput {
  return { question: SQLITE_SELECTION_QUESTION, subClaims: [...SQLITE_SELECTION_TARGETS], budget: 0, spentSoFar: 0,
    candidates: ["wal", "backup"].map((document, index) => {
      const url = `https://sqlite.org/${document}.html`;
      return { id: `public:${document}`, name: `SQLite ${document}`, description: "User-requested original; contents unobserved",
        tags: [], fetchPrice: 0, cached: false, preview: "User-requested original; contents unobserved", sourceKind: "public-reference",
        item: { itemId: `original-${index}`, itemTitle: document, itemUrl: url, contentVersion: "unobserved",
          requestedSource: { urls: [url], readScope: "bounded-whole-document" } } };
    }) };
}

function row(sourceId = "public:wal", targets: unknown = [0, 1, 4], action = "CACHE") {
  return { sourceId, action, targets, expectedValue: 0.8, confidence: 0.7, rationale: "Predicted relevance, not verified support." };
}

function refusal(input: DecideInput, output: unknown): ResearchSelectionError {
  try { parseResearchSelection(input, output); } catch (error) {
    expect(error).toBeInstanceOf(ResearchSelectionError);
    return error as ResearchSelectionError;
  }
  throw new Error("Expected a selection refusal");
}

class MeasuredEngine extends JsonChatEngine {
  lastSystem = "";
  lastInput?: Record<string, unknown>;
  constructor(readonly name: string, private readonly output: Record<string, unknown> | Error) { super(); }
  protected async chatJson(_model: string, system: string, payload: string) {
    this.lastSystem = system; this.lastInput = JSON.parse(payload);
    this.recordUsage({ model: "synthetic-model", inputTokens: 120, cachedInputTokens: null, outputTokens: 30 });
    if (this.output instanceof Error) throw this.output;
    return this.output;
  }
}

describe("bounded source-selection validation", () => {
  it("preserves representative eight targets, exact source identities and caller-owned prices", () => {
    const input = sqliteInput();
    expect(input.subClaims).toHaveLength(8);
    expect(createHash("sha256").update(input.question).digest("hex")).toBe(SQLITE_SELECTION_QUESTION_SHA256);
    const before = structuredClone(input);
    const output = parseResearchSelection(input, { decisions: [
      { ...row(), sourceName: "Forged name", price: 900, payTo: "provider-value" }, row("public:backup", [2, 3, 5, 6, 7]),
    ] });
    expect(output).toEqual({ decisions: [
      expect.objectContaining({ sourceId: "public:wal", sourceName: "SQLite wal", price: 0, targets: [0, 1, 4] }),
      expect.objectContaining({ sourceId: "public:backup", sourceName: "SQLite backup", price: 0, targets: [2, 3, 5, 6, 7] }),
    ] });
    expect(input).toEqual(before);
    expect(output.decisions.every(decision => !("payTo" in decision))).toBe(true);
  });

  it.each([
    [undefined, "missing_targets"], [[], "empty_targets"], [null, "targets_not_array"], ["0", "targets_not_array"],
    [["0"], "target_non_integer"], [[0, "1"], "target_non_integer"], [[0.5], "target_non_integer"], [Array(1), "target_non_integer"],
    [[-1], "target_out_of_range"], [[8], "target_out_of_range"], [[0, 8], "target_out_of_range"],
  ])("withholds the whole invalid target list %j without repairing indexes", (targets, code) => {
    const input = sqliteInput();
    for (const action of ["BUY", "CACHE"]) {
      const invalid = { ...row("public:wal", targets, action), targets };
      const result = parseResearchSelection(input, { decisions: [invalid, row("public:backup", [7])] });
      expect(result.decisions[0]).toMatchObject({ sourceId: "public:wal", action: "SKIP", targets: [],
        expectedValue: 0, confidence: 0, selectionRefusal: code });
      expect(result.decisions[1]).toMatchObject({ action: "CACHE", targets: [7] });
      expect(result.diagnostic).toMatchObject({ outcome: "partial", counts: { targetCount: 8, validActionableCount: 1,
        withheldCandidateCount: 1, invalidRowCount: 1 }, reasons: [{ code, rowIndex: 0, candidateIndex: 0 }] });
      const terminal = refusal(input, { decisions: [invalid, row("public:backup", [], "SKIP")] });
      expect(terminal.diagnostic).toMatchObject({ outcome: "refused", reasons: [{ code, rowIndex: 0, candidateIndex: 0 }] });
    }
  });

  it("retains genuine all-SKIP choices and canonicalizes nonauthorizing target fields", () => {
    const result = parseResearchSelection(sqliteInput(), { decisions: [row("public:wal", [], "SKIP"), row("public:backup", ["provider-value"], "skip")] });
    expect(result.diagnostic).toBeUndefined();
    expect(result.decisions).toEqual([expect.objectContaining({ action: "SKIP", targets: [] }), expect.objectContaining({ action: "SKIP", targets: [] })]);
    expect(result.decisions.every(decision => decision.selectionRefusal === undefined)).toBe(true);
  });

  it.each([
    [row(), row("public:wal", [], "SKIP")], [row(), row("public:wal", [0, 8])],
    [row("public:wal", [], "SKIP"), row("public:wal", [], "SKIP")],
  ])("withholds every duplicate candidate group without selecting a preferred row", (first, second) => {
    const result = parseResearchSelection(sqliteInput(), { decisions: [first, second, row("public:backup", [7])] });
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions[0]).toMatchObject({ action: "SKIP", targets: [], selectionRefusal: "duplicate_source" });
    expect(result.diagnostic).toMatchObject({ counts: { matchedCandidateCount: 2, invalidRowCount: 2, withheldCandidateCount: 1 },
      reasons: [{ code: "duplicate_source", rowIndex: 0, candidateIndex: 0 }, { code: "duplicate_source", rowIndex: 1, candidateIndex: 0 }] });
  });

  it("refuses all-duplicate selections, including conflicting SKIP and BUY", () => {
    const error = refusal(sqliteInput(), { decisions: [row(), row("public:wal", [], "SKIP")] });
    expect(error.diagnostic.counts.validActionableCount).toBe(0);
    expect(error.diagnostic.outcome).toBe("refused");
  });

  it("does not reconstruct unknown IDs, URLs or source names into a known candidate", () => {
    const result = parseResearchSelection(sqliteInput(), { decisions: [row("https://sqlite.org/wal.html"), row("SQLite wal"), row("public:backup", [7])] });
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].sourceId).toBe("public:backup");
    expect(result.diagnostic).toMatchObject({ counts: { invalidRowCount: 2 }, reasons: [{ code: "unknown_source", rowIndex: 0 }, { code: "unknown_source", rowIndex: 1 }] });
    expect(refusal(sqliteInput(), { decisions: [row("https://sqlite.org/wal.html")] }).diagnostic.reasons).toEqual([
      { code: "unknown_source", rowIndex: 0 }, { code: "no_matched_decisions" },
    ]);
  });

  it.each([row("unknown-provider-source", [0], "BUY"), null, { sourceId: 42 }])(
    "refuses malformed or unknown rows alongside only a matched SKIP %j", invalid => {
      const error = refusal(sqliteInput(), { decisions: [invalid, row("public:backup", [], "SKIP")] });
      expect(error.diagnostic).toMatchObject({ outcome: "refused", counts: { matchedCandidateCount: 1,
        invalidRowCount: 1, validActionableCount: 0 } });
    });

  it.each([null, [], "provider-text", 42, { sourceId: 42 }, { sourceId: "public:wal", action: "PAY" },
    { ...row(), rationale: { message: "provider-text" } }])("isolates a malformed row %j beside a valid source", value => {
    const result = parseResearchSelection(sqliteInput(), { decisions: [value, row("public:backup", [7])] });
    expect(result.decisions.filter(decision => decision.action !== "SKIP")).toEqual([expect.objectContaining({ sourceId: "public:backup", targets: [7] })]);
    expect(result.diagnostic?.reasons[0].code).toBe("malformed_row");
    expect(result.diagnostic?.counts.invalidRowCount).toBe(1);
  });

  it.each([{}, { decisions: [] }])("classifies a genuinely absent/empty selection %j", output => {
    expect(refusal(sqliteInput(), output).diagnostic.reasons).toEqual([{ code: "no_decisions" }]);
  });

  it.each([null, [], { decisions: "provider-text" }, { decisions: {} }])("distinguishes invalid output %j from an empty decision list", output => {
    expect(refusal(sqliteInput(), output).diagnostic.reasons).toEqual([{ code: "invalid_output" }]);
  });

  it("bounds reason count, indexes and oversized batch work without dropping a tail into a valid batch", () => {
    const output = { decisions: Array.from({ length: 50 }, (_, index) => row(`unknown-${index}`)) };
    const error = refusal(sqliteInput(), output);
    expect(error.diagnostic.reasons).toHaveLength(16);
    expect(error.diagnostic.truncated).toBe(true);
    expect(error.diagnostic.counts.invalidRowCount).toBe(50);
    const oversized = refusal(sqliteInput(), { decisions: Array(MAX_SELECTION_DIAGNOSTIC_COUNT + 1).fill(row()) });
    expect(oversized.diagnostic).toMatchObject({ counts: { decisionCount: MAX_SELECTION_DIAGNOSTIC_COUNT,
      invalidRowCount: MAX_SELECTION_DIAGNOSTIC_COUNT }, truncated: true, reasons: [{ code: "invalid_output" }] });
  });
});

describe("safe diagnostic contract", () => {
  const safe = (): SelectionDiagnostic => refusal(sqliteInput(), { decisions: [row("private-source-id-URL", ["private-target-value"])] }).diagnostic;

  it("keeps a stable ID/time while defensively cloning getters and stripping arbitrary fields", () => {
    const error = refusal(sqliteInput(), { decisions: [row("private-source-id-URL", ["private-target-value"])] });
    const first = error.diagnostic;
    const second = error.diagnostic;
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    first.counts.candidateCount = 900; first.reasons[0].code = "malformed_row";
    expect(error.diagnostic).toEqual(second);
    expect(error).toBeInstanceOf(ReasoningOutputValidationError);
    expect(error).toMatchObject({ name: "ResearchSelectionError", status: 422, code: "research_source_selection_invalid" });
    const data = { ...second, prompt: SQLITE_SELECTION_QUESTION, providerValue: "private-target-value",
      counts: { ...second.counts, raw: "private" }, reasons: second.reasons.map(reason => ({ ...reason, sourceId: "private" })) };
    const parsed = parseSelectionDiagnostic(data)!;
    expect(parsed).toEqual(second);
    expect(parsed).not.toBe(second);
    expect(JSON.stringify({ error, diagnostic: parsed })).not.toMatch(/sqlite\.org|private|SQLite|providerValue|sourceId|prompt/);
  });

  it.each([
    (value: SelectionDiagnostic) => ({ ...value, protocol: "other" }),
    (value: SelectionDiagnostic) => ({ ...value, stage: "synthesize" }),
    (value: SelectionDiagnostic) => ({ ...value, outcome: "complete" }),
    (value: SelectionDiagnostic) => ({ ...value, id: "https://private.example" }),
    (value: SelectionDiagnostic) => ({ ...value, createdAt: "2026-02-30T00:00:00.000Z" }),
    (value: SelectionDiagnostic) => ({ ...value, reasons: [{ code: "provider-said-private-value" }] }),
    (value: SelectionDiagnostic) => ({ ...value, reasons: [{ code: "unknown_source", rowIndex: 10000 }] }),
    (value: SelectionDiagnostic) => ({ ...value, reasons: [{ code: "unknown_source", candidateIndex: -1 }] }),
    (value: SelectionDiagnostic) => ({ ...value, counts: { ...value.counts, candidateCount: 10001 } }),
    (value: SelectionDiagnostic) => ({ ...value, counts: { ...value.counts, targetCount: 0.5 } }),
    (value: SelectionDiagnostic) => ({ ...value, reasons: Array(17).fill({ code: "unknown_source" }) }),
    (value: SelectionDiagnostic) => ({ ...value, reasons: [] }),
  ])("rejects nonallowlisted or unbounded client metadata %#", mutate => {
    expect(parseSelectionDiagnostic(mutate(safe()))).toBeUndefined();
  });

  it("does not evaluate unknown-object accessors", () => {
    const getter = vi.fn(() => "private");
    const value = Object.defineProperty(safe(), "prompt", { get: getter, enumerable: true });
    expect(parseSelectionDiagnostic(value)).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("request-local selection instrumentation and paid-call isolation", () => {
  it("makes the exact eight allowed indexes/source IDs and alternative concrete row shapes explicit", async () => {
    const input = sqliteInput();
    const engine = new MeasuredEngine("selection-prompt", { decisions: [row(), row("public:backup", [7])] });
    await engine.decide(input);
    expect(engine.lastInput).toMatchObject({ allowedTargetIndexes: [0, 1, 2, 3, 4, 5, 6, 7],
      allowedSourceIds: ["public:wal", "public:backup"], expectedDecisionRows: 2,
      subClaims: input.subClaims.map((question, claimIndex) => ({ question, claimIndex })),
      examples: { actionableRow: expect.objectContaining({ sourceId: "public:wal", action: "CACHE", targets: [0] }),
        skipRow: expect.objectContaining({ sourceId: "public:wal", action: "SKIP", targets: [] }) } });
    expect(engine.lastSystem).toContain("Copy its sourceId exactly");
    expect(engine.lastSystem).toContain("preview has no substantive evidence");
    expect(engine.lastSystem).toContain("not verified evidence or permission to pay citation rewards");
    expect(engine.lastSystem).not.toContain("If no target is supported by the preview");
  });

  it("records one billable response and one failed attempt, with no fallback or circuit mutation", async () => {
    const primary = new MeasuredEngine("selection-terminal", { decisions: [row("public:wal", [0, 8])] });
    const fallback = new MeasuredEngine("selection-alternate", { decisions: [row()] });
    const store = new MemoryReasoningCircuitStore();
    const failed = vi.spyOn(store, "failed"), succeeded = vi.spyOn(store, "succeeded");
    const engine = new ResilientEngine(primary, fallback, 0, store);
    await expect(engine.decide(sqliteInput())).rejects.toBeInstanceOf(ResearchSelectionError);
    expect(primary.calls).toEqual([expect.objectContaining({ outcome: "returned" })]);
    expect(fallback.calls).toHaveLength(0);
    expect(reasoningUsage(engine)).toEqual([expect.objectContaining({ inputTokens: 120, outputTokens: 30, callId: primary.calls[0].id })]);
    expect(reasoningAttempts(engine)).toEqual([expect.objectContaining({ tier: 0, attempt: 1, outcome: "failed", status: 422, error: "output_validation" })]);
    expect(failed).not.toHaveBeenCalled(); expect(succeeded).not.toHaveBeenCalled();
    expect(readSelectionDiagnostics(engine)).toEqual(primary.selectionDiagnostics);
  });

  it("does not clear a durable half-open lease on a request-local selection refusal", async () => {
    const primary = new MeasuredEngine("selection-half-open", { decisions: [row("public:wal", [])] });
    const store = new MemoryReasoningCircuitStore();
    const key = JSON.stringify([primary.name, "decide"]);
    store.remember({ key, failures: 2, openUntil: Date.now() - 1, probeUntil: 0, updatedAt: Date.now() - 10 });
    const engine = new ResilientEngine(primary, new MeasuredEngine("unused", { decisions: [row()] }), 0, store);
    await expect(engine.decide(sqliteInput())).rejects.toBeInstanceOf(ResearchSelectionError);
    expect(await store.acquire(key, Date.now(), 1000)).toMatchObject({ allowed: false });
  });

  it("classifies completed malformed/truncated output locally and preserves usage without retries", async () => {
    const primary = new MeasuredEngine("selection-invalid-output", new ReasoningOutputValidationError("private provider body"));
    const fallback = new MeasuredEngine("unused", { decisions: [row()] });
    const engine = new ResilientEngine(primary, fallback, 0, new MemoryReasoningCircuitStore());
    await expect(engine.decide(sqliteInput())).rejects.toBeInstanceOf(ResearchSelectionError);
    expect(readSelectionDiagnostics(engine)[0].reasons).toEqual([{ code: "invalid_output" }]);
    expect(primary.calls).toEqual([expect.objectContaining({ outcome: "failed" })]);
    expect(engine.usage).toHaveLength(1); expect(fallback.calls).toHaveLength(0);
    expect(JSON.stringify(readSelectionDiagnostics(engine))).not.toContain("private");
  });

  it("keeps transport failures distinct from selection refusals", async () => {
    const failure = new ReasoningTransportError("timeout");
    const engine = new MeasuredEngine("selection-transport", failure);
    await expect(engine.decide(sqliteInput())).rejects.toBe(failure);
    expect(engine.selectionDiagnostics).toEqual([]);
  });

  it("propagates mixed-success diagnostics through nested tiers as bounded independent snapshots", async () => {
    const primary = new MeasuredEngine("selection-partial", { decisions: [row("public:wal", [0, 8]), row("public:backup", [7])] });
    const nested = new ResilientEngine(primary, new MeasuredEngine("unused", { decisions: [row()] }), 0, new MemoryReasoningCircuitStore());
    const result = await nested.decide(sqliteInput());
    expect(result[0]).toMatchObject({ action: "SKIP", targets: [], selectionRefusal: "target_out_of_range" });
    expect(nested.selectionDiagnostics[0].outcome).toBe("partial");
    nested.selectionDiagnostics[0].reasons[0].code = "malformed_row";
    expect(nested.selectionDiagnostics[0].reasons[0].code).toBe("target_out_of_range");
    expect(readSelectionDiagnostics({})).toEqual([]);
  });

  it("keeps sequential and concurrent synthetic calls correlated with independent bounded diagnostics", async () => {
    const engine = new MeasuredEngine("selection-concurrent", { decisions: [row("public:wal", []), row("public:backup", [7])] });
    await Promise.all([engine.decide(sqliteInput()), engine.decide(sqliteInput())]);
    expect(new Set(engine.calls.map(call => call.id)).size).toBe(2);
    expect(new Set(engine.usage.map(record => record.callId)).size).toBe(2);
    expect(new Set(engine.selectionDiagnostics.map(diagnostic => diagnostic.id)).size).toBe(2);
    for (let index = 0; index < MAX_SELECTION_DIAGNOSTIC_HISTORY; index++) await engine.decide(sqliteInput());
    expect(engine.selectionDiagnostics).toHaveLength(MAX_SELECTION_DIAGNOSTIC_HISTORY);
    expect(engine.selectionDiagnostics.every(diagnostic => parseSelectionDiagnostic(diagnostic))).toBe(true);
    expect(engine.calls).toHaveLength(MAX_SELECTION_DIAGNOSTIC_HISTORY + 2);
  });
});
