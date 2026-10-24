import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { QueryRun } from "../types";
import { openRequesterOpinionStore } from "./metadata-store";

export const binding = { origin: "https://research.synthetic.invalid", network: "eip155:5042002" as const };
export const secret = "public-synthetic-feedback-test-secret-256-bits";
export function recordedRun(): QueryRun {
  return { id: "12345678-1234-4234-8234-123456789abc", question: "Synthetic original request", answer: "Saved supported answer [S1].",
    budget: 0, totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], evidence: [],
    engine: "synthetic", trace: [], createdAt: "2026-10-24T00:00:00.000Z", durationMs: 1250, paymentMode: "offline" };
}
export function opinionFixture() {
  const temporary = mkdtempSync(join(tmpdir(), "keryx-requester-opinion-"));
  const directory = join(temporary, ".local", "opinions");
  const store = openRequesterOpinionStore(directory, binding);
  let closed = false;
  return { temporary, directory, store, closeStore() { if (!closed) { store.close(); closed = true; } },
    cleanup() {
      if (!closed) store.close();
      if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error("Fixture cleanup path refused");
      rmSync(temporary, { recursive: true, force: true });
    } };
}
