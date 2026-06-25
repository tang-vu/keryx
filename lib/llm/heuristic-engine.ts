/**
 * HeuristicEngine — deterministic, offline reasoning. No API key required.
 *
 * Uses keyword-overlap scoring to make genuine BUY/SKIP/CACHE choices and extractive synthesis.
 * It is intentionally simpler than the LLM engine but exercises the EXACT same decision flow,
 * so the whole pipeline (and real settlement) runs end-to-end during development.
 */

import type { Decision } from "../types";
import type {
  AttributeInput,
  DecideInput,
  ReevaluateInput,
  ReevaluateOutput,
  ReasoningEngine,
  SufficiencyInput,
  SufficiencyResult,
  SynthInput,
} from "./reasoning-engine";

const STOP = new Set(
  "the a an and or but of to in on for with at by from is are was were be been being this that these those what which who whom how why when where do does did can could should would will your you it its as into about more most than then over under not no yes".split(
    /\s+/,
  ),
);

function tokenize(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (w) => w.length > 2 && !STOP.has(w),
    ),
  );
}

/** fraction of `query` terms present in `doc` (0..1) */
function overlap(query: Set<string>, doc: Set<string>): number {
  if (query.size === 0) return 0;
  let hits = 0;
  for (const t of query) if (doc.has(t)) hits++;
  return hits / query.size;
}

