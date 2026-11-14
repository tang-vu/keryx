import { parseWebSession, isWebSessionActive, webSessionHash } from "../auth-session";
import { canonicalJson } from "../canonical-json";
import { a2aOrderId, type A2aOrder } from "./order";
import { validateStorageIdentity, type StorageIdentity } from "../db/storage-identity";
import { PendingOwnerAdmissionError, type PostgresPendingOwnerAdmissionPacket, type PostgresPendingOwnerSessionPacket } from "./pending-owner-association";
import { readRuntimeStorageDeployment } from "../db/runtime-storage-config";

declare const brand: unique symbol;
export type PendingOwnerSessionProof = { readonly [brand]: true };
type Binding = { id: string; requestHash: string };
type Retained = Binding & { kind: "sqlite" | "postgres"; store: string; selectedStore: string; network: string; hash: string; wallet: string;
  issuedAt: number; expiresAt: number; proofExpiresAt: number; purpose: "admit" | "read" };
const proofs = new WeakMap<object, Readonly<Retained>>();
const deny = () => new PendingOwnerAdmissionError("session_unavailable");

/** Route-specific actual signed-cookie verifier. No token, secret, claims,
 * session row, guard or owner supplied by a caller can mint a proof. */
export async function pendingOwnerRequestSession(req: Request, binding?: Binding): Promise<PendingOwnerSessionProof> {
  // Runtime storage/CLI consumers import only the opaque proof consumer. Keep
  // framework and selected application composition behind this route boundary.
  const { cookies } = await import("next/headers");
  const { config } = await import("../config");
  const { getDb } = await import("../db");
  const url = new URL(req.url);
  if (url.pathname !== (binding ? "/api/agent/ask" : "/api/me/jobs") || req.method !== (binding ? "POST" : "GET")) throw deny();
  if (binding && (req.headers.get("x-keryx-account-job") !== "associate" || req.headers.has("authorization")
    || req.headers.has("x-api-key") || req.headers.has("x-keryx-api-key")
    || req.headers.get("origin") !== url.origin)) throw deny();
  if (binding && (!/^a2a_[a-f0-9]{64}$/.test(binding.id) || !/^[a-f0-9]{64}$/.test(binding.requestHash))) throw deny();
  const claims = await parseWebSession((await cookies()).get("keryx_session")?.value, config.jwtSecret);
  if (!claims) throw deny();
  const deployment = readRuntimeStorageDeployment();
  const selectedStore = canonicalJson(deployment);
  const db = await getDb();
  let identity: Readonly<StorageIdentity>, kind: Retained["kind"];
  if (deployment.backend.kind === "postgres") {
    // Only the genuine zero-argument installed factory can satisfy this. In
    // particular, its current read facade cannot mint an admission proof.
    const { assertPostgresRuntimeIdentity } = await import("../db/postgres/runtime-adapter");
    identity = await assertPostgresRuntimeIdentity(db, binding ? "write" : "read");
    kind = "postgres";
  } else if (deployment.backend.kind === "sqlite") {
    const { assertEnrolledSqliteAdapter } = await import("../db/enrolled-sqlite-adapter");
    identity = assertEnrolledSqliteAdapter(db, binding ? "write" : "read");
    kind = "sqlite";
  } else throw deny();
  identity = validateStorageIdentity(identity);
  if (identity.authorityMode !== "mainnet-real" || identity.network !== config.networkId || !db.pendingJobOwners
    || canonicalJson(identity) !== canonicalJson(deployment.identity) || !await isWebSessionActive(db, claims)
    || selectedStore !== canonicalJson(readRuntimeStorageDeployment())) throw deny();
  const now = Date.now();
  const proof = Object.freeze(Object.create(null)) as PendingOwnerSessionProof;
  proofs.set(proof, Object.freeze({ id: binding?.id ?? "", requestHash: binding?.requestHash ?? "",
    kind, store: canonicalJson(identity), selectedStore, network: config.networkId, hash: webSessionHash(claims.jti),
    wallet: claims.address.toLowerCase(), issuedAt: claims.iat * 1000, expiresAt: claims.exp * 1000,
    proofExpiresAt: Math.min(claims.exp * 1000, now + 300_000), purpose: binding ? "admit" : "read" }));
  return proof;
}

/** Internal storage consumer; candidate objects cannot pass the WeakMap check.
 * It exposes only verified metadata, never an independently usable writer. */
