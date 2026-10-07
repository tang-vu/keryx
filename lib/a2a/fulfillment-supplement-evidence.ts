import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import type { GatheredContent } from "../llm/reasoning-engine";
import type { QueryRun } from "../types";
import type { QuoteOption } from "../llm/quote-options";
import { enrollSupplementalSpans, type SupplementalSpanCapability } from "../llm/supplemental-span-capability";
export type { SupplementalSpanCapability } from "../llm/supplemental-span-capability";
import { fulfillmentObjectSha256 as objectHash, fulfillmentSha256 as hash,
  type FulfillmentAuthority, type FulfillmentInput, type A2aFulfillmentClaim } from "./failed-original-fulfillment-protocol";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const stamp = z.string().datetime().refine(value => new Date(value).toISOString() === value);
const fileName = z.string().regex(/^[a-z0-9-]+(?:\.(?:raw|body))?\.(txt|json)$/);
export const SUPPLEMENT_EVIDENCE_LIMITS = Object.freeze({ maximumSources: 4, maximumBodyBytes: 4800,
  maximumRawBytes: 200000, minimumSupport: 0.4, minimumTargetCoverage: 0.4 });
const sourceSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,80}$/), title: z.string().min(1).max(200),
  requestedUrl: z.string().url(), finalUrl: z.string().url(), retrievedAt: stamp, status: z.literal(200),
  rawFile: fileName, rawSha256: digest, rawBytes: z.number().int().min(1).max(SUPPLEMENT_EVIDENCE_LIMITS.maximumRawBytes),
  bodyFile: fileName, bodySha256: digest, bodyBytes: z.number().int().min(8).max(SUPPLEMENT_EVIDENCE_LIMITS.maximumBodyBytes),
  spans: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict()).min(1).max(8),
}).strict();
export const supplementaryInputSchema = z.object({ format: z.literal("keryx-original-supplementary-evidence-v1"),
  nativeClaimSha256: digest, originalAuthoritySha256: digest, originalPacketSha256: digest,
  originalInputSemanticSha256: digest, questionSha256: digest, ownerAuthorizationSha256: digest,
  executorCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sources: z.array(sourceSchema).min(1).max(SUPPLEMENT_EVIDENCE_LIMITS.maximumSources),
  payments: z.literal(0), creatorRewards: z.literal(0), provenance: z.literal("reviewed-free-official-verbatim-sections"),
}).strict();
type Base = { authority: FulfillmentAuthority; packet: { input: FulfillmentInput; gathered: GatheredContent[];
  packetSha256: string; inputSemanticSha256: string } };
type Binding = { nativeClaimSha256: string; ownerAuthorizationSha256: string; executorCommit: string };
declare const contextBrand: unique symbol;
export interface FulfillmentSupplementContext { readonly [contextBrand]: true;
  readonly contextSha256: string; readonly authoritySha256: string; readonly gathered: GatheredContent[] }
declare const capabilityBrand: unique symbol;
export interface FulfillmentEvidenceCapability { readonly [capabilityBrand]: true }
const contexts = new WeakMap<FulfillmentSupplementContext, { file: string; sha: string; base: Base; binding: Binding }>();
const capabilities = new WeakMap<FulfillmentEvidenceCapability, { context: FulfillmentSupplementContext; claimSha: string; runSha: string }>();
const refuse = (): never => { throw new Error("Original supplemental evidence refused"); };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

