import { describe, expect, it } from "vitest";
import { evidenceContext } from "./evidence-context";
import { buildContextualQuoteOptions } from "./quote-context";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import {
  briefEvidence, briefContextSources, briefQuoteMenu, briefReviewPacket, prepareDecisionBrief, reviewDecisionBrief, validBriefPacket,
  MAX_BRIEF_ACTIONS, MAX_BRIEF_FACTS,
  type BriefCandidate, type BriefPacket,
} from "./decision-brief";
import type { SynthInput } from "./reasoning-engine";

/** Fictional cases; supplied verdicts exercise propagation, not model accuracy. */
function fixture() {
  const input: SynthInput = {
    question: "For this internal queue experiment, what should I verify before relying on retries?",
    subClaims: ["Can the queue deliver duplicates?", "What must retry handlers tolerate?"],
    gathered: [
      { sourceId: "internal-queue", sourceName: "Fictional protocol", marker: "S1", text:
        "The fictional queue may deliver duplicate messages. Retry handlers must tolerate duplicates. The fictional retention period is twelve hours." },
      { sourceId: "internal-limit", sourceName: "Fictional limitations", marker: "S2", text:
        "This internal experiment does not evaluate exactly-once effects. This fixture is not provider documentation." },
    ],
  };
  const sources = evidenceContext(input.question, input.subClaims, input.gathered);
  const options = buildContextualQuoteOptions(sources, input.gathered);
  const candidate: BriefCandidate = {
    facts: [
      { id: "f1", targetIndex: 0, text: "The fictional queue may deliver duplicate messages.", quoteIds: ["q0_0"], support: 0.9 },
      { id: "f2", targetIndex: 1, text: "Retry handlers must tolerate duplicates.", quoteIds: ["q0_1"], support: 0.8 },
    ],
    actions: [{ id: "a1", text: "Verify that the handler tolerates duplicate messages before relying on retries.",
      premiseIds: ["f1", "f2"], conditions: ["If this fictional queue is the one being evaluated."] }],
  };
  return { input, sources, options, candidate };
}

function prepared() {
  const value = fixture();
  const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources);
  expect(packet).toBeDefined();
  return { ...value, packet: packet! };
}

function supported(packet: BriefPacket) {
  return { digest: packet.digest,
    facts: packet.candidate.facts.map(fact => ({ id: fact.id, status: "supported", support: 0.9,
      quotes: fact.quoteIds.map(quoteId => ({ quoteId, status: "supported", support: 0.9 })) })),
    actions: packet.candidate.actions.map(action => ({ id: action.id, status: "supported" })),
  };
}

