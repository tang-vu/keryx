import { canonicalJson } from "../../canonical-json";
import { parseSessionWithdrawalPreparation, verifySessionWithdrawalPreparation, sessionWithdrawalCancellationSchema,
  type SessionWithdrawalPreparation, type SessionWithdrawalSigningPhase, type SessionWithdrawalCancellation } from "../../gateway/session-withdrawal-protocol";
import { verifySessionWithdrawalCompletion, type SessionWithdrawalCompletion } from "../../gateway/session-withdrawal-completion";
import { verifySessionWithdrawalAbort, type SessionWithdrawalAbort } from "../../gateway/session-withdrawal-abort";
import { PostgresStorageUnavailable, type PostgresConnectionOptions } from "./connection";
import type { StorageIdentity } from "../storage-identity";
import { composePostgresSessionTransport, type PostgresSessionTransport } from "./session-transport";
import { createPostgresDomainChannel, PostgresDomainWriteOutcomeUnknown, type PostgresDomainChannel } from "./domain-channel";

export interface PostgresWithdrawalTransport extends PostgresSessionTransport {
  sessionWithdrawalAccounting(signer: string): Promise<{ heldPaymentMicroUsdc: string; heldWithdrawalMicroUsdc: string; confirmedSpentMicroUsdc: string }>;
  reserveSessionWithdrawal(preparation: SessionWithdrawalPreparation): Promise<SessionWithdrawalPreparation>;
  getSessionWithdrawal(id: string, owner: string): Promise<SessionWithdrawalPreparation | null>;
  pendingSessionWithdrawal(owner: string, signer: string): Promise<SessionWithdrawalPreparation | null>;
  getSessionWithdrawalSigningPhase(id: string, owner: string): Promise<SessionWithdrawalSigningPhase | null>;
  authorizeSessionWithdrawal(id: string, owner: string): Promise<SessionWithdrawalPreparation | null>;
  cancelSessionWithdrawal(id: string, owner: string): Promise<SessionWithdrawalCancellation | null>;
  getSessionWithdrawalAbort(id: string, owner: string): Promise<SessionWithdrawalAbort | null>;
  abortSessionWithdrawal(id: string, owner: string, proof: SessionWithdrawalAbort): Promise<SessionWithdrawalAbort | null>;
  getSessionWithdrawalCompletion(id: string, owner: string): Promise<SessionWithdrawalCompletion | null>;
  completeSessionWithdrawal(id: string, owner: string, completion: SessionWithdrawalCompletion): Promise<SessionWithdrawalCompletion>;
}
const address = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v);
const micro = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,15})$/.test(v) && BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER);
function unavailable(): never { throw new PostgresStorageUnavailable(); }
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) unavailable(); return v as Record<string, unknown>;
}
function wire(v: unknown, bound: number) { const text = canonicalJson(v); if (Buffer.byteLength(text)>bound) unavailable(); return text; }

/** Protocol-only composition. It validates the same pure signed originals as the
 * current SQLite domain, then native commands atomically compare retained facts.
 * Neither selected-store provenance nor an actual vendor/chain call is exposed. */
