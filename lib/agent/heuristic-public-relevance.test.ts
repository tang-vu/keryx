import { expect, it } from "vitest";
import { executeResearchWorkload, workloadSnapshotHash, type WorkloadRead } from "../evals/research-workload";
import type { InternalResearchInput } from "../evals/internal-research-input-types";
import { HeuristicEngine } from "../llm/heuristic-engine";

const input: InternalResearchInput = { id: "R99", inputKind: "synthetic",
  question: "Investigate SQLite online backup API for a small service with concurrent readers, durable writes, recoverable snapshots, rollback handling, process interruptions, storage limits, restore verification and explicit missing assumptions; identify what still needs measurement before implementation.",
  targets: ["Backup handling"], expectedArtifact: "Source-backed checklist or explicit missing evidence", review: [],
  sources: [{ title: "SQLite: Online Backup API", url: "https://example.org/backup" }] };
function read(failed = false): WorkloadRead {
  const article = { title: "SQLite: Online Backup API", finalUrl: "https://example.org/backup", kind: "text" as const,
    truncated: false, text: "Roses and tulips bloom during spring. Gardeners plant flowers in pots." };
  return { url: article.finalUrl, title: article.title, observedAt: "2026-10-01T00:00:00Z", provenance: "synthetic",
    ...(failed ? { failure: "transport-unavailable" as const } : { article, snapshotSha256: workloadSnapshotHash(article) }) };
}

it.each([false, true])("reads a metadata-relevant original without treating an unrelated body or failed read as evidence (failed=%s)", async failed => {
  const result = await executeResearchWorkload(input, [read(failed)], new HeuristicEngine());
  expect(result.observation.readAttempts).toEqual(["https://example.org/backup"]);
  expect(result.observation.hardFailures).toEqual([]);
  expect(result.observation.paymentAttempts).toBe(0); expect(result.observation.paymentRows).toBe(0);
  expect(result.run.totalSpent).toBe(0); expect(result.run.totalToCreators).toBe(0);
  expect(result.run.citations).toEqual([]);
  expect(result.run.evidence?.some(row => row.qualifiesForAnswer || row.qualifiesForReward)).toBe(false);
  expect(result.run.confidence?.level).toBe("Low");
});
