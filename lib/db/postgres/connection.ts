import { Pool, types, type PoolConfig } from "pg";
import { canonicalJson } from "../../canonical-json";
import { validateStorageIdentity, type StorageIdentity } from "../storage-identity";

export interface PostgresConnectionOptions {
  readonly endpoint: Readonly<{ kind: "unix"; directory: string; port: number }
    | { kind: "loopback"; port: number }>;
  readonly database: string;
  readonly role: string;
  readonly password: string;
}

// This module is a transport primitive, not installed adapter provenance,
// enrollment, a migration capability or an admitted mainnet financial backend.
const READ_OPERATIONS = Object.freeze({
  identity: "SELECT keryx_pg.read_identity($1::jsonb) AS result",
  authority: "SELECT keryx_pg.verify_runtime_authority($1::jsonb,$2::text) AS result",
  readiness: "SELECT keryx_pg.inspect_runtime_readiness($1::jsonb,$2::text) AS result",
});
export type PostgresBootstrapRead = keyof typeof READ_OPERATIONS;
const MAX_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_BYTES = 8192;
const ACTIVE_CONNECTIONS = 2;
const QUEUED_READS = 8;

export class PostgresStorageUnavailable extends Error {
  constructor() { super("PostgreSQL storage unavailable"); }
}
export class PostgresStorageBusy extends Error {
  constructor() { super("PostgreSQL storage capacity unavailable"); }
}
function refuse(): never { throw new PostgresStorageUnavailable(); }

/** Explicit local endpoint only. No URL parsing or PG* environment selection. */
export function postgresPoolConfiguration(options: PostgresConnectionOptions): PoolConfig {
  if (!options || typeof options !== "object" || Object.keys(options).sort().join(",") !== "database,endpoint,password,role"
    || typeof options.database !== "string" || typeof options.role !== "string"
    || !/^[a-z][a-z0-9_]{0,62}$/.test(options.database) || !/^[a-z][a-z0-9_]{0,62}$/.test(options.role)
    || typeof options.password !== "string" || options.password.length < 16 || options.password.length > 1024
    || /[\u0000\r\n]/.test(options.password)) refuse();
  const endpoint = options.endpoint;
  if (!endpoint || !Number.isSafeInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) refuse();
  let host: string;
  if (endpoint.kind === "unix") {
    if (Object.keys(endpoint).sort().join(",") !== "directory,kind,port"
      || typeof endpoint.directory !== "string" || endpoint.directory.length > 1024
      || !/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(endpoint.directory)
      || endpoint.directory.split("/").some(part => part === "." || part === "..")) refuse();
    host = endpoint.directory;
  } else if (endpoint.kind === "loopback") {
    if (Object.keys(endpoint).sort().join(",") !== "kind,port") refuse();
    host = "127.0.0.1";
  } else refuse();
  return {
    host, port: endpoint.port, database: options.database, user: options.role, password: options.password,
    ssl: false, application_name: "keryx-postgres-guarded", max: ACTIVE_CONNECTIONS,
    connectionTimeoutMillis: 2_000, idleTimeoutMillis: 30_000, query_timeout: 6_000,
    options: "-c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000 -c client_encoding=UTF8",
    allowExitOnIdle: true,
    // Size-check the actual JSON wire value before allocating its object graph.
    types: { getTypeParser: (oid, format) => format !== "binary" && (oid === 114 || oid === 3802)
      ? (value: string) => value : types.getTypeParser(oid, format) },
  };
}

export interface PostgresBootstrapTransport {
  read(operation: PostgresBootstrapRead, identity: StorageIdentity, sourceContractDigest?: string): Promise<unknown>;
  close(): Promise<void>;
}

/** Fixed bounded read-only RPCs. No arbitrary SQL, target discovery, retry,
 * transaction callback, pool or native connection escapes this primitive. */
export function createPostgresBootstrapTransport(options: PostgresConnectionOptions): PostgresBootstrapTransport {
  const pool = new Pool(postgresPoolConfiguration(options));
  let closed = false, pending = 0;
  const inFlight = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  // Idle socket failure must not become an unhandled EventEmitter exception.
  // Every actual read still rejects independently; no private error is logged.
  pool.on("error", () => {});
  return Object.freeze({
    async read(operation: PostgresBootstrapRead, rawIdentity: StorageIdentity, sourceContractDigest?: string): Promise<unknown> {
      if (closed || typeof operation !== "string" || !Object.hasOwn(READ_OPERATIONS, operation)) refuse();
      let identity: string;
      try { identity = canonicalJson(validateStorageIdentity(rawIdentity)); } catch { return refuse(); }
      if (Buffer.byteLength(identity) > MAX_INPUT_BYTES) refuse();
      if (operation === "identity" ? sourceContractDigest !== undefined
        : typeof sourceContractDigest !== "string" || !/^[0-9a-f]{64}$/.test(sourceContractDigest)) refuse();
      if (pending >= ACTIVE_CONNECTIONS + QUEUED_READS) throw new PostgresStorageBusy();
      pending++;
      let query: Promise<unknown> | undefined;
      try {
        const request = pool.query({ text: READ_OPERATIONS[operation], rowMode: "array",
          values: operation === "identity" ? [identity] : [identity, sourceContractDigest] });
        query = request; inFlight.add(request);
        const result = await request;
        if (closed || result.rows.length !== 1 || result.fields.length !== 1 || result.fields[0].name !== "result"
          || ![114, 3802].includes(result.fields[0].dataTypeID)) refuse();
        const row = result.rows[0] as unknown[];
        if (!Array.isArray(row) || row.length !== 1 || typeof row[0] !== "string"
          || Buffer.byteLength(row[0], "utf8") > MAX_RESULT_BYTES) refuse();
        const value: unknown = JSON.parse(row[0]);
        if (closed) refuse();
        return value;
      } catch { return refuse(); }
      finally { pending--; if (query) inFlight.delete(query); }
    },
    close(): Promise<void> {
      closed = true; // Results already in flight cannot publish after disposal.
      // pg-pool.end() does not settle queued acquisition promises. Let our
      // already-bounded native reads finish before draining its actual clients;
      // the closed checks above still prevent publishing any late result.
      return closing ??= Promise.allSettled([...inFlight]).then(() => pool.end())
        .then(() => {}, () => { throw new PostgresStorageUnavailable(); });
    },
  });
}
