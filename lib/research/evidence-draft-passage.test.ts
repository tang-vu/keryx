import { describe, expect, it } from "vitest";
import { rebaseEvidenceDraftClaims, type PassageEditHint } from "./evidence-draft-passage";
import { buildEvidenceDraft } from "./evidence-draft";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";

const claim = (start: number, end: number, id = "claim1") => ({
  ...evidenceDraftFixture().claims[0], id, start, end,
});
const hint = (passage: string, start: number, end: number, inputType = "insertText"): PassageEditHint => ({ passage, start, end, inputType });

describe("exact passage claim preservation", () => {
  it.each([
    ["Lead. Claim. Tail.", "New lead. Claim. Tail.", 6, 12, 10, 16],
    ["Lead. Claim. Tail.", "Lead. Claim. New tail.", 6, 12, 6, 12],
    ["Claim.", "Prefix Claim.", 0, 6, 7, 13],
    ["Claim.", "Claim. Suffix", 0, 6, 0, 6],
    ["Before Claim. After", "Claim. After", 7, 13, 0, 6],
    ["Claim. After", "Claim.", 0, 6, 0, 6],
    ["😀 Claim. Tail", "🧑‍🔬 Claim. Tail", 3, 9, 6, 12],
    ["Lead Claim. 😁", "Lead Claim. 😀", 5, 11, 5, 11],
  ])("maps a surrounding edit from %j to %j", (previous, next, start, end, mappedStart, mappedEnd) => {
    const row = claim(start, end), result = rebaseEvidenceDraftClaims(previous, next, [row]);
    expect(result).toEqual({ claims: [{ ...row, start: mappedStart, end: mappedEnd }], removed: 0 });
    expect(next.slice(mappedStart, mappedEnd)).toBe(previous.slice(start, end));
  });

  it("retains the complete exact assessment when shifted and rebuilt", () => {
    const packet = evidenceDraftFixture(), excerpt = buildEvidenceDraft(packet).excerpts[0];
    packet.claims[0].excerptIds = [excerpt.id];
    packet.claims[0].assessment = { origin: "user-assessment", reviewer: "Reviewer", reviewedAt: "2026-10-20T00:00:00Z",
      verdict: "supported", claimText: packet.passage, paperUrls: packet.claims[0].paperUrls,
      excerptIds: [excerpt.id], excerpts: [excerpt] };
    const result = rebaseEvidenceDraftClaims(packet.passage, `🧪 Introduction. ${packet.passage}`, packet.claims);
    expect(result.claims[0].assessment).toEqual(packet.claims[0].assessment);
    expect(buildEvidenceDraft({ ...packet, passage: `🧪 Introduction. ${packet.passage}`, claims: result.claims }).claims[0].status).toBe("user-assessed");
  });

  it("drops only intersecting and enclosing claims, including a one-character edit", () => {
    const previous = "AAA BBB CCC", next = "AAA BbB CCC";
    const rows = [claim(0, 3, "before"), claim(4, 7, "changed"), claim(8, 11, "after"), claim(0, 11, "enclosing")];
    expect(rebaseEvidenceDraftClaims(previous, next, rows)).toEqual({ claims: [rows[0], rows[2]], removed: 2 });
  });

  it.each(["insertText", "insertFromPaste", "insertCompositionText", "deleteByCut", "deleteContentBackward", "deleteContentForward"])(
    "binds %s to the selected occurrence of repeated prose", inputType => {
      const previous = "same same", next = inputType.startsWith("insert") ? "new same" : "same";
      const end = inputType.startsWith("insert") ? 4 : 5;
      const rows = [claim(0, 4, "first"), claim(5, 9, "second")];
      const result = rebaseEvidenceDraftClaims(previous, next, rows, hint(previous, 0, end, inputType));
      expect(result).toEqual({ claims: [{ ...rows[1], start: next.length - 4, end: next.length }], removed: 1 });
    });

  it.each([
    [5, "deleteContentBackward"], [0, "deleteContentForward"],
    [5, "deleteWordBackward"], [0, "deleteWordForward"],
  ])("maps collapsed deletion at %i using %s", (caret, inputType) => {
    const rows = [claim(0, 4, "first"), claim(5, 9, "second")];
    expect(rebaseEvidenceDraftClaims("same same", "same", rows, hint("same same", caret, caret, inputType)))
      .toEqual({ claims: [{ ...rows[1], start: 0, end: 4 }], removed: 1 });
  });

  it("preserves the first occurrence when the second identical occurrence was deleted", () => {
    const rows = [claim(0, 4, "first"), claim(5, 9, "second")];
    expect(rebaseEvidenceDraftClaims("same same", "same", rows, hint("same same", 4, 9, "deleteByCut")))
      .toEqual({ claims: [rows[0]], removed: 1 });
  });

  it("withholds ambiguous repeated spans without a usable hint; never searches for matching text", () => {
    const rows = [claim(0, 4, "first"), claim(5, 9, "second")];
    for (const edit of [undefined, hint("stale passage", 4, 9), hint("same same", 4, 9, "historyUndo"),
      hint("same same", 50, 90), hint("same same", 1, 2)]) {
      expect(rebaseEvidenceDraftClaims("same same", "same", rows, edit)).toEqual({ claims: [], removed: 2 });
    }
  });

  it("keeps unambiguous claims outside a repeated ambiguous edit", () => {
    const rows = [claim(0, 4, "lead"), claim(5, 9, "first"), claim(10, 14, "second"), claim(15, 19, "tail")];
    expect(rebaseEvidenceDraftClaims("Lead same same Tail", "Lead same Tail", rows))
      .toEqual({ claims: [rows[0], { ...rows[3], start: 10, end: 14 }], removed: 2 });
  });

  it("does not treat a multi-region replacement as unchanged interior text", () => {
    const row = claim(2, 7);
    expect(rebaseEvidenceDraftClaims("A Claim Z", "B Claim Y", [row])).toEqual({ claims: [], removed: 1 });
  });

  it("keeps no-op inputs and clears fully deleted passage annotations", () => {
    const rows = [claim(0, 5)];
    expect(rebaseEvidenceDraftClaims("Claim", "Claim", rows)).toEqual({ claims: rows, removed: 0 });
    expect(rebaseEvidenceDraftClaims("Claim", "", rows)).toEqual({ claims: [], removed: 1 });
  });
});
