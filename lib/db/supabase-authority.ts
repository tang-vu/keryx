import type { SupabaseClient } from "@supabase/supabase-js";
import { refuseStorage, validateStorageIdentity, type StorageIdentity } from "./storage-identity";

// Ports carry only checked transport, never installed-runtime provenance. Only
// the private runtime factory can construct an installed enrolled adapter.
const domainPorts = new WeakMap<object, SupabaseAuthority>();

/** The operation and arguments are fixed in each helper. No query translator. */
export async function callSupabaseDomain<T, A extends Record<string, unknown>>(
  client: SupabaseClient, operation: string, args: A, legacy: (args: A) => PromiseLike<T>,
): Promise<T> {
  const authority = domainPorts.get(client);
  if (!authority) return legacy(args);
  return await authority.rpcResult(operation, args) as T;
}

/** Read-only preflight: one public marker RPC, no adapter/cache/schema initialization. */
export async function verifySupabaseStorageIdentity(client: SupabaseClient, expectedIdentity: StorageIdentity): Promise<Readonly<StorageIdentity>> {
  const expected = validateStorageIdentity(expectedIdentity);
  const { data, error } = await client.rpc("read_storage_identity");
  if (error) refuseStorage("identity_unavailable");
  if (data == null) refuseStorage("enrollment_required");
  const observed = validateStorageIdentity(data);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) refuseStorage("identity_mismatch");
  return expected;
}

/** Restricted domain RPC client. No table/query-builder or enrollment API escapes it. */
export class SupabaseAuthority {
  #ready = false;
  readonly #client: SupabaseClient;
  readonly #adapterReady: () => boolean;
  readonly expectedIdentity: Readonly<StorageIdentity>;

  constructor(client: SupabaseClient, expectedIdentity: StorageIdentity,
    adapterReady: () => boolean = () => true) {
    this.#client = client;
    this.#adapterReady = adapterReady;
    this.expectedIdentity = validateStorageIdentity(expectedIdentity);
  }

  async init(): Promise<void> {
    await verifySupabaseStorageIdentity(this.#client, this.expectedIdentity);
    this.#ready = true;
  }

  rpc(name: string, args: Record<string, unknown> = {}) {
    if (!this.#ready || !this.#adapterReady()) refuseStorage("adapter_not_initialized");
    if (!/^[a-z][a-z0-9_]*$/.test(name) || Object.hasOwn(args, "p_expected_identity")) refuseStorage("invalid_operation");
    // Only explicitly granted named SQL functions exist. Identity is never discovered
    // or normalized from a target response, and each RPC repeats admission in SQL.
    return this.#client.rpc(`storage_${name}`, { ...args, p_expected_identity: this.expectedIdentity }).throwOnError().then(result => {
      if (!this.#adapterReady()) refuseStorage("adapter_not_initialized");
      return result;
    });
  }

  /** Domain helpers inspect failure envelopes to preserve their bounded public
   * error messages and ambiguous-write recovery. Identity admission still runs. */
  rpcResult(name: string, args: Record<string, unknown> = {}) {
    return this.rpc(name, args).then(result => result, (error: unknown) => ({ data: null, error }));
  }

  getStorageIdentity(): Readonly<StorageIdentity> {
    if (!this.#ready || !this.#adapterReady()) refuseStorage("adapter_not_initialized");
    return this.expectedIdentity;
  }

  /** RPC-only port for existing domain validators; no client or .from escape. */
  domainClient(): SupabaseClient {
    if (!this.#ready || !this.#adapterReady()) refuseStorage("adapter_not_initialized");
    const port = Object.freeze({ rpc: (name: string, args: Record<string, unknown> = {}) => this.rpcResult(name, args),
      from: () => refuseStorage("invalid_operation") });
    domainPorts.set(port, this);
    return port as unknown as SupabaseClient;
  }

  /** Startup can only inspect/reseal cache rows, never admit financial authority. */
  initializationRpc(name: "scan_cache_for_encryption" | "init" | "inspect_runtime_readiness", args: Record<string, unknown>) {
    if (!this.#ready || !["scan_cache_for_encryption", "init", "inspect_runtime_readiness"].includes(name)
      || Object.hasOwn(args, "p_expected_identity")) refuseStorage("invalid_initialization_operation");
    return this.#client.rpc(`storage_${name}`, { ...args, p_expected_identity: this.expectedIdentity }).throwOnError();
  }
}
