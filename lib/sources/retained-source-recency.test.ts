import { describe, expect, it } from "vitest";
import fixture from "./fixtures/issue-217-retained-releases.json";
import { freezeRetainedSourceSet, selectNewestRetainedSourceItem,
  type RetainedSourceRecencyRequirement, type RetainedSourceSet, type RetainedSourceSetInput } from "./retained-source-recency";
import { recognizeSourceRecency, sourceRecencyGap } from "./source-recency";
import { selectRelevantSourceItem } from "./source-item-asset";

const feed = fixture.feedUrl;
const question = `Name the newest release by publication date among the retained catalog entries in ${feed}, state one change.`;
const now = new Date("2026-10-08T01:00:00.000Z").getTime();
const requirement: RetainedSourceRecencyRequirement = Object.freeze({ kind: "newest-retained-feed-entry",
  scope: "frozen-retained-set", criterion: "explicit-publication-date", feedUrl: feed });
function input(): RetainedSourceSetInput { return structuredClone(fixture) as RetainedSourceSetInput; }
function select(value = input()) { return selectNewestRetainedSourceItem(requirement, freezeRetainedSourceSet(value), now); }

describe("qualified frozen retained-set recency", () => {
  it("selects the unique newest release before relevance even when an older entry overlaps more", () => {
    const rows = input().items.map(item => ({ id: item.itemId, sourceId: fixture.sourceId, title: item.itemTitle,
      link: item.itemUrl, publishedAt: item.itemPublishedAt, content: "",
      summary: item.itemId === "v10" ? "Newest release change compatibility deployment fact API" : "New entry" }));
    expect(selectRelevantSourceItem(question, ["compatibility deployment API"], ["release change"], rows)?.id).toBe("v10");
    const result = select({ ...input(), items: input().items.reverse() });
    expect(result).toMatchObject({ status: "eligible", sourceId: fixture.sourceId, feedUrl: feed,
      scope: "frozen-retained-set", criterion: "explicit-publication-date", membershipCount: 10,
      capturedAt: fixture.capturedAt, selected: { itemId: "v18", contentVersion: "sha256:synthetic-v18" } });
    if (result.status !== "eligible") throw new Error("Expected qualified retained selection");
    expect(result.snapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it.each([
    { ...requirement, scope: "current-feed" }, { ...requirement, criterion: "highest-stable-version" },
    { ...requirement, before: "2026-10-01" }, { ...requirement, feedUrl: `${feed}#section` },
    { ...requirement, feedUrl: "https://user:secret@creator.example/feed.atom" },
    { ...requirement, feedUrl: "not a URL" },
  ])("refuses a different or uncertain explicitly supplied requirement", value => {
    expect(selectNewestRetainedSourceItem(value as RetainedSourceRecencyRequirement, freezeRetainedSourceSet(input()), now))
      .toMatchObject({ status: "withheld", reason: "requirement-unqualified" });
  });

  it("leaves the existing current-feed refusal in force", () => {
    const current = recognizeSourceRecency(`Name the newest release in ${feed}.`);
    expect(sourceRecencyGap(current, { id: fixture.sourceId, name: "Fixture", rssUrl: feed })?.reason)
      .toBe("newest-feed-observation-unqualified");
  });

  it.each(["partial", "unknown"] as const)("refuses %s membership rather than guessing from a returned array", membership => {
    expect(select({ ...input(), membership })).toMatchObject({ status: "withheld", reason: "membership-unqualified" });
  });
  it("does not treat an empty complete set as a qualifying newest result", () => {
    expect(select({ ...input(), items: [] })).toMatchObject({ status: "withheld", reason: "empty-retained-set" });
  });

  it.each(["missing-date", "missing-origin", "updated-only", "legacy-origin", "mismatched-origin", "future", "invalid-calendar"])(
    "refuses any uncertain cohort member (%s) instead of dropping it", problem => {
      const value = input(), older = value.items.at(-1)!;
      if (problem === "missing-date") delete older.itemPublishedAt;
      if (problem === "missing-origin") delete older.publication;
      if (problem === "updated-only") older.publication!.field = "atom:updated";
      if (problem === "legacy-origin") older.publication!.field = "legacy:publishedAt";
      if (problem === "mismatched-origin") older.publication!.rawValue = "2026-10-06T13:00:00Z";
      if (problem === "future") { older.itemPublishedAt = "2026-10-08T00:30:00.000Z"; older.publication!.rawValue = "2026-10-08T00:30:00Z"; }
      if (problem === "invalid-calendar") { older.itemPublishedAt = "2026-03-02T00:00:00.000Z"; older.publication!.rawValue = "2026-02-30T00:00:00Z"; }
      expect(select(value)).toMatchObject({ status: "withheld", reason: "unqualified-publication-date" });
    });

  it("accepts explicit RSS publication with a timezone without treating edits as publication", () => {
    const value = input();
    value.items[0].publication = { field: "rss:pubDate", rawValue: "Wed, 7 Oct 2026 17:55:05 +0200" };
    expect(select(value)).toMatchObject({ status: "eligible", selected: { itemId: "v18" } });
    value.items[0].publication.rawValue = "30 Feb 2026 00:00:00 GMT";
    expect(select(value)).toMatchObject({ status: "withheld", reason: "unqualified-publication-date" });
  });
  it("rejects a contradictory RSS weekday while checking valid weekdays in their raw timezone", () => {
    const value = input();
    value.items[0].publication = { field: "rss:pubDate", rawValue: "Tue, 7 Oct 2026 17:55:05 +0200" };
    expect(select(value)).toMatchObject({ status: "withheld", reason: "unqualified-publication-date" });
    value.items[0].publication.rawValue = "Thu, 8 Oct 2026 00:55:05 +0900";
    expect(select(value)).toMatchObject({ status: "eligible", selected: { itemId: "v18" } });
    value.items[0].publication.rawValue = "7 Oct 2026 17:55:05 +0200";
    expect(select(value)).toMatchObject({ status: "eligible", selected: { itemId: "v18" } });
  });

  it("refuses distinct newest candidates tied by publication date", () => {
    const value = input();
    value.items[1].itemPublishedAt = value.items[0].itemPublishedAt;
    value.items[1].publication = { ...value.items[0].publication! };
    expect(select(value)).toMatchObject({ status: "withheld", reason: "ambiguous-newest" });
  });
  it("requires exact feed binding, retaining query identity without hostname inference", () => {
    expect(select({ ...input(), feedUrl: `${feed}?edition=other` })).toMatchObject({ status: "withheld", reason: "source-mismatch" });
  });
  it("refuses a future capture clock or invalid selection clock", () => {
    const snapshot = freezeRetainedSourceSet(input());
    for (const clock of [new Date("2026-10-07T23:59:59.000Z").getTime(), NaN]) {
      expect(selectNewestRetainedSourceItem(requirement, snapshot, clock)).toMatchObject({ status: "withheld", reason: "invalid-observation-time" });
    }
    expect(() => freezeRetainedSourceSet({ ...input(), capturedAt: "invalid" })).toThrow();
  });
  it("preserves a wanted source/item/version and refuses any conflicting exact binding", () => {
    const snapshot = freezeRetainedSourceSet(input());
    const wanted = { sourceId: fixture.sourceId, itemId: "v18", contentVersion: "sha256:synthetic-v18" };
    expect(selectNewestRetainedSourceItem(requirement, snapshot, now, wanted).status).toBe("eligible");
    for (const conflict of [{ ...wanted, sourceId: "other" }, { ...wanted, itemId: "v10" }, { ...wanted, contentVersion: "changed" }]) {
      expect(selectNewestRetainedSourceItem(requirement, snapshot, now, conflict)).toMatchObject({ status: "withheld", reason: "wanted-version-conflict" });
    }
  });
  it("freezes complete membership and date provenance against a later refresh", () => {
    const value = input(), snapshot = freezeRetainedSourceSet(value), originalDigest = snapshot.digest;
    value.items[0].itemTitle = "Replaced"; value.items[0].publication!.rawValue = "2027-01-01T00:00:00Z"; value.items.pop();
    expect(snapshot.items).toHaveLength(10); expect(snapshot.items[0].itemTitle).toBe("v0.27.18");
    expect(Object.isFrozen(snapshot.items[0].publication)).toBe(true);
    expect(selectNewestRetainedSourceItem(requirement, snapshot, now)).toMatchObject({ status: "eligible", snapshotDigest: originalDigest });
  });
  it("rejects forged cohorts and altered copies without propagating their claimed digest", () => {
    const snapshot = freezeRetainedSourceSet(input());
    for (const forged of [
      { ...input(), digest: "sha256:forged" },
      { ...snapshot, digest: "sha256:forged" },
      { ...snapshot, membership: "complete-retained-set", items: [] },
      { ...snapshot, capturedAt: "invalid" },
    ]) {
      expect(selectNewestRetainedSourceItem(requirement, forged as RetainedSourceSet, now))
        .toEqual({ status: "withheld", reason: "snapshot-unqualified" });
    }
  });
  it("rejects exact shallow, deep, serialized and proxied copies of a minted snapshot", () => {
    const snapshot = freezeRetainedSourceSet(input());
    const copies = [{ ...snapshot }, structuredClone(snapshot), JSON.parse(JSON.stringify(snapshot)), new Proxy(snapshot, {})];
    for (const copy of copies) expect(selectNewestRetainedSourceItem(requirement, copy as RetainedSourceSet, now))
      .toEqual({ status: "withheld", reason: "snapshot-unqualified" });
  });
  it("rejects an unminted structural cast before reading any metadata", () => {
    const forged = { get digest() { throw new Error("Untrusted digest getter"); } } as unknown as RetainedSourceSet;
    expect(selectNewestRetainedSourceItem(requirement, forged, now))
      .toEqual({ status: "withheld", reason: "snapshot-unqualified" });
  });
  it("does not permit mutation of a minted cohort, its exact version or native field", () => {
    const snapshot = freezeRetainedSourceSet(input()), originalDigest = snapshot.digest;
    expect(Reflect.set(snapshot, "digest", "sha256:forged")).toBe(false);
    expect(Reflect.set(snapshot, "membership", "unknown")).toBe(false);
    expect(Reflect.set(snapshot.items[0], "contentVersion", "changed")).toBe(false);
    expect(Reflect.set(snapshot.items[0].publication!, "rawValue", "2027-01-01T00:00:00Z")).toBe(false);
    expect(() => (snapshot.items as unknown as unknown[]).pop()).toThrow();
    expect(selectNewestRetainedSourceItem(requirement, snapshot, now))
      .toMatchObject({ status: "eligible", snapshotDigest: originalDigest, selected: { itemId: "v18", contentVersion: "sha256:synthetic-v18" } });
  });
  it("bounds cohorts and fields, rejects duplicate IDs and rejects payment/body fields", () => {
    const value = input();
    expect(() => freezeRetainedSourceSet({ ...value, items: Array.from({ length: 1001 }, () => value.items[0]) })).toThrow();
    expect(() => freezeRetainedSourceSet({ ...value, items: [value.items[0], value.items[0]] })).toThrow("unique");
    expect(() => freezeRetainedSourceSet({ ...value, sourceId: "x".repeat(201) })).toThrow();
    expect(() => freezeRetainedSourceSet({ ...value, payTo: "caller-created" } as unknown as RetainedSourceSetInput)).toThrow();
    expect(() => freezeRetainedSourceSet({ ...value, items: [{ ...value.items[0], content: "paid body" }] } as unknown as RetainedSourceSetInput)).toThrow();
  });
  it("supports the complete 1000-item ceiling without relying on newest-first order", () => {
    const value = input(), older = value.items.at(-1)!;
    value.items = [...Array.from({ length: 999 }, (_, index) => ({ ...older, itemId: `older-${index}` })), value.items[0]];
    expect(select(value)).toMatchObject({ status: "eligible", membershipCount: 1000, selected: { itemId: "v18" } });
  });
});
