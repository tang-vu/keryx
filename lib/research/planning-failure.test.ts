import { expect, it, vi } from "vitest";
import { parsePlanningFailure, savedPlanningFailureId } from "./planning-failure";
import { publicQueryRun } from "./public-query-run";
import { createPrivateClaimHandoff } from "../run-claims/web-handoff";
import type { QueryRun } from "../types";

const diagnostic = { version: 1, stage: "decompose", reason: "invalid_output", maximumTargets: 8, automaticRetry: false } as const;
const id = "11111111-1111-4111-8111-111111111111";
const error = { code: "research_plan_refinement_required", planningFailure: diagnostic, reportSaved: true, failedReportId: id };

it("projects only the closed diagnostic and preserves actual output ceilings without raw model fields", () => {
  expect(parsePlanningFailure({ ...diagnostic, outputTokenLimit: 2048 })).toEqual({ ...diagnostic, outputTokenLimit: 2048 });
  for (const value of [{ ...diagnostic, raw: "PRIVATE_MODEL_BODY" }, { ...diagnostic, stage: "provider response" },
    { ...diagnostic, reason: "PRIVATE_MODEL_BODY" }, { ...diagnostic, automaticRetry: true }, { ...diagnostic, outputTokenLimit: -1 }]) {
    expect(parsePlanningFailure(value)).toBeUndefined();
    const run = { trace: [], planningFailure: value } as unknown as QueryRun;
    expect(publicQueryRun(run)).not.toHaveProperty("planningFailure");
  }
  const read = vi.fn();
  expect(parsePlanningFailure(Object.defineProperty({}, "reason", { get: read }))).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});

it.each([undefined, null, { ...error, reportSaved: false }, { ...error, code: "other" }, { ...error, failedReportId: "../private" },
  { ...error, planningFailure: { ...diagnostic, raw: "private" } }])("does not admit unsaved/unbound claim completion: %j", value => {
  expect(savedPlanningFailureId(value)).toBeUndefined();
});

it.each(["clean", "cancel", "new-request", "document-change", "lost-EOF"])("keeps a failed report's private one-shot handoff fenced across %s", boundary => {
  let proof = "initial-document", state = "";
  const open = vi.fn(), handoff = createPrivateClaimHandoff({ origin: () => "https://synthetic.example", documentProof: () => proof,
    now: () => Date.parse("2026-10-18T00:00:00Z"), open });
  handoff.subscribe(value => { state = value; }); handoff.begin();
  handoff.saved(savedPlanningFailureId(error));
  const token = "a".repeat(64), packet = JSON.stringify({ version: 1, runId: id, status: "available", delivery: { version: 1,
    claimUrl: `https://synthetic.example/claim-run#${token}`, expiresAt: "2026-10-19T00:00:00.000Z" } });
  if (boundary === "cancel") handoff.clear();
  if (boundary === "new-request") handoff.begin();
  if (boundary === "document-change") proof = "different-owner-document";
  handoff.packet(packet);
  if (boundary === "lost-EOF") handoff.fail(); else handoff.finish();
  expect(state === "available").toBe(boundary === "clean");
  expect(JSON.stringify(handoff)).not.toContain(token);
  handoff.open(); handoff.open();
  expect(open).toHaveBeenCalledTimes(boundary === "clean" ? 1 : 0);
});
