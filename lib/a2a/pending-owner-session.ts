import { parseWebSession, isWebSessionActive, webSessionHash } from "../auth-session";
import { canonicalJson } from "../canonical-json";
import { a2aOrderId, type A2aOrder } from "./order";
import type { StorageIdentity } from "../db/storage-identity";
import { PendingOwnerAdmissionError } from "./pending-owner-association";
import { readRuntimeStorageDeployment } from "../db/runtime-storage-config";

declare const brand: unique symbol;
export type PendingOwnerSessionProof = { readonly [brand]: true };
type Binding = { id: string; requestHash: string };
type Retained = Binding & { store: string; selectedStore: string; network: string; hash: string; wallet: string;
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
  const { assertEnrolledSqliteAdapter } = await import("../db/enrolled-sqlite-adapter");
  const url = new URL(req.url);
  if (url.pathname !== (binding ? "/api/agent/ask" : "/api/me/jobs") || req.method !== (binding ? "POST" : "GET")) throw deny();
  if (binding && (req.headers.get("x-keryx-account-job") !== "associate" || req.headers.has("authorization")
    || !req.headers.get("origin") || new URL(req.headers.get("origin")!).origin !== url.origin)) throw deny();
  if (binding && (!/^a2a_[a-f0-9]{64}$/.test(binding.id) || !/^[a-f0-9]{64}$/.test(binding.requestHash))) throw deny();
  const claims = await parseWebSession((await cookies()).get("keryx_session")?.value, config.jwtSecret);
  if (!claims) throw deny();
  const db = await getDb();
  const identity = assertEnrolledSqliteAdapter(db, binding ? "write" : "read");
  if (identity.authorityMode !== "mainnet-real" || identity.network !== config.networkId || !db.pendingJobOwners
    || !await isWebSessionActive(db, claims)) throw deny();
  const now = Date.now();
  const proof = Object.freeze(Object.create(null)) as PendingOwnerSessionProof;
  proofs.set(proof, Object.freeze({ id: binding?.id ?? "", requestHash: binding?.requestHash ?? "",
    store: canonicalJson(identity), selectedStore: canonicalJson(readRuntimeStorageDeployment()), network: config.networkId, hash: webSessionHash(claims.jti),
    wallet: claims.address.toLowerCase(), issuedAt: claims.iat * 1000, expiresAt: claims.exp * 1000,
    proofExpiresAt: Math.min(claims.exp * 1000, now + 300_000), purpose: binding ? "admit" : "read" }));
  return proof;
}

/** Internal storage consumer; candidate objects cannot pass the WeakMap check.
 * It exposes only verified metadata, never an independently usable writer. */
export function retainedPendingOwnerSession(proof: PendingOwnerSessionProof, identity: Readonly<StorageIdentity>,
  order?: A2aOrder, consume = false): Readonly<Retained> {
  const row = proof && typeof proof === "object" ? proofs.get(proof) : undefined;
  if (consume && proof && typeof proof === "object") proofs.delete(proof);
  const now = Date.now();
  if (!row || row.store !== canonicalJson(identity) || row.network !== identity.network
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
  const row = proof && typeof proof === "object" ? proofs.get(proof) : undefined, now = Date.now();
  if (!row || row.purpose !== "admit" || row.store !== canonicalJson(identity) || row.network !== identity.network
    || row.selectedStore !== canonicalJson(readRuntimeStorageDeployment())
    || row.issuedAt > now || row.expiresAt <= now || row.proofExpiresAt <= now) throw deny();
  return row;
}
