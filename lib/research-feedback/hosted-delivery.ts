import { config } from "../config";
import { getDb } from "../db";
import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";
import { privateRequesterObservations } from "./service";
import { configuredRequesterOpinionStore } from "./metadata-store";

/** Trusted completion adapters only, after persistence; no caller-controlled opt-in. */
export async function hostedRequesterObservations(run: QueryRun, publicOriginal: boolean, db?: KeryxDB) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const binding = { network: config.networkId, origin: config.baseUrl };
    const pending = (async () => privateRequesterObservations({ run, db: db ?? await getDb(), publicOriginal,
      store: () => configuredRequesterOpinionStore(binding), binding, secret: config.jwtSecret, signal: abort.signal }))();
    return await Promise.race([pending, new Promise<null>(resolve => {
      timer = setTimeout(() => { abort.abort(); resolve(null); }, 2000);
    })]);
  } catch { return null; } finally { clearTimeout(timer); }
}
