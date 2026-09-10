import { isAbsolute } from "node:path";
import { createPrivateResultSpool } from "./private-result-spool";

/** Explicit operator environment only. Never generate or reuse a signing key. */
export async function privateResultSpoolFromEnv(env: Record<string, string | undefined> = process.env) {
  const directory = env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY;
  const key = env.KERYX_PRIVATE_RESULT_SPOOL_KEY;
  if (!directory || !isAbsolute(directory) || !key || !/^[a-fA-F0-9]{64}$/.test(key))
    throw new Error("Private result backup configuration unavailable");
  return createPrivateResultSpool(directory, key);
}