export function createPostgresWithdrawalTransport(options: PostgresConnectionOptions, identity: StorageIdentity, sourceDigest: string): PostgresWithdrawalTransport {
  const channel = createPostgresDomainChannel(options, identity, sourceDigest);
  return composePostgresWithdrawalTransport(channel);
}
export function composePostgresWithdrawalTransport(channel: PostgresDomainChannel): PostgresWithdrawalTransport {
  const live = () => { if (channel.closed) unavailable(); };
  const selector = (id: string, owner: string) => { if (!hash(id) || !address(owner)) unavailable(); live(); };
  const write = async (operation: "withdrawalReserve" | "withdrawalExpose" | "withdrawalCancel" | "withdrawalAbort" | "withdrawalComplete", args: string[]) => {
    live(); await channel.call(operation, args); if (channel.closed) throw new PostgresDomainWriteOutcomeUnknown();
  };
  const snapshot = async (value: unknown, id: string | undefined, owner: string, signer?: string) => {
    live(); if (value === null) return null;
    const r = object(value);
    if (Object.keys(r).sort().join(",") !== "abort,completion,phase,preparation" || typeof r.phase !== "string"
      || !["prepared","exposed","cancelled_unexposed","completed","aborted_before_publication"].includes(r.phase)) unavailable();
    let preparation: SessionWithdrawalPreparation, completion: SessionWithdrawalCompletion | null, abort: SessionWithdrawalAbort | null;
    try {
      preparation = await verifySessionWithdrawalPreparation(r.preparation); live();
      if (preparation.ownerAddr !== owner || (id !== undefined && preparation.requestId !== id) || (signer !== undefined && preparation.sessAddr !== signer)) unavailable();
      completion = r.completion === null ? null : await verifySessionWithdrawalCompletion(r.completion, preparation); live();
      abort = r.abort === null ? null : await verifySessionWithdrawalAbort(r.abort, preparation); live();
      if ((completion !== null) !== (r.phase === "completed") || (abort !== null) !== (r.phase === "aborted_before_publication")) unavailable();
    } catch { return unavailable(); }
    return { preparation, completion, abort, phase: r.phase as SessionWithdrawalSigningPhase };
  };
  const read = async (id: string, owner: string) => {
    selector(id,owner); const r = await channel.call("withdrawalRead", [id,owner]); live(); return snapshot(r,id,owner);
  };
  return Object.freeze({
    ...composePostgresSessionTransport(channel),
    async sessionWithdrawalAccounting(signer: string) {
      if (!address(signer)) unavailable(); live();
      const response = object(await channel.call("withdrawalAccounting",[signer])); live(); const totals = object(response.totals);
      if (Object.keys(response).sort().join(",")!=="preparations,totals" || Object.keys(totals).sort().join(",")!=="confirmedSpentMicroUsdc,heldPaymentMicroUsdc,heldWithdrawalMicroUsdc"
        || !micro(totals.heldPaymentMicroUsdc) || !micro(totals.heldWithdrawalMicroUsdc) || !micro(totals.confirmedSpentMicroUsdc)
        || !Array.isArray(response.preparations) || response.preparations.length>1) unavailable();
      let held=BigInt(0);
      for (const value of response.preparations) {
        let p: SessionWithdrawalPreparation; try { p=parseSessionWithdrawalPreparation(value); } catch { return unavailable(); }
        if (p.sessAddr!==signer) unavailable(); held+=BigInt(p.burnIntent.spec.value)+BigInt(p.burnIntent.maxFee);
      }
      if (held.toString()!==totals.heldWithdrawalMicroUsdc) unavailable();
      return Object.freeze({ heldPaymentMicroUsdc: totals.heldPaymentMicroUsdc, heldWithdrawalMicroUsdc: totals.heldWithdrawalMicroUsdc, confirmedSpentMicroUsdc: totals.confirmedSpentMicroUsdc });
    },
    async reserveSessionWithdrawal(value: SessionWithdrawalPreparation) {
      live(); const p=await verifySessionWithdrawalPreparation(value); live();
      await write("withdrawalReserve",[wire(p,16384)]); if (channel.closed) throw new PostgresDomainWriteOutcomeUnknown(); return p;
    },
    async getSessionWithdrawal(id: string, owner: string) { const r=await read(id,owner); live(); return r?.preparation ?? null; },
    async pendingSessionWithdrawal(owner: string, signer: string) {
      if (!address(owner)||!address(signer)) unavailable(); live();
      const r=await snapshot(await channel.call("withdrawalPending",[owner,signer]),undefined,owner,signer); live();
      if(r && !["prepared","exposed"].includes(r.phase)) unavailable(); return r?.preparation ?? null;
    },
    async getSessionWithdrawalSigningPhase(id: string, owner: string) { const r=await read(id,owner); live(); return r?.phase ?? null; },
    async authorizeSessionWithdrawal(id: string, owner: string) {
      const r=await read(id,owner); live(); if(!r)return null;
      await write("withdrawalExpose",[id,owner,wire(r.preparation,16384)]); if (channel.closed) throw new PostgresDomainWriteOutcomeUnknown(); return r.preparation;
    },
    async cancelSessionWithdrawal(id: string, owner: string) {
      const r=await read(id,owner); live(); if(!r)return null;
      const c=sessionWithdrawalCancellationSchema.parse({format:"keryx-session-withdrawal-cancellation-v1",network:r.preparation.network,requestId:id,ownerAddr:owner,sessAddr:r.preparation.sessAddr,reason:"cancelled-unexposed"});
      await write("withdrawalCancel",[id,owner,wire(r.preparation,16384)]); if (channel.closed) throw new PostgresDomainWriteOutcomeUnknown(); return c;
    },
    async getSessionWithdrawalAbort(id: string, owner: string) { const r=await read(id,owner); live(); return r?.abort ?? null; },
    async abortSessionWithdrawal(id: string, owner: string, value: SessionWithdrawalAbort) {
      // Snapshot external proof before the first storage/crypto await.
      const proposed=structuredClone(value),r=await read(id,owner); live(); if(!r)return null;
      const proof=await verifySessionWithdrawalAbort(proposed,r.preparation); live();
      await write("withdrawalAbort",[id,owner,wire(r.preparation,16384),wire(proof,2048)]); if (channel.closed) throw new PostgresDomainWriteOutcomeUnknown(); return proof;
    },
    async getSessionWithdrawalCompletion(id: string, owner: string) { const r=await read(id,owner); live(); return r?.completion ?? null; },
    async completeSessionWithdrawal(id: string, owner: string, value: SessionWithdrawalCompletion) {
      const proposed=structuredClone(value),r=await read(id,owner); live(); if(!r)unavailable();
      const completion=await verifySessionWithdrawalCompletion(proposed,r.preparation); live();
      await write("withdrawalComplete",[id,owner,wire(r.preparation,16384),wire(completion,16384)]); if (channel.closed) throw new PostgresDomainWriteOutcomeUnknown(); return completion;
    },
  });
}
