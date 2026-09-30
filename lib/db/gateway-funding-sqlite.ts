import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { fundingDigest, fundingRecord, fundingRefused, validateFundingOwnerInstallation } from "./gateway-funding-ledger-validation";
import { validateGatewayFundingOperation } from "../payments/gateway-funding-policy";
export { openGatewayFundingSqliteLedger, openGatewayFundingSqliteTerminalObserver } from "./gateway-funding-sqlite-native";

/** Dedicated owner-only surface; never wired into an app route. Unknown
 * acknowledgement may follow COMMIT: inspect original identity, never reset or
 * automatically issue a replacement installation/authorization. */
async function owner(mode: "inspect" | "policy" | "authorization", file: string, expected: StorageIdentity, input: unknown = null) {
  try {
    const identity = validateStorageIdentity(expected);
    const checked = mode === "policy" ? validateFundingOwnerInstallation(input) : mode === "authorization" ? validateGatewayFundingOperation(input) : null;
    const request = JSON.stringify({ mode, file, identity, input: checked });
    if (Buffer.byteLength(request) > 65536) fundingRefused();
    const require = createRequire(import.meta.url);
    const child = spawn(process.execPath, ["--max-old-space-size=128", "--import", pathToFileURL(require.resolve("tsx")).href,
      fileURLToPath(new URL("./gateway-funding-sqlite-owner-child.ts", import.meta.url))], { windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"], env: process.platform === "win32" ? { NODE_ENV: "production", SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : { NODE_ENV: "production" } });
    return await new Promise<unknown>((resolve, reject) => {
      let output = "", failed = false;
      const stop = () => { failed = true; child.kill("SIGKILL"); };
      const deadline = setTimeout(stop, 15000);
      child.stdout.on("data", (bytes: Buffer) => { if (Buffer.byteLength(output) + bytes.length > 4096) stop(); else output += bytes.toString("utf8"); });
      child.once("error", () => { failed = true; });
      child.stdin.once("error", () => { failed = true; });
      child.once("close", code => {
        clearTimeout(deadline);
        if (failed || code !== 0) { reject(new Error("Gateway funding owner acknowledgement unknown; inspect original installation")); return; }
        try { const result = JSON.parse(output); if (result.refused) throw new Error(); resolve(result); }
        catch { reject(new Error("Gateway funding owner acknowledgement unknown; inspect original installation")); }
      });
      child.stdin.end(request);
    });
  } catch (error) {
    if (error instanceof Error && /^Gateway funding owner (acknowledgement unknown|operation refused)/.test(error.message)) throw error;
    return fundingRefused();
  }
}
export async function inspectGatewayFundingSqliteOwnerTarget(file: string, identity: StorageIdentity) {
  const r = fundingRecord(await owner("inspect", file, identity), ["reviewedTargetDigest", "reviewedSnapshotDigest"]);
  return Object.freeze({ reviewedTargetDigest: fundingDigest(r.reviewedTargetDigest), reviewedSnapshotDigest: fundingDigest(r.reviewedSnapshotDigest) });
}
async function installed(mode: "policy" | "authorization", file: string, identity: StorageIdentity, input: unknown) {
  const r = fundingRecord(await owner(mode, file, identity, input), ["installed"]);
  if (typeof r.installed !== "boolean") fundingRefused(); return Object.freeze({ installed: r.installed });
}
export async function installGatewayFundingSqliteOwnerPolicy(file: string, identity: StorageIdentity, input: unknown) { return await installed("policy", file, identity, input); }
export async function installGatewayFundingSqliteOwnerAuthorization(file: string, identity: StorageIdentity, input: unknown) { return await installed("authorization", file, identity, input); }
