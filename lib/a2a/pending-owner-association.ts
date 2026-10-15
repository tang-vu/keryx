import { z } from "zod";

const id = z.string().regex(/^a2a_[a-f0-9]{64}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const millis = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const session = z.object({
  hash,
  wallet: z.string().regex(/^0x[a-f0-9]{40}$/),
  issuedAt: millis,
  expiresAt: millis,
}).strict();

/** Data shape only. Parsing this schema cannot authenticate a session or mint
 * ownership. The protected producer must derive every field independently. */
export const pendingOwnerAdmissionCandidateSchema = z.object({
  original: z.object({
    id,
    queryId: id,
    requestHash: hash,
    network: z.string().regex(/^eip155:[1-9][0-9]{0,15}$/),
    createdAt: z.string().max(64).datetime({ offset: true }),
  }).strict(),
  // "new" must come from the producer's pre-insert lookup in its transaction,
  // never from a request body or an independently committed created boolean.
  creation: z.enum(["new", "existing", "unknown"]),
  authenticatedSession: session,
  retainedSession: session.nullable(),
  observedAtMs: millis,
}).strict();

export type PendingOwnerAdmissionCandidate = z.infer<typeof pendingOwnerAdmissionCandidateSchema>;
export type PendingOwnerAdmissionErrorCode = "invalid_admission" | "existing_original"
  | "session_unavailable" | "owner_association_unavailable" | "atomic_admission_unavailable";
export class PendingOwnerAdmissionError extends Error {
  constructor(public readonly code: PendingOwnerAdmissionErrorCode) { super(code); }
}

/** Validates exact admission inputs for a future atomic producer. The result is
 * deliberately a candidate, not a grant, proof, session credential or port.
 * No database, payment, token, worker body or visibility operation occurs here. */
export function validatePendingOwnerAdmissionCandidate(raw: unknown): PendingOwnerAdmissionCandidate {
  if (arguments.length !== 1) throw new PendingOwnerAdmissionError("invalid_admission");
  const parsed = pendingOwnerAdmissionCandidateSchema.safeParse(raw);
  if (!parsed.success) throw new PendingOwnerAdmissionError("invalid_admission");
  const candidate = parsed.data;
  if (candidate.creation !== "new") throw new PendingOwnerAdmissionError("existing_original");
  const created = Date.parse(candidate.original.createdAt);
  if (candidate.original.id !== candidate.original.queryId || !Number.isSafeInteger(created)
    || created < 0 || created !== candidate.observedAtMs)
    throw new PendingOwnerAdmissionError("invalid_admission");
  const verified = candidate.authenticatedSession, retained = candidate.retainedSession;
  if (!retained || retained.hash !== verified.hash || retained.wallet !== verified.wallet
    || retained.issuedAt !== verified.issuedAt || retained.expiresAt !== verified.expiresAt
    || verified.issuedAt > created || verified.expiresAt <= created
    || verified.expiresAt <= verified.issuedAt)
    throw new PendingOwnerAdmissionError("session_unavailable");
  return candidate;
}
