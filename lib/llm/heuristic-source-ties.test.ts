import { describe, expect, it } from "vitest";
import { HeuristicEngine } from "./heuristic-engine";
import type { GatheredContent, SynthInput, SynthResult } from "./reasoning-engine";

const engine = new HeuristicEngine();
function source(marker: string, text: string, itemUrl = `https://example.org/${marker}`): GatheredContent {
  return { marker, sourceId: marker, sourceName: marker, text, itemUrl };
}
async function synthesize(subClaims: string[], gathered: GatheredContent[]): Promise<SynthResult> {
  const input: SynthInput = { question: subClaims.join(" "), subClaims, gathered };
  const result = await engine.synthesize(input);
  for (const row of result.evidence ?? []) {
    const original = gathered.find(item => item.marker === row.marker)!;
    expect(original.text.slice(row.quoteSpan!.start, row.quoteSpan!.end)).toBe(row.quote);
    expect(row.support).toBeGreaterThan(0);
  }
  return result;
}

describe("heuristic excerpts with equally relevant source counterparts", () => {
  it("retains conflicting figures from both equally best sources without declaring a resolution", async () => {
    const result = await synthesize(["Retention policy"], [
      source("S1", "The retention policy retains event logs for seven days."),
      source("S2", "The retention policy retains event logs for thirty days."),
    ]);
    expect(result.citedMarkers).toEqual(["S1", "S2"]);
    expect(result.evidence).toHaveLength(2);
    expect(result.answer).toContain("seven days.");
    expect(result.answer).toContain("thirty days.");
    expect(result.conflicts).toEqual([]);
  });

  it("bounds equal counterparts to two distinct markers per target", async () => {
    const result = await synthesize(["Retention policy"], ["S1", "S2", "S3", "S4"].map(marker =>
      source(marker, "The retention policy retains event logs for seven days.")));
    expect(result.evidence).toHaveLength(2);
    expect(result.citedMarkers).toEqual(["S1", "S2"]);
  });

  it("keeps one best sentence for a marker with several equal sentences", async () => {
    const result = await synthesize(["Retention policy"], [
      source("S1", "The retention policy lasts seven days. The retention policy lasts thirty days."),
    ]);
    expect(result.evidence).toHaveLength(1);
  });

  it("replaces all earlier ties when a later source has a strictly better match", async () => {
    const result = await synthesize(["Retention policy duration"], [
      source("S1", "The retention condition remains open."),
      source("S2", "This policy condition remains open."),
      source("S3", "The retention policy duration is seven days."),
    ]);
    expect(result.citedMarkers).toEqual(["S3"]);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence![0].support).toBe(1);
  });

  it("retains the measured support rather than assigning a minimum to a counterpart", async () => {
    const result = await synthesize(["Retention policy duration"], [
      source("S1", "The retention policy lasts seven days."),
      source("S2", "The retention policy lasts thirty days."),
    ]);
    expect(result.evidence!.map(row => row.support)).toEqual([0.667, 0.667]);
  });

  it("does not select zero-overlap evidence", async () => {
    const result = await synthesize(["Retention policy"], [
      source("S1", "Astronomy measures distant galaxies."),
      source("S2", "Cooking vegetables requires careful timing."),
    ]);
    expect(result.evidence).toEqual([]);
  });

  it("excludes a higher-scoring wrong arXiv version while retaining allowed counterparts", async () => {
    const result = await synthesize(["arXiv 2606.02668v1 retention policy"], [
      source("S1", "The retention policy lasts seven days.", "https://arxiv.org/pdf/2606.02668v1"),
      source("S2", "arXiv 2606.02668v1 retention policy.", "https://arxiv.org/pdf/2606.02668v2"),
      source("S3", "The retention policy lasts thirty days.", "https://arxiv.org/pdf/2606.02668v1"),
    ]);
    expect(result.citedMarkers).toEqual(["S1", "S3"]);
    expect(result.answer).not.toContain("[S2]");
  });

  it("preserves empty-input behavior", async () => {
    const result = await synthesize(["Retention policy"], []);
    expect(result.evidence).toEqual([]);
    expect(result.citedMarkers).toEqual([]);
  });
});
