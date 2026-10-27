import { expect, it } from "vitest";
import { isSourcePerformanceResponse, type SourcePerformanceResponse } from "./source-performance-response";

const record: SourcePerformanceResponse = { sourceId: "a", name: "Source A", windowRuns: 400, performance: {
  considered: 2, bought: 1, reused: 0, skipped: 1, cited: 1, citeThrough: 1, evChosen: 0.8, evSkipped: 0.2,
  price: 0.002, rivalPriceOnSkip: 0.001, recentSkips: [{ queryId: "public-run", question: "Public question",
    rationale: "Original public rationale", createdAt: "2026-10-01T00:00:00.000Z", expectedValue: 0.2,
    price: 0.002, rivalPrice: 0.001 }],
} };
it("accepts a successful source-bound record and a verified empty window without rewriting them", () => {
  const before = JSON.stringify(record);
  expect(isSourcePerformanceResponse(record, "a")).toBe(true);
  expect(isSourcePerformanceResponse({ ...record, performance: null }, "a")).toBe(true);
  expect(JSON.stringify(record)).toBe(before);
});
it("keeps finite recorded rates and values instead of clamping or substituting zero", () => {
  const historical = { ...record, performance: { ...record.performance!, citeThrough: 1.5, evChosen: -0.1 } };
  expect(isSourcePerformanceResponse(historical, "a")).toBe(true);
  expect(historical.performance.citeThrough).toBe(1.5);
  expect(historical.performance.evChosen).toBe(-0.1);
});
it.each([undefined, null, [], {}, { ...record, sourceId: "another-source" }, { ...record, name: null },
  { ...record, windowRuns: "400" }, { ...record, windowRuns: 0 }, { ...record, performance: {} },
  { ...record, performance: { ...record.performance, considered: -1 } },
  { ...record, performance: { ...record.performance, bought: 1.5 } },
  { ...record, performance: { ...record.performance, cited: Number.MAX_SAFE_INTEGER + 1 } },
  { ...record, performance: { ...record.performance, citeThrough: NaN } },
  { ...record, performance: { ...record.performance, price: Infinity } },
  { ...record, performance: { ...record.performance, evChosen: "0.8" } },
  { ...record, performance: { ...record.performance, recentSkips: null } },
  { ...record, performance: { ...record.performance, recentSkips: [null] } },
  { ...record, performance: { ...record.performance, recentSkips: [{ ...record.performance!.recentSkips[0], queryId: "" }] } },
  { ...record, performance: { ...record.performance, recentSkips: [{ ...record.performance!.recentSkips[0], question: null }] } },
  { ...record, performance: { ...record.performance, recentSkips: [{ ...record.performance!.recentSkips[0], createdAt: "not-a-date" }] } },
  { ...record, performance: { ...record.performance, recentSkips: [{ ...record.performance!.recentSkips[0], rivalPrice: "unknown" }] } },
])("refuses malformed or mismatched feedback without manufacturing an empty record: %j", value => {
  expect(isSourcePerformanceResponse(value, "a")).toBe(false);
});
