import { Pool } from "pg";
import { ARC_MAINNET_PROFILE } from "../../arc-network-profile";
import { canonicalJson } from "../../canonical-json";
import { parseSessionGrantConsent, type SessionGrantConsent } from "../../payments/session-grant-consent";
import { validateStorageIdentity, type StorageIdentity } from "../storage-identity";
import type { SessionGrantConsentRecord } from "../session-grant-consents";
import { postgresPoolConfiguration, PostgresStorageBusy, PostgresStorageUnavailable, type PostgresConnectionOptions } from "./connection";

const CALLS = Object.freeze({
  issue: "SELECT public.storage_issue_session_grant_consent($1::jsonb,$2::text,$3::text) AS result",
  consume: "SELECT public.storage_consume_session_grant_consent($1::jsonb,$2::text,$3::text,$4::text,$5::text) AS result",
  get: "SELECT public.storage_get_session_grant_consent($1::jsonb,$2::text,$3::text,$4::text) AS result",
});
export class PostgresConsentWriteOutcomeUnknown extends Error {
  constructor() { super("Session consent write outcome requires original-bound reconciliation"); }
}
export interface PostgresConsentTransport {
  issue(consent: SessionGrantConsent): Promise<void>;
  consume(consent: SessionGrantConsent, ownerSignature: string, sessionSignature: string): Promise<void>;
  get(owner: string, epoch: string): Promise<SessionGrantConsentRecord | null>;
  close(): Promise<void>;
}
const signature = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{130}$/i.test(value);
function unavailable(): never { throw new PostgresStorageUnavailable(); }

/** Fixed domain transport only. No installed KeryxDB provenance, alternate-store
 * discovery, raw query/pool, callback, enrollment, policy renewal or signer. */
export function createPostgresConsentTransport(options: PostgresConnectionOptions, expected: StorageIdentity, sourceDigest: string): PostgresConsentTransport {
  const identity = validateStorageIdentity(expected);
  if (identity.authorityMode !== "mainnet-real" || typeof sourceDigest !== "string" || !/^[0-9a-f]{64}$/.test(sourceDigest)) unavailable();
  const expectedWire = canonicalJson(identity), pool = new Pool(postgresPoolConfiguration(options));
  let closed = false, pending = 0;
  let closing: Promise<void> | undefined;
  const inFlight = new Set<Promise<unknown>>();
  pool.on("error", () => {});
  const call = async (operation: keyof typeof CALLS, args: readonly string[]) => {
    if (closed) unavailable();
    if (pending >= 10) throw new PostgresStorageBusy();
    const write = operation !== "get";
    let submitted = false, request: Promise<unknown> | undefined;
    pending++;
    try {
      submitted = true;
      const query = pool.query({ text: CALLS[operation], rowMode: "array", values: [expectedWire, sourceDigest, ...args] });
      request = query; inFlight.add(query);
      const result = await query;
      if (closed || result.rows.length !== 1 || result.fields.length !== 1 || result.fields[0].name !== "result"
        || ![114, 3802].includes(result.fields[0].dataTypeID)) unavailable();
      const row = result.rows[0] as unknown[];
      if (!Array.isArray(row) || row.length !== 1) unavailable();
      if (write) { if (row[0] !== null) unavailable(); return null; }
      if (row[0] === null) return null;
      if (typeof row[0] !== "string" || Buffer.byteLength(row[0]) > 16 * 1024) unavailable();
      const value: unknown = JSON.parse(row[0]);
      if (closed || value === null) unavailable();
      return value;
    } catch {
      // Even a rejected/closed result can follow a committed native write.
      // Neither the driver nor this boundary may turn it into another attempt.
      if (write && submitted) throw new PostgresConsentWriteOutcomeUnknown();
      return unavailable();
    } finally { pending--; if (request) inFlight.delete(request); }
  };
  const consentWire = (input: SessionGrantConsent) => {
    const wire = canonicalJson(parseSessionGrantConsent(input, ARC_MAINNET_PROFILE));
    if (Buffer.byteLength(wire) > 8192) unavailable();
    return wire;
  };
  return Object.freeze({
    async issue(input: SessionGrantConsent): Promise<void> {
      await call("issue", [consentWire(input)]);
      if (closed) throw new PostgresConsentWriteOutcomeUnknown();
    },
    async consume(input: SessionGrantConsent, ownerSignature: string, sessionSignature: string): Promise<void> {
      if (!signature(ownerSignature) || !signature(sessionSignature)) unavailable();
      await call("consume", [consentWire(input), ownerSignature, sessionSignature]);
      if (closed) throw new PostgresConsentWriteOutcomeUnknown();
    },
    async get(owner: string, epoch: string): Promise<SessionGrantConsentRecord | null> {
      if (typeof owner !== "string" || !/^0x[0-9a-f]{40}$/.test(owner) || typeof epoch !== "string" || !/^[0-9a-f-]{36}$/.test(epoch)) unavailable();
      const result = await call("get", [owner, epoch]);
      if (closed) unavailable();
      if (result === null) return null;
      if (!result || typeof result !== "object" || Array.isArray(result)
        || Object.keys(result).sort().join(",") !== "consent,ownerSignature,sessionSignature") unavailable();
      const value = result as Record<string, unknown>;
      let consent: SessionGrantConsent;
      try { consent = parseSessionGrantConsent(value.consent, ARC_MAINNET_PROFILE); } catch { return unavailable(); }
      if (closed || consent.ownerAddr !== owner || consent.grantEpoch !== epoch || !signature(value.ownerSignature) || !signature(value.sessionSignature)) unavailable();
      return Object.freeze({ consent, ownerSignature: value.ownerSignature, sessionSignature: value.sessionSignature });
    },
    close(): Promise<void> {
      closed = true;
      return closing ??= Promise.allSettled([...inFlight]).then(() => pool.end())
        .then(() => {}, () => { throw new PostgresStorageUnavailable(); });
    },
  });
}