export function retainedPendingOwnerSession(proof: PendingOwnerSessionProof, identity: Readonly<StorageIdentity>,
  order?: A2aOrder, consume = false): Readonly<Retained> {
  return retainedSession("sqlite", proof, identity, order, consume);
}

/** Native consumer only: this does not turn a transport or caller's session
 * packet into installed provenance. It accepts only the private route proof. */
export function retainedPostgresPendingOwnerSession(proof: PendingOwnerSessionProof, identity: Readonly<StorageIdentity>,
  order?: A2aOrder, consume = false): Readonly<Retained> {
  return retainedSession("postgres", proof, identity, order, consume);
}

function retainedSession(kind: Retained["kind"], proof: PendingOwnerSessionProof, identity: Readonly<StorageIdentity>,
  order?: A2aOrder, consume = false): Readonly<Retained> {
  const row = proof && typeof proof === "object" ? proofs.get(proof) : undefined;
  if (consume && proof && typeof proof === "object") proofs.delete(proof);
  const now = Date.now();
  if (!row || row.kind !== kind || row.store !== canonicalJson(validateStorageIdentity(identity)) || row.network !== identity.network
    || row.selectedStore !== canonicalJson(readRuntimeStorageDeployment())
    || row.issuedAt > now || row.expiresAt <= now || row.proofExpiresAt <= now
    || row.purpose !== (order ? "admit" : "read")
    || order && (order.id !== row.id || order.queryId !== row.id || order.requestHash !== row.requestHash
      || order.id !== a2aOrderId({ network: row.network, payer: order.payer, payee: order.payee, authorizationId: order.authorizationId })
      || order.request?.network !== row.network || Date.parse(order.createdAt) < row.issuedAt
      || Date.parse(order.createdAt) > now || !Number.isFinite(Date.parse(order.createdAt)))) throw deny();
  return row;
}

export function pendingOwnerSettlementSession(proof: PendingOwnerSessionProof, identity: Readonly<StorageIdentity>) {
  return settlementSession("sqlite", proof, identity);
}

export function postgresPendingOwnerSettlementSession(proof: PendingOwnerSessionProof, identity: Readonly<StorageIdentity>) {
  return settlementSession("postgres", proof, identity);
}

function settlementSession(kind: Retained["kind"], proof: PendingOwnerSessionProof, identity: Readonly<StorageIdentity>) {
  const row = proof && typeof proof === "object" ? proofs.get(proof) : undefined, now = Date.now();
  if (!row || row.kind !== kind || row.purpose !== "admit" || row.store !== canonicalJson(validateStorageIdentity(identity)) || row.network !== identity.network
    || row.selectedStore !== canonicalJson(readRuntimeStorageDeployment())
    || row.issuedAt > now || row.expiresAt <= now || row.proofExpiresAt <= now) throw deny();
  return row;
}

/** Capture before the native producer's first await, consuming the opaque proof.
 * The only association writer must insert a genuinely new original and owner in
 * one transaction after rechecking this session against web_sessions. */
export function capturePostgresPendingOwnerAdmission(proof: PendingOwnerSessionProof, identity: Readonly<StorageIdentity>,
  order: A2aOrder): Readonly<PostgresPendingOwnerAdmissionPacket> {
  const row = retainedPostgresPendingOwnerSession(proof, identity, order, true);
  return Object.freeze({ ...nativePacket(row, identity), original: Object.freeze({ id: order.id,
    queryId: order.queryId, requestHash: order.requestHash, network: row.network, createdAt: order.createdAt }) });
}

export function capturePostgresPendingOwnerSession(proof: PendingOwnerSessionProof, identity: Readonly<StorageIdentity>,
  purpose: "admit" | "read"): Readonly<PostgresPendingOwnerSessionPacket> {
  const row = purpose === "admit" ? postgresPendingOwnerSettlementSession(proof, identity)
    : purpose === "read" ? retainedPostgresPendingOwnerSession(proof, identity) : undefined;
  if (!row) throw deny();
  return nativePacket(row, identity);
}

function nativePacket(row: Readonly<Retained>, identity: Readonly<StorageIdentity>): Readonly<PostgresPendingOwnerSessionPacket> {
  return Object.freeze({ identity: validateStorageIdentity(identity), session: Object.freeze({ hash: row.hash,
    wallet: row.wallet, issuedAt: row.issuedAt, expiresAt: row.expiresAt }), proofExpiresAt: row.proofExpiresAt,
    binding: row.purpose === "admit" ? Object.freeze({ id: row.id, requestHash: row.requestHash }) : null });
}