describe("strict decision-brief candidate contract", () => {
  it("retains admitted facts and a conditional next step from exact fictional evidence", () => {
    const { packet } = prepared();
    const reviewed = reviewDecisionBrief(packet, supported(packet));
    expect(reviewed?.facts).toEqual([
      { id: "f1", support: 0.9, quoteSupports: [{ quoteId: "q0_0", support: 0.9 }] },
      { id: "f2", support: 0.8, quoteSupports: [{ quoteId: "q0_1", support: 0.8 }] },
    ]);
    expect(reviewed?.actions).toEqual(["a1"]);
    expect(reviewed?.packet.candidate.actions[0].conditions).toEqual(["If this fictional queue is the one being evaluated."]);
    expect(briefEvidence(reviewed!)).toEqual([
      { claimIndex: 0, marker: "S1", quote: "The fictional queue may deliver duplicate messages.", quoteSpan: { start: 0, end: 51 }, support: 0.9 },
      { claimIndex: 1, marker: "S1", quote: "Retry handlers must tolerate duplicates.", quoteSpan: { start: 52, end: 92 }, support: 0.8 },
    ]);
  });

  it("keeps unselected adverse source passages while narrowing quote options to cited ones", () => {
    const { packet } = prepared();
    expect(packet.quotes.map(quote => quote.quoteId)).toEqual(["q0_0", "q0_1"]);
    expect(packet.sources).toHaveLength(2);
    expect(packet.sources[1].passages[0].text).toContain("does not evaluate exactly-once effects");
    expect(validBriefPacket(packet)).toBe(true);
  });

  it("copies input, candidate, quote and source arrays before hashing", () => {
    const { packet, input, candidate, options, sources } = prepared();
    const before = structuredClone(packet);
    input.subClaims[0] = "Rewritten target";
    candidate.facts[0].text = "Rewritten fact";
    candidate.facts[0].quoteIds.push("q1_0");
    candidate.actions[0].conditions[0] = "Rewritten condition";
    options[0].context = "Rewritten context";
    sources[1].passages[0].text = "Rewritten adverse source";
    expect(packet).toEqual(before);
    expect(validBriefPacket(packet)).toBe(true);
  });

  it("accepts exact structural caps without rejecting every candidate", () => {
    const value = fixture();
    value.input.subClaims = Array.from({ length: 8 }, (_, index) => `Target ${index}`);
    value.candidate.facts = Array.from({ length: MAX_BRIEF_FACTS }, (_, index) => ({ id: `f${index + 1}`,
      targetIndex: index % 8, text: "x".repeat(360), quoteIds: ["q0_0", "q0_1", "q0_2"], support: 1 }));
    value.candidate.actions = Array.from({ length: MAX_BRIEF_ACTIONS }, (_, index) => ({ id: `a${index + 1}`,
      text: "x".repeat(360), premiseIds: ["f1", "f2", "f3", "f4"], conditions: ["x".repeat(180), "y".repeat(180)] }));
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources);
    expect(packet?.candidate.facts).toHaveLength(MAX_BRIEF_FACTS);
    expect(packet?.candidate.actions).toHaveLength(MAX_BRIEF_ACTIONS);
    // Structural acceptance is not a claim that these boundary strings are useful facts.
    expect(validBriefPacket(packet!)).toBe(true);
  });

  it("accepts a fact-only candidate with no proposed action", () => {
    const value = fixture();
    value.candidate.actions = [];
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const reviewed = reviewDecisionBrief(packet, supported(packet));
    expect(reviewed?.facts).toHaveLength(2);
    expect(reviewed?.actions).toEqual([]);
    expect(briefEvidence(reviewed!)).toHaveLength(2);
  });

  it("accepts a zero-condition action for review without inventing an applicability condition", () => {
    const value = fixture();
    value.candidate.actions[0].conditions = [];
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    expect(reviewDecisionBrief(packet, supported(packet))?.actions).toEqual(["a1"]);
    expect(packet.candidate.actions[0].conditions).toEqual([]);
  });

  it.each([null, undefined, "unreviewed narrative", 7, true, []])("refuses non-object candidate %#", raw => {
    const value = fixture();
    expect(prepareDecisionBrief(value.input, raw, value.options, value.sources)).toBeUndefined();
  });

  it.each([
    ["additional summary", { summary: "An unreviewed claim" }],
    ["non-array facts", { facts: {} }], ["non-array actions", { actions: null }],
    ["string facts", { facts: "supported" }],
  ])("refuses candidate %s", (_name, patch) => {
    const value = fixture();
    expect(prepareDecisionBrief(value.input, { ...value.candidate, ...patch }, value.options, value.sources)).toBeUndefined();
  });

  it("requires facts even when actions are omitted", () => {
    const value = fixture();
    for (const raw of [{}, { actions: [] }]) {
      expect(prepareDecisionBrief(value.input, raw, value.options, value.sources)).toBeUndefined();
    }
  });

  it("normalizes only absent optional actions without changing facts or supplying a next step", () => {
    const value = fixture();
    const raw = { facts: value.candidate.facts };
    const before = structuredClone(raw);
    const packet = prepareDecisionBrief(value.input, raw, value.options, value.sources)!;
    const explicit = prepareDecisionBrief(value.input, { ...raw, actions: [] }, value.options, value.sources)!;
    expect(packet).toEqual(explicit);
    expect(packet.candidate.facts).toEqual(before.facts);
    expect(packet.candidate.actions).toEqual([]);
    expect(raw).toEqual(before);
    expect(Object.hasOwn(raw, "actions")).toBe(false);
    const verdict = supported(packet);
    expect(reviewDecisionBrief(packet, verdict)?.actions).toEqual([]);
    const missingReviewActions: Record<string, unknown> = { ...verdict };
    delete missingReviewActions.actions;
    expect(reviewDecisionBrief(packet, missingReviewActions)).toBeUndefined();
  });

  it.each([undefined, null, {}, "", false, 0])("does not normalize present malformed actions (%#)", actions => {
    const value = fixture();
    expect(prepareDecisionBrief(value.input, { facts: value.candidate.facts, actions }, value.options, value.sources)).toBeUndefined();
  });

  it("does not use absent actions to rescue unknown keys or invalid facts", () => {
    const value = fixture();
    expect(prepareDecisionBrief(value.input, { facts: value.candidate.facts, summary: "Unreviewed" }, value.options, value.sources)).toBeUndefined();
    expect(prepareDecisionBrief(value.input, { facts: [{ ...value.candidate.facts[0], quoteIds: ["foreign"] }] }, value.options, value.sources)).toBeUndefined();
  });

  const invalidFacts: [string, Record<string, unknown>][] = [
    ["unknown narrative", { explanation: "This is also a claim" }],
    ["zero ID", { id: "f0" }], ["wrong ID kind", { id: "a1" }], ["overlong ID number", { id: "f100" }],
    ["nonstring ID", { id: 1 }], ["padded ID", { id: " f1" }],
    ["negative target", { targetIndex: -1 }], ["foreign target", { targetIndex: 2 }],
    ["fractional target", { targetIndex: 0.5 }], ["string target", { targetIndex: "0" }],
    ["nonfinite target", { targetIndex: Infinity }],
    ["empty text", { text: "" }], ["blank text", { text: "  " }], ["nonstring text", { text: 12 }],
    ["361-unit text", { text: "x".repeat(361) }], ["control in text", { text: "Claim\nHidden extra clause" }],
    ["malformed text Unicode", { text: "Claim \uD800" }],
    ["empty quote list", { quoteIds: [] }], ["duplicate quote ID", { quoteIds: ["q0_0", "q0_0"] }],
    ["foreign quote ID", { quoteIds: ["q99_0"] }], ["raw quote instead of ID", { quoteIds: ["The exact source quotation."] }],
    ["four quote IDs", { quoteIds: ["q0_0", "q0_1", "q0_2", "q1_0"] }], ["nonarray quote IDs", { quoteIds: "q0_0" }],
    ["nonstring quote ID", { quoteIds: [1] }],
    ["negative support", { support: -0.01 }], ["over-one support", { support: 1.01 }],
    ["NaN support", { support: NaN }], ["infinite support", { support: Infinity }],
    ["numeric-string support", { support: "0.9" }], ["boolean support", { support: true }],
  ];
  it.each(invalidFacts)("refuses fact %s", (_name, patch) => {
    const value = fixture();
    const raw = { ...value.candidate, facts: [{ ...value.candidate.facts[0], ...patch }, value.candidate.facts[1]] };
    expect(prepareDecisionBrief(value.input, raw, value.options, value.sources)).toBeUndefined();
  });

  it.each(["id", "targetIndex", "text", "quoteIds", "support"])("requires fact field %s", field => {
    const value = fixture();
    const row: Record<string, unknown> = { ...value.candidate.facts[0] };
    delete row[field];
    expect(prepareDecisionBrief(value.input, { ...value.candidate, facts: [row] }, value.options, value.sources)).toBeUndefined();
  });

  const invalidActions: [string, Record<string, unknown>][] = [
    ["unreviewed rationale", { rationale: "An additional assertion" }],
    ["wrong ID kind", { id: "f1" }], ["zero ID", { id: "a0" }], ["overlong ID number", { id: "a100" }],
    ["empty text", { text: "" }], ["overlong text", { text: "x".repeat(361) }],
    ["control in text", { text: "Act\u0000now" }], ["malformed Unicode", { text: "Act \uDC00" }],
    ["empty premises", { premiseIds: [] }], ["duplicate premises", { premiseIds: ["f1", "f1"] }],
    ["foreign premise", { premiseIds: ["f3"] }], ["action as premise", { premiseIds: ["a1"] }],
    ["nonarray premises", { premiseIds: "f1" }],
    ["nonarray conditions", { conditions: "If applicable" }], ["three conditions", { conditions: ["If A", "If B", "If C"] }],
    ["empty condition", { conditions: [""] }], ["blank condition", { conditions: [" "] }],
    ["overlong condition", { conditions: ["x".repeat(181)] }], ["nonstring condition", { conditions: [12] }],
    ["control in condition", { conditions: ["If A\nassert B"] }], ["malformed condition Unicode", { conditions: ["If \uD800"] }],
  ];
  it.each(invalidActions)("refuses action %s", (_name, patch) => {
    const value = fixture();
    const raw = { ...value.candidate, actions: [{ ...value.candidate.actions[0], ...patch }] };
    expect(prepareDecisionBrief(value.input, raw, value.options, value.sources)).toBeUndefined();
  });

  it.each(["id", "text", "premiseIds", "conditions"])("requires action field %s", field => {
    const value = fixture();
    const row: Record<string, unknown> = { ...value.candidate.actions[0] };
    delete row[field];
    expect(prepareDecisionBrief(value.input, { ...value.candidate, actions: [row] }, value.options, value.sources)).toBeUndefined();
  });

  it("refuses duplicate fact IDs even if every quote ID exists", () => {
    const value = fixture();
    value.candidate.facts[1].id = "f1";
    expect(prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)).toBeUndefined();
  });

  it("refuses duplicate action IDs", () => {
    const value = fixture();
    value.candidate.actions.push({ ...value.candidate.actions[0] });
    expect(prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)).toBeUndefined();
  });

  it("refuses duplicate menu IDs even when the duplicate is not selected", () => {
    const value = fixture();
    value.options.push({ ...value.options.at(-1)! });
    expect(prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)).toBeUndefined();
  });

  it.each(["facts", "actions", "targets", "premises"])("refuses the %s count above its cap", kind => {
    const value = fixture();
    if (kind === "facts" || kind === "premises") value.candidate.facts = Array.from({ length: MAX_BRIEF_FACTS + 1 },
      (_, index) => ({ ...value.candidate.facts[0], id: `f${index + 1}` }));
    if (kind === "actions") value.candidate.actions = Array.from({ length: MAX_BRIEF_ACTIONS + 1 }, (_, index) => ({ ...value.candidate.actions[0], id: `a${index + 1}` }));
    if (kind === "targets") value.input.subClaims = Array.from({ length: 9 }, (_, index) => `Target ${index}`);
    if (kind === "premises") value.candidate.actions[0].premiseIds = ["f1", "f2", "f3", "f4", "f5"];
    expect(prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)).toBeUndefined();
  });
});

