import { Pool } from "pg";
import { canonicalJson } from "../../canonical-json";
import { validateStorageIdentity, type StorageIdentity } from "../storage-identity";
import { postgresPoolConfiguration, PostgresStorageBusy, PostgresStorageUnavailable, type PostgresConnectionOptions } from "./connection";

// Source-defined calls only: callers cannot supply SQL, function names, transaction
// callbacks, expected metadata, role changes or a connection to the runtime.
const CALLS = Object.freeze({
  issue: { sql: "SELECT public.storage_issue_session_grant_consent($1::jsonb,$2::text,$3::text) AS result", args: 1, write: true, bytes: 0 },
  consume: { sql: "SELECT public.storage_consume_session_grant_consent($1::jsonb,$2::text,$3::text,$4::text,$5::text) AS result", args: 3, write: true, bytes: 0 },
  get: { sql: "SELECT public.storage_get_session_grant_consent($1::jsonb,$2::text,$3::text,$4::text) AS result", args: 2, write: false, bytes: 16384 },
  funding: { sql: "SELECT public.storage_session_funding_accounting($1::jsonb,$2::text,$3::text,$4::text) AS result", args: 2, write: false, bytes: 1024 },
  retained: { sql: "SELECT public.storage_browser_signer_retained_spend($1::jsonb,$2::text,$3::text) AS result", args: 1, write: false, bytes: 64 },
});
export class PostgresDomainWriteOutcomeUnknown extends Error {
  constructor() { super("Storage write outcome requires original-bound reconciliation"); }
}
export interface PostgresDomainChannel {
  call(operation: keyof typeof CALLS, args: readonly (string | null)[]): Promise<unknown>;
  readonly closed: boolean;
  close(): Promise<void>;
}
function unavailable(): never { throw new PostgresStorageUnavailable(); }

/** A single bounded pool for composed native domain ports. Not application
 * enrollment/provenance, target discovery, funding, custody or retry authority. */
export function createPostgresDomainChannel(options: PostgresConnectionOptions, expected: StorageIdentity, sourceDigest: string): PostgresDomainChannel {
  const identity = validateStorageIdentity(expected);
  if (identity.authorityMode !== "mainnet-real" || typeof sourceDigest !== "string" || !/^[0-9a-f]{64}$/.test(sourceDigest)) unavailable();
  const expectedWire = canonicalJson(identity), pool = new Pool(postgresPoolConfiguration(options));
  let closed = false, pending = 0, closing: Promise<void> | undefined;
  const inFlight = new Set<Promise<unknown>>();
  pool.on("error", () => {});
  return Object.freeze({
    get closed() { return closed; },
    async call(operation: keyof typeof CALLS, args: readonly (string | null)[]): Promise<unknown> {
      if (closed || typeof operation !== "string" || !Object.hasOwn(CALLS, operation)) unavailable();
      const selected = CALLS[operation];
      if (!Array.isArray(args) || args.length !== selected.args || args.some(value => value !== null && typeof value !== "string")
        || Buffer.byteLength(JSON.stringify(args)) > 16384) unavailable();
      if (pending >= 10) throw new PostgresStorageBusy();
      let submitted = false, request: Promise<unknown> | undefined;
      pending++;
      try {
        submitted = true;
        const query = pool.query({ text: selected.sql, rowMode: "array", values: [expectedWire, sourceDigest, ...args] });
        request = query; inFlight.add(query);
        const result = await query;
        if (closed || result.rows.length !== 1 || result.fields.length !== 1 || result.fields[0].name !== "result"
          || ![114, 3802].includes(result.fields[0].dataTypeID)) unavailable();
        const row = result.rows[0] as unknown[];
        if (!Array.isArray(row) || row.length !== 1) unavailable();
        if (selected.write) { if (row[0] !== null) unavailable(); return null; }
        if (row[0] === null) return null;
        if (typeof row[0] !== "string" || Buffer.byteLength(row[0]) > selected.bytes) unavailable();
        const value: unknown = JSON.parse(row[0]);
        if (closed || value === null) unavailable();
        return value;
      } catch {
        if (selected.write && submitted) throw new PostgresDomainWriteOutcomeUnknown();
        return unavailable();
      } finally { pending--; if (request) inFlight.delete(request); }
    },
    close(): Promise<void> {
      closed = true;
      return closing ??= Promise.allSettled([...inFlight]).then(() => pool.end())
        .then(() => {}, () => { throw new PostgresStorageUnavailable(); });
    },
  });
}
