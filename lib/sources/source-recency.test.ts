import { describe, expect, it } from "vitest";
import { recognizeSourceRecency, sourceRecencyGap, sourceRecencyReport, sourceRecencyRequestGaps } from "./source-recency";
import { ISSUE217_ORIGINAL_QUESTION } from "../../test-support/issue-217-request-fixture";

const feed = "https://creator.example/releases.atom";
const source = { id: "creator", name: "Creator releases", rssUrl: feed };

describe("original caller newest-feed safety constraint", () => {
  it("retains the full archived issue217 command as a hold without inventing an anaphoric feed scope", () => {
    const requirement = recognizeSourceRecency(ISSUE217_ORIGINAL_QUESTION)!;
    expect(requirement).toMatchObject({ kind: "newest-feed-entry", status: "unsupported", binding: "exact-feeds",
      feedUrls: ["https://github.com/tang-vu/keryx/releases.atom"], reason: "unsupported-temporal-form" });
    expect(ISSUE217_ORIGINAL_QUESTION.slice(requirement.originalSpan.start)).toMatch(/^In English, name the newest release tag/);
    expect(sourceRecencyGap(requirement, { ...source, rssUrl: requirement.feedUrls[0] })).not.toBeNull();
  });

  it.each([
    `I am evaluating release notes. Name the newest release in ${feed}.`,
    `I am evaluating release notes! Please identify the latest release in ${feed}.`,
    `Which version should I inspect? In English, name the newest release tag in ${feed}.`,
    `Read ${feed}. In English, name the newest release tag actually present in the feed.`,
    `Read ${feed}.\nName the newest release in the feed.`,
    `Read ${feed}\nName the newest release in the feed.`,
    `In English, name the newest release in ${feed}.`,
    `I'm evaluating release notes. Name the newest release in ${feed}.`,
  ])("withholds a contextual positive command without enabling native scope: %s", question => {
    const requirement = recognizeSourceRecency(question)!;
    expect(requirement).toMatchObject({ status: "unsupported", reason: "unsupported-temporal-form", binding: "exact-feeds", feedUrls: [feed] });
    expect(sourceRecencyGap(requirement, source)).not.toBeNull();
  });

  it.each([
    `Read ${feed}. Do not name the newest release; explain compatibility.`,
    `Read ${feed}. In English, do not name the newest release.`,
    `Read ${feed}. Don't name the newest release.`,
    `Read ${feed}. Example: name the newest release in the feed.`,
    `Read ${feed}. "Example. Name the newest release in the feed." Explain the example.`,
    `Read ${feed}. 'Example. Name the newest release in the feed.' Explain the example.`,
    `Read ${feed}. 'I'm giving an example. Name the newest release in the feed.' Explain the example.`,
    `Read ${feed}. \u201cExample. Name the newest release in the feed.\u201d Explain the example.`,
    `Read ${feed}. \u2018I'm giving an example. Name the newest release in the feed.\u2019 Explain the example.`,
    `Read ${feed}. \`Example. Name the newest release in the feed.\` Explain the example.`,
    `Read ${feed}. \`\`\`\nName the newest release in the feed.\n\`\`\` Explain the example.`,
    `I am evaluating notes; name the newest release in ${feed}.`,
    `The request to name the newest release in ${feed} is being discussed.`,
  ])("does not manufacture a command from negation, quoting or non-command prose: %s", question => {
    expect(recognizeSourceRecency(question)).toBeNull();
  });

  it("keeps multiple original feed URLs ambiguous without guessing an anaphoric binding", () => {
    const second = "https://second.example/feed.atom";
    const requirement = recognizeSourceRecency(`Read ${feed} and ${second}. Name the newest release in the feed.`)!;
    expect(requirement).toMatchObject({ status: "unsupported", reason: "ambiguous-feed-urls", feedUrls: [feed, second] });
    expect(sourceRecencyGap(requirement, source)).not.toBeNull();
    expect(sourceRecencyGap(requirement, { ...source, rssUrl: second })).not.toBeNull();
    expect(sourceRecencyGap(requirement, { ...source, rssUrl: "https://unrelated.example/feed" })).toBeNull();
  });

  it("withholds unresolved later-command source bindings rather than reverting to topical BUY", () => {
    const requirement = recognizeSourceRecency("I am evaluating releases. Name the newest release tag actually present in the feed.")!;
    expect(requirement).toMatchObject({ status: "unsupported", reason: "source-binding-unresolved", binding: "unresolved", feedUrls: [] });
    expect(sourceRecencyGap(requirement, source)).not.toBeNull();
  });

  it("recognizes a later actual command after a completed quoted example", () => {
    const requirement = recognizeSourceRecency(`"Example. Name the newest release." Name the newest release in ${feed}.`)!;
    expect(requirement).toMatchObject({ status: "unsupported", reason: "unsupported-temporal-form", feedUrls: [feed] });
  });

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
