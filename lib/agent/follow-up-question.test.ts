/**
 * The invariant worth pinning: a follow-up carries the parent *question* and never the parent
 * *answer*. Carrying the answer would let the next dispatch be written from text earlier sources
 * were paid to produce — a citation-toll agent answering for free from someone else's paid work.
 */

import { describe, it, expect } from "vitest";
import { buildFollowUpQuestion, needsContext } from "./follow-up-question";

const PARENT = "What settlement guarantees does Arc offer for stablecoin payments?";

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
    const longParent = `${"How does the Arc settlement path behave ".repeat(12)}under load?`;
    const q = buildFollowUpQuestion(longParent, "What about it under congestion?");
    expect(q).toContain("…");
    expect(q.length).toBeLessThan(longParent.length);
    // The kept prefix must be a whole-word prefix of the parent: the parent continues with a
    // space right where the trim landed, so no word was cut in half.
    const kept = q.slice(q.indexOf('"') + 1, q.indexOf("…"));
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
