import { describe, expect, it } from "vitest";
import { normalizeCoverage, canStopForCoverage } from "./coverage-assessment";
import { JsonChatEngine } from "./json-chat-engine";

const gathered = [{ sourceId: "s", sourceName: "Source", marker: "S1", text: "An explicit answer." }];
const claims = ["What is the answer?"];

describe("coverage assessment", () => {
  it("cannot stop research on unknown markers, empty content, or malformed rows", () => {
    for (const rows of [null, {}, [null], [{ coverage: 1, coveredBy: ["S99"] }], [{ coverage: "1", coveredBy: ["S1"] }]]) {
      expect(normalizeCoverage(rows, claims, gathered)[0].coverage).toBe(0);
    }
    expect(normalizeCoverage([{ coverage: 1, coveredBy: ["S1"] }], claims, [{ ...gathered[0], text: " " }])[0].coverage).toBe(0);
  });

  it("keeps caller-owned targets and does not invent coverage for missing targets", () => {
    expect(normalizeCoverage([{ claim: "paraphrase", coverage: 0.6, coveredBy: ["S1", "S99", "S1"] }], [...claims, "Missing question"], gathered)).toEqual([
      { claim: claims[0], coverage: 0.6, coveredBy: ["S1"] },
      { claim: "Missing question", coverage: 0, coveredBy: [] },
    ]);
  });

  it.each([[false, 0.8, true], [true, 0.3, false], [false, 0.4, false]] as const)(
    "derives stopping from validated coverage, not the contradictory model flag %s / %s",
    async (flag, coverage, sufficient) => {
      class Engine extends JsonChatEngine {
        readonly name = "test";
        protected async chatJson() { return { sufficient: flag, perClaim: [{ coverage, coveredBy: ["S1"],
          supportedAnswer: "An explicit answer.", missingRequestedParts: [] }] }; }
      }
      const result = await new Engine().sufficiency({ question: claims[0], subClaims: claims, gathered });
      expect(result.sufficient).toBe(sufficient);
      expect(result.perClaim?.[0].coverage).toBe(coverage);
    },
  );

  it("does not stop on a high score with missing requested facts or malformed answer assessment", async () => {
    for (const fields of [{}, { supportedAnswer: "", missingRequestedParts: [] },
      { supportedAnswer: "An answer", missingRequestedParts: ["Measured latency"] },
      { supportedAnswer: "An answer", missingRequestedParts: "none" },
      { supportedAnswer: "An answer" }, { supportedAnswer: "   ", missingRequestedParts: [] }]) {
      const rows = [{ coverage: 0.9, coveredBy: ["S1"], ...fields }];
      class Engine extends JsonChatEngine { readonly name = "test"; protected async chatJson() { return { perClaim: rows }; } }
      const result = await new Engine().sufficiency({ question: claims[0], subClaims: claims, gathered });
      expect(result.sufficient).toBe(false); expect(result.perClaim?.[0].coverage).toBe(0.9);
    }
  });

  it("requires every requested target and available source while preserving truthful coverage scores", () => {
    const answer = { coverage: 0.8, coveredBy: ["S1"], supportedAnswer: "An explicit answer.", missingRequestedParts: [] };
    const targets = [...claims, "What is the measured latency?"];
    for (const rows of [[answer], [answer, { ...answer, missingRequestedParts: ["Latency"] }],
      [answer, { ...answer, coveredBy: ["S99"] }], [answer, answer, answer]])
      expect(canStopForCoverage(rows, normalizeCoverage(rows, targets, gathered))).toBe(false);
    expect(canStopForCoverage([answer], normalizeCoverage([answer], claims, gathered))).toBe(true);
    expect(canStopForCoverage([], [])).toBe(false);
  });
});
