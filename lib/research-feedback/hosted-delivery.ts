import { config } from "../config";
import { getDb } from "../db";
import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";
import { privateRequesterObservations } from "./service";
import { configuredRequesterOpinionStore } from "./metadata-store";

/** Trusted completion adapters only, after persistence; no caller-controlled opt-in. */
export async function hostedRequesterObservations(run: QueryRun, publicOriginal: boolean, db?: KeryxDB) {
  try {
    const binding = { network: config.networkId, origin: config.baseUrl };
    return await privateRequesterObservations({ run, db: db ?? await getDb(), publicOriginal,
      store: () => configuredRequesterOpinionStore(binding), binding, secret: config.jwtSecret });
  } catch { return null; }
}
