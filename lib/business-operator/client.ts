import { readBoundedJson } from "../read-bounded-json";
import { operatorBusinessStatusSchema } from "./contracts";
export async function fetchOperatorStatus(origin: string) {
  const base = new URL(origin);
  if (base.username || base.password || base.origin !== origin || base.protocol !== "https:" &&
    !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
    throw new Error("Operator observation origin refused");
  const response = await fetch(`${origin}/api/operator/status`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Operator observation unavailable");
  return operatorBusinessStatusSchema.parse(await readBoundedJson(response));
}
