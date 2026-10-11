// Node-only imports keep full frozen artifacts out of the client module graph.
import { createHash } from "node:crypto";
import original from "../../fixtures/evals/quality/scorecard-20261009.json";
import corrected from "../../fixtures/evals/quality/scorecard-20261009-corrected.json";
import six from "../../fixtures/evals/quality/scorecard-20261010.json";
import eight from "../../fixtures/evals/quality/scorecard-20261010-eight.json";
import { projectPublicQualityScorecard } from "./public-quality-scorecard";

const frozen = [
  { id: "oct10-eight", artifact: eight, sha256: "732882b620480fe6dbbd757fdab9af03df0f18269bde80adc1af34bc6697768a" },
  { id: "oct10-six", artifact: six, sha256: "5ab158a520efe26fe81b722143ccd0e96565fb2b1e0fd38759c0f67ffb66a6de" },
  { id: "oct9-corrected", artifact: corrected, sha256: "ac1650383b812baaf50b837221b039069da6cb53e88a4f2754608450a9f5110d" },
  { id: "oct9-original", artifact: original, sha256: "5407e206154c5a9679345512e096a99ae2e73057e6c9e63dd60077eef12a87e0" },
] as const;

export type FrozenQualitySnapshotId = typeof frozen[number]["id"];

/** Fixed repository inputs only. Canonical hash is checked; tests bind raw bytes including EOF. */
export function frozenPublicQualityScorecards() {
  return frozen.map(({ id, artifact, sha256 }) => {
    const actual = createHash("sha256").update(JSON.stringify(artifact, null, 2) + "\n").digest("hex");
    if (actual !== sha256) throw new Error("FROZEN_SCORECARD_DIGEST_MISMATCH");
    return { id, artifactSha256: sha256, scorecard: projectPublicQualityScorecard(artifact) };
  });
}
