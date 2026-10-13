import { z } from "zod";
import { privateProfileInputSchema, profileWallet } from "./private-profile";
import { privacyId, privacySession } from "../run-privacy/contracts";
import { runClaimBindingSchema, type RunClaimBinding } from "../run-claims/contracts";
import { RUN_SURFACES } from "../research/run-provenance";
import { validOrcid } from "./verified-identities";

export const PUBLIC_PROFILE_FIELDS = ["displayName", "about", "purpose", "verifiedLinks", "ledgers"] as const;
export const publicHandle = privateProfileInputSchema.shape.handle.refine(value => value !== "");
export const publicProfileInput = z.object({ published: z.boolean(), fields: z.array(z.enum(PUBLIC_PROFILE_FIELDS)).max(5)
  .refine(value => new Set(value).size === value.length), runIds: z.array(privacyId).max(50)
  .refine(value => new Set(value).size === value.length), revision: z.number().int().min(0).max(2147483646) }).strict();
export type PublicProfileInput = z.infer<typeof publicProfileInput>;
export const publicProfileSettings = publicProfileInput.omit({ revision: true }).extend({ handle: publicHandle.or(z.literal("")),
  revision: z.number().int().min(0).max(2147483647), updatedAt: z.string().datetime().nullable() }).strict();
export type PublicProfileSettings = z.infer<typeof publicProfileSettings>;
export const publicProfileActor = z.object({ wallet: z.string().transform(profileWallet), sessionHash: privacySession,
  binding: runClaimBindingSchema }).strict();
export type PublicProfileActor = { wallet: string; sessionHash: string; binding: RunClaimBinding };
const micros = z.string().regex(/^(?:0|[1-9]\d{0,77})$/).nullable();
export const publicProfileLedger = z.object({ network: z.enum(["eip155:5042", "eip155:5042002"]),
  readerPaidMicros: micros, creatorEarnedMicros: micros, sponsoredCreatorPaymentsMicros: micros }).strict();
export const publicProfileRun = z.object({ id: privacyId, question: z.string().max(4000), createdAt: z.string().datetime({ offset: true }),
  surface: z.enum(RUN_SURFACES), network: z.enum(["eip155:5042", "eip155:5042002"]).nullable(),
  funding: z.enum(["sponsored", "sponsorship-recorded", "reader-funded", "simulation", "unknown"]),
  ownership: z.enum(["session", "api-key", "verified-payer", "claimed", "recorded-unknown"]),
  citations: z.array(z.object({ marker: z.string().max(32), sourceName: z.string().max(200), itemUrl: z.string().max(2048).optional() }).strict()).max(50),
  reportPath: z.string(), receiptsPath: z.string() }).strict().superRefine((run,ctx)=>{
    if(run.reportPath!==`/dispatch/${run.id}`||run.receiptsPath!==`/api/dispatch/${run.id}/receipt`)ctx.addIssue({code:"custom",message:"Wrong original report/receipt binding"});
    for(const citation of run.citations)if(citation.itemUrl){try{const url=new URL(citation.itemUrl);if(url.protocol!=="https:"||url.username||url.password||url.search)throw new Error();}
      catch{ctx.addIssue({code:"custom",message:"Unsafe citation URL"});}}
  });
export const publicProfileSnapshot = z.object({ version: z.literal(1), handle: publicHandle, publishedAt: z.string().datetime(),
  displayName: z.string().max(80).optional(), about: z.string().max(160).optional(), purpose: z.string().max(160).optional(),
  verifiedLinks: z.array(z.object({ provider: z.enum(["orcid", "github"]), label: z.string().max(160),
    url: z.string().url().max(512), verifiedAt: z.string().datetime() }).strict().refine(link=>{
      try{const url=new URL(link.url);return link.provider==="github"?link.url===`https://github.com/${link.label}`&&/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(link.label)
        :link.url===`https://orcid.org/${url.pathname.slice(1)}`&&validOrcid(url.pathname.slice(1));}catch{return false;}
    })).max(2).optional(),
  ledgers: z.array(publicProfileLedger).length(2).refine(rows=>new Set(rows.map(row=>row.network)).size===2).optional(), ledgerBasis: z.literal("wallet-wide-recorded-settled-creator-events").optional(),
  runs: z.array(publicProfileRun).max(50), ownershipBasis: z.literal("signed-wallet-publication-existing-run-proof") }).strict();
export type PublicProfileSnapshot = z.infer<typeof publicProfileSnapshot>;
export interface PublicProfilesStore {
  read(handle: string): Promise<PublicProfileSnapshot | null>;
  settings(actor: PublicProfileActor): Promise<PublicProfileSettings>;
  update(actor: PublicProfileActor, input: PublicProfileInput): Promise<PublicProfileSettings>;
  unpublish(actor: PublicProfileActor): Promise<void>;
  sitemap(take: number): Promise<Array<{ handle: string; updatedAt: string }>>;
}
export class PublicProfileError extends Error {
  constructor(readonly code: "public_profile_unavailable" | "profile_required" | "conflict" | "unauthenticated" | "not_owned") { super(code); }
}
export function publicProfilesEnabled(env: Readonly<Record<string,string|undefined>>): boolean {
  return env.KERYX_PUBLIC_PROFILES_ENABLED==="true" && env.KERYX_RUN_PRIVACY_ENABLED==="true";
}
export function requirePublicProfiles(db: { readonly publicProfiles?: PublicProfilesStore; readonly runPrivacyActive?: boolean }): PublicProfilesStore {
  try { if (db.runPrivacyActive === true && db.publicProfiles) return db.publicProfiles; } catch { /* No sealed/native fallback. */ }
  throw new PublicProfileError("public_profile_unavailable");
}
