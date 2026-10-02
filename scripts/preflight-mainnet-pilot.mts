import { open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { inspectMainnetPilotCandidate } from "../lib/readiness/mainnet-pilot-candidate.ts";
import { inspectArcMainnet } from "./inspect-arc-mainnet.mts";

export async function readPilotCandidate(path: string): Promise<unknown> {
  // Read exactly one explicit bounded JSON file. No dotenv, custody, DB or application imports.
  const selected = await lstat(path);
  if (!selected.isFile() || selected.size < 2 || selected.size > 16_384) throw new Error("candidate_refused");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== selected.size || before.ino !== selected.ino || before.dev !== selected.dev ||
      before.mtimeMs !== selected.mtimeMs || before.ctimeMs !== selected.ctimeMs) throw new Error("candidate_refused");
    const buffer = Buffer.alloc(16_385);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs) throw new Error("candidate_refused");
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
  } finally { await handle.close(); }
}

export async function preflightMainnetPilot(path: string, live = false) {
  const candidate = inspectMainnetPilotCandidate(await readPilotCandidate(path));
  if (!candidate.candidateAccepted || !live) return { ...candidate, externalEvidence: "not_requested" };
  return { ...candidate, externalEvidence: await inspectArcMainnet() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, path, mode, ...rest] = process.argv.slice(2);
  if (command === "--help" && path === undefined) {
    console.log("Usage: npm run preflight:mainnet-pilot -- --candidate <explicit-json-file> [--live]\nRead-only candidate checks; --live observes fixed public endpoints. Never enables or authorizes mainnet.");
  } else if (command !== "--candidate" || !path || (mode !== undefined && mode !== "--live") || rest.length) {
    console.error("Expected --candidate <explicit-json-file> [--live]"); process.exitCode = 2;
  } else {
    try {
      const evidence = await preflightMainnetPilot(path, mode === "--live");
      console.log(JSON.stringify(evidence, null, 2));
      // Zero accepts the proposal shape, never release/spend. Live failure is actionable.
      process.exitCode = evidence.candidateAccepted && (typeof evidence.externalEvidence === "string" || evidence.externalEvidence.externalEvidenceComplete) ? 0 : 1;
    } catch { console.error("Candidate file unavailable or refused; no private detail retained."); process.exitCode = 2; }
  }
}
