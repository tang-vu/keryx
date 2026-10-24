import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { secretFreeMcpInput } from "../lib/mcp/secret-free-input-schema.ts";
import type { FeedbackDelivery } from "../lib/research-feedback/contracts.ts";
import { privateRequesterObservationText } from "../lib/research-feedback/mcp.ts";
import { AskQuestionSchema, MAX_ASK_QUESTION_CHARS } from "../lib/ask-input.ts";
import {
  researchSponsored, SponsoredResearchError, sponsoredResearchOrigin, SPONSORED_RESEARCH_NOTICE,
} from "../shared/sponsored-research-client.ts";

const invalidInput = "Invalid sponsored research input. Supply a bounded question, publicReport: true, optional mode quick/deep and source budget 0–0.08 USDC. No research started.";
const fields = {
  question: AskQuestionSchema.describe(`Public research question, 1–${MAX_ASK_QUESTION_CHARS} characters after trimming. Never include private information.`),
  publicReport: z.literal(true).describe("Required explicit consent: the question and resulting trial report are public."),
  mode: z.enum(["quick", "deep"]).optional().describe("Hosted research mode: quick or deep (service default when omitted)."),
  budget: z.number().finite().min(0).max(0.08).optional()
    .describe("Source budget in USDC, 0–0.08 inclusive. Zero is valid. Separate from model/search operating costs; service limits still apply."),
};
const inputSchema = z.object(fields).strict(invalidInput);

// Follow the existing MCP registrations: keep discovery constraints while preventing
// SDK validation errors from echoing rejected credentials or private field values.
const guardedInput = secretFreeMcpInput(fields, invalidInput);

export interface SponsoredResearchToolOptions {
  baseUrl?: string;
  /** Test/embedding seam; production uses the shared anonymous hosted client. */
  executor?: typeof researchSponsored;
}

function failureText(error: unknown, baseUrl?: string): string {
  const failure = error instanceof SponsoredResearchError ? error : undefined;
  const messages = [failure?.status === 429 ? "Sponsored research quota reached."
    : failure?.status === 503 ? "Sponsored research paused or unavailable."
    : "Sponsored research refused, unavailable or incomplete."];
  // Backend messages/codes are untrusted. Only retain bounded scheduling and
  // canonical public report identity, never raw diagnostic text or claim fields.
  const retryAfter = failure?.retryAfter;
  if (retryAfter && /^\d{1,10}$/.test(retryAfter)) {
    messages.push(`Wait at least ${Number(retryAfter)} seconds before choosing a new submission.`);
  } else if (retryAfter && retryAfter.length <= 128 && Number.isFinite(Date.parse(retryAfter))) {
    messages.push(`Wait until ${new Date(retryAfter).toUTCString()} before choosing a new submission.`);
  } else if (failure?.status === 429 || failure?.status === 503) {
    messages.push("Wait for service availability before choosing a new submission.");
  }
  const id = failure?.queryId;
  if (id && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|a2a_[0-9a-f]{64})$/.test(id)) {
    messages.push(`Original query ID: ${id}.`);
    try {
      const origin = sponsoredResearchOrigin(baseUrl), url = failure?.dispatchUrl;
      if (url === `${origin}/dispatch/${id}` || url === `${origin}/ask/${id}`) messages.push(`Inspect the original public report: ${url}`);
    } catch { /* Invalid configuration cannot add an untrusted link to errors. */ }
  }
  if (!failure || failure.uncertain) messages.push("The outcome is uncertain; server work may continue after a timeout or disconnect.");
  messages.push("Do not retry automatically. No paid fallback was attempted.");
  return messages.join(" ");
}

/** Additive public hosted research; never loads custody or calls the paid buyer. */
export function registerSponsoredResearchTool(server: McpServer, options: SponsoredResearchToolOptions) {
  const execute = options.executor ?? researchSponsored;
  return server.registerTool("ask_keryx_sponsored", {
    title: "Ask Keryx — sponsored public research",
    description: "Run hosted sponsored research without a buyer wallet, funding or API key. " +
      "Requires publicReport: true: your question and trial report become public. " +
      "Server quota, pause and spending limits apply; source budget is 0–0.08 USDC, separate from model/search costs. " +
      "This creates a new research run and may contact external sources. No automatic retry or paid fallback. " +
      "Timeouts/disconnects may leave server work running; do not resend automatically. " +
      "For a separately authorized purchase from your own funded wallet, use the paid buyer tool ask_keryx.",
    inputSchema: guardedInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (raw, extra) => {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return { isError: true, content: [{ type: "text" as const, text: invalidInput }] };
    try {
      extra.signal.throwIfAborted();
      let requester: FeedbackDelivery | undefined;
      const result = await execute(parsed.data, { baseUrl: options.baseUrl, signal: extra.signal,
        onRequesterObservations: packet => { requester = packet; } });
      extra.signal.throwIfAborted();
      return { structuredContent: result,
        ...(requester ? { _meta: { "keryx/requesterObservations": requester } } : {}),
        content: [{ type: "text" as const, text: `${SPONSORED_RESEARCH_NOTICE}\n\n${JSON.stringify(result, null, 2)}` },
          ...(requester ? [{ type: "text" as const, text: privateRequesterObservationText(requester) }] : [])] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text:
        failureText(error, options.baseUrl) }] };
    }
  });
}
