import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KeryxDB } from "../db/keryx-db";
import type { RunPrivacyStore } from "./contracts";
import { PrivacyError } from "./contracts";
import { listedQuestions } from "./listed-questions";
import { createSupabaseRunPrivacy } from "../db/run-privacy-supabase";

afterEach(() => vi.unstubAllEnvs());
const run = (id: string) => ({ id, question: "Canonical " + id, createdAt: "2026-11-04T00:00:00Z", answer: "ANSWER_SENTINEL", budget: 0,
  engine: "synthetic", totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], trace: [] });
function fixture(slim = true) {
  const questions = vi.fn(async () => [{ id: "a", question: "Canonical a" }]);
  const list = vi.fn(async () => [run("a")]);
  const legacy = vi.fn(async (id: string) => run(id));
  const store = { list, ...(slim ? { questions } : {}) } as unknown as RunPrivacyStore;
  return { questions, list, legacy, store, db: { runPrivacy: store, runPrivacyActive: true, getQueryRun: legacy } as unknown as KeryxDB };
}

it("uses one bounded question projection, deduplicates IDs and does not cache publication rights", async () => {
  const f = fixture(), ids = ["a", "a", "b"];
  const first = await listedQuestions(f.db, ids); expect([...first]).toEqual([["a", "Canonical a"]]);
  expect(f.questions).toHaveBeenCalledExactlyOnceWith(["a", "b"]); expect(ids).toEqual(["a", "a", "b"]);
  expect(f.list).not.toHaveBeenCalled(); expect(f.legacy).not.toHaveBeenCalled();
  first.set("a", "POISON"); f.questions.mockResolvedValueOnce([]);
  expect(await listedQuestions(f.db, ["a"])).toEqual(new Map());
  expect(f.questions).toHaveBeenCalledTimes(2);
});

it("uses the existing guarded full-run list once when the optional projection is absent", async () => {
  const f = fixture(false);
  expect(await listedQuestions(f.db, ["a", "b", "a"])).toEqual(new Map([["a", "Canonical a"]]));
  expect(f.list).toHaveBeenCalledExactlyOnceWith({ take: 2, ids: ["a", "b"] }); expect(f.legacy).not.toHaveBeenCalled();
});

it.each([true, false])("propagates the original active-reader refusal without falling back: slim=%s", async slim => {
  const f = fixture(slim), refusal = new PrivacyError("privacy_unavailable");
  (slim ? f.questions : f.list).mockRejectedValueOnce(refusal);
  await expect(listedQuestions(f.db, ["a"])).rejects.toBe(refusal);
  expect(f.legacy).not.toHaveBeenCalled(); if (slim) expect(f.list).not.toHaveBeenCalled();
});

it.each([
  { rows: [{ id: "other", question: "SECRET" }] },
  { rows: [{ id: "a", question: "SECRET" }, { id: "a", question: "DUPLICATE" }] },
  { rows: [{ id: "a", question: 42 }] },
  { rows: [{ id: "a", question: "SECRET", answer: "PRIVATE" }] },
])("refuses malformed, foreign or extra projected rows with a content-free error: %j", async ({ rows }) => {
  const f = fixture(); f.questions.mockResolvedValueOnce(rows as unknown as { id: string; question: string }[]);
  await expect(listedQuestions(f.db, ["a"])).rejects.toThrow(/^privacy_unavailable$/);
  expect(f.list).not.toHaveBeenCalled(); expect(f.legacy).not.toHaveBeenCalled();
});

it("keeps empty questions and absent public rows as null enrichment rather than invented text", async () => {
  const f = fixture(); f.questions.mockResolvedValueOnce([{ id: "a", question: "" }]);
  expect(await listedQuestions(f.db, ["a", "b"])).toEqual(new Map());
});

it("requires the captured active privacy port and validates bounds before dispatch", async () => {
  const f = fixture();
  for (const ids of [Array(33).fill("a"), ["invalid id"]])
    await expect(listedQuestions(f.db, ids)).rejects.toThrow("privacy_unavailable");
  await expect(listedQuestions({ runPrivacyActive: true, getQueryRun: f.legacy }, ["a"])).rejects.toThrow("privacy_unavailable");
  expect(f.questions).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled(); expect(f.legacy).not.toHaveBeenCalled();
  expect(await listedQuestions({ runPrivacyActive: true }, [])).toEqual(new Map());
});

it("preserves explicitly inactive legacy reads, including their original ID spelling", async () => {
  const f = fixture(); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  const db = { ...f.db, runPrivacyActive: false };
  expect(await listedQuestions(db, ["legacy id", "a", "a"])).toEqual(new Map([["legacy id", "Canonical legacy id"], ["a", "Canonical a"]]));
  expect(f.legacy.mock.calls).toEqual([["legacy id"], ["a"]]); expect(f.list).not.toHaveBeenCalled(); expect(f.questions).not.toHaveBeenCalled();
});

it("batches the actual Supabase privacy adapter through its existing fixed RPC with no REST or legacy escape", async () => {
  let state = "public";
  const abortSignal = vi.fn(async (_signal: AbortSignal) => ({ error: null, data: { version: 1, action: "list", id: null,
    result: ["a", "b"].map(id => ({ run: run(id), state: { visibility: state, revision: 0, erased: false } })) } }));
  const rpc = vi.fn(() => ({ abortSignal })), from = vi.fn(() => { throw Error("REST is forbidden"); });
  const store = createSupabaseRunPrivacy({ rpc, from } as unknown as SupabaseClient);
  const db = { runPrivacyActive: true, runPrivacy: store };
  expect(await listedQuestions(db, ["a", "b"])).toEqual(new Map([["a", "Canonical a"], ["b", "Canonical b"]]));
  expect(rpc).toHaveBeenCalledExactlyOnceWith("run_privacy_v1", { p_action: "list", p_id: null,
    p_input: { take: 2, ids: ["a", "b"] }, p_actor: null, p_claims: false });
  expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal); expect(from).not.toHaveBeenCalled();
  state = "private"; await expect(listedQuestions(db, ["a", "b"])).rejects.toThrow("privacy_unavailable");
  expect(rpc).toHaveBeenCalledTimes(2); expect(from).not.toHaveBeenCalled();
});
