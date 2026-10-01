import { createClient } from "@supabase/supabase-js";
import { assembleAuthorityBoundSupabaseCore } from "./supabase-adapter";
import { readRuntimeStorageDeployment, type StorageDeploymentManifest } from "./runtime-storage-config";
import { refuseStorage } from "./storage-identity";
import { SUPABASE_ENROLLED_METHODS } from "./supabase-enrolled-methods";
import type { KeryxDB } from "./keryx-db";
import type { QueryRun } from "../types";

const enrolledFacades = new WeakMap<object, { guard: () => Promise<void>; close: () => void; readOnly: boolean; closed: boolean; deployment: Readonly<StorageDeploymentManifest> }>();
const enrolledNativeFetch = globalThis.fetch.bind(globalThis);

function enrolledTransport(origin: string): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.origin !== origin || !/^\/rest\/v1\/rpc\/(read_storage_identity|storage_[a-z0-9_]+)$/.test(url.pathname)) refuseStorage("invalid_operation");
    if (init?.body !== undefined && init.body !== null &&
      (typeof init.body !== "string" || Buffer.byteLength(init.body, "utf8") > 4 * 1024 * 1024)) refuseStorage("invalid_operation");
    const deadline = AbortSignal.timeout(30_000);
    let response: Response;
    try {
      response = await enrolledNativeFetch(input, { ...init, redirect: "error", credentials: "omit",
        signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (reader) try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > (url.pathname === "/rest/v1/rpc/storage_inspect_runtime_readiness" ? 10 : 4) * 1024 * 1024) throw new Error();
          chunks.push(part.value);
        }
      } catch { await reader.cancel().catch(() => {}); throw new Error(); }
      const body = Buffer.concat(chunks);
      if (response.ok) return new Response(response.status === 204 ? null : body, { status: response.status, headers: { "Content-Type": "application/json" } });
      let code = "STORAGE_REFUSED";
      try { const parsed = JSON.parse(body.toString("utf8")); if (/^[0-9A-Z]{5}$/.test(parsed.code)) code = parsed.code; } catch {}
      return Response.json({ code, message: "Storage operation refused", details: null, hint: null }, { status: response.status });
    } catch { throw new Error("Storage operation unavailable"); }
  };
}

/** Controlled candidate only. Default getDb() continues using the legacy lane. */
export async function createEnrolledSupabaseAdapter(): Promise<KeryxDB> {
  if (arguments.length !== 0) refuseStorage("invalid_operation");
  return constructEnrolledSupabaseAdapter(false);
}

export async function createReadonlyEnrolledSupabaseAdapter(): Promise<KeryxDB> {
  if (arguments.length !== 0) refuseStorage("invalid_operation");
  return constructEnrolledSupabaseAdapter(true);
}

/** Actual installed-facade provenance plus a fresh protected DB check. */
export async function assertEnrolledSupabaseAuthority(adapter: unknown, access: "read" | "write" = "read"): Promise<Readonly<StorageDeploymentManifest>> {
  if (!adapter || typeof adapter !== "object" || !["read", "write"].includes(access)) refuseStorage("invalid_operation");
  const record = enrolledFacades.get(adapter);
  if (!record || record.closed || (access === "write" && record.readOnly)) refuseStorage("adapter_not_initialized");
  await record.guard();
  if (record.closed) refuseStorage("adapter_not_initialized");
  return record.deployment;
}

/** Local terminal close: pending operations cannot publish new authority. */
export function closeEnrolledSupabaseAdapter(adapter: unknown): void {
  if (!adapter || typeof adapter !== "object") refuseStorage("invalid_operation");
  const record = enrolledFacades.get(adapter);
  if (!record) refuseStorage("invalid_operation");
  record.closed = true;
  record.close();
}

export class EnrolledSupabaseWriteOutcomeUnknown extends Error {
  constructor() { super("Storage write outcome requires reconciliation"); }
}

async function constructEnrolledSupabaseAdapter(readOnly: boolean): Promise<KeryxDB> {
  // A closed factory call is the only runtime configuration-loading boundary.
  // Ordinary getDb()/default construction never invokes this function.
  const deployment = readRuntimeStorageDeployment();
  if (deployment.backend.kind !== "supabase") refuseStorage("identity_mismatch");
  const client = createClient(deployment.backend.url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false }, global: { fetch: enrolledTransport(deployment.backend.url) },
  });
  const { adapter, hooks } = assembleAuthorityBoundSupabaseCore(client, deployment, readRuntimeStorageDeployment);
  await adapter.init();
  const record = { guard: hooks.verify, close: hooks.close, readOnly, closed: false, deployment };
  const guard = async () => { if (record.closed) refuseStorage("adapter_not_initialized"); await hooks.verify(); if (record.closed) refuseStorage("adapter_not_initialized"); };
  // Only the explicit KeryxDB surface escapes. Neither the raw client nor the
  // construction capability, authority object or unguarded core is published.
  const facade = new Proxy(adapter, {
    get(target, property) {
      if (property === "then") return undefined;
      if (typeof property !== "string" || !Object.hasOwn(SUPABASE_ENROLLED_METHODS, property)) refuseStorage("invalid_operation");
      const method = Reflect.get(target, property) as (...args: unknown[]) => unknown;
      if (property === "iterateRecentQueries") return async function* (...args: unknown[]) {
        await guard();
        try {
          const iterator = Reflect.apply(method, target, args) as AsyncIterable<QueryRun>;
          const cursor = iterator[Symbol.asyncIterator]();
          try { while (true) { await guard(); const next = await cursor.next(); await guard(); if (next.done) break; yield next.value; } }
          finally { await cursor.return?.(); }
        } finally { await guard(); }
      };
      return async (...args: unknown[]) => {
        const write = SUPABASE_ENROLLED_METHODS[property as keyof typeof SUPABASE_ENROLLED_METHODS] === "write";
        if (write && readOnly) refuseStorage("readonly_operation");
        await guard();
        try { return await Reflect.apply(method, target, args); }
        finally {
          try { await guard(); }
          catch (error) { if (write) throw new EnrolledSupabaseWriteOutcomeUnknown(); throw error; }
        }
      };
    },
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => undefined,
    getPrototypeOf: () => null,
    setPrototypeOf: () => false,
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    preventExtensions: () => false,
  });
  enrolledFacades.set(facade, record);
  await guard();
  return facade;
}

