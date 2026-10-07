/** Public observation only. Absence of a global pause never authorizes a question. */
export interface ResearchAvailability {
  state: "paused" | "not-paused";
  message: string;
}

export const RESEARCH_PAUSED_MESSAGE = "New research is temporarily paused while an earlier delivery is reviewed. You can still inspect saved reports. Increasing the source budget or connecting a wallet will not remove this pause. Your question has not been retried.";

export const RESEARCH_AVAILABILITY_UNKNOWN = "Research availability could not be checked. Each question still requires server admission; no automatic retry will run.";

export function parseResearchAvailability(value: unknown): ResearchAvailability | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = (value as Record<string, unknown>).state;
  if (state !== "paused" && state !== "not-paused") return null;
  // Render application copy rather than arbitrary status/error text.
  return { state, message: state === "paused" ? RESEARCH_PAUSED_MESSAGE :
    "No global research pause was observed. Each question still requires admission and its existing cost and payment controls." };
}

/** Internal detail remains available to operations; public adapters use fixed safe copy. */
export class ResearchAdmissionHeldError extends Error {
  readonly code = "research_paused";
}

export function researchAdmissionError(error: unknown) {
  return error instanceof ResearchAdmissionHeldError
    ? { code: error.code, message: RESEARCH_PAUSED_MESSAGE } : null;
}
