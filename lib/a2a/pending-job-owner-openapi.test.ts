import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { accountHistoryItem } from "./account-history";
import type { A2aOrder } from "./order";
import { pendingJobOwnerHeader, pendingJobOwnerOpenApiPaths, pendingJobOwnerOpenApiSchemas } from "./pending-job-owner-openapi";

it("documents only actual GET export, bounded cursor view and cookie authority", () => {
  const source = readFileSync(new URL("../../app/api/me/jobs/route.ts", import.meta.url), "utf8");
  expect([...source.matchAll(/export async function (GET|POST|PUT|DELETE|PATCH)\b/g)].map(m => m[1].toLowerCase()))
    .toEqual(Object.keys(pendingJobOwnerOpenApiPaths["/api/me/jobs"]));
  const get = pendingJobOwnerOpenApiPaths["/api/me/jobs"].get;
  expect(get.security).toEqual([{ WebSession: [] }]);
  expect(get.responses["200"].content["application/json"].schema.properties.jobs.maxItems).toBe(25);
  expect(get.parameters.find(p => p.name === "cursor")?.schema.maxLength).toBe(300);
  expect(get.parameters.map(p => p.name)).toEqual(["cursor", "pending", "id"]);
  expect(get.parameters.find(p => p.name === "pending")?.schema.enum).toEqual(["owned"]);
});

it("retains the allowlisted real history projection and shared escalation schema without financial authority", () => {
  const now = "2026-10-15T00:00:00.000Z", id = `a2a_${"a".repeat(64)}`;
  const original: A2aOrder = {
    id, queryId: id, authorizationId: "PRIVATE nonce", requestHash: "b".repeat(64),
    payer: `0x${"c".repeat(40)}`, payee: `0x${"d".repeat(40)}`,
    amountUsdc: 0.1, creatorBudgetUsdc: 0.05, serviceFeeUsdc: 0.05, researchMode: "quick",
    researchPackage: null, transaction: "original_reference", request: null, status: "running",
    workerId: null, startedAt: null, executionJournalVersion: 1, paymentStartedAt: null, resultSavingAt: null,
    response: null, errorCode: null, resolution: null, createdAt: now, updatedAt: now,
  };
  const item = accountHistoryItem(original, Date.parse(now));
  const schema = pendingJobOwnerOpenApiSchemas.AccountJobHistoryItem;
  expect(Object.keys(item).sort()).toEqual([...schema.required].sort());
  expect(Object.keys(item).every(key => key in schema.properties)).toBe(true);
  expect(schema.properties.status.enum).toContain(item.status);
  expect(schema.properties.escalation).toEqual({ $ref: "#/components/schemas/PaidJobEscalation" });
  expect(item.question).toBeNull(); expect(item.originalPayment.network).toBeNull();
  expect(JSON.stringify(item)).not.toContain(original.authorizationId);
  const owned = pendingJobOwnerOpenApiSchemas.AuthenticatedOriginalJobHistoryItem;
  expect(owned.required).toEqual([...schema.required, "attention", "recoveryState"]);
  expect(owned.properties.recoveryState.enum).toEqual(["held", "unknown"]);
});

it("wires additive owner opt-in into the existing payment operation and keeps prior security alternatives", () => {
  const source = readFileSync(new URL("../openapi-spec.ts", import.meta.url), "utf8");
  expect(pendingJobOwnerHeader.name).toBe("X-Keryx-Account-Job");
  expect(pendingJobOwnerHeader.required).toBe(false);
  expect(pendingJobOwnerHeader.schema.enum).toEqual(["associate"]);
  expect(source).toContain("parameters: [pendingJobOwnerHeader]");
  expect(source).toContain("[{ X402Payment: [] }, { ApiKeyAuth: [], X402Payment: [] }, { WebSession: [], X402Payment: [] }]");
  expect(source.match(/\.\.\.pendingJobOwnerOpenApiPaths/g)).toHaveLength(1);
  expect(source.match(/\.\.\.pendingJobOwnerOpenApiSchemas/g)).toHaveLength(1);
});