function protectedPath(file: string, directory = false) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file || fs.realpathSync(file) !== file) refuse();
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) refuse();
  if (process.platform !== "win32") {
    if (stat.uid !== process.getuid!() || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) refuse();
    for (let parent = path.dirname(file);; parent = path.dirname(parent)) {
      const ancestor = fs.lstatSync(parent);
      if (ancestor.isSymbolicLink() || !ancestor.isDirectory() || ancestor.mode & 0o022 ||
        ancestor.uid !== 0 && ancestor.uid !== process.getuid!()) refuse();
      if (parent === path.dirname(parent)) break;
    }
  }
}
function read(file: string, maximumBytes: number): Buffer {
  protectedPath(file); const before = fs.lstatSync(file, { bigint: true });
  if (before.size < BigInt(1) || before.size > BigInt(maximumBytes)) refuse();
  const signature = (s: fs.BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.mode, s.uid, s.gid, s.nlink].join(":");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (signature(fs.fstatSync(fd, { bigint: true })) !== signature(before)) refuse();
    const bytes = fs.readFileSync(fd); protectedPath(file);
    if (bytes.length !== Number(before.size) || signature(fs.fstatSync(fd, { bigint: true })) !== signature(before) ||
      signature(fs.lstatSync(file, { bigint: true })) !== signature(before)) refuse();
    return bytes;
  } finally { fs.closeSync(fd); }
}
function text(bytes: Buffer) { const value = bytes.toString("utf8"); if (!Buffer.from(value).equals(bytes)) refuse(); return value; }
function official(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash ||
    !["docs.arc.io", "developers.circle.com"].includes(u.hostname)) refuse();
  return u;
}
function snapshot(file: string, sha: string, base: Base, binding: Binding) {
  if (!digest.safeParse(sha).success) refuse(); protectedPath(path.dirname(file), true);
  const bytes = read(file, 65536); if (hash(bytes) !== sha) refuse();
  const input = supplementaryInputSchema.parse(JSON.parse(text(bytes)));
  if (input.nativeClaimSha256 !== binding.nativeClaimSha256 || input.ownerAuthorizationSha256 !== binding.ownerAuthorizationSha256 ||
    input.executorCommit !== binding.executorCommit || input.originalAuthoritySha256 !== objectHash(base.authority) ||
    input.originalPacketSha256 !== base.packet.packetSha256 || input.originalInputSemanticSha256 !== base.packet.inputSemanticSha256 ||
    input.questionSha256 !== base.packet.input.questionSha256 || hash(base.authority.question) !== input.questionSha256 ||
    !same(base.authority.input, base.packet.input) || objectHash(base.packet.input) !== base.packet.inputSemanticSha256 ||
    objectHash({ input: base.packet.input, gathered: base.packet.gathered }) !== base.packet.packetSha256 ||
    base.packet.gathered.length !== base.packet.input.selectedDocumentIds.length ||
    base.packet.gathered.some((source, index) => source.marker !== `S${index + 1}` ||
      source.sourceId !== `public:fulfillment:${base.packet.input.selectedDocumentIds[index]}` ||
      source.sourceKind !== "public-reference" || source.creatorRewardEligible !== false ||
      source.contentVersion !== hash(source.text) || source.webProvenance?.normalizedBodyHash !== hash(source.text)) ||
    new Set(input.sources.map(s => s.id)).size !== input.sources.length) refuse();
  let total = 0;
  const sources = input.sources.map((source, index): GatheredContent => {
    official(source.requestedUrl); const final = official(source.finalUrl);
    if (Date.parse(source.retrievedAt) > Date.now()) refuse();
    const raw = read(path.join(path.dirname(file), source.rawFile), SUPPLEMENT_EVIDENCE_LIMITS.maximumRawBytes);
    const body = read(path.join(path.dirname(file), source.bodyFile), SUPPLEMENT_EVIDENCE_LIMITS.maximumBodyBytes);
    if (raw.length !== source.rawBytes || hash(raw) !== source.rawSha256 || body.length !== source.bodyBytes || hash(body) !== source.bodySha256) refuse();
    const rawText = text(raw), bodyText = text(body);
    if (source.spans.some((s, i) => s.end <= s.start || s.end > rawText.length || i > 0 && s.start < source.spans[i - 1].end) ||
      source.spans.map(s => rawText.slice(s.start, s.end)).join("\n\n") !== bodyText) refuse();
    total += body.length; if (total > SUPPLEMENT_EVIDENCE_LIMITS.maximumBodyBytes) refuse();
    const id = `public:fulfillment:supplement:${source.id}`;
    if (base.packet.gathered.some(s => s.sourceId === id || s.itemId === source.id)) refuse();
    return { sourceId: id, sourceName: source.title, marker: `S${base.packet.gathered.length + index + 1}`, text: bodyText,
      sourceKind: "public-reference", creatorRewardEligible: false, itemId: source.id, itemTitle: source.title,
      itemUrl: source.finalUrl, contentVersion: source.bodySha256,
      requestedSource: { urls: [source.requestedUrl], readScope: "bounded-whole-document" },
      webProvenance: { retrievedAt: source.retrievedAt, publisherGroup: final.hostname, normalizedBodyHash: source.bodySha256,
        extraction: "text", truncated: true } };
  });
  const gathered = [...structuredClone(base.packet.gathered), ...sources];
  return { gathered, authoritySha256: sha, contextSha256: objectHash({ originalPacketSha256: input.originalPacketSha256,
    supplementaryInputSha256: sha, gathered }) };
}
/** Protected, acknowledged manifest bytes grant evidence validation only; no supplier or payment authority. */
export function readBoundSupplementaryContext(file: string, sha: string, base: Base, binding: Binding): FulfillmentSupplementContext {
  const clonedBase = structuredClone(base), clonedBinding = structuredClone(binding);
  const value = Object.freeze(snapshot(file, sha, clonedBase, clonedBinding)) as FulfillmentSupplementContext;
  contexts.set(value, { file, sha, base: clonedBase, binding: clonedBinding }); return value;
}
function current(context: FulfillmentSupplementContext) {
  const state = contexts.get(context); if (!state) return refuse();
  const value = snapshot(state.file, state.sha, state.base, state.binding);
  if (!same(value, context)) refuse(); return { state, value };
}
export function assertSupplementaryRunBinding(run: QueryRun, context: FulfillmentSupplementContext): void {
  const { value } = current(context), metadata = run.originalFulfillment;
  if (!metadata || metadata.format !== "keryx-a2a-original-fulfillment-result-v2" ||
    metadata.supplementaryInputSha256 !== value.authoritySha256 || metadata.contextSha256 !== value.contextSha256) refuse();
}
export function fulfillmentEvidenceCapability(context: FulfillmentSupplementContext, claim: A2aFulfillmentClaim, run: QueryRun): FulfillmentEvidenceCapability {
  const { state } = current(context);
  if (objectHash(claim) !== state.binding.nativeClaimSha256 || !same(claim.authority, state.base.authority)) refuse();
  assertSupplementaryRunBinding(run, context);
  const capability = Object.freeze({}) as FulfillmentEvidenceCapability;
  capabilities.set(capability, { context, claimSha: objectHash(claim), runSha: objectHash(run) }); return capability;
}
/** Revalidate every protected body and the exact run/claim. Historical reads deliberately ignore supplier expiry. */
export function supplementalRunSources(run: QueryRun, claim: A2aFulfillmentClaim, capability?: FulfillmentEvidenceCapability): GatheredContent[] {
  const state = capability && capabilities.get(capability);
  if (!state || state.claimSha !== objectHash(claim) || state.runSha !== objectHash(run)) return refuse();
  assertSupplementaryRunBinding(run, state.context); return current(state.context).value.gathered;
}

