import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, it, vi } from "vitest";
import { registerRequesterFeedbackTools } from "../lib/research-feedback/mcp.ts";
import { registerSponsoredResearchTool } from "./sponsored-research.mts";
import { feedbackDeliverySchema, feedbackResponseSchema } from "../lib/research-feedback/contracts.ts";
import { createRequesterFeedbackRoute } from "../lib/research-feedback/http.ts";
import { issueFeedbackToken } from "../lib/research-feedback/service.ts";
import { recordedJobObservations } from "../lib/research-feedback/observations.ts";
import { binding, secret, opinionFixture, recordedRun } from "../lib/research-feedback/test-fixture.ts";

const clients: Client[] = [], fixtures: ReturnType<typeof opinionFixture>[] = [];
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); for (const f of fixtures.splice(0)) f.cleanup(); });
async function connect(server: McpServer) {
  const client = new Client({ name: "synthetic-feedback-client", version: "1" }); clients.push(client);
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b); return client;
}
const call = async (client: Client, name: string, input: Record<string, unknown>) => client.callTool({ name, arguments: input })
  .catch(error => ({ isError: true, content: [{ type: "text", text: String(error) }] }));

it("exposes bounded private feedback tools and retains the same first opinion through the actual protocol", async () => {
  const f = opinionFixture(); fixtures.push(f); const run = recordedRun();
  const handler = createRequesterFeedbackRoute({ db: async () => ({ getQueryRun: async () => run }), store: () => f.store, binding, secret: () => secret });
  const execute = vi.fn(async (token, input, signal) => {
    const response = await handler(new Request(`${binding.origin}/api/research-feedback`, { method: "POST", signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input ? { operation: "submit", ...input } : { operation: "read" }) }));
    if (!response.ok) throw new Error("Feedback unavailable");
    return feedbackResponseSchema.parse(await response.json());
  });
  const server = new McpServer({ name: "synthetic-feedback-server", version: "1" });
  registerRequesterFeedbackTools(server, { baseUrl: binding.origin, execute }); const client = await connect(server);
  const listed = (await client.listTools()).tools;
  expect(listed.map(tool => tool.name)).toEqual(["research_feedback_read", "research_feedback_submit"]);
  expect(JSON.stringify(listed)).not.toContain(secret);
  expect(execute).not.toHaveBeenCalled();
  const token = issueFeedbackToken(run, binding, secret, f.store.storeId).token;
  const saved = await call(client, "research_feedback_submit", { token, choice: "revise", reason: "Need an example" });
  expect(saved.isError).not.toBe(true);
  expect(saved).toMatchObject({ structuredContent: { execution: "none", feedback: { choice: "revise" } } });
  const repeated = await call(client, "research_feedback_submit", { token, choice: "revise", reason: "Need an example" });
  expect(repeated).toEqual(saved);
  const read = await call(client, "research_feedback_read", { token }); expect(read).toEqual(saved);
  expect((await call(client, "research_feedback_submit", { token, choice: "useful" })).isError).toBe(true);
});

it("refuses invalid input without echoing credentials or starting any caller action", async () => {
  const server = new McpServer({ name: "synthetic-feedback-server", version: "1" }), execute = vi.fn();
  registerRequesterFeedbackTools(server, { baseUrl: binding.origin, execute }); const client = await connect(server);
  const forbidden = "FORBIDDEN_PRIVATE_CREDENTIAL";
  const result = await call(client, "research_feedback_submit", { token: forbidden, choice: "useful" });
  expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain(forbidden); expect(execute).not.toHaveBeenCalled();
});

it("keeps sponsored completion capabilities out of the public structured research projection", async () => {
  const f = opinionFixture(); fixtures.push(f); const run = recordedRun();
  const packet = feedbackDeliverySchema.parse({ format: "keryx-private-requester-observation-v1", runId: run.id,
    observations: recordedJobObservations(run), feedback: issueFeedbackToken(run, binding, secret, f.store.storeId) });
  const executor = vi.fn(async (_input, options) => {
    options?.onRequesterObservations?.(packet);
    return { queryId: run.id, answer: run.answer, citations: [], dispatchUrl: `${binding.origin}/dispatch/${run.id}` };
  });
  const server = new McpServer({ name: "synthetic-sponsored-feedback", version: "1" });
  registerSponsoredResearchTool(server, { baseUrl: binding.origin, executor }); const client = await connect(server);
  const result = await call(client, "ask_keryx_sponsored", { question: "Synthetic public research", publicReport: true, budget: 0 });
  expect(result.isError).not.toBe(true); expect(executor).toHaveBeenCalledOnce();
  expect(JSON.stringify(Reflect.get(result, "structuredContent"))).not.toContain(packet.feedback!.token);
  expect(Reflect.get(result, "_meta")).toMatchObject({ "keryx/privateRequesterObservations": packet });
});
