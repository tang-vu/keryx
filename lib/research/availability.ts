import { canaryResearchPaused } from "../business-operator/canary-policy";
import { parseResearchAvailability, ResearchAdmissionHeldError } from "./availability-contract";

/** Filesystem-only, fail-closed observation. Never initializes DB, consumes quota or grants authority. */
export function readResearchAvailability() {
  return parseResearchAvailability({ state: canaryResearchPaused() ? "paused" : "not-paused" })!;
}

export function assertOrdinaryResearchAvailable() {
  const availability = readResearchAvailability();
  if (availability.state === "paused") throw new ResearchAdmissionHeldError(availability.message);
}