function sharedTerms(query: Set<string>, doc: Set<string>): string[] {
  return [...query].filter((t) => doc.has(t)).slice(0, 5);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

export class HeuristicEngine implements ReasoningEngine {
  readonly name = "heuristic";

  async decompose(question: string): Promise<string[]> {
    const parts = question
      .split(/\?|;|\band\b|\bvs\.?\b|,/i)
      .map((p) => p.trim())
      .filter((p) => tokenize(p).size >= 2);
    const claims = parts.length > 1 ? parts.slice(0, 4) : [question.trim()];
    return claims.map((c) => (c.endsWith("?") ? c : c + "?").replace(/\?+$/, "?"));
  }

  async decide(input: DecideInput): Promise<Decision[]> {
    const qTokens = tokenize(
      input.question + " " + input.subClaims.join(" "),
    );
    const claimTokens = input.subClaims.map((c) => tokenize(c));

    return input.candidates.map((c) => {
      const docTokens = tokenize(
        `${c.name} ${c.description} ${c.tags.join(" ")} ${c.preview}`,
      );
      const value = overlap(qTokens, docTokens);
      const targets = claimTokens
        .map((ct, i) => (overlap(ct, docTokens) > 0.15 ? i : -1))
        .filter((i) => i >= 0);
      const terms = sharedTerms(qTokens, docTokens);

      let action: Decision["action"];
      let rationale: string;
      if (c.cached && value >= 0.08) {
        action = "CACHE";
        rationale = `Already cached and still relevant (matches ${terms.join(", ") || "topic"}); reuse for free instead of paying again.`;
      } else if (value >= 0.12) {
        action = "BUY";
        rationale = `Strong topical match on ${terms.join(", ") || "the question"}${targets.length ? `, addresses sub-claim ${targets.map((t) => t + 1).join(" & ")}` : ""}; worth the ${c.fetchPrice} USDC toll.`;
      } else {
        action = "SKIP";
        rationale = `Weak match (${terms.length ? "only " + terms.join(", ") : "no key terms"}); not worth ${c.fetchPrice} USDC.`;
      }

      return {
        sourceId: c.id,
        sourceName: c.name,
        action,
        expectedValue: round(value),
        price: c.fetchPrice,
        confidence: round(Math.min(1, value * 3)),
        rationale,
        targets,
      };
    });
  }

  async sufficiency(input: SufficiencyInput): Promise<SufficiencyResult> {
    const allText = tokenize(input.gathered.map((g) => g.text).join(" "));
    const perClaim = input.subClaims.map((claim) => {
      const ct = tokenize(claim);
      const cov = overlap(ct, allText);
      const coveredBy = input.gathered
        .filter((g) => overlap(ct, tokenize(g.text)) > 0.15)
        .map((g) => g.marker);
      return { claim, coverage: round(cov), coveredBy };
    });
    const covered = perClaim.filter((c) => c.coverage > 0.3).length;
    const sufficient =
      input.gathered.length >= 2 && covered >= perClaim.length;
    return {
      sufficient,
      rationale: sufficient
        ? `Read ${input.gathered.length} sources covering all ${perClaim.length} sub-claim(s); stopping to save budget.`
        : `Covered ${covered}/${perClaim.length} sub-claim(s) from ${input.gathered.length} source(s); keep reading.`,
      perClaim,
    };
  }

  async reevaluate(input: ReevaluateInput): Promise<ReevaluateOutput> {
    const allText = tokenize(input.gathered.map((g) => g.text).join(" "));
    const claims = input.subClaims.map((claim) => {
      const ct = tokenize(claim);
      const cov = overlap(ct, allText);
      const coveredBy = input.gathered
        .filter((g) => overlap(ct, tokenize(g.text)) > 0.15)
        .map((g) => g.marker);
      return {
        claim,
        coverage: round(cov),
        coveredBy,
        rationale:
          cov >= 0.5
            ? `Well-supported by ${coveredBy.join(", ") || "gathered content"} (${Math.round(cov * 100)}% keyword overlap).`
            : cov > 0
              ? `Partially supported (${Math.round(cov * 100)}% overlap) — gap on: ${[...ct].filter((t) => !allText.has(t)).slice(0, 4).join(", ") || "nuance"}.`
              : `Not covered by any gathered source.`,
      };
    });

    const gaps = claims.filter((c) => c.coverage < 0.4);
    if (gaps.length === 0 || input.skippedSources.length === 0 || input.remainingBudget <= 0) {
      return {
        claims,
        shouldBuyMore: false,
        recommendedIds: [],
        rationale:
          gaps.length === 0
            ? `All ${claims.length} sub-claim(s) have adequate coverage (≥40%).`
            : input.remainingBudget <= 0
              ? `${gaps.length} gap(s) detected but no budget remains ($${input.remainingBudget.toFixed(4)}).`
              : `${gaps.length} gap(s) detected but no skipped sources available to fill them.`,
      };
    }

    // Rank skipped sources by how well they cover the gaps, within budget
    const gapTokens = tokenize(gaps.map((g) => g.claim).join(" "));
    const ranked = input.skippedSources
      .map((s) => ({
        id: s.id,
        name: s.name,
        price: s.price,
        score: overlap(gapTokens, tokenize(`${s.name} ${s.preview}`)),
      }))
      .filter((s) => s.score > 0.05 && s.price <= input.remainingBudget)
      .sort((a, b) => b.score / b.price - a.score / a.price);

    // Pick affordable sources greedily
    let budget = input.remainingBudget;
    const picked: string[] = [];
    for (const s of ranked) {
      if (s.price > budget) continue;
      picked.push(s.id);
      budget -= s.price;
      if (picked.length >= 2) break; // cap at 2 additional buys per re-evaluation round
    }

    return {
      claims,
      shouldBuyMore: picked.length > 0,
      recommendedIds: picked,
      rationale:
        picked.length > 0
          ? `${gaps.length} gap(s) detected — recommending ${picked.length} additional source(s) from ${ranked.length} candidate(s) within $${input.remainingBudget.toFixed(4)} budget.`
          : `${gaps.length} gap(s) detected but no affordable skipped source covers them.`,
    };
  }

  async synthesize(
    input: SynthInput,
  ): Promise<{ answer: string; citedMarkers: string[] }> {
    if (input.gathered.length === 0) {
      return { answer: "No sources were worth purchasing for this question.", citedMarkers: [] };
    }
    const cited = new Set<string>();
    const lines: string[] = [];
    const claims = input.subClaims.length ? input.subClaims : [input.question];

    for (const claim of claims) {
      const ct = tokenize(claim);
      let best = { score: 0, sentence: "", marker: "" };
      for (const g of input.gathered) {
        for (const s of sentences(g.text)) {
          const score = overlap(ct, tokenize(s));
          if (score > best.score) best = { score, sentence: s, marker: g.marker };
        }
      }
      if (best.sentence) {
        cited.add(best.marker);
        lines.push(`${best.sentence} [${best.marker}]`);
      }
    }
    const answer = lines.length
      ? lines.join(" ")
      : `${input.gathered[0].text.slice(0, 240)}… [${input.gathered[0].marker}]`;
    if (lines.length === 0) cited.add(input.gathered[0].marker);
    return { answer, citedMarkers: [...cited] };
  }

  async attribute(
    input: AttributeInput,
  ): Promise<{ sourceId: string; weight: number; rationale: string }[]> {
    const ansTokens = tokenize(input.answer);
    const scored = input.used.map((u) => ({
      sourceId: u.sourceId,
      raw: Math.max(0.01, overlap(ansTokens, tokenize(u.text))),
      name: u.sourceName,
    }));
    const total = scored.reduce((s, x) => s + x.raw, 0) || 1;
    return scored.map((x) => ({
      sourceId: x.sourceId,
      weight: round(x.raw / total),
      rationale: `Contributed ${Math.round((x.raw / total) * 100)}% of the grounding terms in the final answer.`,
    }));
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
