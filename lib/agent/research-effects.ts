import type { KeryxDB } from "../db/keryx-db";
import { z } from "zod";
import type { ActivationEvent, Citation } from "../types";
import { recordActivationEvent } from "../activation";
import { sendAlert } from "../notify/alert";
import { dispatchCitationNotify } from "../notify/citation-webhook";
import { dispatchCitationEmail } from "../notify/citation-email";
import { discoverExternalCandidates } from "./external-discovery";
import { buildDecisionContext, saveMemory, type MemoryCandidate } from "./query-memory";

/** Complete trusted server strategy. Never construct this from an HTTP request body. */
export interface ResearchEffects extends Pick<KeryxDB, "recordPayment" | "getCached" | "getCachedAt" | "setCached" | "saveQueryRun"> {
  scope: { kind: "public" } | { kind: "job"; queryId: string };
  discoverExternal: typeof discoverExternalCandidates;
  decisionContext(question: string, candidates: MemoryCandidate[]): ReturnType<typeof buildDecisionContext>;
  saveMemory(id: string, question: string, citations: Citation[], sourcesRead: string[]): Promise<void>;
  /** Observers must be self-contained/best-effort, as in the public implementation. */
  notifyCitation(input: Parameters<typeof dispatchCitationNotify>[1]): void;
  alert(title: string, message: string): void;
  activation(event: ActivationEvent): Promise<void>;
}

/** Historical public behavior, retained for existing browser/A2A/MCP/engine callers. */
export function publicResearchEffects(db: KeryxDB, discovery = discoverExternalCandidates): ResearchEffects {
  return {
    scope: { kind: "public" },
    recordPayment: payment => db.recordPayment(payment),
    getCached: key => db.getCached(key),
    getCachedAt: key => db.getCachedAt(key),
    setCached: (key, content) => db.setCached(key, content),
    saveQueryRun: run => db.saveQueryRun(run),
    discoverExternal: discovery,
    decisionContext: (question, candidates) => buildDecisionContext(db, question, candidates),
    saveMemory: (id, question, citations, sourcesRead) => saveMemory(db, id, question, citations, sourcesRead),
    notifyCitation: input => { void dispatchCitationNotify(db, input); void dispatchCitationEmail(db, input); },
    alert: (title, message) => { void sendAlert(title, message); },
    activation: event => recordActivationEvent(db, event),
  };
}

const REQUIRED = ["recordPayment", "getCached", "getCachedAt", "setCached", "saveQueryRun", "discoverExternal",
  "decisionContext", "saveMemory", "notifyCitation", "alert", "activation"] as const satisfies readonly (keyof ResearchEffects)[];
const scopeSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("public") }).strict(),
  z.object({ kind: z.literal("job"), queryId: z.string().min(1).max(100) }).strict()]);

/** An explicit strategy is all-or-nothing: never fill missing private sinks with public ones. */
export function resolveResearchEffects(db: KeryxDB, supplied: ResearchEffects | undefined, discovery?: typeof discoverExternalCandidates, queryId?: string): ResearchEffects {
  if (supplied === undefined) supplied = publicResearchEffects(db, discovery);
  if (!supplied || REQUIRED.some(key => typeof supplied[key] !== "function")) throw new Error("Incomplete research effects strategy");
  const parsed = scopeSchema.safeParse(supplied.scope);
  if (!parsed.success) throw new Error("Incomplete research effects strategy");
  if (queryId?.startsWith("prv_") && parsed.data.kind === "public") throw new Error("Private research requires an explicit effects strategy scoped to this job");
  if (parsed.data.kind === "job" && parsed.data.queryId !== queryId) throw new Error("Research effects belong to another job");
  return supplied;
}
