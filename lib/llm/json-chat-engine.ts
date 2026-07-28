/**
 * JsonChatEngine — shared reasoning logic for any chat LLM that can return JSON.
 * Subclasses implement only `chatJson(model, system, user)`. The prompts (the actual
 * "thinking") live here once, so Anthropic and DeepSeek behave identically.
 */

import { config } from "../config";
import type { Decision } from "../types";
import type {
  AttributeInput,
  ClaimSufficiency,
  DecideInput,
  ReevaluateInput,
  ReevaluateOutput,
  ReasoningEngine,
  SufficiencyInput,
  SufficiencyResult,
  SynthInput,
  SynthResult,
  Conflict,
} from "./reasoning-engine";

export abstract class JsonChatEngine implements ReasoningEngine {
  abstract readonly name: string;

  /**
   * Call the model and return a parsed JSON object. Subclass-specific transport.
   *
   * `maxTokens` matters for the steps whose reply scales with the corpus: one line per candidate
   * source, per gathered excerpt, per citation. A reply that hits the ceiling comes back as
   * truncated JSON, which parses to nothing — and "nothing" used to look exactly like a decision to
   * buy nothing. Implementations MUST throw when the model stops on the length limit rather than
   * hand back a half-object; the resilience layer then retries and drops a tier, loudly.
   */
  protected abstract chatJson(
    model: string,
    system: string,
    user: string,
    maxTokens?: number,
  ): Promise<Record<string, unknown>>;

