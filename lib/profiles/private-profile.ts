import { z } from "zod";

export const RESERVED_PROFILE_HANDLES = ["keryx", "admin", "administrator", "api", "auth", "circle", "arc", "creator", "creators", "developer", "dev", "dispatch", "gateway", "help", "integrations", "login", "mainnet", "me", "moderator", "official", "operator", "owner", "profile", "research", "root", "signup", "sources", "status", "support", "system", "testnet", "treasury", "wallet"] as const;
export const PROFILE_LINK_KINDS = ["orcid", "github", "linkedin", "x", "website", "telegram"] as const;
const singleLine = (max: number) => z.string().max(max).refine(value => value.isWellFormed() && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), "Use one line without control characters").transform(value => value.trim());
const hosts: Record<string, readonly string[]> = { orcid: ["orcid.org"], github: ["github.com"], linkedin: ["linkedin.com", "www.linkedin.com"], x: ["x.com", "twitter.com"], telegram: ["t.me"] };

export function canonicalProfileLink(kind: string, value: string): string {
  if (value.length > 512 || !value.isWellFormed() || /[\s\p{Cc}\p{Cf}]/u.test(value)) throw new Error("Invalid profile link");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.search
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)
    || /\.(?:local|localhost|internal|test|invalid|example)$/.test(url.hostname)) throw new Error("Invalid profile link");
  if (kind !== "website" && !hosts[kind]?.includes(url.hostname)) throw new Error("Link host does not match its kind");
  if (kind !== "website" && (url.pathname === "/" || url.pathname.length > 240)) throw new Error("Use a profile link");
  if (url.href.length > 512) throw new Error("Canonical profile link too long");
  return url.href;
}

const profileLink = z.object({ kind: z.enum(PROFILE_LINK_KINDS), url: z.string().max(512) }).strict()
  .superRefine((value, ctx) => { try { canonicalProfileLink(value.kind, value.url); } catch { ctx.addIssue({ code: "custom", message: "Use an allowed HTTPS profile link" }); } })
  .transform(value => ({ ...value, url: canonicalProfileLink(value.kind, value.url) }));
export const privateProfileInputSchema = z.object({
  displayName: singleLine(80),
  handle: z.string().max(32).transform(value => value.trim().toLowerCase()).refine(value => value === "" || /^[a-z][a-z0-9_]{2,31}$/.test(value) && !(RESERVED_PROFILE_HANDLES as readonly string[]).includes(value), "Handle must be 3–32 ASCII letters, digits or underscores, and cannot be reserved"),
  bio: singleLine(160), purpose: singleLine(160),
  links: z.array(profileLink).max(6).refine(links => new Set(links.map(link => link.kind)).size === links.length, "Use one link per kind"),
}).strict();
export type PrivateProfileInput = z.infer<typeof privateProfileInputSchema>;
export const profileWallet = (wallet: string) => z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(wallet).toLowerCase();
export const privateProfileRecordSchema = privateProfileInputSchema.extend({ wallet: z.string().regex(/^0x[0-9a-f]{40}$/), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
export type PrivateProfileRecord = z.infer<typeof privateProfileRecordSchema>;
export const privateProfileActivitySchema = z.object({
  firstSeenAt: z.string().datetime().nullable(), questions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  surfacesUsed: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)).max(16),
  topics: z.array(singleLine(80)).max(12).nullable(),
  /** Distinct recorded payee wallets in attributed runs; attribution is not funding/payer identity. */
  creatorsPaid: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  scope: z.literal("attributed-current-store"), network: z.enum(["eip155:5042", "eip155:5042002"]),
}).strict();
export const privateProfileSnapshotSchema = z.object({ profile: privateProfileRecordSchema.nullable(), activity: privateProfileActivitySchema }).strict();
export type PrivateProfileSnapshot = z.infer<typeof privateProfileSnapshotSchema>;
export interface PrivateProfilesStore {
  get(wallet: string, network: string): Promise<PrivateProfileSnapshot>;
  update(wallet: string, input: PrivateProfileInput): Promise<PrivateProfileRecord>;
  delete(wallet: string): Promise<void>;
}
export class PrivateProfileError extends Error {
  constructor(readonly code: "profile_unavailable" | "handle_conflict" | "invalid_profile") { super(code); }
}
/** A missing or sealed port never acquires authority through another adapter. */
export function requirePrivateProfiles(db: { readonly privateProfiles?: PrivateProfilesStore }): PrivateProfilesStore {
  try { if (db.privateProfiles) return db.privateProfiles; } catch { /* Sealed proxies intentionally reject unknown capabilities before I/O. */ }
  throw new PrivateProfileError("profile_unavailable");
}
