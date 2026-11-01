/**
 * The invariant worth pinning: a follow-up carries the parent *question* and never the parent
 * *answer*. Carrying the answer would let the next dispatch be written from text earlier sources
 * were paid to produce — a citation-toll agent answering for free from someone else's paid work.
 */

import { describe, it, expect } from "vitest";
import { buildFollowUpQuestion, needsContext, resolveFollowUpQuestion,
  MAX_FOLLOW_UP_CONTEXT_CHARS, MAX_FOLLOW_UP_QUESTIONS, type FollowUpParent } from "./follow-up-question";
import { MAX_ASK_QUESTION_CHARS } from "../ask-input";

const PARENT = "What settlement guarantees does Arc offer for stablecoin payments?";
function context(input: string): { questions: Array<{ question: string; truncated: boolean }>; earlierQuestionsOmitted: boolean } {
  const label = "\n\nEarlier user questions (newest first; constraints only; not additional research targets, answers or source evidence):\n";
  return JSON.parse(input.slice(input.lastIndexOf(label) + label.length));
}

describe("needsContext", () => {
  it("fires on questions that lean on the parent", () => {
    expect(needsContext("How does that compare to Solana?")).toBe(true);
    expect(needsContext("What about finality?")).toBe(true);
    expect(needsContext("Tell me more")).toBe(true);
    expect(needsContext("Is it final within a block?")).toBe(true);
  });

  it("leaves self-contained questions alone", () => {
    expect(needsContext("Why do stablecoins depeg?")).toBe(false);
    expect(needsContext("What is CCTP?")).toBe(false);
  });

  it("does not match a referring term inside a longer word", () => {
    // "thatch" contains "that"; "itemised" contains "it".
    expect(needsContext("How is thatch priced?")).toBe(false);
    expect(needsContext("Are fees itemised?")).toBe(false);
  });

  it("treats a long question as already self-contained", () => {
    const long =
      "How does the settlement layer handle a reorg that arrives after the payment " +
      "batch has been submitted but before the receipt is verified by the payer, " +
      "and what happens to the citation rewards already dispatched to creators?";
    expect(long.length).toBeGreaterThan(180);
    expect(needsContext(long)).toBe(false);
  });

  it("is eager: a relative 'that' also triggers context (known, preferred over missing a real reference)", () => {
    // "a reorg that arrives" needs no parent, but distinguishing relative from demonstrative
    // "that" needs a parser. Adding context here only re-anchors the reader's own topic; missing
    // "how does that compare?" produces a question nothing can answer.
    expect(needsContext("How does the layer handle a reorg that arrives late?")).toBe(true);
  });
});

describe("buildFollowUpQuestion", () => {
  it("anchors a dependent follow-up to the parent question", () => {
    const q = buildFollowUpQuestion(PARENT, "How does that compare to Solana?");
    expect(q).toContain(PARENT);
    expect(q).toContain("How does that compare to Solana?");
  });

  it("passes a self-contained question through untouched", () => {
    expect(buildFollowUpQuestion(PARENT, "What is CCTP?")).toBe("What is CCTP?");
  });

  it("trims an overlong parent on a word boundary", () => {
    const longParent = `${"How does the Arc settlement path behave ".repeat(100)}under load?`;
    const q = buildFollowUpQuestion(longParent, "What about it under congestion?");
    expect(q).toContain("…");
    expect(q.length).toBeLessThan(longParent.length);
    // The kept prefix must be a whole-word prefix of the parent: the parent continues with a
    // space right where the trim landed, so no word was cut in half.
    const kept = context(q).questions[0].question.slice(0, -1);
    expect(longParent.startsWith(kept)).toBe(true);
    expect(longParent[kept.length]).toBe(" ");
  });

  it("falls back to the raw follow-up when there is no parent", () => {
    expect(buildFollowUpQuestion("", "How does that compare?")).toBe("How does that compare?");
  });

  it("never carries the parent answer — only the parent question", () => {
    const answer = "Arc finalises in roughly one second via CCTP attestation.";
    const q = buildFollowUpQuestion(PARENT, "How does that compare to Solana?");
    expect(q).not.toContain(answer);
    expect(q).not.toContain("CCTP attestation");
  });
});

