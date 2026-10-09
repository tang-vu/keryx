import { config } from "../config";
import { createReadonlyApplicationStorage } from "../db/application-storage";
import { readOperatorLedger } from "./read";

/** Sealed selected store only. No ordinary fallback initialization or private inspection role. */
export async function readSelectedOperatorLedger(days = 7) {
  const reader = await createReadonlyApplicationStorage();
  if (!reader) throw new Error("Public ledger storage unavailable");
  try { return await readOperatorLedger(reader, config.networkId, days); }
  finally { const close = Reflect.get(reader, "close"); if (typeof close === "function") close(); }
}
