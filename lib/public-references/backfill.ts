import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, rm, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { fetchPublicDocument, fetchPublicBytes, UnsafeTargetError } from "../net/public-fetch";
import type { ArticleRead, ArticleReader } from "../web-research/article-reader";
import { canonicalPublicArticleUrl, publicReferenceItemId, publicReferenceItemSchema, type PublicReference } from "./catalog";
import type { PublicReferenceArchiveDb, PublicReferenceItem } from "./archive";
import { DISCOVERY_MAX_BYTES, parseArchiveHtml, parseDiscoveryXml, parseRobots, robotsAllows, type RobotsPolicy, type DiscoveredArticle } from "./backfill-parser";

const workSchema = z.object({ url: z.string().max(2048), kind: z.enum(["feed", "sitemap", "page", "article"]),
  landing: z.boolean().optional(), title: z.string().max(1000).optional(), publishedAt: z.string().datetime().optional(),
  feedItem: publicReferenceItemSchema.optional(), feedStored: z.boolean().optional(), attempts: z.number().int().nonnegative().default(0), failure: z.string().max(80).optional() }).strict();
export type BackfillWork = z.infer<typeof workSchema>;
const checkpointSchema = z.object({ format: z.literal("keryx-public-backfill-v1"), binding: z.string().regex(/^[a-f0-9]{64}$/),
  referenceId: z.string().max(100), storeBinding: z.string().min(1).max(2048),
  queue: z.array(workSchema), completed: z.array(z.string().max(2060)), historicalSupported: z.boolean(),
  documents: z.number().int().nonnegative(), pages: z.number().int().nonnegative(),
  lastRequests: z.record(z.string().max(2048), z.number().int().nonnegative()).default({}),
  delays: z.record(z.string().max(2048), z.number().nonnegative()).default({}),
  gaps: z.record(z.string().max(150), z.object({ code: z.string().max(80), targetDigest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()).default({}),
  updatedAt: z.string().datetime() }).strict();
export type BackfillCheckpoint = z.infer<typeof checkpointSchema>;
export interface BackfillOptions {
  checkpointPath: string;
  storeBinding: string;
  apply: boolean;
  maxDocuments?: number;
  maxPages?: number;
  durationMs?: number;
  paceMs?: number;
  signal?: AbortSignal;
}
export interface BackfillReport {
  referenceId: string;
  status: "complete" | "incomplete" | "unsupported" | "preview" | "cancelled" | "inactive";
  documents: number;
  pages: number;
  candidates: number;
  added: number;
  updated: number;
  remaining: number;
  cumulativeDocuments: number;
  historicalSupported: boolean;
  coverageGaps: number;
  issues: Record<string, number>;
}
export interface BackfillDependencies {
  loadReference: () => Promise<PublicReference | null>;
  archiveItems?: NonNullable<PublicReferenceArchiveDb["archivePublicReferenceItems"]>;
  fetchDocument?: typeof fetchPublicDocument;
  readArticle?: ArticleReader;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}
export function backfillSourceBinding(reference: PublicReference, storeBinding: string): string {
  return createHash("sha256").update(JSON.stringify({ id: reference.id, url: reference.url, rssUrl: reference.rssUrl, storeBinding })).digest("hex");
}
export function approvedBackfillUrl(raw: string, reference: PublicReference): string | null {
  if (raw.length > 2048) return null;
  const url = canonicalPublicArticleUrl(raw);
  if (!url || url.length > 2048) return null;
  const origin = new URL(url).origin;
  return [new URL(reference.url).origin, new URL(reference.rssUrl).origin].includes(origin) ? url : null;
}
function key(work: Pick<BackfillWork, "kind" | "url">): string { return `${work.kind}:${work.url}`; }
function finite(value: number | undefined, fallback: number, maximum: number, minimum = 1): number {
  const parsed = value ?? fallback;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error("invalid-backfill-limit");
  return parsed;
}
async function atomicCheckpoint(file: string, checkpoint: BackfillCheckpoint): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    try { await handle.writeFile(JSON.stringify(checkpoint)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}
export async function readBackfillCheckpoint(file: string, reference: PublicReference, storeBinding: string): Promise<BackfillCheckpoint | null> {
  let text: string;
  try { text = await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("checkpoint-unavailable"); }
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("invalid-checkpoint"); }
  const parsed = checkpointSchema.safeParse(value);
  if (!parsed.success) throw new Error("invalid-checkpoint");
  const checkpoint = parsed.data;
  if (checkpoint.binding !== backfillSourceBinding(reference, storeBinding) || checkpoint.referenceId !== reference.id || checkpoint.storeBinding !== storeBinding) throw new Error("checkpoint-source-mismatch");
  if (checkpoint.queue.some(work => approvedBackfillUrl(work.url, reference) !== work.url ||
    (work.feedItem && (work.feedItem.link !== work.url || work.feedItem.id !== publicReferenceItemId(reference.id, work.url))))) throw new Error("invalid-checkpoint-target");
  const completed = new Set(checkpoint.completed);
  if (completed.size !== checkpoint.completed.length || checkpoint.queue.some(work => completed.has(key(work))) || new Set(checkpoint.queue.map(key)).size !== checkpoint.queue.length) throw new Error("invalid-checkpoint-queue");
  return checkpoint;
}
function pausedWait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  return new Promise((ok, fail) => {
    const done = () => { signal.removeEventListener("abort", abort); ok(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); fail(new DOMException("Cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** Same bounded extraction helpers as readArticle, with redirects refused before a second socket. */
export async function readBackfillArticle(url: string, signal?: AbortSignal): Promise<ArticleRead> {
  const fetched = await fetchPublicBytes(url, { signal, httpsOnly: true, requireFullResponse: true, maxHops: 0,
    maxBytes: 2 * 1024 * 1024, timeoutMs: 8000,
    allowedContentTypes: ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/pdf"] });
  if (fetched.finalUrl !== url) throw new Error("article-redirect-refused");
  if (new URL(url).hostname === "openreview.net" && /^\/challenge\/?$/u.test(new URL(url).pathname)) throw new Error("publisher-verification-required");
  if (fetched.contentType === "application/pdf") {
    const result = await (await import("../web-research/pdf-reader")).extractPdfText(fetched.bytes, { signal, maxPages: 20, maxChars: 60_000, timeoutMs: 5000 });
    return { ...result, title: new URL(url).hostname, finalUrl: url, kind: "pdf" };
  }
  const text = new TextDecoder().decode(fetched.bytes);
  if (fetched.contentType === "text/plain" || fetched.contentType === "text/markdown") {
    if (fetched.bytes.length > 500_000) throw new Error("article-byte-limit");
    return (await import("../web-research/article-reader")).extractArticle(text, url, fetched.contentType);
  }
  // Successful challenge/paywall HTML is an access failure; no browser, credentials or bypass.
  if (/\b(?:verify (?:you are|that you are) human|checking your browser|enable javascript and cookies|captcha|access denied)\b/iu.test(text.slice(0, 60_000))) throw new Error("publisher-verification-required");
  return (await import("../web-research/html-reader")).extractHtml(text, url, signal);
}

/** One explicit finite run. Queue/checkpoint progress has no lifetime article limit. */
export async function backfillPublicReference(reference: PublicReference, options: BackfillOptions, dependencies: BackfillDependencies): Promise<BackfillReport> {
  const maxDocuments = finite(options.maxDocuments, 25, 10_000), maxPages = finite(options.maxPages, 20, 10_000);
  const durationMs = finite(options.durationMs, 60_000, 3_600_000), paceMs = finite(options.paceMs, 1000, 60_000, 1000);
  if (!isAbsolute(options.checkpointPath) || !options.storeBinding || options.storeBinding.length > 2048) throw new Error("explicit-checkpoint-and-store-required");
  if (options.apply && !dependencies.archiveItems) throw new Error("archive-write-unavailable");
  const report: BackfillReport = { referenceId: reference.id, status: "incomplete", documents: 0, pages: 0, candidates: 0,
    added: 0, updated: 0, remaining: 0, cumulativeDocuments: 0, historicalSupported: false, coverageGaps: 0, issues: {} };
  if (!reference.active || !(await dependencies.loadReference())?.active) { report.status = "inactive"; return report; }
  const file = resolve(options.checkpointPath), lockFile = `${file}.lock`;
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  let lock;
  try { lock = await open(lockFile, "wx", 0o600); }
  catch { throw new Error("checkpoint-already-owned"); }
  const controller = new AbortController(), now = dependencies.now ?? Date.now;
  const started = now(), deadline = started + durationMs;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, durationMs);
  const fetchDocument = dependencies.fetchDocument ?? fetchPublicDocument;
  const readArticle = dependencies.readArticle ?? readBackfillArticle;
  const wait = dependencies.wait ?? pausedWait;
  let checkpoint: BackfillCheckpoint | undefined;
  try {
    await lock.writeFile(JSON.stringify({ referenceId: reference.id, pid: process.pid, startedAt: new Date(started).toISOString() }));
    checkpoint = await readBackfillCheckpoint(file, reference, options.storeBinding) ?? {
      format: "keryx-public-backfill-v1", binding: backfillSourceBinding(reference, options.storeBinding), referenceId: reference.id, storeBinding: options.storeBinding,
      queue: [], completed: [], historicalSupported: false, documents: 0, pages: 0, lastRequests: {}, delays: {}, gaps: {}, updatedAt: new Date(now()).toISOString() };
    const completed = new Set(checkpoint.completed), queued = new Map(checkpoint.queue.map(work => [key(work), work])), attempted = new Set<string>();
    const issue = (code: string) => { report.issues[code] = (report.issues[code] ?? 0) + 1; };
    for (const gap of Object.values(checkpoint.gaps)) issue(gap.code);
    const coverageGap = (code: string, target: string) => {
      const targetDigest = createHash("sha256").update(target).digest("hex"), id = `${code}:${targetDigest}`;
      if (!checkpoint!.gaps[id]) { checkpoint!.gaps[id] = { code, targetDigest }; issue(code); }
    };
    const targetFailure = (url: string) => url.length > 2048 ? "target-url-too-long" : "target-outside-approved-origin";
    const enqueue = (work: Omit<BackfillWork, "attempts">) => {
      const url = approvedBackfillUrl(work.url, reference);
      if (!url) { coverageGap(targetFailure(work.url), work.url); return; }
      const parsed = workSchema.safeParse({ ...work, url, attempts: 0 });
      if (!parsed.success) { coverageGap("discovery-candidate-invalid", work.url); return; }
      const candidate = parsed.data;
      const prior = queued.get(key(candidate));
      if (prior) {
        // Feed observations can enrich a URL that a sitemap queued first, without another article.
        if (candidate.feedItem && !prior.feedItem) prior.feedItem = candidate.feedItem;
        if (candidate.title && !prior.title) prior.title = candidate.title;
        if (candidate.publishedAt && !prior.publishedAt) prior.publishedAt = candidate.publishedAt;
      } else if (!completed.has(key(candidate))) { queued.set(key(candidate), candidate); checkpoint!.queue.push(candidate); }
    };
    if (!checkpoint.queue.length && !checkpoint.completed.length) {
      enqueue({ url: reference.rssUrl, kind: "feed" }); enqueue({ url: reference.url, kind: "page", landing: true });
    }
    const save = async () => { checkpoint!.updatedAt = new Date(now()).toISOString(); await atomicCheckpoint(file, checkpoint!); };
    await save();
    const policies = new Map<string, RobotsPolicy | null>(), lastRequest = new Map(Object.entries(checkpoint.lastRequests));
    let sourceLastRequest = Math.max(-Infinity, ...lastRequest.values());
    const currentActive = async () => {
      const selected = await dependencies.loadReference();
      if (!selected?.active) { report.status = "inactive"; return false; }
      if (backfillSourceBinding(selected, options.storeBinding) !== checkpoint!.binding) throw new Error("reference-source-changed");
      return true;
    };
    const pace = async (origin: string, policy?: RobotsPolicy) => {
      const delay = Math.max(paceMs, policy?.delayMs ?? checkpoint!.delays[origin] ?? 0);
      const remaining = delay - (now() - Math.max(sourceLastRequest, lastRequest.get(origin) ?? -Infinity));
      if (remaining > 0) {
        if (now() + remaining >= deadline) { controller.abort(); throw new DOMException("Cancelled", "AbortError"); }
        await wait(remaining, controller.signal);
      }
      if (controller.signal.aborted || now() >= deadline) throw new DOMException("Cancelled", "AbortError");
      if (!await currentActive()) throw new Error("reference-inactive");
      sourceLastRequest = now(); lastRequest.set(origin, sourceLastRequest); checkpoint!.lastRequests[origin] = sourceLastRequest;
    };
    const policyFor = async (origin: string): Promise<RobotsPolicy | null> => {
      if (policies.has(origin)) return policies.get(origin)!;
      await pace(origin);
      let policy: RobotsPolicy | null = null;
      try {
        const robotsUrl = `${origin}/robots.txt`;
        const fetched = await fetchDocument(robotsUrl, { signal: controller.signal, maxHops: 0, httpsOnly: true, requireFullResponse: true, maxBytes: 512_000,
          timeoutMs: Math.min(8000, Math.max(1, deadline - now())), allowedContentTypes: ["text/plain"] });
        if (fetched.finalUrl !== robotsUrl) throw new Error("robots-redirect-refused");
        policy = parseRobots(fetched.text);
        checkpoint!.delays[origin] = policy.delayMs;
        for (const url of policy.sitemaps) enqueue({ url, kind: "sitemap" });
        if (policy.sitemaps.some(url => approvedBackfillUrl(url, reference))) checkpoint!.historicalSupported = true;
      } catch (error) {
        // RFC 9309 permits crawling when robots is explicitly absent. Authentication failures,
        // redirects, challenges and unreachable responses never become an allow-all fallback.
        if (error instanceof UnsafeTargetError && /^the feed answered (?:404|410)$/u.test(error.message)) policy = { rules: [], sitemaps: [], delayMs: 0 };
        else issue("robots-unavailable");
      }
      policies.set(origin, policy);
      return policy;
    };
    // Discover robots sitemap declarations even when the two initial discovery pages were completed by a preview.
    for (const origin of new Set([new URL(reference.url).origin, new URL(reference.rssUrl).origin])) {
      if (controller.signal.aborted || !await currentActive()) break;
      await policyFor(origin);
    }
    await save();
    for (;;) {
      if (controller.signal.aborted || now() >= deadline || !await currentActive()) break;
      const eligible = checkpoint.queue.filter(candidate => !attempted.has(key(candidate)) &&
        (candidate.kind === "article" ? options.apply && report.documents < maxDocuments : report.pages < maxPages));
      // Discover the bounded publisher listing batch first. Original reads then prefer articles
      // outside the already observed feed and genuinely older feed dates; all remaining work stays.
      const work = eligible.find(candidate => candidate.kind !== "article") ?? eligible.sort((a, b) =>
        Number(!!a.feedItem) - Number(!!b.feedItem) || (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""))[0];
      if (!work) break;
      attempted.add(key(work));
      const origin = new URL(work.url).origin;
      try {
        work.attempts++;
        if (work.kind === "article") {
          report.documents++;
          // The feed was already fetched under its own robots policy. A publisher restriction on
          // the linked original does not prohibit retaining that observed feed abstract/excerpt.
          if (work.feedItem && !work.feedStored) {
            if (!await currentActive() || controller.signal.aborted) break;
            const change = await dependencies.archiveItems!(reference.id, [work.feedItem], "feed");
            report.added += change.added; report.updated += change.updated; work.feedStored = true;
            await save();
          }
        } else report.pages++;
        const policy = await policyFor(origin);
        if (!policy) { work.failure = "robots-unavailable"; continue; }
        if (!robotsAllows(policy, work.url)) { work.failure = "robots-excluded"; issue(work.failure); continue; }
        await pace(origin, policy);
        if (work.kind === "article") {
          const article = await readArticle(work.url, controller.signal);
          if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
          if (approvedBackfillUrl(article.finalUrl, reference) !== work.url) throw new Error("article-redirect-refused");
          if (!article.text.trim()) throw new Error("article-extraction-empty");
          // Extraction observes content. It does not certify publisher completeness.
          const item: PublicReferenceItem = { id: publicReferenceItemId(reference.id, work.url), link: work.url,
            title: (article.title || work.title || new URL(work.url).hostname).slice(0, 1000), content: article.text.slice(0, 60_000), summary: article.text.slice(0, 1000),
            deliveryKind: "excerpt", ...(work.publishedAt ? { publishedAt: work.publishedAt } : {}) };
          if (!await currentActive() || controller.signal.aborted) break;
          const change = await dependencies.archiveItems!(reference.id, [item], "article", new Date(now()).toISOString());
          report.added += change.added; report.updated += change.updated; checkpoint.documents++;
        } else {
          const fetched = await fetchDocument(work.url, { signal: controller.signal, httpsOnly: true, requireFullResponse: true, maxHops: 0,
            maxBytes: DISCOVERY_MAX_BYTES, timeoutMs: Math.min(8000, Math.max(1, deadline - now())),
            allowedContentTypes: work.kind === "page" ? ["text/html", "application/xhtml+xml"] : ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml"] });
          if (approvedBackfillUrl(fetched.finalUrl, reference) !== work.url) throw new Error("discovery-redirect-refused");
          const discovery = work.kind === "page" ? parseArchiveHtml(fetched.text, work.url, !!work.landing) : parseDiscoveryXml(fetched.text, work.url);
          checkpoint.historicalSupported ||= discovery.historical;
          for (const page of discovery.pages) enqueue(page);
          for (const candidate of discovery.articles) {
            const url = approvedBackfillUrl(candidate.url, reference);
            if (!url) { coverageGap(targetFailure(candidate.url), candidate.url); continue; }
            enqueue({ url, kind: "article", ...(candidate.title ? { title: candidate.title } : {}), ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}),
              ...(work.kind === "feed" ? { feedItem: feedCandidate(reference, { ...candidate, url }) } : {}) });
          }
          checkpoint.pages++;
        }
        completed.add(key(work)); checkpoint.completed.push(key(work)); queued.delete(key(work));
        checkpoint.queue.splice(checkpoint.queue.indexOf(work), 1);
      } catch (error) {
        const code = controller.signal.aborted ? "cancelled" : error instanceof Error && /^(?:[a-z]+-)+[a-z]+$/u.test(error.message) ? error.message.slice(0, 80) : "request-or-extraction-unavailable";
        work.failure = code; issue(code);
      } finally { await save(); }
    }
    report.remaining = checkpoint.queue.length;
    report.candidates = checkpoint.queue.filter(work => work.kind === "article").length;
    report.cumulativeDocuments = checkpoint.documents;
    report.historicalSupported = checkpoint.historicalSupported;
    report.coverageGaps = Object.keys(checkpoint.gaps).length;
    if (report.status !== "inactive") report.status = controller.signal.aborted || now() >= deadline ? "cancelled" :
      !checkpoint.historicalSupported ? "unsupported" : !options.apply ? "preview" : checkpoint.queue.length || report.coverageGaps ? "incomplete" : "complete";
    await save();
    return report;
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
    await lock.close(); await rm(lockFile, { force: true });
  }
}
function feedCandidate(reference: PublicReference, article: DiscoveredArticle): PublicReferenceItem {
  const content = article.content ?? "";
  return { id: publicReferenceItemId(reference.id, article.url), link: article.url, title: article.title || "Untitled",
    summary: article.summary || content.slice(0, 1000), content, deliveryKind: content ? content.length > 500 ? "excerpt" : "abstract" : "metadata_only",
    ...(article.publishedAt ? { publishedAt: article.publishedAt } : {}) };
}

export interface BackfillCliOptions { referenceId: string; checkpointPath: string; databasePath?: string; apply: boolean; maxDocuments: number; maxPages: number; durationMs: number; paceMs: number }
export function parseBackfillArgs(args: string[]): BackfillCliOptions {
  const values = new Map<string, string>();
  let apply = false;
  const names = new Set(["--reference", "--checkpoint", "--database", "--max-documents", "--max-pages", "--duration-ms", "--pace-ms"]);
  let mode: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const name = args[i]!;
    if (name === "--apply" || name === "--dry-run") {
      if (mode) throw new Error("choose-one-backfill-mode");
      mode = name; apply = name === "--apply"; continue;
    }
    if (!names.has(name) || values.has(name) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error("invalid-backfill-arguments");
    values.set(name, args[++i]!);
  }
  const referenceId = values.get("--reference"), checkpointPath = values.get("--checkpoint"), databasePath = values.get("--database");
  if (!referenceId || !/^public:[a-z0-9-]{1,80}$/u.test(referenceId) || !checkpointPath || !isAbsolute(checkpointPath) || (databasePath && !isAbsolute(databasePath))) throw new Error("explicit-reference-checkpoint-required");
  const number = (name: string, fallback: number, max: number, min = 1) => {
    const raw = values.get(name);
    if (raw !== undefined && !/^\d+$/u.test(raw)) throw new Error("invalid-backfill-limit");
    return finite(raw === undefined ? undefined : Number(raw), fallback, max, min);
  };
  return { referenceId, checkpointPath: resolve(checkpointPath), ...(databasePath ? { databasePath: resolve(databasePath) } : {}), apply,
    maxDocuments: number("--max-documents", 25, 10_000), maxPages: number("--max-pages", 20, 10_000),
    durationMs: number("--duration-ms", 60_000, 3_600_000), paceMs: number("--pace-ms", 1000, 60_000, 1000) };
}