  /**
   * Output ceiling for a reply that carries one entry per item. Generous per item (a rationale is
   * prose) with a floor for the fixed parts and a hard cap well inside provider limits, so a corpus
   * that grows does not silently walk into truncation the way 20 sources did against a flat 2048.
   */
  protected budgetFor(items: number): number {
    return Math.min(8192, 1024 + items * 256);
  }

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
      ...(c.external
        ? { external: true, settlesOn: c.external.chains, settlesOnArc: c.external.onArc }
        : {}),
    }));
    const memoryBlock = input.memoryContext
      ? `\n\n${input.memoryContext}\n\n`
      : "";
    const out = await this.chatJson(
      config.llmModel,
      "You are a frugal research agent deciding which paid sources to buy under a budget. " +
        "For EACH candidate choose action BUY (pay the toll, high value), CACHE (already cached & still useful, reuse free), or SKIP (not worth it). " +
        "Weigh expected value against price; prefer cheaper sufficient sources; avoid redundancy. " +
        "Some candidates have external:true — these are live endpoints from the open x402 marketplace that settle on OTHER chains, not Keryx's Arc rail. " +
        "You cannot settle to them this run, so mark them SKIP, but still judge their real topical value and say WHY in the rationale (note the off-rail chain). " +
        memoryBlock +
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
      this.budgetFor(candidates.length),
    );
    const byId = new Map(input.candidates.map((c) => [c.id, c]));
    const decisions = (out.decisions as Record<string, unknown>[]) ?? [];
    // A reply with no decisions at all, when candidates were offered, is not a frugal choice — it is
    // a reply that did not survive (capped, malformed, off-schema). Saying "buy nothing" on its
    // behalf would silently switch the agent off, and every source would stop earning while the
    // trace still read like a deliberate decision. Fail instead: the resilience layer drops a tier.
    if (decisions.length === 0 && input.candidates.length > 0) {
      throw new Error("decide returned no decisions for " + input.candidates.length + " candidates");
    }
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

  async sufficiency(input: SufficiencyInput): Promise<SufficiencyResult> {
    const out = await this.chatJson(
      config.llmModel,
      "You decide if enough has been read to answer confidently. For EACH sub-claim, estimate its coverage (0.0 = not covered, 1.0 = fully supported) " +
        "and list which source markers cover it. Stopping early saves budget; only continue if a sub-claim has coverage below 0.4. Output strict JSON.",
      JSON.stringify({
        question: input.question,
        subClaims: input.subClaims,
        gathered: input.gathered.map((g) => ({
          marker: g.marker,
          source: g.sourceName,
          text: g.text.slice(0, 800),
        })),
        schema:
          '{"sufficient":boolean,"rationale":string,"perClaim":[{"claim":string,"coverage":number(0..1),"coveredBy":string[]}]}',
      }),
      this.budgetFor(input.subClaims.length + input.gathered.length),
    );
    const rawClaims = (out.perClaim as Record<string, unknown>[]) ?? [];
    // The claim text is caller-owned state. Preserve the requested order and wording rather than
    // trusting the model to repeat it exactly; a harmless paraphrase must not erase final coverage.
    const perClaim: ClaimSufficiency[] = input.subClaims.map(
      (claim, index) => {
        const item = rawClaims[index] ?? {};
        return {
          claim,
          coverage: clamp01(item.coverage as number),
          coveredBy: Array.isArray(item.coveredBy)
            ? (item.coveredBy as unknown[]).filter(
                (marker): marker is string => typeof marker === "string",
              )
            : [],
        };
      },
    );
    return {
      sufficient: Boolean(out.sufficient),
      rationale: (out.rationale as string) ?? "",
      perClaim: perClaim.length > 0 ? perClaim : undefined,
    };
  }

  async reevaluate(input: ReevaluateInput): Promise<ReevaluateOutput> {
    const out = await this.chatJson(
      config.llmModel,
      "You are a research agent that has already read some sources. Now assess coverage per sub-claim. " +
        "For each claim, estimate how well the gathered content supports it (0.0 = not covered, 1.0 = fully covered). " +
        "If any claim has coverage below 0.5 AND there are affordable skipped sources that could fill the gap, " +
        "recommend buying them (in priority order). Only recommend sources whose price fits the remaining budget. " +
        "Be frugal — don't buy more if coverage is already adequate. Output strict JSON.",
      JSON.stringify({
        question: input.question,
        subClaims: input.subClaims,
        gathered: input.gathered.map((g) => ({
          marker: g.marker,
          source: g.sourceName,
          text: g.text.slice(0, 800),
        })),
        skippedSources: input.skippedSources.map((s) => ({
          id: s.id,
          name: s.name,
          price: s.price,
          preview: s.preview.slice(0, 300),
        })),
        remainingBudget: input.remainingBudget,
        schema:
          '{"claims":[{"claim":string,"coverage":number(0..1),"coveredBy":string[],"rationale":string}],"shouldBuyMore":boolean,"recommendedIds":string[],"rationale":string}',
      }),
      this.budgetFor(input.subClaims.length + input.skippedSources.length),
    );
    const claims = (out.claims as ReevaluateOutput["claims"]) ?? [];
    return {
      claims: claims.map((c) => ({
        claim: c.claim ?? "",
        coverage: clamp01(c.coverage),
        coveredBy: Array.isArray(c.coveredBy) ? c.coveredBy : [],
        rationale: c.rationale ?? "",
      })),
      shouldBuyMore: Boolean(out.shouldBuyMore),
      recommendedIds: Array.isArray(out.recommendedIds)
        ? (out.recommendedIds as string[])
        : [],
      rationale: (out.rationale as string) ?? "",
    };
  }

  async synthesize(input: SynthInput): Promise<SynthResult> {
    const out = await this.chatJson(
      config.synthesisModel,
      "You write a grounded, accurate answer using ONLY the provided sources. " +
        "Cite inline with the source markers like [S1]. Cite every claim. Do not invent facts. " +
        "For every supported decomposed claim, copy a short exact quote (240 characters maximum) from the source into " +
        "`evidence`, using the claim's zero-based index. Do not paraphrase evidence quotes. " +
        "A source belongs in `citedMarkers` only when it appears inline and has an evidence item. " +
        "If the sources do not support a claim, say so and emit no citation/evidence for it. " +
        "When two or more sources disagree on a factual point, do NOT average or blur them: decide " +
        "which to trust based on specificity, internal consistency, and recency; write the answer " +
        "reflecting the trusted source; and record each disagreement in `conflicts` (use an empty " +
        "array when the sources are consistent). Output strict JSON.",
      JSON.stringify({
        question: input.question,
        subClaims: input.subClaims,
        sources: input.gathered.map((g) => ({
          marker: g.marker,
          name: g.sourceName,
          text: g.text.slice(0, 2000),
        })),
        schema:
          '{"answer":string (markdown with [S#] citations),"citedMarkers":string[],' +
          '"evidence":[{"claimIndex":number,"marker":string,"quote":string,"support":number(0..1)}],' +
          '"conflicts":[{"point":string,"positions":[{"marker":string,"stance":string}],"trusted":string,"reason":string}]}',
      }),
      // The answer itself is prose, so this floor carries the write-up on top of the per-source parts.
      this.budgetFor(4 + input.gathered.length),
    );
    return {
      answer: (out.answer as string) ?? "",
      citedMarkers: Array.isArray(out.citedMarkers) ? (out.citedMarkers as string[]) : [],
      evidence: Array.isArray(out.evidence)
        ? (out.evidence as Record<string, unknown>[]).map((item) => ({
            claimIndex: Number(item.claimIndex),
            marker: typeof item.marker === "string" ? item.marker : "",
            quote: typeof item.quote === "string" ? item.quote : "",
            support: clamp01(Number(item.support)),
          }))
        : [],
      conflicts: parseConflicts(out.conflicts),
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
      this.budgetFor(input.used.length),
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

/** Defensively validate the model's `conflicts` array — drop malformed entries and cap the
 *  count so a hallucinated list can never spam the trace. Only well-formed disagreements with
 *  at least two stances and a trusted marker survive. */
function parseConflicts(raw: unknown): Conflict[] {
  if (!Array.isArray(raw)) return [];
  const out: Conflict[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const point = typeof o.point === "string" ? o.point.trim() : "";
    const trusted = typeof o.trusted === "string" ? o.trusted.trim() : "";
    const reason = typeof o.reason === "string" ? o.reason.trim() : "";
    const positions = Array.isArray(o.positions)
      ? o.positions
          .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
          .map((p) => ({
            marker: typeof p.marker === "string" ? p.marker.trim() : "",
            stance: typeof p.stance === "string" ? p.stance.trim() : "",
          }))
          .filter((p) => p.marker && p.stance)
      : [];
    if (!point || !trusted || positions.length < 2) continue;
    out.push({ point, positions, trusted, reason });
    if (out.length >= 5) break;
  }
  return out;
}
