import { readBoundedJson } from "../read-bounded-json";
import { privateProfileInputSchema, privateProfileRecordSchema, privateProfileSnapshotSchema, type PrivateProfileInput } from "./private-profile";
import { identitySnapshotSchema } from "./verified-identities";

/** API-key identity only. Never loads a wallet/signer, follows redirects, or retries a write. */
export function createProfileClient(baseUrl: string, key: () => string | undefined, fetcher: typeof fetch = fetch) {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/" || base.protocol !== "https:") throw new Error("Use the HTTPS deployment origin");
  const call = async (method: string, input?: PrivateProfileInput, endpoint = "/api/me/profile") => {
    const raw = key(); if (!raw || !/^kx_live_[0-9a-f]{96}$/.test(raw)) throw new Error("Configure an explicitly profile-scoped KERYX_API_KEY");
    const url = new URL(endpoint, base);
    const response = await fetcher(url, { method, headers: { Authorization: `Bearer ${raw}`, ...(input ? { "Content-Type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify(privateProfileInputSchema.parse(input)) } : {}), redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Private profile request refused (${response.status})`); }
    if (endpoint === "/api/me/profile/identities" && (response.status !== 200 || response.redirected || (response.url && response.url !== url.href))) {
      await response.body?.cancel(); throw new Error("Invalid verified identity response");
    }
    return readBoundedJson(response, 16384);
  };
  return { read: async () => privateProfileSnapshotSchema.parse(await call("GET")),
    readIdentities: async () => {
      const value = identitySnapshotSchema.safeParse(await call("GET", undefined, "/api/me/profile/identities"));
      if (!value.success) throw new Error("Invalid verified identity response");
      return value.data;
    },
    update: async (input: PrivateProfileInput) => {
      const value = zProfileUpdate(await call("PUT", input)); return value;
    } };
}
function zProfileUpdate(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("profile" in body)) throw new Error("Invalid private profile response");
  return { profile: privateProfileRecordSchema.parse(body.profile) };
}