describe("complete decision-brief review and downward-only support", () => {
  it("accepts complete verdicts in a different order without changing fact identities", () => {
    const { packet } = prepared();
    const raw = supported(packet);
    raw.facts.reverse();
    const result = reviewDecisionBrief(packet, raw);
    expect(result?.facts.map(fact => fact.id).sort()).toEqual(["f1", "f2"]);
    expect(result?.actions).toEqual(["a1"]);
  });

  it.each([null, [], "approved", 1, false])("refuses malformed review %#", raw => {
    const { packet } = prepared();
    expect(reviewDecisionBrief(packet, raw)).toBeUndefined();
  });

  it.each(["digest", "facts", "actions"])("requires review field %s", field => {
    const { packet } = prepared();
    const raw: Record<string, unknown> = supported(packet);
    delete raw[field];
    expect(reviewDecisionBrief(packet, raw)).toBeUndefined();
  });

  it.each([
    ["unknown prose", { explanation: "An unreviewed answer" }], ["wrong digest", { digest: "a".repeat(64) }],
    ["nonstring digest", { digest: 7 }], ["nonarray facts", { facts: {} }], ["nonarray actions", { actions: "a1" }],
  ])("refuses review %s", (_name, patch) => {
    const { packet } = prepared();
    expect(reviewDecisionBrief(packet, { ...supported(packet), ...patch })).toBeUndefined();
  });

  const invalidFactReviews: [string, Record<string, unknown>][] = [
    ["unknown narrative", { explanation: "A new statement" }], ["rewritten fact text", { text: "Rewritten" }],
    ["foreign ID", { id: "f99" }], ["nonstring ID", { id: 1 }],
    ["unknown status", { status: "approved" }], ["wrong status case", { status: "Supported" }],
    ["nonstring status", { status: true }], ["string support", { support: "0.8" }],
    ["negative support", { support: -1 }], ["over-one support", { support: 1.01 }],
    ["NaN support", { support: NaN }], ["infinite support", { support: Infinity }],
  ];
  it.each(invalidFactReviews)("refuses the entire review for fact verdict %s", (_name, patch) => {
    const { packet } = prepared();
    const raw = supported(packet);
    expect(reviewDecisionBrief(packet, { ...raw, facts: [{ ...raw.facts[0], ...patch }, raw.facts[1]] })).toBeUndefined();
  });

  it.each([
    ["unknown prose", { explanation: "New action" }], ["rewritten conditions", { conditions: [] }],
    ["foreign ID", { id: "a99" }], ["nonstring ID", { id: 1 }],
    ["unknown status", { status: "approved" }], ["extra score", { support: 1 }],
  ])("refuses the entire review for action verdict %s", (_name, patch) => {
    const { packet } = prepared();
    const raw = supported(packet);
    expect(reviewDecisionBrief(packet, { ...raw, actions: [{ ...raw.actions[0], ...patch }] })).toBeUndefined();
  });

  it.each(["missing fact", "extra fact", "duplicate fact", "missing action", "extra action"])("refuses incomplete or ambiguous coverage: %s", kind => {
    const { packet } = prepared();
    const raw = supported(packet);
    if (kind === "missing fact") raw.facts.pop();
    if (kind === "extra fact") raw.facts.push({ ...raw.facts[0], id: "f3" });
    if (kind === "duplicate fact") raw.facts[1] = { ...raw.facts[0] };
    if (kind === "missing action") raw.actions.pop();
    if (kind === "extra action") raw.actions.push({ ...raw.actions[0] });
    expect(reviewDecisionBrief(packet, raw)).toBeUndefined();
  });

  it("refuses duplicate action verdicts even when the review count is exact", () => {
    const value = fixture();
    value.candidate.actions.push({ ...value.candidate.actions[0], id: "a2" });
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const raw = supported(packet);
    raw.actions[1] = { ...raw.actions[0] };
    expect(reviewDecisionBrief(packet, raw)).toBeUndefined();
  });

  it.each([
    ["review lowers estimate", 0.9, 0.6, 0.6], ["review cannot raise estimate", 0.6, 0.99, 0.6],
    ["both estimates exactly meet the boundary", 0.4, 0.4, 0.4],
  ])("%s", (_label, initial, reviewedScore, expected) => {
    const value = fixture();
    value.candidate.facts[0].support = initial;
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const raw = supported(packet);
    raw.facts[0].support = reviewedScore;
    const reviewed = reviewDecisionBrief(packet, raw)!;
    expect(reviewed.facts.find(fact => fact.id === "f1")?.support).toBe(expected);
    expect(briefEvidence(reviewed).find(evidence => evidence.claimIndex === 0)?.support).toBe(expected);
    expect(reviewed.actions).toEqual(["a1"]);
  });

  it.each([
    ["generation estimate below cutoff", 0.399, 1], ["review estimate below cutoff", 1, 0.399],
    ["generation estimate zero", 0, 1], ["review estimate zero", 1, 0],
  ])("removes the fact and dependent action when %s", (_label, initial, reviewedScore) => {
    const value = fixture();
    value.candidate.facts[0].support = initial;
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const raw = supported(packet);
    raw.facts[0].support = reviewedScore;
    const reviewed = reviewDecisionBrief(packet, raw)!;
    expect(reviewed.facts.map(fact => fact.id)).toEqual(["f2"]);
    expect(reviewed.actions).toEqual([]);
    expect(briefEvidence(reviewed).every(evidence => evidence.claimIndex !== 0)).toBe(true);
  });

  it.each(["unsupported", "insufficient"])("closes action dependencies when a high-score premise is %s", status => {
    const value = fixture();
    value.candidate.actions.push({ id: "a2", text: "Check whether the handler tolerates duplicates.", premiseIds: ["f2"], conditions: [] });
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const raw = supported(packet);
    raw.facts[0] = { ...raw.facts[0], status, support: 1 };
    const reviewed = reviewDecisionBrief(packet, raw)!;
    expect(reviewed.facts.map(fact => fact.id)).toEqual(["f2"]);
    expect(reviewed.actions).toEqual(["a2"]);
  });

  it.each(["unsupported", "insufficient"])("rejects an action assessed %s even if all premises survive", status => {
    const { packet } = prepared();
    const raw = supported(packet);
    raw.actions[0].status = status;
    const reviewed = reviewDecisionBrief(packet, raw)!;
    expect(reviewed.facts).toHaveLength(2);
    expect(reviewed.actions).toEqual([]);
  });

  it("cannot turn an all-rejected review into evidence or a useful accepted action", () => {
    const { packet } = prepared();
    const raw = supported(packet);
    raw.facts.forEach(fact => { fact.status = "unsupported"; fact.support = 1; });
    raw.actions[0].status = "supported";
    const reviewed = reviewDecisionBrief(packet, raw)!;
    expect(reviewed.facts).toEqual([]);
    expect(reviewed.actions).toEqual([]);
    expect(briefEvidence(reviewed)).toEqual([]);
  });

  it.each([
    ["reversed polarity", "The fictional queue never delivers duplicates."],
    ["invented quantity", "The fictional queue delivers at most three duplicate messages."],
    ["omitted qualification", "All queues deliver duplicate messages."],
    ["missing evidence as absence", "The experiment proves that expiry failures cannot happen."],
    ["unsupported causal clause", "The queue delivers duplicates because retry handlers use a global lock."],
    ["scope or version substitution", "The current production provider guarantees this fictional result."],
  ])("propagates an independent rejection of %s without retaining its dependent action", (_name, unsupportedText) => {
    const value = fixture();
    value.candidate.facts[0].text = unsupportedText;
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    // Semantic determination is explicitly supplied by a reviewer. These cases do
    // not pretend literal quote binding or a deterministic test detects entailment.
    const raw = supported(packet);
    raw.facts[0].status = "unsupported";
    const reviewed = reviewDecisionBrief(packet, raw)!;
    expect(reviewed.facts.map(fact => fact.id)).toEqual(["f2"]);
    expect(reviewed.actions).toEqual([]);
    expect(briefEvidence(reviewed)).toHaveLength(1);
  });

  it("lets the reviewer reject a factual assumption hidden in a condition while retaining facts", () => {
    const value = fixture();
    value.candidate.actions[0].conditions = ["Since your production handler already guarantees exactly-once effects."];
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const raw = supported(packet);
    raw.actions[0].status = "unsupported";
    const reviewed = reviewDecisionBrief(packet, raw)!;
    expect(reviewed.packet.candidate.actions[0].conditions).toEqual(value.candidate.actions[0].conditions);
    expect(reviewed.facts).toHaveLength(2);
    expect(reviewed.actions).toEqual([]);
  });

  it("clones the reviewed packet independently of later packet or verdict mutation", () => {
    const { packet } = prepared();
    const raw = supported(packet);
    const reviewed = reviewDecisionBrief(packet, raw)!;
    packet.candidate.facts[0].text = "Changed after review";
    raw.facts[0].support = 0;
    raw.facts[0].quotes[0].support = 0;
    expect(validBriefPacket(reviewed.packet)).toBe(true);
    expect(reviewed.facts[0].support).toBe(0.9);
    expect(reviewed.facts[0].quoteSupports).toEqual([{ quoteId: "q0_0", support: 0.9 }]);
    expect(briefEvidence(reviewed)[0].quote).toBe("The fictional queue may deliver duplicate messages.");
  });
});

