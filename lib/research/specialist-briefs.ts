import { z } from "zod";
import { AskQuestionSchema } from "../ask-input";
import { specialistBriefCopy as copy } from "../../locales/en/specialist-briefs";
import { API_INTEGRATION_NOTE_REQUEST } from "./api-integration-note-request";

export const SPECIALIST_BRIEF_IDS = ["api-platform", "saas-competition", "scholarly-literature"] as const;
export type SpecialistBriefId = (typeof SPECIALIST_BRIEF_IDS)[number];

export const specialistBriefs = {
  "api-platform": copy.apiPlatform,
  "saas-competition": copy.saasCompetition,
  "scholarly-literature": copy.scholarlyLiterature,
} as const;

const sourceLead = z.string().trim().max(160).url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Use an HTTPS source link without credentials");

export const specialistBriefInputSchema = z.object({
  track: z.enum(SPECIALIST_BRIEF_IDS),
  decision: z.string().trim().min(1).max(450),
  context: z.string().trim().max(250),
  sourceLeads: z.array(sourceLead).max(2),
}).strict();

/** Pure preparation only. The caller still chooses a budget and authorizes an existing quote. */
export function prepareSpecialistBrief(value: unknown) {
  const input = specialistBriefInputSchema.parse(value);
  const brief = specialistBriefs[input.track];
  const question = AskQuestionSchema.parse([
    input.track === "api-platform" ? API_INTEGRATION_NOTE_REQUEST : "",
    brief.instruction,
    `Question: ${input.decision}`,
    input.context ? `Constraints: ${input.context}` : "",
    input.sourceLeads.length ? `Unread source leads:\n${input.sourceLeads.join("\n")}` : "",
    "Show citations, source dates, missing evidence and BUY/SKIP/CACHE decisions. Never treat this requested format as evidence or a guarantee of completion.",
  ].filter(Boolean).join("\n\n"));
  return {
    schema: "urn:keryx:specialist-brief:1" as const,
    track: input.track,
    acceptanceChecklist: [...brief.acceptance],
    request: { question, researchMode: "deep" as const, packageVersion: "1.0.0" as const, responseMode: "async" as const },
  };
}
