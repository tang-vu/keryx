/** Synthesis-only evaluation: frozen primary-document sections; no DB/search/payment effects. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import path from "node:path";
import * as firstCases from "../lib/evals/decision-brief-cases.ts";
import { BoundedWorkloadEngine, WorkloadModelBudget } from "../lib/evals/bounded-workload-engine.ts";
import { buildEvidenceLedger } from "../lib/agent/evidence-ledger.ts";
import { deliverDecisionBrief } from "../lib/agent/decision-brief.ts";
import { finalizeGroundedAnswer } from "../lib/agent/answer-grounding.ts";
import type { GatheredContent } from "../lib/llm/reasoning-engine.ts";
import type { ChatJsonOptions } from "../lib/llm/json-chat-engine.ts";

const args = process.argv.slice(2);
const secondAttempt = args.includes("--v2");
const thirdAttempt = args.includes("--v3");
if (secondAttempt && thirdAttempt) throw new Error("Choose one frozen attempt");
const { decisionBriefCases, DECISION_BRIEF_CASES_VERSION } = thirdAttempt
  ? await import("../lib/evals/decision-brief-cases-v3.ts") : secondAttempt
    ? await import("../lib/evals/decision-brief-cases-v2.ts") : firstCases;
const required = (flag: string) => { const index = args.indexOf(flag); if (index < 0 || !args[index + 1]) throw new Error(`Required ${flag}`); return args[index + 1]; };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const capturesBytes = await readFile(required("--captures"));
if (hash(capturesBytes) !== required("--captures-sha256")) throw new Error("Frozen capture manifest changed");
const casesBytes = await readFile(new URL(thirdAttempt ? "../lib/evals/decision-brief-cases-v3.ts"
  : secondAttempt ? "../lib/evals/decision-brief-cases-v2.ts" : "../lib/evals/decision-brief-cases.ts", import.meta.url));
if (hash(casesBytes) !== required("--cases-sha256")) throw new Error("Frozen task specification changed");
type Capture = { id: string; url: string; finalUrl: string; title: string; text: string; textSha256: string };
const document = JSON.parse(capturesBytes.toString("utf8"));
const captures: Capture[] = Array.isArray(document) ? document : document.captures;
if (!Array.isArray(captures)) throw new Error("Malformed captures");
for (const capture of captures) if (hash(capture.text) !== capture.textSha256) throw new Error("Frozen source text changed");
const byId = new Map(captures.map(capture => [capture.id, capture]));
const inputsBytes = await readFile(required("--inputs"));
if (hash(inputsBytes) !== required("--inputs-sha256")) throw new Error("Frozen runtime inputs changed");
const inputs = JSON.parse(inputsBytes.toString("utf8")) as { cases: { id: string; question: string; subClaims: string[]; gathered: GatheredContent[] }[] };
const apiKey = parseEnv(await readFile(required("--key-file"), "utf8")).DEEPSEEK_API_KEY;
if (!apiKey?.trim()) throw new Error("Missing explicit model credential");
const root = path.resolve(".artifacts/decision-brief-evaluation");
await mkdir(root, { recursive: true });
const output = path.join(root, new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: false });
const allowance = new WorkloadModelBudget(path.join(root, "budget.json"), 802_000);
// All freezes share the ORIGINAL $0.802 journal. V3 follows34held attempts and
// has at most32newcalls, each <=12,144microUSD (20kUTF8+4096framing/output4096).
// No reset/refund/retry; oversize input fails without truncating source context.
class ObservedEngine extends BoundedWorkloadEngine {
  readonly responses: unknown[] = [];
  readonly wire: unknown[] = [];
  protected async chatJson(model: string, system: string, user: string, maxTokens = 2048, options?: ChatJsonOptions) {
    if (allowance.snapshot().calls >= (thirdAttempt ? 66 : secondAttempt ? 64 : 32)) throw new Error("Frozen synthesis call ceiling reached");
    if (thirdAttempt && (Buffer.byteLength(system + " Respond with a single JSON object." + user, "utf8") > 20_000 || maxTokens > 4096))
      throw new Error("Frozen V3 request envelope exceeded; no context truncation");
    const fetchOriginal = globalThis.fetch;
    // Sequential, public-input-only evaluator. Retain response metadata/content,
    // never headers, API credentials or provider reasoning_content.
    globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await fetchOriginal(...args);
      const body = await response.clone().json().catch(() => undefined);
      const request = typeof args[1]?.body === "string" ? JSON.parse(args[1].body) : undefined;
      this.wire.push({ status: response.status, model: body?.model,
        finishReason: body?.choices?.[0]?.finish_reason, content: body?.choices?.[0]?.message?.content,
        maximumOutputTokens: maxTokens, reasoningReview: options?.reasoningReview === true,
        wireThinking: request?.thinking, wireReasoningEffort: request?.reasoning_effort,
        systemSha256: hash(system), userSha256: hash(user) });
      return response;
    };
    try {
      const result = await super.chatJson(model, system, user, maxTokens, options);
      this.responses.push(structuredClone(result));
      return result;
    } finally { globalThis.fetch = fetchOriginal; }
  }
}
const results: unknown[] = [];
try {
  for (const task of decisionBriefCases) {
    const retained = inputs.cases.find(input => input.id === task.id);
    if (!retained || retained.question !== task.question || JSON.stringify(retained.subClaims) !== JSON.stringify(task.subClaims) ||
      retained.gathered.length !== task.sources.length) throw new Error("Frozen runtime input binding changed");
    const gathered: GatheredContent[] = task.sources.map((source, index) => {
      const capture = byId.get(source.captureId);
      const read = retained.gathered[index];
      if (!capture || source.url !== capture.url || read.itemUrl !== capture.finalUrl || read.text !== capture.text ||
        read.marker !== `S${index + 1}` || read.sourceKind !== "public-reference") throw new Error("Frozen task/source binding changed");
      return read;
    });
    const started = Date.now();
    const engine = new ObservedEngine(apiKey, allowance);
    const input = { question: task.question, subClaims: [...task.subClaims], gathered, answerFormat: "decision-brief" as const };
    const synthesized = await engine.synthesize(input);
    // Fixed permissive assessment isolates synthesis/old identity+literal gates;
    // it is NOT an executed sufficiency, discovery or production payment result.
    const ledger = buildEvidenceLedger({ subClaims: input.subClaims, gathered, answer: synthesized.answer,
      declaredMarkers: synthesized.citedMarkers, proposedEvidence: synthesized.evidence,
      finalAssessment: input.subClaims.map(claim => ({ claim, coverage: 1, coveredBy: gathered.map(source => source.marker) })) });
    const projected = deliverDecisionBrief(synthesized.decisionBrief, ledger, input.question);
    const delivered = projected?.facts ? projected : undefined;
    const answer = delivered?.answer ?? finalizeGroundedAnswer({ question: input.question, answer: synthesized.answer, ledger: projected?.ledger ?? ledger });
    const result = { id: task.id, question: input.question, durationMs: Date.now() - started,
      delivery: delivered ? "reviewed-decision-brief" : "qualified-excerpts", facts: delivered?.facts ?? 0, actions: delivered?.actions ?? 0,
      evidenceReview: synthesized.evidenceReview, answer, calls: engine.calls, usage: engine.usage,
      evidence: (projected?.ledger ?? ledger).evidence, responses: engine.responses, wire: engine.wire,
      packet: synthesized.decisionBrief?.packet, allowance: allowance.snapshot() };
    results.push(result);
    await writeFile(path.join(output, `${task.id}.json`), JSON.stringify(result, null, 2), { flag: "wx" });
    await writeFile(path.join(output, `${task.id}.md`), answer, { flag: "wx" });
    console.log(JSON.stringify({ id: task.id, delivery: result.delivery, facts: result.facts, actions: result.actions,
      calls: engine.calls.length, reservedMicroUsd: allowance.snapshot().reservedMicroUsd }));
  }
} finally {
  await writeFile(path.join(output, "summary.json"), JSON.stringify({
    version: DECISION_BRIEF_CASES_VERSION, scope: "internal-synthesis-only-frozen-sections",
    capturesSha256: hash(capturesBytes), casesSha256: hash(casesBytes), inputsSha256: hash(inputsBytes),
    baseline: "fixed-permissive-final-assessment; no executed discovery/sufficiency/payment/client",
    cases: results, allowance: allowance.snapshot(), outcome: "independent-adjudication-pending",
  }, null, 2), { flag: "wx" });
  allowance.close();
}
