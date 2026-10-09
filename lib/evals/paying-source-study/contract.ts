import { createHash } from "node:crypto";
import { z } from "zod";
import type { Source, SourceItem } from "../../types";

export const STUDY_VERSION = 1;
export const BUDGETS = ["0", "6000", "18000", "60000"] as const;
export const PRICES = ["1000", "4000", "12000"] as const;
export const FIXED_DATE = "2026-01-01T00:00:00.000Z";
const text = z.string().min(1).max(4000).refine(value => value.isWellFormed(), "Malformed UTF-16");
const id = z.string().regex(/^[a-z][a-z0-9-]{0,60}$/);
const documentSchema = z.object({ id, name: text, title: text, summary: text,
  body: text, free: z.boolean(), bodyHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  contentVersion: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict();
const questionSchema = z.object({ id, question: text, description: text,
  facts: z.array(z.object({ id, literal: text, documentIds: z.array(id).min(1).max(4) }).strict()).length(2),
  documents: z.array(documentSchema).length(4) }).strict();
const corpusSchema = z.object({ version: z.literal(1), provenance: z.literal("fictional-public-synthetic-fixture"),
  questions: z.array(questionSchema).length(4) }).strict();
export type StudyCorpus = z.infer<typeof corpusSchema>;
export type StudyQuestion = StudyCorpus["questions"][number];
export type StudyDocument = StudyQuestion["documents"][number];
export function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function canonical(value: unknown): string {
  function sort(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input)
      .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, v]) => [k, sort(v)]));
    if (typeof input === "number" && !Number.isFinite(input)) throw new Error("Non-finite study value");
    return input;
  }
  return JSON.stringify(sort(value), null, 2) + "\n";
}
export function artifactTextEqual(retained: string, actual: string): boolean {
  return retained.replaceAll("\r\n", "\n") === actual.replaceAll("\r\n", "\n");
}
/** Reject unsafe legacy numbers rather than round them into apparently exact accounting. */
export function microFromUsdc(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid USDC amount");
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(value));
  if (!match) throw new Error("USDC amount is not an exact six-decimal value");
  const micro = BigInt(match[1]) * BigInt(1_000_000) + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Unsafe legacy USDC amount");
  return micro;
}
export function usdcFromMicro(value: string): number {
  if (!/^(0|[1-9]\d{0,6})$/.test(value) || BigInt(value) > BigInt(1_000_000)) throw new Error("Study amount outside bound");
  const amount = Number(value) / 1_000_000;
  if (microFromUsdc(amount) !== BigInt(value)) throw new Error("Study amount did not round-trip");
  return amount;
}
export function retainedItem(questionId: string, doc: Omit<StudyDocument, "bodyHash" | "contentVersion">): SourceItem {
  return { id: `${questionId}-${doc.id}-item`, sourceId: `${questionId}-${doc.id}`, title: doc.title,
    summary: doc.summary, content: doc.body, link: `https://study.invalid/${questionId}/${doc.id}`,
    publishedAt: FIXED_DATE, deliveryKind: "full_text", storageMode: "db_plaintext",
    evidenceProvenance: "synthetic-demo", plaintextBytes: Buffer.byteLength(doc.body), bodyHash: `0x${sha256(doc.body)}` };
}
export function retainedVersion(item: SourceItem): string {
  return `sha256:${sha256(JSON.stringify([item.id, item.sourceId, item.title, item.link, item.publishedAt ?? "", item.summary, item.content]))}`;
}
export function parseCorpus(raw: unknown): StudyCorpus {
  const corpus = corpusSchema.parse(raw);
  const questions = new Set<string>();
  for (const question of corpus.questions) {
    if (questions.has(question.id)) throw new Error("Duplicate study question");
    questions.add(question.id);
    const docs = new Map(question.documents.map(doc => [doc.id, doc]));
    if (docs.size !== question.documents.length || new Set(question.facts.map(f => f.id)).size !== question.facts.length)
      throw new Error("Duplicate fixture identity");
    if (question.documents.filter(doc => doc.free).length !== 1 || new Set(question.facts.map(f => f.literal)).size !== 2
      || question.facts.some(f => new Set(f.documentIds).size !== f.documentIds.length)) throw new Error("Fixture differs from fixed study design");
    for (const doc of question.documents) {
      if (doc.bodyHash !== `0x${sha256(doc.body)}` || doc.contentVersion !== retainedVersion(retainedItem(question.id, doc)))
        throw new Error("Retained source version mismatch");
    }
    for (const fact of question.facts) for (const docId of fact.documentIds) {
      if (!docs.get(docId)?.body.includes(fact.literal)) throw new Error("Required fact not retained in declared source");
    }
  }
  return corpus;
}
export function fixtureRows(question: StudyQuestion, paidPriceMicro: string): { source: Source; item: SourceItem }[] {
  return question.documents.map(doc => ({ source: { id: `${question.id}-${doc.id}`, name: doc.name,
    url: `https://study.invalid/${question.id}/${doc.id}`, description: doc.summary, tags: [question.id, doc.id],
    walletAddress: `0x${sha256(`${question.id}-${doc.id}`).slice(0, 40)}`, fetchPrice: doc.free ? 0 : usdcFromMicro(paidPriceMicro),
    authors: [], active: true, verified: true, evidenceProvenance: "synthetic-demo", createdAt: FIXED_DATE },
    item: retainedItem(question.id, doc) }));
}
