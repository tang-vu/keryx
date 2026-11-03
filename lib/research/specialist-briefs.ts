import { z } from "zod";
import { AskQuestionSchema } from "../ask-input";
import { specialistBriefCopy as copy } from "../../locales/en/specialist-briefs";
import { API_INTEGRATION_NOTE_REQUEST } from "./api-integration-note-request";

const PRESET_BRIEF_IDS = ["api-platform", "saas-competition", "scholarly-literature"] as const;
export const SPECIALIST_BRIEF_IDS = [...PRESET_BRIEF_IDS, "custom"] as const;
export type SpecialistBriefId = (typeof SPECIALIST_BRIEF_IDS)[number];

export const specialistBriefs = {
  "api-platform": copy.apiPlatform,
  "saas-competition": copy.saasCompetition,
  "scholarly-literature": copy.scholarlyLiterature,
  custom: copy.custom,
} as const;

const sourceLead = z.string().trim().max(160).url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Use an HTTPS source link without credentials");

const sharedInput = {
  decision: z.string().trim().min(1).max(450),
  context: z.string().trim().max(250),
  sourceLeads: z.array(sourceLead).max(2),
};

export const specialistBriefInputSchema = z.discriminatedUnion("track", [
  z.object({ ...sharedInput, track: z.enum(PRESET_BRIEF_IDS) }).strict(),
  z.object({ ...sharedInput, track: z.literal("custom"),
    deliverable: z.string().trim().min(1).max(160),
    reviewCriteria: z.array(z.string().trim().min(1).max(100)).min(1).max(3),
  }).strict(),
]);

/** Pure preparation only. The caller still chooses a budget and authorizes an existing quote. */
export function prepareSpecialistBrief(value: unknown) {
  const input = specialistBriefInputSchema.parse(value);
  const brief = specialistBriefs[input.track];
  const question = AskQuestionSchema.parse([
    input.track === "api-platform" ? API_INTEGRATION_NOTE_REQUEST : "",
    brief.instruction,
    `Question: ${input.decision}`,
    ...(input.track === "custom" ? [
      `Requested deliverable (caller request, not evidence): ${input.deliverable}`,
      `Caller review criteria (not findings or recorded acceptance):\n${input.reviewCriteria.map(value => `- ${value}`).join("\n")}`,
    ] : []),
    input.context ? `Constraints: ${input.context}` : "",
    input.sourceLeads.length ? `Unread source leads:\n${input.sourceLeads.join("\n")}` : "",
    "Show citations, source dates, missing evidence and BUY/SKIP/CACHE decisions. Never treat this requested format as evidence or a guarantee of completion.",
  ].filter(Boolean).join("\n\n"));
  return {
    schema: "urn:keryx:specialist-brief:1" as const,
    track: input.track,
    acceptanceChecklist: input.track === "custom" ? [...input.reviewCriteria] : [...brief.acceptance],
    request: { question, researchMode: "deep" as const, packageVersion: "1.0.0" as const, responseMode: "async" as const },
  };
}
