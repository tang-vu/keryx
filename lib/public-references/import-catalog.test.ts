import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVED_PUBLIC_REFERENCES } from "./approved-catalog";
import { importPublicReferenceCatalog, PUBLIC_CATALOG_IMPORT_DURATION_MS, type PublicCatalogImportProgress } from "./import-catalog";
import type { PublicReference } from "./catalog";

const feed = { feedTitle: "Synthetic public publisher", feedDescription: "Fixture only", link: "https://publisher.test/",
  items: [{ title: "Public article", summary: "Observed text", content: "Observed text", link: "https://publisher.test/article", deliveryKind: "excerpt" as const }] };
function fixture() {
  const saved = new Map<string, PublicReference>();
  const db = { getSource: vi.fn(async () => null), getPublicReference: vi.fn(async (id: string) => saved.get(id) ?? null),
    upsertPublicReference: vi.fn(async (value: PublicReference) => { saved.set(value.id, value); }) };
  return { saved, db };
}
afterEach(() => { vi.restoreAllMocks(); });

describe("finite explicit public catalog import", () => {
  it("reports each fixed-batch result immediately and isolates a failed feed without exposing its error", async () => {
    const { db } = fixture(), progress: PublicCatalogImportProgress[] = [];
    const ingest = vi.fn(async (url: string) => {
      if (url === APPROVED_PUBLIC_REFERENCES[1]!.rssUrl) throw new Error("private upstream diagnostic must not escape");
      return feed;
    });
    const results = await importPublicReferenceCatalog(db, ingest, { onProgress(event) {
      progress.push(event);
      if (event.phase === "completed") expect(ingest).toHaveBeenCalledTimes(event.index);
    } });
    expect(results).toHaveLength(APPROVED_PUBLIC_REFERENCES.length);
    expect(progress).toHaveLength(2 * APPROVED_PUBLIC_REFERENCES.length);
    expect(results[1]).toEqual({ name: APPROVED_PUBLIC_REFERENCES[1]!.name, items: 0, ok: false, code: "feed-failed" });
    expect(results.filter(result => result.ok)).toHaveLength(APPROVED_PUBLIC_REFERENCES.length - 1);
    expect(JSON.stringify(progress)).not.toContain("private upstream");
  });

  it("retains completed publisher commits and stops before the next publisher after cancellation", async () => {
    const { db, saved } = fixture(), controller = new AbortController(), ingest = vi.fn(async () => feed);
    const results = await importPublicReferenceCatalog(db, ingest, { signal: controller.signal, onProgress(event) {
      if (event.phase === "completed" && event.index === 2) controller.abort();
    } });
    expect(results).toHaveLength(2); expect(results.every(result => result.ok)).toBe(true);
    expect(saved.size).toBe(2); expect(ingest).toHaveBeenCalledTimes(2); expect(db.getSource).toHaveBeenCalledTimes(2);
  });

  it("forwards cancellation into the current feed and never writes its late returned snapshot", async () => {
    const { db } = fixture(), controller = new AbortController();
    const ingest = vi.fn(async (_url: string, signal?: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal); controller.abort(); expect(signal?.aborted).toBe(true); return feed;
    });
    const results = await importPublicReferenceCatalog(db, ingest, { signal: controller.signal });
    expect(results).toEqual([{ name: APPROVED_PUBLIC_REFERENCES[0]!.name, items: 0, ok: false, code: "cancelled" }]);
    expect(db.upsertPublicReference).not.toHaveBeenCalled(); expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("does no work when already cancelled and observes the fixed deadline before another publisher", async () => {
    const { db } = fixture(), controller = new AbortController(), ingest = vi.fn(async () => feed);
    controller.abort();
    expect(await importPublicReferenceCatalog(db, ingest, { signal: controller.signal })).toEqual([]);
    expect(db.getSource).not.toHaveBeenCalled();
    let clock = 1000; vi.spyOn(Date, "now").mockImplementation(() => clock);
    const results = await importPublicReferenceCatalog(db, ingest, { onProgress(event) {
      if (event.phase === "completed") clock += PUBLIC_CATALOG_IMPORT_DURATION_MS;
    } });
    expect(results).toHaveLength(1); expect(results[0]!.ok).toBe(true); expect(ingest).toHaveBeenCalledTimes(1);
  });

  it.each([["Public archive write row/byte limit", "capacity"], ["Public archive write deadline", "write-deadline"]])(
    "stops after %s without retrying this publisher or starting the remaining batch", async (message, code) => {
    const { db } = fixture(); db.upsertPublicReference.mockRejectedValueOnce(new Error(message));
    const ingest = vi.fn(async () => feed), results = await importPublicReferenceCatalog(db, ingest);
    expect(results).toHaveLength(1); expect(results[0]!.code).toBe(code);
    expect(ingest).toHaveBeenCalledTimes(1); expect(db.upsertPublicReference).toHaveBeenCalledTimes(1);
  });
});
