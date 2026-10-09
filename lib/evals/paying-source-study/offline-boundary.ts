import { createRequire, syncBuiltinESMExports } from "node:module";
let active = false;
const inheritedKeys = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "COMSPEC", "PATHEXT",
  "HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "SYSTEMDRIVE", "USERDOMAIN", "USERNAME"];
const fixedEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "test", KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
  KERYX_CITATION_POOL_RATIO: "0.5", KERYX_WEB_RESEARCH: "0", KERYX_EXTERNAL_DISCOVERY: "0",
  SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", BASE_URL: "https://study.invalid",
  KERYX_STUDY_WORKER: "1", NO_COLOR: "1",
};
export function assertStudyBoundary(): void {
  if (!active) throw new Error("Use the isolated study launcher with outbound denial");
}

export function studyEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of inheritedKeys)
    if (process.env[key]) env[key] = process.env[key];
  return { ...env, ...fixedEnvironment };
}
/** Installed before importing any application runtime. A caught network error still fails the study. */
export function denyOutbound(): { attempts(): number } {
  const allowedKeys = new Set([...inheritedKeys, ...Object.keys(fixedEnvironment)].map(key => key.toUpperCase()));
  const unexpected = Object.keys(process.env).filter(key => !allowedKeys.has(key.toUpperCase()));
  const mismatched = Object.entries(fixedEnvironment).filter(([key, value]) => process.env[key] !== value).map(([key]) => key);
  if (unexpected.length || mismatched.length)
    throw new Error(`Study requires its isolated fresh-process environment (unexpected keys: ${unexpected.join(", ")}; mismatched keys: ${mismatched.join(", ")})`);
  let attempts = 0;
  const deny = () => { attempts++; throw new Error("Outbound I/O denied by controlled study"); };
  globalThis.fetch = async () => deny();
  globalThis.WebSocket = class { constructor() { deny(); } } as unknown as typeof WebSocket;
  const require = createRequire(import.meta.url);
  for (const [module, methods] of [["node:http", ["request", "get"]], ["node:https", ["request", "get"]],
    ["node:net", ["connect", "createConnection"]], ["node:tls", ["connect"]], ["node:dgram", ["createSocket"]],
    ["node:child_process", ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]]] as const) {
    const api = require(module) as Record<string, unknown>;
    for (const method of methods) api[method] = deny;
  }
  const net = require("node:net") as typeof import("node:net");
  net.Socket.prototype.connect = deny as typeof net.Socket.prototype.connect;
  const dns = require("node:dns") as typeof import("node:dns");
  for (const api of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype])
    for (const method of Object.getOwnPropertyNames(api))
      if ((method.startsWith("resolve") || ["lookup", "lookupService", "reverse"].includes(method)) && typeof Reflect.get(api, method) === "function")
        (api as unknown as Record<string, unknown>)[method] = deny;
  syncBuiltinESMExports();
  active = true;
  return { attempts: () => attempts };
}
