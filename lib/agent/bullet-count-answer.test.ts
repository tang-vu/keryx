import { expect, it } from "vitest";
import { finishBulletCountAnswer, type BulletCountAnswer } from "./bullet-count-answer";

function state(mode: "exact" | "maximum", count: number): BulletCountAnswer {
  return { request: { kind: "recognized", mode, count }, presentation: { language: "en" },
    original: "Canonical retained answer", compact: "- First retained pair\n- Second retained pair\n- Third retained pair",
    fallback: "Could not fit requested bullets. Full retained answer with every pair." };
}

it.each(["exact", "maximum"] as const)("counts mandatory final list rows instead of dropping notices for %s", mode => {
  const projection = state(mode, 3), canonical = "> Original payment warning\n\nCanonical retained answer\n\n- Mandatory follow-up";
  const before = JSON.stringify(projection), result = finishBulletCountAnswer(canonical, projection);
  expect(result.outcome).toBe("unmet");
  expect(result.answer).toContain("Original payment warning");
  expect(result.answer).toContain("Mandatory follow-up");
  expect(result.answer).toContain(projection.fallback);
  expect(JSON.stringify(projection)).toBe(before);
});

it("allows fewer than the maximum with all final notices retained and no padding", () => {
  const projection = state("maximum", 4), result = finishBulletCountAnswer("Canonical retained answer\n\nPayment status remains pending.", projection);
  expect(result.outcome).toBe("met");expect(result.bullets).toBe(3);
  expect(result.answer).toContain("Payment status remains pending.");
  expect(result.answer.match(/^- /gm)).toHaveLength(3);
  expect(finishBulletCountAnswer("Canonical retained answer", state("exact", 4)).outcome).toBe("unmet");
});

it("includes supplied-original status and numbered follow-ups in the final bound", () => {
  const canonical = "Canonical retained answer\n\n1. Keep the receipt\n2. Check the original";
  const result = finishBulletCountAnswer(canonical, state("maximum", 4));
  expect(result.outcome).toBe("unmet");expect(result.answer).toContain("1. Keep the receipt\n2. Check the original");
});

it("keeps an early or changed original intact and reports an unmet format", () => {
  for (const canonical of ["No supported answer. No source read.", "A different retained answer\n\n- Original limitation"]) {
    const result = finishBulletCountAnswer(canonical, state("maximum", 4));
    expect(result.outcome).toBe("unmet");expect(result.answer).toContain("Could not present ≤ 4");
    expect(result.answer.endsWith(canonical)).toBe(true);
  }
});
