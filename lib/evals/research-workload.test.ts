import { describe, expect, it, vi } from "vitest";
import { HeuristicEngine } from "../llm/heuristic-engine";
import { executeResearchWorkload, workloadSnapshotHash, workloadSourceUrl, type WorkloadRead } from "./research-workload";
import type { InternalResearchInput } from "./internal-research-input-types";

const input: InternalResearchInput = { id: "R99", inputKind: "synthetic", question: "What does the retention policy require?",
  targets: ["Retention"], expectedArtifact: "Fixture excerpt", review: [], sources: [{ title: "Retention policy" }] };
function capture(): WorkloadRead {
  const url = workloadSourceUrl(input, 0);
  const article = { title: "Retention policy", finalUrl: url, kind: "text" as const, truncated: false,
    text: "The retention policy requires stored questions to be deleted after seven days. This retention policy applies to stored questions only." };
  return { url, title: article.title, provenance: "synthetic", observedAt: "2026-10-01T00:00:00Z", article, snapshotSha256: workloadSnapshotHash(article) };
}

describe("research workload capture boundary", () => {
  it("rejects corrupted, missing and duplicate snapshots before reasoning", async () => {
    const engine = new HeuristicEngine(); const decompose = vi.spyOn(engine, "decompose");
    const corrupt = capture(); corrupt.article!.text = "Changed content";
    for (const rows of [[corrupt], [], [capture(), capture()]])
      await expect(executeResearchWorkload(input, rows, engine)).rejects.toThrow("snapshot integrity");
    expect(decompose).not.toHaveBeenCalled();
  });

  it("executes a complete no-payment replay while preserving capture time in exported evidence", async () => {
    const result = await executeResearchWorkload(input, [capture()], new HeuristicEngine());
    expect(result.observation.hardFailures).toEqual([]);
    expect(result.observation.paymentAttempts).toBe(0);
    expect(result.observation.readAttempts).toHaveLength(1);
    expect(result.run.evidence?.length).toBeGreaterThan(0);
    for (const row of result.run.evidence ?? []) expect(row.webProvenance?.retrievedAt).toBe("2026-10-01T00:00:00Z");
    expect(result.observation.usefulness).toBe("requires-human-review");
  });
});
