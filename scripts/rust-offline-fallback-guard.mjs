/** Loaded before the TypeScript CLI during synthetic offline rollback drills. */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const denyExternalAction = () => { throw new Error("offline acceptance forbids network or child process access"); };
globalThis.fetch = denyExternalAction;
net.Socket.prototype.connect = denyExternalAction;
net.connect = denyExternalAction;
net.createConnection = denyExternalAction;
http.request = denyExternalAction;
http.get = denyExternalAction;
https.request = denyExternalAction;
https.get = denyExternalAction;
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  childProcess[method] = denyExternalAction;
}
syncBuiltinESMExports();
console.error("keryx offline fallback guard active");
