import { describe, expect, it } from "vitest";
import { prepareDecisionBrief, reviewDecisionBrief, type BriefPacket } from "./decision-brief";
import { evidenceContext } from "./evidence-context";
import { buildContextualQuoteOptions } from "./quote-context";
import type { SynthInput } from "./reasoning-engine";

function fixture() {
  const input: SynthInput = { question: "What do the fictional queue and handler establish?",
    subClaims: ["Are duplicates possible?", "What must handlers tolerate?"], gathered: [{ sourceId: "queue",
      sourceName: "Internal queue", marker: "S1", text: "The queue may deliver duplicates. Handlers must tolerate duplicate messages." }] };
  const sources = evidenceContext(input.question, input.subClaims, input.gathered);
  const options = buildContextualQuoteOptions(sources, input.gathered);
  return prepareDecisionBrief(input, { facts: [
    { id: "f1", targetIndex: 0, text: "Duplicate delivery is possible.", quoteIds: ["q0_0"], support: 0.8 },
    { id: "f2", targetIndex: 1, text: "Handlers must tolerate duplicate messages.", quoteIds: ["q0_1"], support: 0.7 },
  ], actions: [{ id: "a1", text: "Check whether the handler tolerates duplicates.", premiseIds: ["f1", "f2"], conditions: [] }] }, options, sources)!;
}

function legacy(packet: BriefPacket) {
  return { digest: packet.digest, facts: packet.candidate.facts.map(fact => ({ id: fact.id, status: "supported", support: 1,
    quotes: fact.quoteIds.map(quoteId => ({ quoteId, status: "supported", support: 0.6 })) })),
    actions: packet.candidate.actions.map(action => ({ id: action.id, status: "supported" })),
  };
}

function compact(packet: BriefPacket) {
  const value = legacy(packet);
  return { format: "compact-v1", digest: value.digest,
    facts: value.facts.map(fact => [fact.id, fact.status, fact.support,
      fact.quotes.map(quote => [quote.quoteId, quote.status, quote.support])]),
    actions: value.actions.map(action => [action.id, action.status]),
  };
}

describe("compact decision brief reviews preserve exact review authority", () => {
  it("projects the same explicit fact, action and per-quote verdicts with smaller output", () => {
    const packet = fixture();
    const value = compact(packet);
    expect(reviewDecisionBrief(packet, value)).toEqual(reviewDecisionBrief(packet, legacy(packet)));
    expect(reviewDecisionBrief(packet, value)?.facts).toEqual([
      { id: "f1", support: 0.8, quoteSupports: [{ quoteId: "q0_0", support: 0.6 }] },
      { id: "f2", support: 0.7, quoteSupports: [{ quoteId: "q0_1", support: 0.6 }] },
    ]);
    expect(Buffer.byteLength(JSON.stringify(value), "utf8"))
      .toBeLessThan(Buffer.byteLength(JSON.stringify(legacy(packet)), "utf8"));
  });

  it.each(["unsupported", "insufficient"])("withholds a fact, its quote contribution and dependent action for %s", status => {
    const packet = fixture();
    const value = compact(packet);
    const quotes = value.facts[0][3] as unknown[][];
    quotes[0][1] = status;
    const reviewed = reviewDecisionBrief(packet, value)!;
    expect(reviewed.facts.map(fact => fact.id)).toEqual(["f2"]);
    expect(reviewed.actions).toEqual([]);
  });

  const invalid: [string, (value: ReturnType<typeof compact>) => void][] = [
    ["unknown version", value => { value.format = "compact-v2"; }],
    ["missing format", value => { delete (value as Partial<typeof value>).format; }],
    ["foreign digest", value => { value.digest = "0".repeat(64); }],
    ["missing fact", value => { value.facts.pop(); }],
    ["duplicate fact", value => { value.facts[1] = [...value.facts[0]]; }],
    ["foreign fact", value => { value.facts[0][0] = "f99"; }],
    ["incomplete fact tuple", value => { value.facts[0].pop(); }],
    ["extra fact field", value => { value.facts[0].push("unreviewed narrative"); }],
    ["unknown fact status", value => { value.facts[0][1] = "approved"; }],
    ["string fact score", value => { value.facts[0][2] = "1"; }],
    ["nonfinite fact score", value => { value.facts[0][2] = Infinity; }],
    ["missing quote", value => { (value.facts[0][3] as unknown[][]).pop(); }],
    ["duplicate quote", value => { const quotes = value.facts[0][3] as unknown[][]; quotes.push([...quotes[0]]); }],
    ["foreign quote", value => { (value.facts[0][3] as unknown[][])[0][0] = "q99_0"; }],
    ["quote from another fact", value => { (value.facts[0][3] as unknown[][])[0][0] = "q0_1"; }],
    ["incomplete quote tuple", value => { (value.facts[0][3] as unknown[][])[0].pop(); }],
    ["extra quote field", value => { (value.facts[0][3] as unknown[][])[0].push("extra"); }],
    ["missing quote status", value => { (value.facts[0][3] as unknown[][])[0][1] = undefined; }],
    ["string quote score", value => { (value.facts[0][3] as unknown[][])[0][2] = "1"; }],
    ["missing action", value => { value.actions.pop(); }],
    ["duplicate action", value => { value.actions.push([...value.actions[0]]); }],
    ["foreign action", value => { value.actions[0][0] = "a99"; }],
    ["incomplete action tuple", value => { value.actions[0].pop(); }],
    ["extra action field", value => { value.actions[0].push("extra"); }],
    ["unknown action status", value => { value.actions[0][1] = "approved"; }],
  ];
  it.each(invalid)("refuses %s without defaulting any omission to support", (_name, mutate) => {
    const packet = fixture();
    const value = compact(packet);
    mutate(value);
    expect(reviewDecisionBrief(packet, value)).toBeUndefined();
  });

  it("refuses additional narrative keys and mixed object/tuple rows", () => {
    const packet = fixture();
    expect(reviewDecisionBrief(packet, { ...compact(packet), summary: "An unreviewed statement" })).toBeUndefined();
    expect(reviewDecisionBrief(packet, { ...compact(packet), facts: legacy(packet).facts })).toBeUndefined();
  });
});
