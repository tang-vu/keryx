import { describe, expect, it, vi } from "vitest";
import { buildDraftCheck, MAX_DRAFT_CHECK_BYTES, type DraftCheckRequest } from "./draft-check";
import { splitDraftClaims } from "./draft-check-claims";
import { detectDraftReferenceFormat, parseDraftReferences } from "./draft-check-references";
import { lexicalSupport, prepareDraftSource } from "./draft-check-support";
import { draftCheckTool } from "./draft-check-tool";
import { draftCheckFixture } from "./fixtures/draft-check";

const BIBTEX = String.raw`@comment{ignored}
@article{lewis2020, title={Retrieval-{A}ugmented Generation}, author={Lewis, Patrick and Perez, Ethan}, year={2020}, doi={https://doi.org/10.5555/ABC.1}}
@inproceedings{smith2014,
  title = "Dropout: A Simple Way",
  author = "Nitish Smith and Geoffrey Hinton",
  year = 2014,
  url = {https://example.org/dropout},
}
@misc{bare, note={nothing useful}}
@book{broken, title={Unterminated`;
const request = (changes: Partial<DraftCheckRequest>): DraftCheckRequest => ({ ...draftCheckFixture(), ...changes });

describe("reference lists", () => {
  it("reads BibTeX entries and reports entries it cannot identify", () => {
    expect(detectDraftReferenceFormat(BIBTEX)).toBe("bibtex");
    expect(parseDraftReferences("bibtex", BIBTEX)).toEqual([
      { key: "lewis2020", number: 1, status: "identified", title: "Retrieval-Augmented Generation", authorFamilies: ["Lewis", "Perez"], year: "2020", doi: "10.5555/abc.1" },
      { key: "smith2014", number: 2, status: "identified", title: "Dropout: A Simple Way", authorFamilies: ["Smith", "Hinton"], year: "2014", url: "https://example.org/dropout" },
      { key: "bare", number: 3, status: "unresolved", problem: "no-identifier", authorFamilies: [] },
      { key: "broken", number: 4, status: "unresolved", problem: "unreadable-entry", authorFamilies: [] },
    ]);
  });
  it("reads RIS records, flags an unterminated record and duplicate keys", () => {
    const ris = "TY  - JOUR\nID  - a1\nAU  - Lewis, Patrick\nTI  - Retrieval study\nPY  - 2020/05/01\nDO  - 10.5555/abc.1\nER  - \nTY  - JOUR\nID  - a1\nT1  - Second\nUR  - http://insecure.example/x\nER  - \nTY  - BOOK\nTI  - Never closed";
    expect(detectDraftReferenceFormat(ris)).toBe("ris");
    const rows = parseDraftReferences("ris", ris);
    expect(rows[0]).toMatchObject({ key: "a1", status: "unresolved", problem: "duplicate-key", authorFamilies: ["Lewis"], year: "2020", doi: "10.5555/abc.1" });
    // An http link is not accepted as a locator; the duplicate key cannot be cited unambiguously.
    expect(rows[1]).toMatchObject({ key: "a1#2", status: "unresolved", problem: "duplicate-key" });
    expect(rows[1]).not.toHaveProperty("url");
    expect(rows[2]).toMatchObject({ key: "ref3", status: "unresolved", problem: "unreadable-entry" });
  });
  it("reads one DOI, link or formatted citation per line without resolving any of them", () => {
    const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    const rows = parseDraftReferences("list", "1. 10.5555/abc.1\n\n[2] https://example.org/paper.\nLewis, P. (2019). A described work without a locator.\n???");
    expect(rows.map(row => [row.key, row.status, row.doi ?? row.url ?? row.problem])).toEqual([
      ["ref1", "identified", "10.5555/abc.1"], ["ref2", "identified", "https://example.org/paper"],
      ["ref3", "described", "no-identifier"], ["ref4", "unresolved", "no-identifier"]]);
    expect(rows[2]).toMatchObject({ authorFamilies: ["Lewis"], year: "2019" });
    expect(http).not.toHaveBeenCalled(); http.mockRestore();
  });
  it("refuses more than 64 references", () => {
    expect(() => parseDraftReferences("list", Array.from({ length: 65 }, (_, index) => `10.5555/x.${index}`).join("\n"))).toThrow();
  });
});

