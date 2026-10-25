import { expect, it } from "vitest";
import { literatureBackupFixture } from "../../test-support/literature-backup-fixture";
import { hasSavedLiterature, restoreClearedLiterature } from "./literature-clear-recovery";
import { emptyLiteratureWorkspace } from "./literature-workspace";

it("restores all exact saved private fields without aliasing its retained checkpoint", () => {
  const saved = literatureBackupFixture(), raw = JSON.stringify(saved), empty = emptyLiteratureWorkspace();
  const restored = restoreClearedLiterature(empty, saved);
  expect(restored).toEqual(saved); expect(restored).not.toBe(saved); expect(restored.entries[0].paper).not.toBe(saved.entries[0].paper);
  expect(JSON.stringify(saved)).toBe(raw); expect(empty).toEqual(emptyLiteratureWorkspace());
});
it.each(["title", "question", "paper"] as const)("refuses new %s data without replacing it or the checkpoint", kind => {
  const saved = literatureBackupFixture(), current = emptyLiteratureWorkspace();
  if (kind === "title") current.title = "New private review";
  if (kind === "question") current.question = "New focus";
  if (kind === "paper") current.entries = [saved.entries[1]];
  const raw = JSON.stringify(current); expect(() => restoreClearedLiterature(current, saved)).toThrow("library-changed"); expect(JSON.stringify(current)).toBe(raw);
});
it("accepts an already-restored identical library independent of JSON key order", () => {
  const saved = literatureBackupFixture(), { title, ...rest } = saved;
  expect(restoreClearedLiterature({ ...rest, title }, saved)).toEqual(saved);
  const changed = structuredClone(saved); changed.entries[0].notes += " new edit";
  expect(() => restoreClearedLiterature(changed, saved)).toThrow("library-changed");
});
it("validates retained data and distinguishes even a focus-only saved library from empty", () => {
  const empty = emptyLiteratureWorkspace(); expect(hasSavedLiterature(empty)).toBe(false);
  expect(hasSavedLiterature({ ...empty, title: " " })).toBe(true);
  expect(() => restoreClearedLiterature(empty, { ...literatureBackupFixture(), injected: "private" } as never)).toThrow();
});
