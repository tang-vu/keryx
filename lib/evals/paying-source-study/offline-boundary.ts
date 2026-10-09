import { createRequire, syncBuiltinESMExports } from "node:module";
let active = false;
export function assertStudyBoundary(): void {
  if (!active) throw new Error("Use the isolated study launcher with outbound denial");
}

export function studyEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "COMSPEC", "PATHEXT"])
    if (process.env[key]) env[key] = process.env[key];
  return { ...env, KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
    KERYX_CITATION_POOL_RATIO: "0.5", KERYX_WEB_RESEARCH: "0", KERYX_EXTERNAL_DISCOVERY: "0",
    SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", BASE_URL: "https://study.invalid",
    KERYX_STUDY_WORKER: "1", NO_COLOR: "1" };
}
/** Installed before importing any application runtime. A caught network error still fails the study. */
export function denyOutbound(): { attempts(): number } {
  if (process.env.KERYX_STUDY_WORKER !== "1" || process.env.KERYX_FORCE_OFFLINE !== "1"
    || process.env.KERYX_NETWORK !== "arcTestnet" || process.env.NEXT_PUBLIC_KERYX_NETWORK !== "arcTestnet"
    || ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"].some(key => process.env[key] !== ""))
    throw new Error("Study requires its isolated fresh-process environment");
  let attempts = 0;
  const deny = () => { attempts++; throw new Error("Outbound I/O denied by controlled study"); };
  globalThis.fetch = async () => deny();
  globalThis.WebSocket = class { constructor() { deny(); } } as unknown as typeof WebSocket;
  const require = createRequire(import.meta.url);
  for (const [module, methods] of [["node:http", ["request", "get"]], ["node:https", ["request", "get"]],
    ["node:net", ["connect", "createConnection"]], ["node:tls", ["connect"]],
    ["node:dns", ["lookup", "resolve", "resolve4", "resolve6"]], ["node:dgram", ["createSocket"]]] as const) {
    const api = require(module) as Record<string, unknown>;
    for (const method of methods) api[method] = deny;
  }
  const net = require("node:net") as typeof import("node:net");
  net.Socket.prototype.connect = deny as typeof net.Socket.prototype.connect;
  const dns = require("node:dns") as typeof import("node:dns");
  for (const method of ["lookup", "resolve", "resolve4", "resolve6"] as const)
    (dns.promises as unknown as Record<string, unknown>)[method] = async () => deny();
  syncBuiltinESMExports();
  active = true;
  return { attempts: () => attempts };
}
