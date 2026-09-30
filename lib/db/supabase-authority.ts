import type { SupabaseClient } from "@supabase/supabase-js";
import { refuseStorage, validateStorageIdentity, type StorageIdentity } from "./storage-identity";

/** Restricted domain RPC client. No table/query-builder or enrollment API escapes it. */
export class SupabaseAuthority {
  private ready = false;
  readonly expectedIdentity: Readonly<StorageIdentity>;

  constructor(private readonly client: SupabaseClient, expectedIdentity: StorageIdentity) {
    this.expectedIdentity = validateStorageIdentity(expectedIdentity);
  }

  async init(): Promise<void> {
    const { data, error } = await this.client.rpc("read_storage_identity");
    if (error) refuseStorage("identity_unavailable");
    if (data == null) refuseStorage("enrollment_required");
    const observed = validateStorageIdentity(data);
    if (JSON.stringify(observed) !== JSON.stringify(this.expectedIdentity)) refuseStorage("identity_mismatch");
    this.ready = true;
  }

  rpc(name: string, args: Record<string, unknown> = {}) {
    if (!this.ready) refuseStorage("adapter_not_initialized");
    if (!/^[a-z][a-z0-9_]*$/.test(name) || Object.hasOwn(args, "p_expected_identity")) refuseStorage("invalid_operation");
    // Only explicitly granted named SQL functions exist. Identity is never discovered
    // or normalized from a target response, and each RPC repeats admission in SQL.
    return this.client.rpc(`storage_${name}`, { ...args, p_expected_identity: this.expectedIdentity }).throwOnError();
  }

  getStorageIdentity(): Readonly<StorageIdentity> {
    if (!this.ready) refuseStorage("adapter_not_initialized");
    return this.expectedIdentity;
  }
}
