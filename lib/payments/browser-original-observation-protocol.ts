import { z } from "zod";
import {
  keccak256,
  stringToHex,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import { canonicalJson } from "../canonical-json";
import { browserSigningOriginalSchema, verifyBrowserSigningOriginalSource } from "./browser-signing-original";
import {
  browserQueryPolicySchema,
  verifyBrowserQueryPolicy,
} from "./browser-query-policy";
import type { BrowserSigningSnapshot } from "../db/browser-signing-originals";

export const OBSERVATION_AUDIENCE = "https://keryx.cc";
export const OBSERVATION_PATH = "/api/ask/original-observation";
export const OBSERVATION_CLOCK_PATH = OBSERVATION_PATH + "/clock";
export const OBSERVATION_WINDOW_MS = 5000;
export const OBSERVATION_PROOF_LIMIT = 4096;
export const OBSERVATION_RESPONSE_LIMIT = 16384;
const now = Date.now.bind(Date),
  monotonic = performance.now.bind(performance);
export const observationUtcNow = () => now();
export const refuseObservation = (): never => {
  throw new Error("Original observation unavailable");
};
const id = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/);
const digest = z.string().regex(/^0x[0-9a-f]{64}$/);
const address = z.string().regex(/^0x[0-9a-f]{40}$/);
const decimal = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(16)
  .refine((v) => BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER));
const positive = decimal.refine((v) => BigInt(v) > BigInt(0));
const milliseconds = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const observationLocatorSchema = z
  .object({ sessionId: id, requestId: id })
  .strict();
export const observationRequestSchema = observationLocatorSchema
  .extend({
    audience: z.literal(OBSERVATION_AUDIENCE),
    method: z.literal("GET"),
    path: z.literal(OBSERVATION_PATH),
    challenge: digest,
    issuedAtMs: decimal,
    expiresAtMs: decimal,
  })
  .strict()
  .refine(
    (r) =>
      BigInt(r.expiresAtMs) - BigInt(r.issuedAtMs) ===
      BigInt(OBSERVATION_WINDOW_MS)
  );
export type ObservationRequest = z.infer<typeof observationRequestSchema>;
const proofSchema = z
  .object({
    request: observationRequestSchema,
    signature: z.string().regex(/^0x[0-9a-f]{130}$/),
  })
  .strict();
export const observationClockSchema = z
  .object({
    version: z.literal("1"),
    challenge: digest,
    serverTimeMs: milliseconds,
    expiresAtMs: milliseconds,
  })
  .strict()
  .refine((c) => c.expiresAtMs - c.serverTimeMs === OBSERVATION_WINDOW_MS);
const policyProof = z
  .object({
    policy: browserQueryPolicySchema,
    signature: z.string().regex(/^0x[0-9a-f]{130}$/),
  })
  .strict();
const exposedPhase = z.enum([
  "exposed",
  "signed",
  "submission_attempted",
  "settled",
  "failed",
]);
export const observationStateSchema = z
  .object({
    original: browserSigningOriginalSchema,
    policy: policyProof,
    namespace: z
      .object({
        namespace: digest,
        owner: address,
        signer: address,
        service: z.literal(OBSERVATION_AUDIENCE),
        network: z.literal("eip155:5042002"),
        ceilingMicros: positive,
        jobLimit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        allocatedMicros: decimal,
        jobs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        ceilingProof: policyProof,
      })
      .strict(),
    query: z
      .object({
        queryId: z.string().uuid(),
        namespace: digest,
        ceilingMicros: positive,
        spentMicros: decimal,
        proofDigest: digest,
      })
      .strict(),
    journal: z
      .object({
        nonce: digest,
        admittedAt: z.string().datetime(),
        sessionId: id,
        requestId: id,
        grantEpoch: z.string().uuid(),
        signer: address,
        phase: exposedPhase,
        signedValidAfter: decimal.optional(),
        signedValidBefore: decimal.optional(),
        signedHeaderHash: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .optional(),
      })
      .strict(),
    currentGrant: z
      .object({
        sessionId: id,
        sessAddr: address,
        ownerAddr: address,
        capMicros: decimal,
        spentMicros: decimal,
        expiry: milliseconds,
        grantEpoch: z.string().uuid(),
      })
      .strict()
      .nullable(),
    signerSpentMicros: decimal,
    retainedEpochSpentMicros: decimal,
    active: z.boolean(),
  })
  .strict();