describe("separate quote contribution admission", () => {
  it.each([undefined, null, "supported", {}, []])("requires complete quote reviews, not a fact-only score (%#)", quotes => {
    const { packet } = prepared();
    const raw = supported(packet);
    expect(reviewDecisionBrief(packet, { ...raw, facts: [{ ...raw.facts[0], quotes }, raw.facts[1]] })).toBeUndefined();
  });

  it("refuses a missing quotes key even on a rejected fact", () => {
    const { packet } = prepared();
    const raw = supported(packet);
    const first: Record<string, unknown> = { ...raw.facts[0], status: "unsupported" };
    delete first.quotes;
    expect(reviewDecisionBrief(packet, { ...raw, facts: [first, raw.facts[1]] })).toBeUndefined();
  });

  it.each([
    ["unknown prose", { rationale: "An unreviewed explanation" }],
    ["rewritten quote", { text: "A replacement quotation" }],
    ["foreign menu ID", { quoteId: "q99_0" }],
    ["another fact's valid menu ID", { quoteId: "q0_1" }],
    ["nonstring quote ID", { quoteId: 0 }],
    ["unknown status", { status: "approved" }],
    ["nonstring status", { status: true }],
    ["numeric string", { support: "0.8" }],
    ["negative score", { support: -0.1 }],
    ["over-one score", { support: 1.1 }],
    ["NaN score", { support: NaN }],
    ["infinite score", { support: Infinity }],
  ])("refuses the entire review for a quote verdict with %s", (_name, patch) => {
    const { packet } = prepared();
    const raw = supported(packet);
    expect(reviewDecisionBrief(packet, { ...raw, facts: [
      { ...raw.facts[0], quotes: [{ ...raw.facts[0].quotes[0], ...patch }] }, raw.facts[1],
    ] })).toBeUndefined();
  });

  it.each(["quoteId", "status", "support"])("requires quote verdict field %s", field => {
    const { packet } = prepared();
    const raw = supported(packet);
    const quote: Record<string, unknown> = { ...raw.facts[0].quotes[0] };
    delete quote[field];
    expect(reviewDecisionBrief(packet, { ...raw, facts: [
      { ...raw.facts[0], quotes: [quote] }, raw.facts[1],
    ] })).toBeUndefined();
  });

  it.each(["missing", "extra", "duplicate"])("refuses %s per-fact quote coverage", mode => {
    const value = fixture();
    value.candidate.facts[0].quoteIds = ["q0_0", "q0_1"];
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const raw = supported(packet);
    if (mode === "missing") raw.facts[0].quotes.pop();
    if (mode === "extra") raw.facts[0].quotes.push({ quoteId: "q0_2", status: "supported", support: 1 });
    if (mode === "duplicate") raw.facts[0].quotes[1] = { ...raw.facts[0].quotes[0] };
    expect(reviewDecisionBrief(packet, raw)).toBeUndefined();
  });

  it("keeps each quote's score attached to its ID when review order changes", () => {
    const value = fixture();
    value.candidate.facts[0].quoteIds = ["q0_0", "q0_1"];
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const raw = supported(packet);
    raw.facts[0].quotes = [
      { quoteId: "q0_1", status: "supported", support: 0.45 },
      { quoteId: "q0_0", status: "supported", support: 0.7 },
    ];
    const reviewed = reviewDecisionBrief(packet, raw)!;
    expect(briefEvidence(reviewed).filter(row => row.claimIndex === 0)).toEqual([
      { claimIndex: 0, marker: "S1", quote: "The fictional queue may deliver duplicate messages.", quoteSpan: { start: 0, end: 51 }, support: 0.7 },
      { claimIndex: 0, marker: "S1", quote: "Retry handlers must tolerate duplicates.", quoteSpan: { start: 52, end: 92 }, support: 0.45 },
    ]);
  });

  it.each([
    ["generation ceiling", 0.6, 0.95, 0.99, 0.6],
    ["full-fact review ceiling", 0.95, 0.7, 0.99, 0.7],
    ["quote review ceiling", 0.95, 0.9, 0.5, 0.5],
    ["exact admission boundary", 0.95, 0.9, 0.4, 0.4],
  ])("cannot promote quote evidence beyond the %s", (_name, generated, factScore, quoteScore, expected) => {
    const value = fixture();
    value.candidate.facts[0].support = generated;
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const raw = supported(packet);
    raw.facts[0].support = factScore;
    raw.facts[0].quotes[0].support = quoteScore;
    const reviewed = reviewDecisionBrief(packet, raw)!;
    expect(briefEvidence(reviewed).find(row => row.claimIndex === 0)?.support).toBe(expected);
  });

  it.each([
    ["unsupported", 1], ["insufficient", 1], ["supported", 0.399], ["supported", 0],
  ])("withholds an unrelated paid-source quote and every leg of its fact for %s/%s", (status, support) => {
    const value = fixture();
    value.input.gathered[1].text = "An unrelated fictional service bills monthly.";
    const sources = evidenceContext(value.input.question, value.input.subClaims, value.input.gathered);
    const options = buildContextualQuoteOptions(sources, value.input.gathered);
    value.candidate.facts[0].quoteIds = ["q0_0", "q1_0"];
    value.candidate.actions.push({ id: "a2", text: "Check handler tolerance for duplicates.", premiseIds: ["f2"], conditions: [] });
    const packet = prepareDecisionBrief(value.input, value.candidate, options, sources)!;
    const raw = supported(packet);
    // The full assertion is supported by S1. That cannot grant S2 a payment
    // contribution: the separately supplied quote assessment rejects this leg.
    raw.facts[0].support = 1;
    raw.facts[0].quotes[1] = { quoteId: "q1_0", status: String(status), support: Number(support) };
    const reviewed = reviewDecisionBrief(packet, raw)!;
    expect(reviewed.facts.map(fact => fact.id)).toEqual(["f2"]);
    expect(reviewed.actions).toEqual(["a2"]);
    const evidence = briefEvidence(reviewed);
    expect(evidence).toEqual([{ claimIndex: 1, marker: "S1", quote: "Retry handlers must tolerate duplicates.", quoteSpan: { start: 52, end: 92 }, support: 0.8 }]);
    const ledger = buildEvidenceLedger({ subClaims: value.input.subClaims, gathered: value.input.gathered,
      answer: "[S1] [S2]", declaredMarkers: ["S1", "S2"], proposedEvidence: evidence,
      finalAssessment: value.input.subClaims.map(claim => ({ claim, coverage: 1, coveredBy: ["S1", "S2"] })),
    });
    expect([...ledger.acceptedMarkers]).toEqual(["S1"]);
    expect(ledger.evidence.filter(row => row.qualifiesForReward).map(row => row.sourceId)).toEqual(["internal-queue"]);
    expect(ledger.claimCoverage[0].coverage).toBe(0);
  });

  it("does not reuse a quote approval from another fact or target", () => {
    const value = fixture();
    value.candidate.facts[1].quoteIds = ["q0_0"];
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const raw = supported(packet);
    raw.facts[0].quotes[0].status = "insufficient";
    const reviewed = reviewDecisionBrief(packet, raw)!;
    expect(reviewed.facts.map(fact => fact.id)).toEqual(["f2"]);
    expect(reviewed.actions).toEqual([]);
    expect(briefEvidence(reviewed).map(row => row.claimIndex)).toEqual([1]);
  });
});