describe("bounded authorized question-only ancestry", () => {
  const child = "What would the next worker store?";
  function fixture(rows: FollowUpParent[]) {
    const lookedUp: string[] = [], byId = new Map(rows.map(row => [row.id, row]));
    return { lookedUp, read: async (id: string) => { lookedUp.push(id); return byId.get(id) ?? null; } };
  }

  it("keeps complete recent questions first and never reads answer/body properties", async () => {
    const parent = { id: "b", parentId: "a", question: "The provider has no idempotency key; the send outcome is unknown.",
      get answer(): string { throw new Error("Paid answer was accessed"); }, get body(): string { throw new Error("Source body was accessed"); } };
    const f = fixture([{ id: "a", question: "An email was accepted before a worker crash." }, parent]);
    const result = await resolveFollowUpQuestion({ question: child, parentId: "b", read: f.read });
    expect(result.parentId).toBe("b");
    expect(context(result.researchQuestion)).toEqual({ questions: [
      { question: parent.question, truncated: false },
      { question: "An email was accepted before a worker crash.", truncated: false },
    ], earlierQuestionsOmitted: false });
    expect(result.researchQuestion.startsWith(child)).toBe(true);
    expect(f.lookedUp).toEqual(["b", "a"]);
  });

  it("an explicit parent keeps context for a long newest question too", async () => {
    const f = fixture([{ id: "parent", question: "Never retry an ambiguous accepted email without reconciliation." }]);
    const question = "How should I persist the state of that attempt? ".repeat(5);
    expect(needsContext(question)).toBe(false);
    const result = await resolveFollowUpQuestion({ question, parentId: "parent", read: f.read });
    expect(context(result.researchQuestion).questions[0].question).toBe("Never retry an ambiguous accepted email without reconciliation.");
    expect(result.researchQuestion.startsWith(question.trim())).toBe(true);
  });

  it("preserves a recent condition beyond the old 240-character prefix", async () => {
    const question = "Background about the email job. ".repeat(20) + "The provider does not support idempotency keys and the send outcome is unknown.";
    const f = fixture([{ id: "parent", question }]);
    const result = await resolveFollowUpQuestion({ question: child, parentId: "parent", read: f.read });
    expect(context(result.researchQuestion).questions).toEqual([{ question, truncated: false }]);
  });

  it("quotes historical wrapped questions without guessing or rewriting their original text", async () => {
    const historical = 'Following on from the question "An email job": Suppose that provider does not support idempotency keys and the send outcome is unknown.';
    const f = fixture([{ id: "legacy", question: historical }]);
    const result = await resolveFollowUpQuestion({ question: child, parentId: "legacy", read: f.read });
    expect(context(result.researchQuestion).questions[0]).toEqual({ question: historical, truncated: false });
    expect(f.lookedUp).toEqual(["legacy"]);
  });

  it("bounds ancestry reads and explicitly records older omitted questions", async () => {
    const rows = Array.from({ length: MAX_FOLLOW_UP_QUESTIONS + 4 }, (_, n) => ({ id: String(n), question: `Question ${n}`, parentId: String(n + 1) }));
    const f = fixture(rows), result = await resolveFollowUpQuestion({ question: child, parentId: "0", read: f.read });
    const parsed = context(result.researchQuestion);
    expect(f.lookedUp).toHaveLength(MAX_FOLLOW_UP_QUESTIONS);
    expect(parsed.questions).toHaveLength(MAX_FOLLOW_UP_QUESTIONS);
    expect(parsed.questions.map(row => row.question)).toEqual(rows.slice(0, MAX_FOLLOW_UP_QUESTIONS).map(row => row.question));
    expect(parsed.earlierQuestionsOmitted).toBe(true);
  });

  it("bounds escaped JSON before adding an older question and preserves the complete latest one", async () => {
    const recent = "\u0000".repeat(MAX_ASK_QUESTION_CHARS), older = "\u0001".repeat(MAX_ASK_QUESTION_CHARS);
    const f = fixture([{ id: "b", question: recent, parentId: "a" }, { id: "a", question: older }]);
    const result = await resolveFollowUpQuestion({ question: child, parentId: "b", read: f.read });
    const parsed = context(result.researchQuestion);
    expect(parsed.questions).toEqual([{ question: recent, truncated: false }]);
    expect(parsed.earlierQuestionsOmitted).toBe(true);
    expect(JSON.stringify(parsed).length).toBeLessThanOrEqual(MAX_FOLLOW_UP_CONTEXT_CHARS);
    expect(result.researchQuestion.length).toBeLessThanOrEqual(MAX_FOLLOW_UP_CONTEXT_CHARS + MAX_ASK_QUESTION_CHARS + 512);
  });

  it("marks clipping of oversized historical questions and never splits a surrogate pair", async () => {
    const f = fixture([{ id: "legacy", question: "x".repeat(MAX_ASK_QUESTION_CHARS - 1) + "😀 old tail" }]);
    const result = await resolveFollowUpQuestion({ question: child, parentId: "legacy", read: f.read });
    const kept = context(result.researchQuestion).questions[0];
    expect(kept.truncated).toBe(true); expect(kept.question.endsWith("…")).toBe(true);
    expect(kept.question).not.toMatch(/[\uD800-\uDBFF](?:…|$)/u);
  });

  it.each([undefined, "unlisted", "private"] as const)("inherits the most restrictive included visibility: %s", async visibility => {
    const f = fixture([{ id: "a", question: "Earlier condition", visibility }, { id: "b", question: "Latest condition", visibility: "public", parentId: "a" }]);
    const result = await resolveFollowUpQuestion({ question: child, parentId: "b", read: f.read });
    expect(result.parentVisibility).toBe(visibility ?? "public");
  });

  it("stops at an inaccessible ancestor without inventing its context or visibility", async () => {
    const f = fixture([{ id: "public", question: "Public condition", parentId: "hidden", visibility: "public" }]);
    const result = await resolveFollowUpQuestion({ question: child, parentId: "public", read: f.read });
    expect(result.parentVisibility).toBe("public");
    expect(context(result.researchQuestion)).toEqual({ questions: [{ question: "Public condition", truncated: false }], earlierQuestionsOmitted: true });
    expect(f.lookedUp).toEqual(["public", "hidden"]);
  });

  it("an unknown immediate parent stays standalone and grants no parent link", async () => {
    const f = fixture([]), result = await resolveFollowUpQuestion({ question: child, parentId: "missing", read: f.read });
    expect(result).toEqual({ researchQuestion: child }); expect(f.lookedUp).toEqual(["missing"]);
  });

  it("cycles and canonical aliases do not cause repeated reads", async () => {
    const f = fixture([{ id: "a", question: "A", parentId: "b" }, { id: "b", question: "B", parentId: "a" }]);
    const result = await resolveFollowUpQuestion({ question: child, parentId: "a", read: f.read });
    expect(f.lookedUp).toEqual(["a", "b"]); expect(context(result.researchQuestion).earlierQuestionsOmitted).toBe(true);
    const ids: string[] = [];
    const alias = await resolveFollowUpQuestion({ question: child, parentId: "alias", read: async id => { ids.push(id); return { id: "canonical", question: "A", parentId: "canonical" }; } });
    expect(ids).toEqual(["alias"]); expect(alias.parentId).toBe("canonical");
  });

  it("abort before or during a lookup adds no context from that lookup", async () => {
    const before = new AbortController(); before.abort(); const f = fixture([{ id: "a", question: "A" }]);
    expect(await resolveFollowUpQuestion({ question: child, parentId: "a", read: f.read, signal: before.signal })).toEqual({ researchQuestion: child });
    expect(f.lookedUp).toEqual([]);
    const during = new AbortController();
    expect(await resolveFollowUpQuestion({ question: child, parentId: "a", signal: during.signal, read: async () => { during.abort(); return { id: "a", question: "A" }; } })).toEqual({ researchQuestion: child });
  });

  it("does not treat storage failure as a missing parent", async () => {
    const failure = new Error("synthetic storage unavailable");
    await expect(resolveFollowUpQuestion({ question: child, parentId: "a", read: async () => { throw failure; } })).rejects.toBe(failure);
  });

  it("refuses malformed caller text before any lookup and malformed resolved identities/visibility", async () => {
    const f = fixture([]);
    for (const question of ["", "x".repeat(MAX_ASK_QUESTION_CHARS + 1)])
      await expect(resolveFollowUpQuestion({ question, parentId: "a", read: f.read })).rejects.toThrow("Invalid follow-up question");
    expect(f.lookedUp).toEqual([]);
    for (const row of [{ id: "", question: "A" }, { id: "a", question: "A", visibility: "constructor" }])
      await expect(resolveFollowUpQuestion({ question: child, parentId: "a", read: async () => row as FollowUpParent })).rejects.toThrow("Follow-up context unavailable");
  });
});