export type OriginalObservationState = z.infer<typeof observationStateSchema>;
export const observationResponseSchema = z
  .object({
    version: z.literal("1"),
    readOnly: z.literal(true),
    challenge: digest,
    requestDigest: digest,
    readInterval: z
      .object({ startedAtMs: milliseconds, finishedAtMs: milliseconds })
      .strict()
      .refine((r) => r.finishedAtMs >= r.startedAtMs),
    state: observationStateSchema,
  })
  .strict();
export type OriginalObservation = z.infer<typeof observationResponseSchema>;
export function observationTypedData(value: ObservationRequest) {
  const r = observationRequestSchema.parse(value);
  return {
    domain: {
      name: "KeryxOriginalObservation",
      version: "1",
      chainId: 5042002,
      salt: keccak256(stringToHex(OBSERVATION_AUDIENCE)),
    },
    primaryType: "ObservationRequest" as const,
    types: {
      ObservationRequest: [
        { name: "audience", type: "string" },
        { name: "method", type: "string" },
        { name: "path", type: "string" },
        { name: "sessionId", type: "string" },
        { name: "requestId", type: "string" },
        { name: "challenge", type: "bytes32" },
        { name: "issuedAtMs", type: "uint256" },
        { name: "expiresAtMs", type: "uint256" },
      ],
    },
    message: {
      ...r,
      issuedAtMs: BigInt(r.issuedAtMs),
      expiresAtMs: BigInt(r.expiresAtMs),
    },
  };
}
export const observationRequestDigest = (r: ObservationRequest) =>
  keccak256(stringToHex(canonicalJson(observationRequestSchema.parse(r))));