describe("aggregate context budget across several reads", () => {
  const targets = ["Does the accounting API support writing payments?", "What authorization safeguards protect payment writes?",
    "Where does the payment API fall short?"];
  const filler = (seed: number) => Array.from({ length: 6 }, (_, index) =>
    `Section ${seed}.${index} describes installation, configuration and reporting screens in ordinary detail for administrators.`).join(" ");
  // Fictional documentation pages: relevant sentences spread between unrelated paragraphs.
  const page = (seed: number) => Array.from({ length: 6 }, (_, index) => filler(seed * 10 + index) + "\n\n" +
    `The accounting API ${seed} supports writing payments through a REST endpoint with idempotency keys. ` +
    `Authorization safeguards for payment writes include scoped tokens and approval workflows. ` +
    `The payment API falls short on bulk reconciliation and has limitations for multi-currency writes.`).join("\n\n");
  function budgeted(reads: number) {
    const input: SynthInput = { question: "Which accounting systems have an API an agent can safely write payments to?", subClaims: targets,
      gathered: Array.from({ length: reads }, (_, index) => ({ sourceId: `doc-${index}`, sourceName: `Fictional doc ${index}`,
        marker: `S${index + 1}`, text: page(index + 1) })) };
    const selected = evidenceContext(input.question, input.subClaims, input.gathered);
    const offered = buildContextualQuoteOptions(selected, input.gathered);
    const sources = briefContextSources(selected, input, offered);
    return { input, offered, sources, menu: briefQuoteMenu(offered, sources) };
  }
  const characters = (sources: ReturnType<typeof budgeted>["sources"]) =>
    sources.flatMap(source => source.quoteContexts!).reduce((sum, span) => sum + span.text.length, 0);

  it("admits every offered quote while the reads fit", () => {
    const { offered, sources, menu } = budgeted(4);
    expect(characters(sources)).toBeLessThanOrEqual(12_000);
    expect(menu).toEqual(offered);
    expect(sources.some(source => "withheldQuoteOptions" in source)).toBe(false);
  });

  it("keeps untrimmed context from every read inside the bound and counts the quotes it withheld", () => {
    const { input, offered, sources, menu } = budgeted(7);
    expect(characters(sources)).toBeLessThanOrEqual(12_000);
    for (const source of sources) {
      const original = input.gathered.find(read => read.marker === source.marker)!;
      const mine = offered.filter(quote => quote.marker === source.marker);
      expect(source.quoteContexts!.length).toBeGreaterThan(0);
      for (const span of source.quoteContexts!) expect(original.text.slice(span.start, span.end)).toBe(span.text);
      expect(source.withheldQuoteOptions ?? 0).toBe(mine.filter(quote => !menu.includes(quote)).length);
      // Selected passages stay visible to both passes even when their quotes are withheld.
      expect(source.passages.length).toBeGreaterThan(0);
    }
    expect(menu.length).toBeGreaterThan(0);
    expect(menu.length).toBeLessThan(offered.length);
    for (const quote of menu) {
      const span = sources.find(source => source.marker === quote.marker)!.quoteContexts!
        .find(span => span.start <= quote.contextStart && span.end >= quote.contextEnd)!;
      expect(span.text.slice(quote.contextStart - span.start, quote.contextEnd - span.start)).toBe(quote.context);
    }
  });

  it("cannot cite a withheld quote", () => {
    const { input, offered, sources, menu } = budgeted(7);
    const withheld = offered.find(quote => !menu.includes(quote))!;
    const fact = (quoteId: string) => ({ facts: [{ id: "f1", targetIndex: 0, text: "The API supports writing payments.", quoteIds: [quoteId], support: 0.8 }] });
    expect(prepareDecisionBrief(input, fact(menu[0].quoteId), menu, sources)).toBeDefined();
    expect(prepareDecisionBrief(input, fact(withheld.quoteId), menu, sources)).toBeUndefined();
  });
});