describe("claim spans and citation markers", () => {
  const references = parseDraftReferences("bibtex", BIBTEX);
  const split = (passage: string) => splitDraftClaims(passage, references).map(claim => ({ text: passage.slice(claim.start, claim.end),
    targets: claim.markers.flatMap(marker => marker.targets.map(target => target.reference ?? `${target.problem}:${target.token}`)) }));
  it("keeps exact sentence spans, including a marker written after the full stop", () => {
    expect(split("First result holds [1]. Second result holds.[2] Third has none.\nSmith et al. (2014) agree, e.g. in Fig. 3 of the paper.")).toEqual([
      { text: "First result holds [1].", targets: ["lewis2020"] },
      { text: "Second result holds.[2]", targets: ["smith2014"] },
      { text: "Third has none.", targets: [] },
      { text: "Smith et al. (2014) agree, e.g. in Fig. 3 of the paper.", targets: ["smith2014"] },
    ]);
  });
  it("binds numeric lists and ranges, LaTeX keys and Pandoc keys, and reports what it cannot bind", () => {
    expect(split(String.raw`Both agree [1, 2] and others [1-3, 9]. Keys work \citep[p. 4]{lewis2020, nokey} and [@smith2014; @ghost]. Intervals like [0, 1] are prose.`)).toEqual([
      { text: "Both agree [1, 2] and others [1-3, 9].", targets: ["lewis2020", "smith2014", "lewis2020", "smith2014", "bare", "unresolved:9"] },
      { text: String.raw`Keys work \citep[p. 4]{lewis2020, nokey} and [@smith2014; @ghost].`, targets: ["lewis2020", "unresolved:nokey", "smith2014", "unresolved:ghost"] },
      { text: "Intervals like [0, 1] are prose.", targets: [] },
    ]);
  });
  it("binds author-year citations by first author and year and never guesses another year", () => {
    expect(split("As shown (Lewis et al., 2020; Smith and Hinton, 2014, pp. 3-4). Lewis (2019) differs. In March (2020) nothing happened. Unknown (Brown, 2001).")).toEqual([
      { text: "As shown (Lewis et al., 2020; Smith and Hinton, 2014, pp. 3-4).", targets: ["lewis2020", "smith2014"] },
      { text: "Lewis (2019) differs.", targets: ["year-differs:Lewis 2019"] },
      { text: "In March (2020) nothing happened.", targets: [] },
      { text: "Unknown (Brown, 2001).", targets: ["unresolved:Brown 2001"] },
    ]);
  });
  it("refuses more than 128 claims rather than truncating the passage", () => {
    expect(() => splitDraftClaims("A b c. ".repeat(129), references)).toThrow();
  });
});

