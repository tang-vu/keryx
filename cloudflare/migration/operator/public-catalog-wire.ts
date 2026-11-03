/** Typed public data only. Parsing these DTOs never enrolls or admits a store. */
import { z } from "zod";
import { publicReferenceSchema, publicReferenceItemSchema } from "../../../lib/public-references/catalog-contract";
import { PUBLIC_EXPORT_LIMITS } from "./public-catalog-export";

const hash = z.string().regex(/^[a-f0-9]{64}$/), rowid = z.string().regex(/^-?(0|[1-9][0-9]*)$/).max(21);
const date = z.string().datetime(), count = z.number().int().nonnegative().max(PUBLIC_EXPORT_LIMITS.rows);
const snapshot = z.string().max(PUBLIC_EXPORT_LIMITS.fieldBytes).refine(value => Buffer.byteLength(value) <= PUBLIC_EXPORT_LIMITS.fieldBytes);
// Application and CLI pin separate validator graphs. Delegate primitive checks
// across this boundary; never embed one graph's schema in the other's object.
const applicationString = (schema: { safeParse(value: unknown): { success: boolean } }) => z.string().refine(value => schema.safeParse(value).success);
const reference_id = applicationString(publicReferenceSchema.shape.id), item_id = applicationString(publicReferenceItemSchema.shape.id);
export const publicExportHeader = z.object({ type: z.literal("header"), format: z.literal("keryx-public-catalog-export-v1"),
  startedAt: date, selectedIdentityDigest: hash, authority: z.literal("public-data-only"),
  counts: z.object({ publishers: count, articles: count, versions: count, terms: count }).strict()
    .refine(value => Object.values(value).reduce((sum, n) => sum + n, 0) <= PUBLIC_EXPORT_LIMITS.rows), termsDigest: hash, metadataDigest: hash }).strict();
export const publicExportPublisher = z.object({ type: z.literal("publisher"), row: z.object({ rowid, id: reference_id,
  active: z.union([z.literal(0), z.literal(1)]), rss_url: applicationString(publicReferenceSchema.shape.rssUrl), snapshot }).strict() }).strict();
export const publicExportArticle = z.object({ type: z.literal("article"), row: z.object({ rowid, reference_id, item_id,
  canonical_url: applicationString(publicReferenceItemSchema.shape.link), current_revision: hash, first_collected_at: date, last_collected_at: date,
  published_at: date.nullable(), sort_at: date }).strict() }).strict();
export const publicExportVersion = z.object({ type: z.literal("version"), row: z.object({ rowid, reference_id, item_id, revision: hash,
  content_version: z.string().min(1).max(256), collection_kind: z.enum(["feed", "article"]), collected_at: date,
  snapshot, original_snapshot: snapshot }).strict() }).strict();
export const publicExportFooter = z.object({ type: z.literal("footer"), records: z.number().int().positive().max(PUBLIC_EXPORT_LIMITS.rows + 1),
  sourceDigest: hash, outputBytesBeforeFooter: z.number().int().nonnegative().max(PUBLIC_EXPORT_LIMITS.outputBytes),
  completedAt: date, sourceChangedSinceSnapshot: z.boolean() }).strict();
export const publicExportRecord = z.discriminatedUnion("type", [publicExportHeader, publicExportPublisher, publicExportArticle, publicExportVersion, publicExportFooter]);
export type ExportPublisher = z.infer<typeof publicExportPublisher>["row"];
export type ExportArticle = z.infer<typeof publicExportArticle>["row"];
export type ExportVersion = z.infer<typeof publicExportVersion>["row"];