function encode(text: string) {
  return btoa(
    Array.from(new TextEncoder().encode(text), (b) =>
      String.fromCharCode(b)
    ).join("")
  );
}
export function serializeObservationProof(
  request: ObservationRequest,
  signature: string
): string {
  const proof = proofSchema.parse({
      request,
      signature: signature.toLowerCase(),
    }),
    encoded = encode(canonicalJson(proof));
  if (encoded.length > OBSERVATION_PROOF_LIMIT) refuseObservation();
  return encoded;
}
export function assertObservationRequestCurrent(r: ObservationRequest): void {
  const utc = now();
  if (utc < Number(r.issuedAtMs) || utc >= Number(r.expiresAtMs))
    refuseObservation();
}
export async function recoverObservationProof(
  encoded: unknown
): Promise<{ request: ObservationRequest; signer: Hex }> {
  if (
    typeof encoded !== "string" ||
    encoded.length > OBSERVATION_PROOF_LIMIT ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    return refuseObservation();
  const decoded = atob(encoded);
  if (btoa(decoded) !== encoded) refuseObservation();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(decoded, (c) => c.charCodeAt(0))
    ),
    proof = proofSchema.parse(JSON.parse(text));
  if (encode(canonicalJson(proof)) !== encoded) refuseObservation();
  assertObservationRequestCurrent(proof.request);
  const signer = await recoverTypedDataAddress({
    ...observationTypedData(proof.request),
    signature: proof.signature as Hex,
  });
  assertObservationRequestCurrent(proof.request);
  return { request: proof.request, signer: signer.toLowerCase() as Hex };
}
/** Elapsed wall delta catches ordinary sleep where performance.now pauses. Neither clock proves UTC accuracy. */
export class ObservationElapsedGuard {
  private readonly wall = now();
  private readonly mono = monotonic();
  readonly abort = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(private readonly limit = OBSERVATION_WINDOW_MS) {
    if (
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > OBSERVATION_WINDOW_MS
    )
      refuseObservation();
    this.timer = setTimeout(() => this.abort.abort(), limit);
  }
  live(): void {
    const wall = now() - this.wall,
      mono = monotonic() - this.mono;
    if (
      this.abort.signal.aborted ||
      wall < 0 ||
      mono < 0 ||
      wall >= this.limit ||
      mono >= this.limit ||
      Math.abs(wall - mono) > 250
    )
      refuseObservation();
  }
  close(): void {
    clearTimeout(this.timer);
    this.abort.abort();
  }
}
function micros(value: number): string {
  const raw = value * 1e6,
    rounded = Math.round(raw);
  if (
    !Number.isSafeInteger(rounded) ||
    rounded < 0 ||
    Math.abs(raw - rounded) >= 0.000001
  )
    refuseObservation();
  return String(rounded);
}
/** Positive-phase guard precedes all economic projection. This does not authorize a payment. */
export function projectOriginalObservation(
  snapshot: BrowserSigningSnapshot
): OriginalObservationState {
  if (!exposedPhase.safeParse(snapshot.journal.phase).success)
    refuseObservation();
  const j = snapshot.journal,
    g = snapshot.currentGrant;
  return observationStateSchema.parse({
    original: snapshot.original,
    policy: snapshot.policy,
    namespace: snapshot.namespace,
    query: snapshot.query,
    journal: {
      nonce: j.nonce,
      admittedAt: j.admittedAt,
      sessionId: j.sessionId,
      requestId: j.requestId,
      grantEpoch: j.grantEpoch,
      signer: j.signer.toLowerCase(),
      phase: j.phase,
      signedValidAfter: j.signedValidAfter ?? undefined,
      signedValidBefore: j.signedValidBefore ?? undefined,
      signedHeaderHash: j.signedHeaderHash ?? undefined,
    },
    currentGrant: g
      ? {
          sessionId: g.sessionId,
          sessAddr: g.sessAddr.toLowerCase(),
          ownerAddr: g.ownerAddr.toLowerCase(),
          capMicros: micros(g.cap),
          spentMicros: micros(g.spent),
          expiry: g.expiry,
          grantEpoch: g.grantEpoch,
        }
      : null,
    signerSpentMicros: snapshot.signerSpentMicros,
    retainedEpochSpentMicros: snapshot.retainedEpochSpentMicros,
    active: snapshot.active,
  });
}
export async function validateOriginalObservation(
  value: unknown,
  request: ObservationRequest,
  signer: string
): Promise<OriginalObservation> {
  const response = observationResponseSchema.parse(value),
    r = observationRequestSchema.parse(request),
    s = response.state;
  const query = await verifyBrowserQueryPolicy(s.policy),
    ceiling = await verifyBrowserQueryPolicy(s.namespace.ceilingProof),
    p = query.policy,
    n = s.namespace,
    q = s.query,
    o = s.original,
    j = s.journal;
  await verifyBrowserSigningOriginalSource(o);
  if (
    response.challenge !== r.challenge ||
    response.requestDigest !== observationRequestDigest(r) ||
    response.readInterval.startedAtMs < Number(r.issuedAtMs) ||
    response.readInterval.finishedAtMs >= Number(r.expiresAtMs) ||
    j.sessionId !== r.sessionId ||
    j.requestId !== r.requestId ||
    j.signer !== signer.toLowerCase() ||
    o.authorization.from !== j.signer ||
    o.authorization.nonce !== j.nonce ||
    o.requestId !== j.requestId ||
    o.grantEpoch !== j.grantEpoch ||
    o.admittedAt !== j.admittedAt ||
    n.namespace !== query.namespace ||
    n.namespace !== ceiling.namespace ||
    n.owner !== p.owner ||
    n.signer !== p.signer ||
    j.signer !== p.signer ||
    j.grantEpoch !== p.grantEpoch ||
    o.namespace !== n.namespace ||
    o.queryId !== q.queryId ||
    q.queryId !== p.queryId ||
    q.namespace !== n.namespace ||
    q.proofDigest !== query.proofDigest ||
    q.ceilingMicros !== p.queryCeilingMicros ||
    n.ceilingMicros !== ceiling.policy.lifetimeCeilingMicros ||
    n.jobLimit !== ceiling.policy.jobLimit ||
    BigInt(n.allocatedMicros) > BigInt(n.ceilingMicros) ||
    n.jobs > n.jobLimit ||
    BigInt(q.spentMicros) > BigInt(q.ceilingMicros) ||
    BigInt(o.authorization.value) <= BigInt(0) ||
    BigInt(o.authorization.value) > BigInt(q.spentMicros)
  )
    refuseObservation();
  function freeze(object: object): void {
    for (const child of Object.values(object))
      if (child && typeof child === "object") freeze(child);
    Object.freeze(object);
  }
  freeze(response);
  return response;
}
