import { afterEach, expect, it, vi } from "vitest";
import { researchSponsored } from "../../shared/sponsored-research-client";
import { issueFeedbackToken } from "./service";
import { recordedJobObservations } from "./observations";
import { feedbackDeliverySchema } from "./contracts";
import { binding, secret, opinionFixture, recordedRun } from "./test-fixture";

const fixtures: ReturnType<typeof opinionFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
const packet = () => {
  const f = opinionFixture(); fixtures.push(f); const run = recordedRun();
  return feedbackDeliverySchema.parse({ format: "keryx-private-requester-observation-v1", runId: run.id,
    observations: recordedJobObservations(run), feedback: issueFeedbackToken(run, binding, secret, f.store.storeId) });
};
function response(sidecar: unknown, done = true) {
  const run = recordedRun(), chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
  return new Response(chunk({ id: `chatcmpl-${run.id}`, choices: [{ delta: { content: run.answer }, finish_reason: null }] })
    + chunk({ id: `chatcmpl-${run.id}`, choices: [{ delta: {}, finish_reason: "stop" }], keryx: { queryId: run.id,
      dispatchUrl: `${binding.origin}/dispatch/${run.id}`, citations: [] }, keryx_private_requester: sidecar })
    + (done ? "data: [DONE]\n\n" : ""), { headers: { "Content-Type": "text/event-stream" } });
}

it("delivers the one-shot sidecar separately after complete terminal/DONE validation", async () => {
  const value = packet(), callback = vi.fn(), fetcher = vi.fn(async () => response(value));
  const result = await researchSponsored({ question: "Synthetic public request", budget: 0, publicReport: true }, {
    baseUrl: binding.origin, fetch: fetcher, onRequesterObservations: callback });
  expect(callback).toHaveBeenCalledExactlyOnceWith(value);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(result.answer).toBe(recordedRun().answer);
  expect(JSON.stringify(result)).not.toContain(value.feedback!.token);
  expect(JSON.stringify(result)).not.toContain("keryx_private_requester");
});

it("withholds wrong-run, invalid or truncated sidecars without adding them to public results", async () => {
  const value = packet();
  for (const sidecar of [{ ...value, runId: "another-run" }, { ...value, credential: "FORBIDDEN_PRIVATE_FIELD" }]) {
    const callback = vi.fn();
    await researchSponsored({ question: "Synthetic public request", budget: 0, publicReport: true }, {
      baseUrl: binding.origin, fetch: async () => response(sidecar), onRequesterObservations: callback });
    expect(callback).not.toHaveBeenCalled();
  }
  const callback = vi.fn();
  await expect(researchSponsored({ question: "Synthetic public request", budget: 0, publicReport: true }, {
    baseUrl: binding.origin, fetch: async () => response(value, false), onRequesterObservations: callback })).rejects.toThrow();
  expect(callback).not.toHaveBeenCalled();
});

it("preserves the completed answer if an optional private consumer fails", async () => {
  const result = await researchSponsored({ question: "Synthetic public request", budget: 0, publicReport: true }, {
    baseUrl: binding.origin, fetch: async () => response(packet()), onRequesterObservations: () => { throw new Error("Private UI unavailable"); } });
  expect(result.answer).toBe(recordedRun().answer);
});
