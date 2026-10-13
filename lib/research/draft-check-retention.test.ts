import { expect, it } from "vitest";
import { draftCheckFixture } from "./fixtures/draft-check";
import { DRAFT_CHECK_STORAGE_KEY, readDraftCheckFile, saveDraftCheck, restoreDraftCheck, clearSavedDraftCheck, type DraftCheckStorage } from "./draft-check-retention";

function store(): DraftCheckStorage {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
it("restores exact Unicode input files and refuses invalid UTF-8 instead of replacing bytes", () => {
  const packet = { ...draftCheckFixture(), passage: "😀 Retrieval improves factual accuracy [1]." };
  expect(readDraftCheckFile(new TextEncoder().encode(JSON.stringify(packet)))).toEqual(packet);
  expect(() => readDraftCheckFile(new Uint8Array([0xc3, 0x28]))).toThrow();
  expect(() => readDraftCheckFile(new Uint8Array(65_537))).toThrow("Oversized draft input");
});
it("saves only deliberate input, restores unchanged spans, and recomputes instead of trusting saved verdicts", () => {
  const storage = store(), input = draftCheckFixture();
  expect(restoreDraftCheck(storage, 1000)).toBeNull();
  expect(saveDraftCheck(storage, input, 3600, 1000)).toBe(3_601_000);
  expect(restoreDraftCheck(storage, 1001)).toEqual({ request: input, expiresAt: 3_601_000 });
  expect(storage.getItem(DRAFT_CHECK_STORAGE_KEY)).not.toContain('"verdict"');
});
it.each([3600, 86400, 604800] as const)("refuses and removes an expired %s second save at the exact boundary", lifetime => {
  const storage = store(); saveDraftCheck(storage, draftCheckFixture(), lifetime, 1000);
  expect(restoreDraftCheck(storage, 1000 + lifetime * 1000 - 1)).not.toBeNull();
  expect(restoreDraftCheck(storage, 1000 + lifetime * 1000)).toBeNull();
  expect(storage.getItem(DRAFT_CHECK_STORAGE_KEY)).toBeNull();
});
it("never replaces an existing private input with an invalid check", () => {
  const storage = store(); saveDraftCheck(storage, draftCheckFixture(), 3600, 1000);
  const previous = storage.getItem(DRAFT_CHECK_STORAGE_KEY);
  expect(() => saveDraftCheck(storage, { ...draftCheckFixture(), claims: [{ start: 1000, end: 2000 }] }, 3600, 1001)).toThrow();
  expect(storage.getItem(DRAFT_CHECK_STORAGE_KEY)).toBe(previous);
});
it("rejects corrupt/oversized/future saves and confirms removal", () => {
  const storage = store();
  for (const raw of ["not json", "x".repeat(66_001), JSON.stringify({ version: 1, savedAt: 2000, expiresAt: 3_602_000, request: draftCheckFixture() })]) {
    storage.setItem(DRAFT_CHECK_STORAGE_KEY, raw);
    expect(() => restoreDraftCheck(storage, 1000)).toThrow("Saved draft unavailable");
    expect(storage.getItem(DRAFT_CHECK_STORAGE_KEY)).toBeNull();
  }
});
it("reports failed writes/removal without claiming a verified save or deletion", () => {
  const storage = store();
  expect(() => saveDraftCheck({ ...storage, setItem: () => {} }, draftCheckFixture(), 3600, 1000)).toThrow("Draft save unverified");
  saveDraftCheck(storage, draftCheckFixture(), 3600, 1000);
  expect(() => clearSavedDraftCheck({ ...storage, removeItem: () => {} })).toThrow("Draft removal unverified");
  expect(storage.getItem(DRAFT_CHECK_STORAGE_KEY)).not.toBeNull();
});
