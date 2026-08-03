import { describe, expect, it } from "vitest";
import {
  buildGroundedQuestionPrompt,
  contextForSeed,
  fallbackQuestionForContext,
  questionMatchesContext,
  type QuestionSourceContext,
} from "./seed-question-generator";
import { EXPLORATION_SEED_QUESTIONS, pickGroundedQuestion } from "./seed-questions";
import type { Source } from "./types";

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: "circle-notes",
    name: "Circle Protocol Notes",
    url: "https://example.com",
    description: "Technical notes about native USDC cross-chain transfers.",
    walletAddress: "0x0000000000000000000000000000000000000001",
    fetchPrice: 0.002,
    tags: ["CCTP", "USDC", "cross-chain"],
    authors: [],
    createdAt: "2026-08-03T00:00:00.000Z",
    active: true,
    verified: true,
    ...overrides,
  };
}

function context(overrides: Partial<QuestionSourceContext> = {}): QuestionSourceContext {
  return {
    source: source(),
    items: [
      {
        title: "CCTP V2 uses burn and mint for native USDC transfers",
        summary:
          "USDC is burned on the source domain, attested, and minted on the destination without a liquidity pool.",
      },
    ],
    ...overrides,
  };
}

describe("coverage-aware seed questions", () => {
  it("rotates only active, verified contexts with current preview items", () => {
    const inactive = context({ source: source({ id: "inactive", active: false }) });
    const unverified = context({ source: source({ id: "unverified", verified: false }) });
    const empty = context({ source: source({ id: "empty" }), items: [] });
    const eligible = context({ source: source({ id: "eligible" }) });

    expect(contextForSeed([inactive, unverified, empty, eligible], 12)?.source.id).toBe(
      "eligible",
    );
  });

  it("builds a deterministic fallback from content the agent can actually read", () => {
    const question = fallbackQuestionForContext(context(), 0);
    expect(question).toContain("CCTP V2 uses burn and mint");
    expect(question).toContain("CCTP");
    expect(question.endsWith("?")).toBe(true);
  });

  it("accepts a preview-grounded question and rejects an adjacent unsupported theme", () => {
    const selected = context();
    expect(
      questionMatchesContext(
        "How does CCTP burn and mint USDC across domains?",
        selected,
      ),
    ).toBe(true);
    expect(
      questionMatchesContext(
        "How does account abstraction improve smart wallet recovery?",
        selected,
      ),
    ).toBe(false);
  });

  it("sends only free preview material and an explicit no-drift instruction", () => {
    const prompt = buildGroundedQuestionPrompt(context());
    expect(prompt).toContain("Circle Protocol Notes");
    expect(prompt).toContain("CCTP V2 uses burn and mint");
    expect(prompt).toContain("Do not introduce an adjacent technology");
  });

  it("keeps broad questions out of the normal provider-failure fallback", () => {
    for (let i = 0; i < 30; i++) {
      expect(EXPLORATION_SEED_QUESTIONS).not.toContain(pickGroundedQuestion(i));
    }
  });
});
