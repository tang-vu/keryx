import { expect, it } from "vitest";
import { executeResearchWorkload, workloadSnapshotHash, type WorkloadRead } from "../evals/research-workload";
import type { InternalResearchInput } from "../evals/internal-research-input-types";
import { HeuristicEngine } from "../llm/heuristic-engine";

const urls = ["https://example.org/policy-a", "https://example.org/policy-b"];
const input: InternalResearchInput = {
  id: "R99", inputKind: "synthetic",
  question: "Compare the Meridian retention policy copies; show the retention period stated in each copy.",
  targets: ["Retention periods in both copies"],
  sources: urls.map((url, index) => ({ title: `Meridian retention policy revision 4 copy ${index + 1}`, url })),
  expectedArtifact: "Both exact source excerpts; no invented authority or conflict resolution", review: [],
};
function reads(secondFails: boolean): WorkloadRead[] {
  return urls.map((url, index) => {
    const article = { title: input.sources[index].title, finalUrl: url, kind: "text" as const, truncated: false,
      text: `Meridian retention policy revision 4: Event logs are retained for ${index === 0 ? "seven" : "thirty"} days.` };
    return { url, title: article.title, observedAt: "2026-10-01T00:00:00Z", provenance: "synthetic" as const,
      ...(index === 1 && secondFails ? { failure: "transport-unavailable" as const }
        : { article, snapshotSha256: workloadSnapshotHash(article) }) };
  });
}

it.each([false, true])("exports admitted tied counterparts only when actually read (secondFails=%s)", async secondFails => {
  const result = await executeResearchWorkload(input, reads(secondFails), new HeuristicEngine());
  expect(result.observation.hardFailures).toEqual([]);
  expect(result.observation.readAttempts).toEqual(urls);
  expect(result.observation.paymentAttempts).toBe(0);
  expect(result.observation.paymentRows).toBe(0);
  expect(result.run.totalSpent).toBe(0);
  expect(result.run.totalToCreators).toBe(0);
  expect(result.run.confidence?.level).toBe("Low");
  expect(result.run.citations).toHaveLength(secondFails ? 1 : 2);
  const admitted = result.run.evidence!.filter(row => row.qualifiesForAnswer);
  expect(admitted.every(row => row.support >= 0.4 && !row.qualifiesForReward)).toBe(true);
  expect(new Set(admitted.map(row => row.itemUrl))).toEqual(new Set(secondFails ? urls.slice(0, 1) : urls));
  expect(result.run.answer).toContain("seven days.");
  if (secondFails) {
    expect(result.run.answer).not.toContain("thirty days.");
    expect(result.exports.bibtex.content).not.toContain(urls[1]);
  } else {
    expect(result.run.answer).toContain("thirty days.");
    for (const url of urls) {
      expect(result.exports.bibtex.content).toContain(url);
      expect(result.exports.ris.content).toContain(url);
    }
  }
});
