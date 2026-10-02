/** Compile normal production worker with synthetic public pins, then exercise actual emitted
 * Turbopack bootstrap/chunks and Next CSP. No deployment, wallet or production activation flag. */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd(), tsconfig = resolve(root, "tsconfig.json"), original = readFileSync(tsconfig);
const dist = `.artifacts/next-mainnet-normal-${process.pid}`;
const environment: NodeJS.ProcessEnv = { ...process.env, KERYX_NETWORK: "arc", NEXT_PUBLIC_KERYX_NETWORK: "arc", KERYX_FORCE_OFFLINE: "0",
  KERYX_REGISTRY_ADDRESS: "0x3333333333333333333333333333333333333333",
  NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: "0x3333333333333333333333333333333333333333", NEXT_DIST_DIR: dist };
delete environment.KERYX_REGISTRY_READ_ADDRESS; delete environment.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS;
async function run(command: string, args: string[]) {
  await new Promise<void>((done, fail) => {
    const child = spawn(command, args, { cwd: root, env: environment, stdio: "inherit", windowsHide: true });
    child.once("error", fail); child.once("exit", code => code === 0 ? done() : fail(new Error("Synthetic mainnet browser packaging check failed")));
  });
}
try {
  if (process.platform === "win32") await run("cmd.exe", ["/d", "/s", "/c", "npm run build"]);
  else await run("npm", ["run", "build"]);
  await run(process.execPath, ["--import", "tsx", "scripts/test-browser-mainnet-normal.mts", "--next-dist", dist]);
} finally {
  // Next automatically adds the isolated dist's generated type path; preserve source config.
  writeFileSync(tsconfig, original);
}
