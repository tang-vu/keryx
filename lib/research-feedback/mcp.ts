import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { secretFreeMcpInput } from "../mcp/secret-free-input-schema";
import { feedbackInputSchema, feedbackResponseSchema, type FeedbackDelivery, type FeedbackInput, type FeedbackResponse } from "./contracts";
import { requestRequesterFeedback } from "./client";

const refusal = "Requester feedback could not be confirmed. Supply the original private feedback token and an explicit bounded choice. No research, refund or payment was started.";
const token = z.string().max(2048).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/).describe("Private capability received with your original completed answer. Keep it out of reports, prompts to Keryx research, public links and exports.");
export function privateRequesterObservationText(packet: FeedbackDelivery) {
  return `Private original-caller observations and feedback capability. Keep this sidecar private; do not add it to the public answer or report. Model costs are partial recorded estimates. Feedback cannot run research, revise content, refund or pay anyone.\n${JSON.stringify(packet)}`;
}
export function registerRequesterFeedbackTools(server: McpServer, options: { baseUrl: string;
  execute?: (token: string, input: FeedbackInput | undefined, signal: AbortSignal) => Promise<FeedbackResponse> }) {
  const execute = options.execute ?? ((value, input, signal) => requestRequesterFeedback(options.baseUrl, value, input, { signal }));
  for (const write of [false, true]) {
    const schema = write ? feedbackInputSchema.extend({ token }).strict() : z.object({ token }).strict();
    server.registerTool(write ? "research_feedback_submit" : "research_feedback_read", {
      title: write ? "Record usefulness of your original answer" : "Read feedback for your original answer",
      description: "Original-caller private opinion on the exact delivered ordinary research answer. Requires its private bearer capability; a public report ID or link grants no authority. First choice is retained, exact retries are idempotent. Silence is no response. No research, source fetching, revision execution, refunds, signing or payments.",
      inputSchema: secretFreeMcpInput(schema.shape, refusal), outputSchema: feedbackResponseSchema.innerType(),
      annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async (raw, extra) => {
      try {
        extra.signal.throwIfAborted();
        const input = schema.parse(raw);
        const choice = write ? feedbackInputSchema.parse({ choice: Reflect.get(input, "choice"), reason: Reflect.get(input, "reason") }) : undefined;
        const result = feedbackResponseSchema.parse(await execute(input.token, choice, extra.signal));
        extra.signal.throwIfAborted();
        return { structuredContent: result, content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch { return { isError: true, content: [{ type: "text" as const, text: refusal }] }; }
    });
  }
}
