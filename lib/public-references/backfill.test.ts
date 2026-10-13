import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PublicReference } from "./catalog";
import type { PublicReferenceItem } from "./archive";
import type { FetchLimits } from "../net/public-fetch";
import { UnsafeTargetError } from "../net/public-fetch";
import * as publicFetch from "../net/public-fetch";
import { approvedBackfillUrl, backfillPublicReference, parseBackfillArgs, readBackfillArticle, readBackfillCheckpoint, type BackfillDependencies, type BackfillOptions } from "./backfill";

const reference: PublicReference = { id: "public:test", name: "Publisher", url: "https://publisher.test/", rssUrl: "https://publisher.test/feed.xml", description: "Public", tags: [], active: true, items: [] };
const scratch: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of scratch.splice(0)) {
    if (!dir.startsWith(join(tmpdir(), "keryx-backfill-"))) throw new Error("Unexpected test directory");
    await rm(dir, { recursive: true, force: true });
  }
});

describe("historical article extraction transport", () => {
  it("pins HTTPS/zero redirects/byte/time limits and preserves observed excerpt extraction", async () => {
    const transport = vi.spyOn(publicFetch, "fetchPublicBytes").mockResolvedValueOnce({ bytes: new TextEncoder().encode("An old public document."), contentType: "text/plain", finalUrl: "https://publisher.test/old" });
    const article = await readBackfillArticle("https://publisher.test/old");
    expect(article).toMatchObject({ kind: "text", text: "An old public document.", finalUrl: "https://publisher.test/old", truncated: false });
    expect(transport).toHaveBeenCalledWith("https://publisher.test/old", expect.objectContaining({ maxHops: 0, httpsOnly: true, requireFullResponse: true, timeoutMs: 8000, maxBytes: 2 * 1024 * 1024 }));
  });
  it("refuses changed response identity before extraction", async () => {
    vi.spyOn(publicFetch, "fetchPublicBytes").mockResolvedValueOnce({ bytes: new TextEncoder().encode("Unapproved body"), contentType: "text/plain", finalUrl: "https://other.test/old" });
    await expect(readBackfillArticle("https://publisher.test/old")).rejects.toThrow("article-redirect-refused");
  });
  it("treats successful captcha/verification HTML as an access failure", async () => {
    vi.spyOn(publicFetch, "fetchPublicBytes").mockResolvedValueOnce({ bytes: new TextEncoder().encode("<html>Verify you are human. CAPTCHA</html>"), contentType: "text/html", finalUrl: "https://publisher.test/old" });
    await expect(readBackfillArticle("https://publisher.test/old")).rejects.toThrow("publisher-verification-required");
  });
  it("extracts public HTML through the existing bounded isolated article helper", async () => {
    const words = "Old public evidence with context and qualifications. ".repeat(30);
    vi.spyOn(publicFetch, "fetchPublicBytes").mockResolvedValueOnce({ bytes: new TextEncoder().encode(`<html><head><title>Historical source</title></head><body><main><p>${words}</p></main></body></html>`), contentType: "text/html", finalUrl: "https://publisher.test/old" });
    expect(await readBackfillArticle("https://publisher.test/old")).toMatchObject({ kind: "html", title: "Historical source", finalUrl: "https://publisher.test/old", truncated: false });
  });
});
async function setup(extra: Partial<BackfillOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "keryx-backfill-")); scratch.push(dir);
  const options: BackfillOptions = { checkpointPath: join(dir, "checkpoint.json"), storeBinding: "isolated-store", apply: true, durationMs: 60_000, ...extra };
  let tick = 1_000_000;
  let current: PublicReference | null = reference;
  const bodies = new Map<string, { text: string; contentType: string }>([
    ["https://publisher.test/robots.txt", { text: "User-agent: *\nAllow: /\nSitemap: https://publisher.test/sitemap.xml", contentType: "text/plain" }],
    [reference.rssUrl, { text: "<rss><channel/></rss>", contentType: "application/rss+xml" }],
    [reference.url, { text: "<html><main>Publisher</main></html>", contentType: "text/html" }],
    ["https://publisher.test/sitemap.xml", { text: '<urlset><url><loc>https://publisher.test/2010/a</loc></url><url><loc>https://publisher.test/2011/b</loc></url></urlset>', contentType: "application/xml" }],
  ]);
  const existing = new Map<string, PublicReferenceItem>();
  const archiveItems = vi.fn(async (_id: string, items: PublicReferenceItem[]) => {
    let added = 0, updated = 0;
    for (const item of items) { if (existing.has(item.id)) updated++; else added++; existing.set(item.id, item); }
    return { added, updated };
  });
  const fetchDocument = vi.fn(async (url: string, _limits?: FetchLimits) => {
    const body = bodies.get(url);
    if (!body) throw new Error("missing-fixture");
    return { ...body, finalUrl: url };
  });
  const readArticle = vi.fn(async (url: string) => ({ finalUrl: url, kind: "html" as const, title: "Historical article", text: `Article body for ${url}`, truncated: false }));
  const dependencies: BackfillDependencies = { loadReference: async () => current, archiveItems, fetchDocument, readArticle, now: () => tick,
    wait: async ms => { tick += ms; } };
  return { options, dependencies, bodies, existing, archiveItems, fetchDocument, readArticle, setReference: (next: PublicReference | null) => { current = next; } };
}
describe("bounded resumable historical backfill", () => {
  it("archives older sitemap articles as excerpts without deleting existing content", async () => {
    const s = await setup();
    s.existing.set("retained", { id: "retained", title: "Existing", content: "Must remain", summary: "", link: "https://publisher.test/older", deliveryKind: "excerpt" });
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report).toMatchObject({ status: "complete", documents: 2, added: 2, remaining: 0, cumulativeDocuments: 2, historicalSupported: true });
    expect(s.existing.get("retained")?.content).toBe("Must remain");
    expect([...s.existing.values()].filter(item => item.id !== "retained").every(item => item.deliveryKind === "excerpt")).toBe(true);
    expect(s.fetchDocument.mock.calls.every(([, limits]) => limits?.maxHops === 0 && limits.httpsOnly === true)).toBe(true);
  });
  it("previews real candidate discovery without article requests or database writes, then applies its queue", async () => {
    const s = await setup({ apply: false });
    const preview = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(preview).toMatchObject({ status: "preview", documents: 0, candidates: 2, remaining: 2 });
    expect(s.archiveItems).not.toHaveBeenCalled(); expect(s.readArticle).not.toHaveBeenCalled();
    const applied = await backfillPublicReference(reference, { ...s.options, apply: true }, s.dependencies);
    expect(applied).toMatchObject({ status: "complete", added: 2 });
  });
  it("retains capacity-exhausted work and supports more than 100 cumulative documents across runs", async () => {
    const s = await setup({ maxDocuments: 65, durationMs: 180_000 });
    s.bodies.set("https://publisher.test/sitemap.xml", { text: `<urlset>${Array.from({ length: 130 }, (_, i) => `<url><loc>https://publisher.test/old/${i}</loc></url>`).join("")}</urlset>`, contentType: "application/xml" });
    const first = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(first).toMatchObject({ status: "incomplete", documents: 65, remaining: 65 });
    const second = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(second).toMatchObject({ status: "complete", cumulativeDocuments: 130 });
    expect(s.existing.size).toBe(130);
    const third = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(third).toMatchObject({ status: "complete", documents: 0, added: 0 });
  });
  it("retains page budget overflow instead of silently ending historical discovery", async () => {
    const s = await setup({ maxPages: 1, apply: false });
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report.pages).toBe(1); expect(report.remaining).toBeGreaterThan(0);
    const checkpoint = await readBackfillCheckpoint(s.options.checkpointPath, reference, s.options.storeBinding);
    expect(checkpoint?.queue.some(work => work.kind === "sitemap")).toBe(true);
  });
  it("deduplicates canonical articles and breaks sitemap and feed pagination cycles", async () => {
    const s = await setup();
    s.bodies.set(reference.rssUrl, { text: `<feed xmlns="http://www.w3.org/2005/Atom"><link rel="next" href="/feed.xml"/><entry><title>A</title><link href="/2010/a?utm_source=feed"/><summary>Old abstract</summary></entry></feed>`, contentType: "application/atom+xml" });
    s.bodies.set("https://publisher.test/sitemap.xml", { text: '<sitemapindex><sitemap><loc>https://publisher.test/sitemap.xml</loc></sitemap><sitemap><loc>https://publisher.test/more.xml</loc></sitemap></sitemapindex>', contentType: "application/xml" });
    s.bodies.set("https://publisher.test/more.xml", { text: '<urlset><url><loc>https://publisher.test/2010/a#fragment</loc></url><url><loc>https://publisher.test/2010/a</loc></url></urlset>', contentType: "application/xml" });
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report).toMatchObject({ status: "complete", documents: 1 });
    expect(s.fetchDocument.mock.calls.filter(([url]) => url === "https://publisher.test/sitemap.xml")).toHaveLength(1);
    expect(s.readArticle).toHaveBeenCalledExactlyOnceWith("https://publisher.test/2010/a", expect.any(AbortSignal));
  });
  it("retains publisher feed content when the historical article is unavailable and retries later", async () => {
    const s = await setup();
    s.bodies.set("https://publisher.test/sitemap.xml", { text: "<urlset/>", contentType: "application/xml" });
    s.bodies.set(reference.rssUrl, { text: '<rss><channel><item><title>Lost article</title><link>https://publisher.test/lost</link><description>Retained historical abstract</description></item></channel></rss>', contentType: "application/rss+xml" });
    s.readArticle.mockRejectedValueOnce(new Error("article-unavailable"));
    const first = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(first.status).toBe("incomplete"); expect(s.existing.size).toBe(1);
    expect([...s.existing.values()][0]?.deliveryKind).toBe("abstract");
    const second = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(second.status).toBe("complete"); expect(s.existing.size).toBe(1);
    expect([...s.existing.values()][0]?.deliveryKind).toBe("excerpt");
  });
  it("refuses off-origin, HTTP, credential, port and script targets", async () => {
    const s = await setup();
    s.bodies.set("https://publisher.test/sitemap.xml", { text: '<urlset><url><loc>https://other.test/old</loc></url><url><loc>http://publisher.test/old</loc></url><url><loc>https://user:secret@publisher.test/old</loc></url><url><loc>https://publisher.test:8443/old</loc></url><url><loc>javascript:alert(1)</loc></url><url><loc>https://publisher.test/2010/a</loc></url></urlset>', contentType: "application/xml" });
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report.issues["target-outside-approved-origin"]).toBe(5);
    expect(s.readArticle.mock.calls.map(([url]) => url)).toEqual(["https://publisher.test/2010/a"]);
    expect(approvedBackfillUrl("https://sub.publisher.test/a", reference)).toBeNull();
    expect(approvedBackfillUrl("https://publisher.test.evil/a", reference)).toBeNull();
  });
  it("rejects oversized publisher URLs before checkpoint admission and preserves valid resumable work", async () => {
    const s = await setup({ apply: false });
    s.bodies.set("https://publisher.test/sitemap.xml", { text: `<urlset><url><loc>https://publisher.test/${"x".repeat(2050)}</loc></url><url><loc>https://publisher.test/valid-old</loc></url></urlset>`, contentType: "application/xml" });
    const preview = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(preview.issues["target-url-too-long"]).toBe(1); expect(preview.candidates).toBe(1);
    const checkpoint = await readBackfillCheckpoint(s.options.checkpointPath, reference, s.options.storeBinding);
    expect(checkpoint?.queue.map(work => work.url)).toEqual(["https://publisher.test/valid-old"]);
    const resumed = await backfillPublicReference(reference, { ...s.options, apply: true }, s.dependencies);
    expect(resumed).toMatchObject({ status: "incomplete", documents: 1, cumulativeDocuments: 1, coverageGaps: 1 });
  });
  it("retains off-origin historical coverage gaps across preview, apply and subsequent resume", async () => {
    const s = await setup({ apply: false });
    s.bodies.set("https://publisher.test/sitemap.xml", { text: '<urlset><url><loc>https://other.test/old</loc></url><url><loc>https://publisher.test/valid-old</loc></url></urlset>', contentType: "application/xml" });
    const preview = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(preview).toMatchObject({ status: "preview", coverageGaps: 1, candidates: 1 });
    const applied = await backfillPublicReference(reference, { ...s.options, apply: true }, s.dependencies);
    expect(applied).toMatchObject({ status: "incomplete", coverageGaps: 1, remaining: 0 });
    expect(applied.issues["target-outside-approved-origin"]).toBe(1);
    const resumed = await backfillPublicReference(reference, { ...s.options, apply: true }, s.dependencies);
    expect(resumed).toMatchObject({ status: "incomplete", coverageGaps: 1, remaining: 0, documents: 0 });
    expect(resumed.issues["target-outside-approved-origin"]).toBe(1);
  });
  it("preserves allowed feed excerpts even when robots prohibits the linked original, without duplicate feed writes", async () => {
    const s = await setup();
    s.bodies.set("https://publisher.test/robots.txt", { text: "User-agent: *\nDisallow: /private-old\nSitemap: https://publisher.test/sitemap.xml", contentType: "text/plain" });
    s.bodies.set("https://publisher.test/sitemap.xml", { text: "<urlset/>", contentType: "application/xml" });
    s.bodies.set(reference.rssUrl, { text: '<rss><channel><item><title>Lost article</title><link>https://publisher.test/private-old</link><description>Publisher exposed this historical feed abstract</description></item></channel></rss>', contentType: "application/rss+xml" });
    const first = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(first).toMatchObject({ status: "incomplete", added: 1, remaining: 1 });
    expect(first.issues["robots-excluded"]).toBe(1); expect(s.readArticle).not.toHaveBeenCalled();
    expect(s.archiveItems).toHaveBeenCalledExactlyOnceWith(reference.id, [expect.objectContaining({ deliveryKind: "abstract", content: "Publisher exposed this historical feed abstract" })], "feed");
    const second = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(second).toMatchObject({ status: "incomplete", remaining: 1, added: 0 });
    expect(s.archiveItems).toHaveBeenCalledTimes(1); expect(s.readArticle).not.toHaveBeenCalled();
  });
  it("allows only exact approved secondary RSS origin and checks its own robots", async () => {
    const other = { ...reference, rssUrl: "https://feeds.test/feed.xml" };
    const s = await setup(); s.setReference(other);
    s.bodies.set("https://feeds.test/robots.txt", { text: "User-agent: *\nAllow: /", contentType: "text/plain" });
    s.bodies.set(other.rssUrl, { text: '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="https://feeds.test/a"/></entry></feed>', contentType: "application/atom+xml" });
    await backfillPublicReference(other, s.options, s.dependencies);
    expect(s.fetchDocument).toHaveBeenCalledWith("https://feeds.test/robots.txt", expect.any(Object));
    expect(s.readArticle.mock.calls.map(([url]) => url)).toContain("https://feeds.test/a");
  });
  it("refuses off-origin final redirects and never archives the redirected body", async () => {
    const s = await setup();
    s.readArticle.mockResolvedValueOnce({ finalUrl: "https://other.test/article", text: "Wrong publisher", kind: "html", title: "Wrong", truncated: false });
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report.issues["article-redirect-refused"]).toBe(1); expect(report.remaining).toBe(1);
    expect([...s.existing.values()].some(item => item.content === "Wrong publisher")).toBe(false);
  });
  it("fails closed on robots 403/unavailability and retains work for retry", async () => {
    const s = await setup(); s.bodies.delete("https://publisher.test/robots.txt");
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report.issues["robots-unavailable"]).toBe(1);
    expect(s.fetchDocument).toHaveBeenCalledTimes(1); expect(s.readArticle).not.toHaveBeenCalled(); expect(s.archiveItems).not.toHaveBeenCalled();
    expect(report.remaining).toBe(2);
  });
  it.each([404, 410])("permits exact robots absence status %i without treating network failures as absence", async status => {
    const s = await setup();
    s.fetchDocument.mockRejectedValueOnce(new UnsafeTargetError(`the feed answered ${status}`));
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report.issues["robots-unavailable"]).toBeUndefined();
    expect(s.fetchDocument.mock.calls.map(([url]) => url)).toContain(reference.rssUrl);
    expect(report.status).toBe("unsupported");
  });
  it.each([401, 403, 429, 500, 503])("retains work when robots answers protected/unreachable status %i", async status => {
    const s = await setup();
    s.fetchDocument.mockRejectedValueOnce(new UnsafeTargetError(`the feed answered ${status}`));
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report.issues["robots-unavailable"]).toBe(1); expect(s.fetchDocument).toHaveBeenCalledTimes(1);
    expect(s.readArticle).not.toHaveBeenCalled(); expect(report.remaining).toBe(2);
  });
  it("keeps robots-excluded articles queued and observes publisher pacing", async () => {
    const s = await setup();
    s.bodies.set("https://publisher.test/robots.txt", { text: "User-agent: Keryx-FeedCheck\nDisallow: /2010\nCrawl-delay: 3\nSitemap: https://publisher.test/sitemap.xml", contentType: "text/plain" });
    const waits: number[] = [];
    const original = s.dependencies.wait!;
    s.dependencies.wait = async (ms, signal) => { waits.push(ms); await original(ms, signal); };
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report.issues["robots-excluded"]).toBe(1); expect(report.remaining).toBe(1);
    expect(s.readArticle.mock.calls.map(([url]) => url)).toEqual(["https://publisher.test/2011/b"]);
    expect(waits.every(ms => ms >= 3000)).toBe(true);
  });
  it("retains malformed sitemap failures and does not claim completion", async () => {
    const s = await setup();
    s.bodies.set("https://publisher.test/sitemap.xml", { text: "<urlset><url></urlset>", contentType: "application/xml" });
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report.status).toBe("incomplete"); expect(report.issues["malformed-xml"]).toBe(1);
    expect((await readBackfillCheckpoint(s.options.checkpointPath, reference, s.options.storeBinding))?.queue[0]?.kind).toBe("sitemap");
  });
  it("reports unsupported history when publisher exposes no actual sitemap/pagination/archive", async () => {
    const s = await setup();
    s.bodies.set("https://publisher.test/robots.txt", { text: "User-agent: *\nAllow: /", contentType: "text/plain" });
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report.status).toBe("unsupported"); expect(report.historicalSupported).toBe(false);
    expect(s.fetchDocument.mock.calls.map(([url]) => url)).toEqual(["https://publisher.test/robots.txt", reference.rssUrl, reference.url]);
  });
  it("follows root Articles index to older articles outside the current feed before enrichment reads", async () => {
    const s = await setup({ maxDocuments: 1, maxPages: 3 });
    s.bodies.set("https://publisher.test/robots.txt", { text: "User-agent: *\nAllow: /", contentType: "text/plain" });
    s.bodies.set(reference.rssUrl, { text: '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Current article</title><link href="/2026/current"/><published>2026-10-12T00:00:00Z</published><summary>Current feed body</summary></entry></feed>', contentType: "application/atom+xml" });
    s.bodies.set(reference.url, { text: '<html><nav><a href="/articles/">Articles</a><a href="/newsletter">Newsletter</a></nav><main>Publisher landing</main></html>', contentType: "text/html" });
    s.bodies.set("https://publisher.test/articles/", { text: '<html><main><article><a href="/2010/outside-feed">Historical research article</a></article></main></html>', contentType: "text/html" });
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report).toMatchObject({ historicalSupported: true, documents: 1, remaining: 1, status: "incomplete" });
    expect(s.readArticle.mock.calls.map(([url]) => url)).toEqual(["https://publisher.test/2010/outside-feed"]);
    expect([...s.existing.values()].map(item => item.link)).toEqual(["https://publisher.test/2010/outside-feed"]);
    const resumed = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(resumed).toMatchObject({ status: "complete", cumulativeDocuments: 2 });
    expect([...s.existing.values()].map(item => item.link)).toContain("https://publisher.test/2026/current");
  });
  it("persists cancelled article and resumes without replaying completed pages", async () => {
    const controller = new AbortController();
    const s = await setup({ signal: controller.signal });
    s.readArticle.mockImplementationOnce(async () => { controller.abort(); throw new DOMException("Cancelled", "AbortError"); });
    const first = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(first.status).toBe("cancelled"); expect(first.remaining).toBe(2);
    const callsBefore = s.fetchDocument.mock.calls.length;
    const second = await backfillPublicReference(reference, { ...s.options, signal: undefined }, s.dependencies);
    expect(second.status).toBe("complete");
    expect(s.fetchDocument.mock.calls.slice(callsBefore).map(([url]) => url)).toEqual(["https://publisher.test/robots.txt"]);
  });
  it("honors cancellation even when an injected article reader finishes without throwing", async () => {
    const controller = new AbortController();
    const s = await setup({ signal: controller.signal });
    s.readArticle.mockImplementationOnce(async url => { controller.abort(); return { finalUrl: url, text: "Finished after cancellation", title: "Late", kind: "html", truncated: false }; });
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report.status).toBe("cancelled"); expect(report.remaining).toBe(2);
    expect(s.archiveItems).not.toHaveBeenCalled();
  });
  it("retains failed database writes for resume instead of claiming the article was completed", async () => {
    const s = await setup();
    s.archiveItems.mockRejectedValueOnce(new Error("archive-unavailable"));
    const first = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(first).toMatchObject({ status: "incomplete", remaining: 1, cumulativeDocuments: 1 });
    expect(first.issues["archive-unavailable"]).toBe(1);
    const second = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(second).toMatchObject({ status: "complete", remaining: 0, cumulativeDocuments: 2 });
  });
  it("does not crawl or reenable inactive sources, including deactivation during extraction", async () => {
    const s = await setup(); s.setReference({ ...reference, active: false });
    expect((await backfillPublicReference(reference, s.options, s.dependencies)).status).toBe("inactive");
    expect(s.fetchDocument).not.toHaveBeenCalled();
    s.setReference(reference);
    s.readArticle.mockImplementationOnce(async url => { s.setReference({ ...reference, active: false }); return { finalUrl: url, kind: "html", title: "Old", text: "Old", truncated: false }; });
    const report = await backfillPublicReference(reference, s.options, s.dependencies);
    expect(report.status).toBe("inactive"); expect(s.archiveItems).not.toHaveBeenCalled(); expect(report.remaining).toBe(2);
  });
  it("binds checkpoints to source URLs and selected storage, and rejects tampered off-origin queues", async () => {
    const s = await setup({ apply: false });
    await backfillPublicReference(reference, s.options, s.dependencies);
    await expect(readBackfillCheckpoint(s.options.checkpointPath, { ...reference, rssUrl: "https://publisher.test/other.xml" }, s.options.storeBinding)).rejects.toThrow("checkpoint-source-mismatch");
    await expect(readBackfillCheckpoint(s.options.checkpointPath, reference, "other-store")).rejects.toThrow("checkpoint-source-mismatch");
    const parsed = JSON.parse(await readFile(s.options.checkpointPath, "utf8"));
    parsed.queue[0].url = "https://other.test/a";
    await writeFile(s.options.checkpointPath, JSON.stringify(parsed));
    await expect(backfillPublicReference(reference, s.options, s.dependencies)).rejects.toThrow("invalid-checkpoint-target");
  });
  it("refuses simultaneous owners and does not remove another owner's lock", async () => {
    const s = await setup(); await writeFile(`${s.options.checkpointPath}.lock`, "existing-owner");
    await expect(backfillPublicReference(reference, s.options, s.dependencies)).rejects.toThrow("checkpoint-already-owned");
    expect(await readFile(`${s.options.checkpointPath}.lock`, "utf8")).toBe("existing-owner");
  });
});

describe("strict finite backfill CLI arguments", () => {
  const valid = ["--reference", "public:test", "--checkpoint", resolve("checkpoint.json")];
  it("defaults to read-only discovery and exposes finite per-run budgets", () => {
    expect(parseBackfillArgs(valid)).toMatchObject({ apply: false, maxDocuments: 25, maxPages: 20, durationMs: 60_000, paceMs: 1000 });
    expect(parseBackfillArgs([...valid, "--apply", "--max-documents", "200"])).toMatchObject({ apply: true, maxDocuments: 200 });
  });
  const invalid: string[][] = [[], ["--help"], [...valid, "--apply", "--dry-run"], [...valid, "--reference", "public:other"], [...valid, "--max-pages", "0"], [...valid, "--max-documents", "Infinity"], [...valid, "--duration-ms", "-1"], [...valid, "--pace-ms", "0"], [...valid, "--database", "relative.sqlite"], [...valid, "--unknown", "value"]];
  it.each(invalid.map(args => ({ args })))("refuses ambiguous/unbounded inputs $args", ({ args }) => {
    expect(() => parseBackfillArgs(args)).toThrow();
  });
});
