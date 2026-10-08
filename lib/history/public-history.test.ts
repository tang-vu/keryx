import { expect, it } from "vitest";
import type { QueryRun } from "../types";
import { historyBefore, historyNext, mergeQuestionHistory, questionSummary } from "./public-history";

const run = (id: string, createdAt = "2026-10-02T09:26:53.345Z") => ({ id, createdAt, question: id, answer: "Original answer", citations: [], totalSpent: 0, totalToCreators: 0 } as unknown as QueryRun);
it("keeps current records authoritative, sorts equal timestamps deterministically, and bounds history", () => {
  const rows = mergeQuestionHistory([run("b")], [run("a"), { ...run("b"), answer: "Older" }, run("c")], 2);
  expect(rows.map(row => row.run.id)).toEqual(["c", "b"]);
  expect(rows[1]).toMatchObject({ historical: false, run: { answer: "Original answer" } });
});
it("round-trips public history paging and rejects incomplete or noncanonical cursors", () => {
  expect(historyBefore(new URLSearchParams(historyNext(run("a"))))).toEqual({ createdAt: run("a").createdAt, id: "a" });
  expect(historyBefore(new URLSearchParams())).toBeUndefined();
  expect(() => historyBefore(new URLSearchParams("before=2026-10-02"))).toThrow();
  expect(() => historyBefore(new URLSearchParams("before=2026-10-02&beforeId=a"))).toThrow();
});
it("public summaries omit wallet, provider usage and private recovery metadata", () => {
  const summary = questionSummary({ ...run("a"), asker: "private-wallet", originalFulfillment: { private: true } } as unknown as QueryRun);
  expect(JSON.stringify(summary)).not.toContain("private");
});
