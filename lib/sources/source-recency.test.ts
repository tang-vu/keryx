import { describe, expect, it } from "vitest";
import { recognizeSourceRecency, sourceRecencyGap, sourceRecencyReport, sourceRecencyRequestGaps } from "./source-recency";

const feed = "https://creator.example/releases.atom";
const source = { id: "creator", name: "Creator releases", rssUrl: feed };

describe("original caller newest-feed safety constraint", () => {
  it.each([
    `Name the newest release in ${feed}, state one change and one missing compatibility fact.`,
    `Please identify the latest release actually in ${feed}.`,
    `Hãy nêu bản phát hành mới nhất trong ${feed}, nêu một thay đổi.`,
    `Xác định bản phát hành mới nhất từ ${feed}.`,
  ])("binds one positive original instruction and exact feed: %s", question => {
    const requirement = recognizeSourceRecency(question)!;
    expect(requirement).toMatchObject({ kind: "newest-feed-entry", status: "explicit-single-feed", binding: "exact-feeds", feedUrls: [feed] });
    expect(question.slice(requirement.originalSpan.start, requirement.originalSpan.end)).toContain(feed);
    expect(Object.isFrozen(requirement)).toBe(true);
    expect(Object.isFrozen(requirement.originalSpan)).toBe(true);
    expect(Object.isFrozen(requirement.feedUrls)).toBe(true);
    expect(sourceRecencyGap(requirement, source)).toMatchObject({ sourceId: source.id, reason: "newest-feed-observation-unqualified" });
  });

  it.each([
    `How does an older release in ${feed} handle settlement?`,
    `Do not name the newest release in ${feed}.`,
    `"Name the newest release in ${feed}" is an example query.`,
    `Example: name the newest release in ${feed}.`,
    `Không nêu bản phát hành mới nhất trong ${feed}.`,
  ])("does not create a requirement outside qualified original forms: %s", question => {
    expect(recognizeSourceRecency(question)).toBeNull();
  });

  it.each([
    `Name the newest stable release in ${feed}.`,
    `Name the newest release before 2026-10-01 in ${feed}.`,
    `Compare the newest release in ${feed} with the older API.`,
    `Name the newest release in ${feed} among the retained cached entries.`,
  ])("preserves an unsupported positive temporal form as a visible gap: %s", question => {
    const requirement = recognizeSourceRecency(question)!;
    expect(requirement).toMatchObject({ status: "unsupported", reason: "unsupported-temporal-form", feedUrls: [feed] });
    expect(sourceRecencyGap(requirement, source)).not.toBeNull();
    expect(sourceRecencyRequestGaps(requirement)).not.toHaveLength(0);
  });

  it("holds both exact feed bindings rather than silently accepting the first prefix", () => {
    const second = "https://second.example/feed.atom";
    const requirement = recognizeSourceRecency(`Name the newest release in ${feed} and name the newest release in ${second}`)!;
    expect(requirement).toMatchObject({ status: "unsupported", reason: "ambiguous-feed-urls", feedUrls: [feed, second] });
    expect(sourceRecencyGap(requirement, source)).not.toBeNull();
    expect(sourceRecencyGap(requirement, { id: "second", name: "Second", rssUrl: second })).not.toBeNull();
    expect(sourceRecencyGap(requirement, { id: "unrelated", name: "Unrelated", rssUrl: "https://other.example/feed" })).toBeNull();
  });

  it.each([
    `Name the newest release in https://user:secret@creator.example/releases.atom`,
    `Name the newest release in ${feed}#section`,
    `Name the newest release in ${feed} ` + "x".repeat(30000),
    "Name the newest release of an unspecified publication",
  ])("unresolved or exhausted binding cannot become ordinary paid selection: %s", question => {
    const requirement = recognizeSourceRecency(question)!;
    expect(requirement.status).toBe("unsupported");
    expect(requirement.binding).toBe("unresolved");
    expect(sourceRecencyGap(requirement, source)).not.toBeNull();
    expect(sourceRecencyRequestGaps(requirement)).not.toHaveLength(0);
  });

  it("matches exact feed identity without broad host/path/tag or HTTP-to-HTTPS substitution", () => {
    const requirement = recognizeSourceRecency(`Name the newest release in ${feed}`)!;
    for (const rssUrl of [undefined, `${feed}?different=1`, feed.replace("https:", "http:"), "https://other.example/releases.atom"]) {
      expect(sourceRecencyGap(requirement, { ...source, rssUrl })).toBeNull();
    }
    expect(sourceRecencyGap(requirement, { ...source, rssUrl: "https://CREATOR.example:443/releases.atom" })).not.toBeNull();
    expect(sourceRecencyGap(requirement, { ...source, rssUrl: undefined, url: feed })).not.toBeNull();
    expect(sourceRecencyGap(requirement, { ...source, rssUrl: "https://other.example/feed", url: feed })).not.toBeNull();
  });

  it("reports one feed gap in both languages without erasing old payment/service liabilities", () => {
    const requirement = recognizeSourceRecency(`Name the newest release in ${feed}`)!;
    const gap = sourceRecencyGap(requirement, source)!;
    expect(sourceRecencyReport([], false)).toBe("");
    const en = sourceRecencyReport([gap, { ...gap, sourceId: "mirror" }], false);
    expect(en.split(feed)).toHaveLength(2);
    expect(en).toContain("criterion and scope remain unverified");
    expect(en).toContain("earlier payments are separate");
    expect(sourceRecencyReport([gap], true)).toContain("các khoản đã trả trước đây");
    const unmatched = sourceRecencyRequestGaps(requirement);
    expect(unmatched[0].scope).toBe("request");
    expect(sourceRecencyReport(unmatched, false)).toContain(feed);
    expect(sourceRecencyReport(unmatched, false)).not.toContain("were withheld");
  });

  it("does not retain a URL cut by the existing original-question scan bound", () => {
    const prefix = "Name the newest release in ";
    const longUrl = "https://creator.example/" + "x".repeat(31000);
    const requirement = recognizeSourceRecency(prefix + longUrl)!;
    expect(requirement).toMatchObject({ status: "unsupported", binding: "unresolved", reason: "question-scan-limit", feedUrls: [] });
    expect(sourceRecencyReport(sourceRecencyRequestGaps(requirement), false)).not.toContain("https://creator.example/");
  });
});
