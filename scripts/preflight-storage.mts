import { readRuntimeStorageDeployment } from "../lib/db/runtime-storage-config.ts";
import { storageIdentityDigest } from "../lib/db/storage-identity.ts";

// Separate from build and payment/network preflight: no adapter initialization, migrations or signers.
try {
  if (process.argv.length !== 2) throw new Error();
  const deployment = readRuntimeStorageDeployment();
  let identity;
  if (deployment.backend.kind === "sqlite") {
    const { SqliteAdapter } = await import("../lib/db/sqlite-adapter.ts");
    const adapter = new SqliteAdapter(deployment.backend.databasePath, { expectedIdentity: deployment.identity, readOnly: true });
    try { identity = adapter.getStorageIdentity(); } finally { adapter.close(); }
  } else {
    const { createClient } = await import("@supabase/supabase-js");
    const { verifySupabaseStorageIdentity } = await import("../lib/db/supabase-authority.ts");
    const endpoint = `${deployment.backend.url}/rest/v1/rpc/read_storage_identity`;
    const client = createClient(deployment.backend.url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
        if (String(input) !== endpoint || init?.method !== "POST") throw new Error();
        const response = await fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(5000) });
        const reader = response.body?.getReader(); if (!reader) throw new Error();
        const chunks: Uint8Array[] = []; let bytes = 0;
        try {
          for (;;) { const part = await reader.read(); if (part.done) break;
            bytes += part.value.byteLength; if (bytes > 8192) throw new Error(); chunks.push(part.value); }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
      } },
    });
    identity = await verifySupabaseStorageIdentity(client, deployment.identity);
  }
  // Refuse configuration replacement during asynchronous metadata admission.
  if (storageIdentityDigest(readRuntimeStorageDeployment().identity) !== storageIdentityDigest(identity)) throw new Error();
  console.log(JSON.stringify({ format: "keryx-storage-preflight-v1", backend: deployment.backend.kind,
    authorityMode: identity.authorityMode, identityDigest: storageIdentityDigest(identity), readOnly: true,
    signingResumeAuthorized: false, runtimeReady: false }));
} catch { console.error("Storage preflight refused; no initialization or signing authorized"); process.exitCode = 1; }