describe("lexical support", () => {
  const source = prepareDraftSource("The cohort was large.\nThe intervention did not reduce readmission rates in elderly patients. Costs rose by 12 percent in 2019.");
  it("quotes an exact slice of the supplied text", () => {
    const result = lexicalSupport("Costs rose by 12% in 2019", source);
    expect(result.verdict).toBe("supported");
    expect(source.text.slice(result.excerpt!.start, result.excerpt!.end)).toBe(result.excerpt!.text);
    expect(result.excerpt!.text).toBe("Costs rose by 12 percent in 2019.");
  });
  it("never counts a negated, opposite or differently numbered passage as support", () => {
    expect(lexicalSupport("The intervention reduced readmission rates in elderly patients", source))
      .toMatchObject({ verdict: "not-found", closest: { difference: "negation", text: "The intervention did not reduce readmission rates in elderly patients." } });
    expect(lexicalSupport("Costs rose by 21 percent in 2019", source)).toMatchObject({ verdict: "not-found", missingNumbers: ["21"], closest: { difference: "different-number" } });
    expect(lexicalSupport("Costs fell by 12 percent in 2019", prepareDraftSource("Costs rose by 12 percent in 2019."))).toMatchObject({ verdict: "partly-supported", missingTerms: ["fell"] });
    expect(lexicalSupport("Wage increases decreased employment", prepareDraftSource("Wage increases increased employment.")))
      .toMatchObject({ verdict: "not-found", closest: { difference: "opposite-term" } });
  });
  it("withholds supported for an unstated figure, a tentative source and a two-word claim", () => {
    expect(lexicalSupport("Costs rose by 12 percent in 2019 across 40 clinics", prepareDraftSource("Costs rose in 2019 across clinics.")))
      .toMatchObject({ verdict: "partly-supported", missingNumbers: ["12", "40"] });
    expect(lexicalSupport("The coating prevents bacterial growth", prepareDraftSource("The coating may prevent bacterial growth.")))
      .toMatchObject({ verdict: "partly-supported", sourceTentative: true });
    expect(lexicalSupport("Costs rose", prepareDraftSource("Costs rose sharply."))).toMatchObject({ verdict: "partly-supported" });
    expect(lexicalSupport("Glaciers retreated", source)).toEqual({ verdict: "not-found", missingTerms: ["glaciers", "retreated"], missingNumbers: [] });
  });
  it.each([
    ["Women had 60% recovery and men had 40% recovery", "Men had 60% recovery and women had 40% recovery."],
    ["Women had 60.5 percent recovery and men had 40.5 percent recovery", "Men had 60.5 percent recovery and women had 40.5 percent recovery."],
    ["Women had 60% recovery", "Men had 60% recovery and women had 40% recovery."],
    ["Cohort alpha had 60% recovery and cohort beta had 40% recovery", "Cohort beta had 60% recovery and cohort alpha had 40% recovery."],
  ])("rejects reassigned percentages: %s", (claim, text) => {
    const result = lexicalSupport(claim, prepareDraftSource(text));
    expect(result).toMatchObject({ verdict: "not-found", missingNumbers: [], closest: { difference: "different-number" } });
    expect(result).not.toHaveProperty("excerpt");
    expect(text.slice(result.closest!.start, result.closest!.end)).toBe(result.closest!.text);
  });
  it.each([
    "Women had 60% recovery and men had 40% recovery.",
    "Men had 40% recovery and women had 60% recovery.",
    "Men had 40 percent recovery. Women had 60 percent recovery.",
  ])("supports matching population percentages with exact source offsets: %s", text => {
    const result = lexicalSupport("Women had 60% recovery and men had 40% recovery", prepareDraftSource(text));
    expect(result.verdict).toBe("supported");
    expect(text.slice(result.excerpt!.start, result.excerpt!.end)).toBe(result.excerpt!.text);
  });
  it("withholds supported when percentage populations cannot be bound to distinct clauses", () => {
    const text = "Women and men had 60% and 40% recovery, respectively.";
    expect(lexicalSupport("Women had 60% recovery and men had 40% recovery", prepareDraftSource(text)))
      .toMatchObject({ verdict: "partly-supported", excerpt: { text } });
  });
  it.each([
    "Women had 60% recovery unlike men.",
    "Men had 60% recovery unlike women.",
  ])("withholds supported for equal-value many-to-one percentage roles: %s", text => {
    const result = lexicalSupport("Women had 60% recovery and men had 60% recovery", prepareDraftSource(text));
    expect(result).toMatchObject({ verdict: "partly-supported", missingTerms: [], missingNumbers: [], excerpt: { text } });
    expect(text.slice(result.excerpt!.start, result.excerpt!.end)).toBe(result.excerpt!.text);
  });
  it.each([
    "Women had 60% recovery and men had 60% recovery.",
    "Men had 60% recovery and women had 60% recovery.",
    "Men had 60 percent recovery. Women had 60 percent recovery.",
  ])("supports distinct equal-value population percentage clauses: %s", text => {
    const result = lexicalSupport("Women had 60% recovery and men had 60% recovery", prepareDraftSource(text));
    expect(result.verdict).toBe("supported");
    expect(text.slice(result.excerpt!.start, result.excerpt!.end)).toBe(result.excerpt!.text);
    expect(result.excerpt!.text).toBe(text);
  });
});