/** Exact table prefixes retain their header; code lines and completed section-end
 * sentences stay verbatim. Only the protected official supplemental sections enroll. */
export function supplementaryQuoteOptions(context: FulfillmentSupplementContext): { options: QuoteOption[]; capability: SupplementalSpanCapability } {
  const { state, value } = current(context), bytes = read(state.file, 65536);
  const manifest = supplementaryInputSchema.parse(JSON.parse(text(bytes))), options: QuoteOption[] = [];
  for (const [index, document] of manifest.sources.entries()) {
    const source = value.gathered[state.base.packet.gathered.length + index];
    let sectionStart = 0;
    for (const span of document.spans) {
      const sectionEnd = sectionStart + span.end - span.start, section = source.text.slice(sectionStart, sectionEnd);
      const add = (start: number, end: number) => {
        const quote = source.text.slice(start, end);
        if (quote.length < 8 || quote.length > 240 || options.some(option => option.marker === source.marker && option.start === start && option.end === end)) return;
        const contextStart = Math.max(sectionStart, start - 400), contextEnd = Math.min(sectionEnd, end + 400);
        options.push({ quoteId: `supplement:${source.marker}:${start}:${end}`, marker: source.marker, text: quote, start, end,
          sourceId: source.sourceId, itemUrl: source.itemUrl, contentVersion: source.contentVersion,
          contextStart, contextEnd, context: source.text.slice(contextStart, contextEnd),
          prefixOmitted: contextStart > 0, suffixOmitted: contextEnd < source.text.length });
      };
      // Contiguous complete table prefixes, never a value detached from its header.
      for (const table of section.matchAll(/^[ \t]*\|[^\n]+\|\r?\n[ \t]*\|[ :|\-]+\|(?:\r?\n[ \t]*\|[^\n]+\|)+/gm)) {
        const start = sectionStart + table.index + table[0].length - table[0].trimStart().length;
        let lineIndex = 0;
        let completeEnd: number | undefined;
        for (const lineMatch of table[0].matchAll(/[^\r\n]+(?:\r?\n|$)/g)) {
          const line = lineMatch[0].replace(/\r?\n$/, "");
          const end = sectionStart + table.index + lineMatch.index + line.trimEnd().length;
          if (lineIndex >= 2 && end - start <= 240) completeEnd = end;
          lineIndex++;
        }
        if (completeEnd !== undefined) add(start, completeEnd);
      }
      for (const line of section.matchAll(/^[ \t]*https:\/\/[^\s]+[ \t]*$/gm)) {
        const start = sectionStart + line.index + line[0].length - line[0].trimStart().length;
        add(start, sectionStart + line.index + line[0].trimEnd().length);
      }
      // A bounded section may end at an observed completed paragraph, even though
      // its public provenance correctly says the surrounding document is truncated.
      for (const paragraph of section.matchAll(/(?:^|\n\n)([^\n]+(?:\n[^\n]+)*)/g)) {
        const body = paragraph[1].trim();
        if (!/[.!?]$/.test(body) || /[|<>`]/.test(body)) continue;
        const start = sectionStart + paragraph.index + paragraph[0].indexOf(body);
        add(start, start + body.length);
      }
      sectionStart = sectionEnd + 2;
    }
  }
  if (options.length > 32) refuse();
  return { options, capability: enrollSupplementalSpans(value.gathered, options, () => { current(context); }) };
}