describe("lossless decision-brief review wire projection", () => {
  function withSharedContexts() {
    const value = fixture();
    value.input.gathered[0].text = "The fictional queue may deliver duplicate messages. Retry handlers must tolerate duplicates. " +
      "A separate limitation remains relevant: r\u00e9sum\u00e9 \u{1f310} is test text, not a delivery guarantee.";
    const sources = evidenceContext(value.input.question, value.input.subClaims, value.input.gathered);
    const options = buildContextualQuoteOptions(sources, value.input.gathered);
    const shared = briefContextSources(sources, value.input, options);
    return { ...value, sources: shared, options };
  }

  it("reconstructs every omitted context byte-for-byte at its UTF-16 offsets while preserving adverse sources", () => {
    const value = withSharedContexts();
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const before = structuredClone(packet);
    const projected = briefReviewPacket(packet);
    // Exercise the actual JSON boundary rather than relying on object identity.
    const wire = JSON.parse(JSON.stringify(projected)) as typeof projected;
    expect(wire.quotes.every(quote => !("context" in quote))).toBe(true);
    const recovered = wire.quotes.map(quote => {
      const source = wire.sources.find(source => source.marker === quote.marker)!;
      const span = source.quoteContexts!.find(span => span.start <= quote.contextStart && span.end >= quote.contextEnd)!;
      return { ...quote, context: span.text.slice(quote.contextStart - span.start, quote.contextEnd - span.start) };
    });
    expect(recovered).toEqual(packet.quotes);
    expect(wire.sources).toEqual(packet.sources);
    expect(wire.sources[1].passages[0].text).toContain("does not evaluate exactly-once effects");
    expect(wire.sources[0].quoteContexts![0].text).toContain("r\u00e9sum\u00e9 \u{1f310}");
    expect(wire.candidate).toEqual(packet.candidate);
    expect(wire.digest).toBe(packet.digest);
    expect(Buffer.byteLength(JSON.stringify(wire), "utf8")).toBeLessThan(Buffer.byteLength(JSON.stringify(packet), "utf8"));
    expect(packet).toEqual(before);
    expect(validBriefPacket(packet)).toBe(true);
  });

  it.each(["missing shared context", "wrong marker", "wrong exact offsets", "changed text", "partial context"])("retains full quote context for %s", mode => {
    const value = withSharedContexts();
    const source = value.sources[0];
    const span = source.quoteContexts![0];
    if (mode === "missing shared context") delete source.quoteContexts;
    if (mode === "wrong marker") source.marker = "foreign";
    if (mode === "wrong exact offsets") { span.start++; span.end++; }
    if (mode === "changed text") span.text = "!" + span.text.slice(1);
    if (mode === "partial context") { span.end--; span.text = span.text.slice(0, -1); }
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const projected = briefReviewPacket(packet);
    expect(projected.quotes).toEqual(packet.quotes);
    expect(validBriefPacket(packet)).toBe(true);
  });

  it("retains separate source gaps and omission flags instead of inventing contiguous context", () => {
    const value = fixture();
    value.input.gathered[0].text = "The fictional queue may deliver duplicate messages.\n\n" +
      "Unselected middle context. ".repeat(100) + "\n\nRetry handlers must tolerate duplicates.";
    const sources = evidenceContext(value.input.question, value.input.subClaims, value.input.gathered);
    const options = buildContextualQuoteOptions(sources, value.input.gathered);
    const early = options.find(option => option.text.includes("queue may"))!;
    const late = options.find(option => option.text.includes("handlers must"))!;
    expect(early.contextEnd).toBeLessThan(late.contextStart);
    value.candidate.facts[0].quoteIds = [early.quoteId];
    value.candidate.facts[1].quoteIds = [late.quoteId];
    const shared = briefContextSources(sources, value.input, [early, late]);
    const packet = prepareDecisionBrief(value.input, value.candidate, [early, late], shared)!;
    const wire = briefReviewPacket(packet);
    expect(wire.sources[0].quoteContexts).toHaveLength(2);
    expect(wire.quotes.map(({ contextStart, contextEnd, prefixOmitted, suffixOmitted }) =>
      ({ contextStart, contextEnd, prefixOmitted, suffixOmitted }))).toEqual(
      packet.quotes.map(({ contextStart, contextEnd, prefixOmitted, suffixOmitted }) =>
        ({ contextStart, contextEnd, prefixOmitted, suffixOmitted })));
    expect(wire.quotes[0].suffixOmitted).toBe(true);
    expect(wire.quotes[1].prefixOmitted).toBe(true);
  });

  it("projects a recursively frozen packet without mutation and refuses a stale digest", () => {
    const value = withSharedContexts();
    const packet = prepareDecisionBrief(value.input, value.candidate, value.options, value.sources)!;
    const before = structuredClone(packet);
    function freeze(value: unknown): void {
      if (!value || typeof value !== "object") return;
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    freeze(packet);
    expect(() => briefReviewPacket(packet)).not.toThrow();
    expect(packet).toEqual(before);
    const tampered = structuredClone(packet);
    tampered.sources[0].quoteContexts![0].text += " Invented guarantee.";
    expect(() => briefReviewPacket(tampered)).toThrow("packet changed");
  });
});

describe("immutable decision-brief review packet", () => {
  const mutations: [string, (packet: BriefPacket) => void][] = [
    ["question", packet => { packet.question = "A different user goal"; }],
    ["target", packet => { packet.targets[0] = "A different target"; }],
    ["fact text", packet => { packet.candidate.facts[0].text = "A rewritten assertion"; }],
    ["fact target", packet => { packet.candidate.facts[0].targetIndex = 1; }],
    ["fact quote IDs", packet => { packet.candidate.facts[0].quoteIds = ["q0_1"]; }],
    ["fact support", packet => { packet.candidate.facts[0].support = 1; }],
    ["action text", packet => { packet.candidate.actions[0].text = "A rewritten action"; }],
    ["action premises", packet => { packet.candidate.actions[0].premiseIds = ["f2"]; }],
    ["action condition", packet => { packet.candidate.actions[0].conditions[0] = "A hidden new assumption"; }],
    ["quote text", packet => { packet.quotes[0].text = "A substituted quotation"; }],
    ["quote offset", packet => { packet.quotes[0].start += 1; }],
    ["quote marker", packet => { packet.quotes[0].marker = "S2"; }],
    ["quote context", packet => { packet.quotes[0].context += " An invented guarantee."; }],
    ["context omission flag", packet => { packet.quotes[0].prefixOmitted = !packet.quotes[0].prefixOmitted; }],
    ["adverse passage", packet => { packet.sources[1].passages[0].text = "Removed adverse evidence"; }],
    ["source identity", packet => { packet.sources[0].sourceId = "foreign-source"; }],
    ["digest", packet => { packet.digest = "0".repeat(64); }],
  ];
  it.each(mutations)("refuses a stale digest after tampering with %s", (_name, mutate) => {
    const { packet } = prepared();
    const raw = supported(packet);
    mutate(packet);
    expect(validBriefPacket(packet)).toBe(false);
    expect(reviewDecisionBrief(packet, raw)).toBeUndefined();
  });

  it("does not accept a review for a different freshly prepared packet", () => {
    const first = prepared();
    const second = fixture();
    second.candidate.actions[0].conditions = ["If a separate fictional version applies."];
    const secondPacket = prepareDecisionBrief(second.input, second.candidate, second.options, second.sources)!;
    expect(secondPacket.digest).not.toBe(first.packet.digest);
    expect(reviewDecisionBrief(secondPacket, supported(first.packet))).toBeUndefined();
  });
});