describe("private draft check contract", () => {
  it("ties every verdict to a verbatim excerpt or an explicit absence, and never classifies an unsupplied source", () => {
    const check = buildDraftCheck(draftCheckFixture());
    expect(check).toMatchObject({ version: 1, scope: "private-draft-check", method: "lexical-overlap-v2", origin: "caller-supplied-source-text",
      summary: { claims: 3, supported: 1, partlySupported: 0, notFound: 0, sourceUnavailable: 1, notChecked: 1 } });
    expect(check.claims[0]).toMatchObject({ id: "claim1", text: "Retrieval improves factual accuracy on open-domain questions [1].", verdict: "supported",
      citations: [{ token: "1", reference: "ref1", verdict: "supported", evidence: "verbatim-excerpt", coverage: "partial",
        excerpt: { text: "We show that retrieval improves factual accuracy on open-domain questions." } }] });
    expect(check.claims[1]).toMatchObject({ verdict: "source-unavailable",
      citations: [{ reference: "ref2", verdict: "source-unavailable", evidence: "source-unavailable", unavailableReason: "source-text-not-supplied" }] });
    expect(check.claims[2]).toMatchObject({ verdict: "not-checked", notCheckedReason: "no-citation", citations: [] });
    expect(check.references.map(row => row.sourceText)).toEqual(["partial", "not-supplied"]);
    // The supplied source text is never echoed beyond its excerpts.
    expect(JSON.stringify(check)).not.toContain("Background is omitted here");
    for (const claim of check.claims) for (const citation of claim.citations)
      expect(citation.evidence === "verbatim-excerpt").toBe(citation.verdict === "supported" || citation.verdict === "partly-supported");
  });
  it("reports not-found only against supplied text, with the unmatched wording", () => {
    const check = buildDraftCheck(request({ passage: "Glacier retreat accelerated sharply after 1990 [1]." }));
    expect(check.claims[0]).toMatchObject({ verdict: "not-found", citations: [{ verdict: "not-found", evidence: "no-supporting-passage-found", coverage: "partial",
      missingTerms: ["glacier", "retreat", "accelerated", "sharply"], missingNumbers: ["1990"] }] });
    expect(check.claims[0].citations[0]).not.toHaveProperty("excerpt");
  });
  it("keeps a claim unavailable while any cited source is unread, unless a read source supports it", () => {
    const passage = "Glacier retreat accelerated sharply after 1990 [1, 2]. Retrieval improves factual accuracy on open-domain questions [1, 2].";
    const check = buildDraftCheck(request({ passage }));
    expect(check.claims.map(claim => [claim.verdict, claim.citations.map(row => row.verdict)])).toEqual([
      ["source-unavailable", ["not-found", "source-unavailable"]], ["supported", ["supported", "source-unavailable"]]]);
  });
  it("flags unresolved references, unresolved citations, uncited works and a named author who is not the cited author", () => {
    const check = buildDraftCheck(request({ references: { format: "bibtex", text: BIBTEX },
      passage: String.raw`Jones et al. [1] report gains. Others disagree \cite{ghost}. Lewis (2019) is cited by year.`, sources: [] }));
    expect(check.flags).toEqual([
      { kind: "reference-unresolved", reference: "bare", problem: "no-identifier" },
      { kind: "reference-unresolved", reference: "broken", problem: "unreadable-entry" },
      { kind: "possible-different-work", claim: "claim1", reference: "lewis2020", impliedAuthor: "Jones" },
      { kind: "citation-unresolved", claim: "claim2", token: "ghost", problem: "unresolved" },
      { kind: "citation-unresolved", claim: "claim3", token: "Lewis 2019", problem: "year-differs", candidates: ["lewis2020"] },
      { kind: "reference-not-cited", reference: "smith2014" },
    ]);
    expect(check.claims.map(claim => claim.verdict)).toEqual(["source-unavailable", "source-unavailable", "source-unavailable"]);
    expect(check.claims[2].citations[0]).toMatchObject({ unavailableReason: "reference-year-differs" });
  });
  it("does not compare the cited author's name or the marker as claim wording", () => {
    const check = buildDraftCheck(request({ references: { format: "bibtex", text: BIBTEX }, passage: "Lewis et al. [1] show that retrieval improves accuracy.",
      sources: [{ reference: "lewis2020", coverage: "full-text", text: "We show that retrieval improves accuracy." }] }));
    expect(check.claims[0]).toMatchObject({ verdict: "supported", citations: [{ missingTerms: [] }] });
    expect(check.flags.filter(flag => flag.kind === "possible-different-work")).toEqual([]);
  });
  it("leaves text in scripts without word spacing unchecked rather than reporting it not found", () => {
    const check = buildDraftCheck(request({ passage: "検索は精度を向上させる [1]. 検索は精度を向上させる [2]." }));
    expect(check.claims.map(claim => [claim.verdict, claim.notCheckedReason])).toEqual([["not-checked", "script-without-word-spacing"], ["source-unavailable", undefined]]);
  });
  it("accepts caller-chosen exact spans and refuses overlapping, empty or surrogate-splitting spans", () => {
    const base = draftCheckFixture(), end = base.passage.indexOf("Dropout") - 1;
    expect(buildDraftCheck({ ...base, claims: [{ start: 0, end }] }).claims).toMatchObject([{ start: 0, end, verdict: "supported" }]);
    for (const claims of [[{ start: 0, end: 20 }, { start: 10, end: 30 }], [{ start: 65, end: 66 }], [{ start: 0, end: 99_999 }]])
      expect(() => buildDraftCheck({ ...base, claims })).toThrow();
    expect(() => buildDraftCheck({ ...base, passage: "\u{1F600} improves accuracy [1].", claims: [{ start: 1, end: 12 }] })).toThrow();
  });
  it("refuses unknown fields, source text for an unlisted work, duplicate source text and oversized packets", () => {
    const base = draftCheckFixture();
    expect(() => buildDraftCheck({ ...base, store: true })).toThrow();
    expect(() => buildDraftCheck({ ...base, sources: [{ reference: "ref9", coverage: "full-text", text: "Unattributed text." }] })).toThrow();
    expect(() => buildDraftCheck({ ...base, sources: [base.sources[0], base.sources[0]] })).toThrow();
    expect(() => buildDraftCheck({ ...base, sources: [{ ...base.sources[0], text: "   " }] })).toThrow();
    expect(() => buildDraftCheck({ ...base, references: { format: "list", text: "x".repeat(MAX_DRAFT_CHECK_BYTES) } })).toThrow();
  });
  it("is deterministic and performs no network call", () => {
    const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    expect(buildDraftCheck(draftCheckFixture())).toEqual(buildDraftCheck(draftCheckFixture()));
    expect(http).not.toHaveBeenCalled(); http.mockRestore();
  });
});

describe("draft_check MCP handler", () => {
  it("returns the shared contract and a plain summary", () => {
    const result = draftCheckTool({ check: draftCheckFixture() });
    expect(result.structuredContent).toEqual({ check: buildDraftCheck(draftCheckFixture()) });
    expect(result.content[0].text).toContain("3 claims: 1 supported, 0 partly supported, 0 not found in the supplied text, 1 source unavailable, 1 not checked.");
  });
  it("answers invalid input with a fixed error that never echoes the private passage", () => {
    const result = draftCheckTool({ check: { ...draftCheckFixture(), passage: "PRIVATE_SECRET_FIXTURE", extra: 1 } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "Invalid private draft check. Use the version-1 bounded contract; no research or payment started." }] });
  });
});
