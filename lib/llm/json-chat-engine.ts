/**
 * JsonChatEngine — shared reasoning logic for any chat LLM that can return JSON.
 * Subclasses implement only `chatJson(model, system, user)`. The prompts (the actual
 * "thinking") live here once, so Anthropic and DeepSeek behave identically.
 */

import { config } from "../config";
import type { Decision } from "../types";
import type {
  AttributeInput,
  DecideInput,
  ReasoningEngine,
  SufficiencyInput,
  SynthInput,
} from "./reasoning-engine";

export abstract class JsonChatEngine implements ReasoningEngine {
  abstract readonly name: string;

  /** Call the model and return a parsed JSON object. Subclass-specific transport. */
  protected abstract chatJson(
    model: string,
    system: string,
    user: string,
  ): Promise<Record<string, unknown>>;

  async decompose(question: string): Promise<string[]> {
    const out = await this.chatJson(
      config.llmModel,
      "You break a research question into 1-4 atomic sub-claims an answer must support. Be concise.",
      `Question: ${question}\n\nReturn JSON: {"claims": string[]}`,
    );
    const claims = (out.claims as string[]) ?? [];
    return claims.length ? claims.slice(0, 4) : [question];
  }

  async decide(input: DecideInput): Promise<Decision[]> {
    const candidates = input.candidates.map((c) => ({
      sourceId: c.id,
      name: c.name,
      description: c.description,
      tags: c.tags,
      price: c.fetchPrice,
      cached: c.cached,
      preview: c.preview.slice(0, 600),
    }));
    const out = await this.chatJson(
      config.llmModel,
      "You are a frugal research agent deciding which paid sources to buy under a budget. " +
        "For EACH candidate choose action BUY (pay the toll, high value), CACHE (already cached & still useful, reuse free), or SKIP (not worth it). " +
        "Weigh expected value against price; prefer cheaper sufficient sources; avoid redundancy. " +
        "Give a short, specific, human-readable rationale citing WHY. Output strict JSON only.",
      JSON.stringify({
        question: input.question,
        subClaims: input.subClaims,
        budget: input.budget,
        spentSoFar: input.spentSoFar,
        candidates,
        schema:
          '{"decisions":[{"sourceId":string,"action":"BUY"|"CACHE"|"SKIP","expectedValue":number(0..1),"confidence":number(0..1),"rationale":string,"targets":number[]}]}',
      }),
    );
    const byId = new Map(input.candidates.map((c) => [c.id, c]));
    const decisions = (out.decisions as Record<string, unknown>[]) ?? [];
    return decisions
      .map((d) => {
        const c = byId.get(d.sourceId as string);
        if (!c) return null;
        return {
          sourceId: c.id,
          sourceName: c.name,
          action: normalizeAction(d.action as string),
          expectedValue: clamp01(d.expectedValue as number),
          price: c.fetchPrice,
          confidence: clamp01(d.confidence as number),
          rationale: (d.rationale as string) ?? "",
          targets: Array.isArray(d.targets) ? (d.targets as number[]) : [],
        } satisfies Decision;
      })
      .filter((d): d is Decision => d !== null);
  }

  async sufficiency(
    input: SufficiencyInput,
  ): Promise<{ sufficient: boolean; rationale: string }> {
    const out = await this.chatJson(
      config.llmModel,
      "You decide if enough has been read to answer confidently. Stopping early saves budget; only continue if a sub-claim is genuinely unsupported. Output strict JSON.",
      JSON.stringify({
        question: input.question,
        subClaims: input.subClaims,
        gathered: input.gathered.map((g) => ({
          marker: g.marker,
          source: g.sourceName,
          text: g.text.slice(0, 800),
        })),
        schema: '{"sufficient":boolean,"rationale":string}',
      }),
    );
    return { sufficient: Boolean(out.sufficient), rationale: (out.rationale as string) ?? "" };
  }

  async synthesize(
    input: SynthInput,
  ): Promise<{ answer: string; citedMarkers: string[] }> {
    const out = await this.chatJson(
      config.synthesisModel,
      "You write a grounded, accurate answer using ONLY the provided sources. " +
        "Cite inline with the source markers like [S1]. Cite every claim. Do not invent facts. Output strict JSON.",
      JSON.stringify({
        question: input.question,
        subClaims: input.subClaims,
        sources: input.gathered.map((g) => ({
          marker: g.marker,
          name: g.sourceName,
          text: g.text.slice(0, 2000),
        })),
        schema: '{"answer":string (markdown with [S#] citations),"citedMarkers":string[]}',
      }),
    );
    return {
      answer: (out.answer as string) ?? "",
      citedMarkers: Array.isArray(out.citedMarkers) ? (out.citedMarkers as string[]) : [],
    };
  }

  async attribute(
    input: AttributeInput,
  ): Promise<{ sourceId: string; weight: number; rationale: string }[]> {
    const out = await this.chatJson(
      config.synthesisModel,
      "You assign each cited source a contribution weight (0..1) for how much it grounded the answer. Weights must sum to ~1. Output strict JSON.",
      JSON.stringify({
        question: input.question,
        answer: input.answer,
        sources: input.used.map((u) => ({
          sourceId: u.sourceId,
          marker: u.marker,
          name: u.sourceName,
          text: u.text.slice(0, 1000),
        })),
        schema: '{"attributions":[{"sourceId":string,"weight":number,"rationale":string}]}',
      }),
    );
    const atts =
      (out.attributions as { sourceId: string; weight: number; rationale: string }[]) ?? [];
    const total = atts.reduce((s, a) => s + (a.weight || 0), 0) || 1;
    return atts.map((a) => ({
      sourceId: a.sourceId,
      weight: clamp01(a.weight / total),
      rationale: a.rationale ?? "",
    }));
  }
}

export function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return {};
  }
}

function normalizeAction(a: string): Decision["action"] {
  const up = (a ?? "").toUpperCase();
  return up === "BUY" || up === "CACHE" || up === "SKIP" ? up : "SKIP";
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
