import { expect, it } from "vitest";
import { researchVerdict } from "./research-verdict";
const base = { coverage: [{ claimIndex: 0, claim: "Which retention period applies?", coverage: 1, coveredBy: ["S1", "S2"] }],
  citedMarkers: ["S1", "S2"], sourceMarkers: ["S1", "S2"], finalAssessmentSufficient: true,
  sources: [{ marker: "S1", sourceId: "a", sourceName: "a", text: "First distinct body", itemUrl: "https://a.example/a" },
    { marker: "S2", sourceId: "b", sourceName: "b", text: "Second distinct body", itemUrl: "https://b.example/b" }] };
const conflict = { point: "retention", positions: [{ marker: "S1", stance: "seven days" }, { marker: "S2", stance: "thirty days" }],
  trusted: "none", reason: "No precedence rule" };
it("does not promote an unresolved conflict with perfect coverage and two citations", () => {
  for (const trusted of ["none", "", "S99"]) expect(researchVerdict({ ...base, conflicts: [{ ...conflict, trusted }] })).toMatchObject({ level: "Low", reason: expect.stringContaining("unresolved") });
});
it("requires supported source identity and an explanation, and caps explained preferences at Moderate", () => {
  expect(researchVerdict({ ...base, conflicts: [{ ...conflict, trusted: "S1" }] }).level).toBe("Moderate");
  for (const delta of [{ reason: "" }, { positions: [{ marker: "S1", stance: "seven" }, { marker: "S99", stance: "thirty" }] }]) {
    expect(researchVerdict({ ...base, conflicts: [{ ...conflict, trusted: "S1", ...delta }] }).level).toBe("Low");
  }
  expect(researchVerdict({ ...base, citedMarkers: ["S2"], conflicts: [{ ...conflict, trusted: "S1" }] }).level).toBe("Low");
});
it("retains strong corroborated, weak and absent evidence verdicts without conflicts", () => {
  expect(researchVerdict({ ...base, conflicts: [] }).level).toBe("High");
  expect(researchVerdict({ ...base, conflicts: [], citedMarkers: ["S1"] }).level).toBe("Moderate");
  expect(researchVerdict({ ...base, conflicts: [], coverage: [{ ...base.coverage[0], coverage: 0.1 }] }).level).toBe("Low");
  expect(researchVerdict({ ...base, conflicts: [], citedMarkers: [] }).level).toBe("Low");
});

it("requires the final sufficiency conclusion even with perfect scores and multiple citations", () => {
  expect(researchVerdict({ ...base, conflicts: [], finalAssessmentSufficient: false }))
    .toEqual({ level: "Low", reason: "the final assessment does not establish a complete supported answer for every requested part" });
  expect(researchVerdict({ ...base, conflicts: [{ ...conflict, trusted: "S1" }], finalAssessmentSufficient: false }).level).toBe("Low");
});
it("requires separate nonduplicate publisher groups for every claim before High", () => {
  expect(researchVerdict({ ...base, conflicts: [], coverage: [{ ...base.coverage[0], coveredBy: ["S1"] }, { ...base.coverage[0], claimIndex: 1, coveredBy: ["S2"] }] }).level).toBe("Moderate");
  expect(researchVerdict({ ...base, conflicts: [], sources: base.sources.map(source => ({ ...source, itemUrl: `https://${source.sourceId}.same.example/a` })) }).level).toBe("Moderate");
  expect(researchVerdict({ ...base, conflicts: [], sources: base.sources.map(source => ({ ...source, text: "same  body" })) }).level).toBe("Moderate");
  expect(researchVerdict({ ...base, conflicts: [], sources: undefined }).level).toBe("Moderate");
});

it("cannot reach High from one known publisher's articles across distinct domains", () => {
  const sources = base.sources.map(source => ({ ...source, sourceId: "same-publisher" }));
  expect(researchVerdict({ ...base, conflicts: [], sources }).level).toBe("Moderate");
  expect(researchVerdict({ ...base, conflicts: [], sources: [...sources].reverse() }).level).toBe("Moderate");
  expect(researchVerdict({ ...base, conflicts: [] }).level).toBe("High");
});

it("keeps a later duplicate marker usable for its own supported target without adding a group", () => {
  const sources = [...base.sources, { ...base.sources[0], marker: "S3", itemUrl: "https://a.example/reprint" }];
  const coverage = [base.coverage[0], { claimIndex: 1, claim: "Which archival period applies?", coverage: 0.9, coveredBy: ["S3", "S2"] }];
  expect(researchVerdict({ ...base, sources, coverage, conflicts: [], citedMarkers: ["S1", "S2", "S3"], sourceMarkers: ["S1", "S2", "S3"] }).level).toBe("High");
});

it("merges a body-copy bridge before counting another article from the copied publisher", () => {
  const sources = [base.sources[0], { ...base.sources[0], marker: "S3", sourceId: "b", itemUrl: "https://b.example/copy" }, base.sources[1]];
  for (const ordered of [sources, [...sources].reverse()]) {
    expect(researchVerdict({ ...base, sources: ordered, conflicts: [], citedMarkers: ["S1", "S2", "S3"], sourceMarkers: ["S1", "S2", "S3"] }).level).toBe("Moderate");
  }
});

it("does not count an empty source body as another corroborating group", () => {
  expect(researchVerdict({ ...base, conflicts: [], sources: [{ ...base.sources[0], text: " \t\n" }, base.sources[1]] }).level).toBe("Moderate");
});

it("localizes reasons while preserving every confidence classification and input", () => {
  const cases = [
    { ...base, conflicts: [], citedMarkers: [] },
    { ...base, conflicts: [conflict] },
    { ...base, conflicts: [], coverage: [] },
    { ...base, conflicts: [], coverage: [{ ...base.coverage[0], coverage: 0.1 }] },
    { ...base, conflicts: [], finalAssessmentSufficient: false },
    { ...base, conflicts: [{ ...conflict, trusted: "S1" }] },
    { ...base, conflicts: [] },
    { ...base, conflicts: [], citedMarkers: ["S1"] },
  ];
  for (const input of cases) {
    const before = JSON.stringify(input), english = researchVerdict(input);
    for (const language of ["vi", "pt", "es"] as const) {
      const localized = researchVerdict(input, language);
      expect(localized.level).toBe(english.level);
      expect(localized.reason).not.toBe(english.reason);
    }
    expect(researchVerdict(input, "en")).toEqual(english);
    expect(JSON.stringify(input)).toBe(before);
  }
});
