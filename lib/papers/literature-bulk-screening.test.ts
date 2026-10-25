import { expect, it } from "vitest";
import { PAPER_CATALOG } from "./catalog";
import { emptyLiteratureWorkspace, saveLiteraturePaper } from "./literature-workspace";
import { applyLiteratureScreening, previewLiteratureScreening } from "./literature-bulk-screening";

function workspace() {
  let value = emptyLiteratureWorkspace();
  for (const paper of PAPER_CATALOG.slice(0, 3)) value = saveLiteraturePaper(value, paper, "2026-10-20T00:00:00Z");
  value.title = "Private focus"; value.question = "Private question";
  value.entries.forEach((entry, index) => { entry.notes = `PRIVATE note ${index}`; });
  return value;
}
it("updates the previewed exact identities atomically without changing metadata, notes, focus or saved order", () => {
  const original = workspace(), raw = JSON.stringify(original);
  const plan = previewLiteratureScreening(original, [original.entries[2].paper.url, original.entries[0].paper.url], "exclude");
  expect(plan.entries.map(entry => entry.paper.url)).toEqual([original.entries[2].paper.url, original.entries[0].paper.url]);
  const result = applyLiteratureScreening(original, plan);
  expect(result.entries.map(entry => entry.screening)).toEqual(["exclude", "unscreened", "exclude"]);
  expect({ ...result, entries: result.entries.map((entry, index) => ({ ...entry, screening: original.entries[index].screening })) }).toEqual(original);
  expect(JSON.stringify(original)).toBe(raw);
});
it.each(["notes", "screening", "metadata", "missing"] as const)("refuses all target updates after a %s conflict", kind => {
  const original = workspace(), plan = previewLiteratureScreening(original, original.entries.map(entry => entry.paper.url), "include");
  const current = structuredClone(original);
  if (kind === "notes") current.entries[1].notes = "Another tab note";
  if (kind === "screening") current.entries[1].screening = "undecided";
  if (kind === "metadata") current.entries[1].paper.title = "Other snapshot";
  if (kind === "missing") current.entries.splice(1, 1);
  const raw = JSON.stringify(current);
  expect(() => applyLiteratureScreening(current, plan)).toThrow("stale-selection"); expect(JSON.stringify(current)).toBe(raw);
});
it("preserves concurrent changes outside the reviewed targets and does not alias its snapshot", () => {
  const original = workspace(), plan = previewLiteratureScreening(original, [original.entries[0].paper.url], "include");
  expect(plan.entries[0]).not.toBe(original.entries[0]);
  const current = structuredClone(original); current.question = "New question"; current.entries[1].notes = "Keep newer note"; current.entries.reverse();
  const result = applyLiteratureScreening(current, plan);
  expect(result.question).toBe("New question"); expect(result.entries[1].notes).toBe("Keep newer note");
  expect(result.entries.map(entry => entry.paper.url)).toEqual(current.entries.map(entry => entry.paper.url));
  expect(result.entries[2].screening).toBe("include");
});
it("refuses empty, repeated, absent or invalid selections and tampered plans", () => {
  const current = workspace(), url = current.entries[0].paper.url;
  for (const urls of [[], [url, url], ["https://missing.example"]]) expect(() => previewLiteratureScreening(current, urls, "include")).toThrow();
  expect(() => previewLiteratureScreening(current, [url], "__proto__" as never)).toThrow("invalid-selection");
  const plan = previewLiteratureScreening(current, [url], "include"); plan.entries.push(plan.entries[0]);
  expect(() => applyLiteratureScreening(current, plan)).toThrow();
  const empty = { screening: "include" as const, entries: [] }; expect(() => applyLiteratureScreening(current, empty)).toThrow("invalid-selection");
});
