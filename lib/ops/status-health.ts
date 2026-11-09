import { readBoundedJson } from "../read-bounded-json";

/** Readiness and the scalar fields displayed by /status, not payment authority. */
export interface StatusHealth {
  name: "keryx";
  ok: true;
  db: "ok";
  status: "operational" | "degraded";
  commit: string | null;
  uptimeSeconds: number;
  reasoning: string;
  settles: string;
  network: string;
  rpcProvider: string;
  time: string;
}

function currentHealth(value: unknown, now: number): value is StatusHealth {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isFinite(now)) return false;
  const v = value as Record<string, unknown>;
  const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;
  if (v.name !== "keryx" || v.ok !== true || v.db !== "ok"
    || (v.status !== "operational" && v.status !== "degraded")
    || typeof v.time !== "string" || v.time.length > 64
    || !Number.isSafeInteger(v.uptimeSeconds) || (v.uptimeSeconds as number) < 0
    || !(v.commit === null || text(v.commit))
    || ![v.reasoning, v.settles, v.network, v.rpcProvider].every(text)) return false;
  const timestamp = Date.parse(v.time);
  return Number.isFinite(timestamp) && timestamp >= now - 120_000 && timestamp <= now + 60_000;
}

/** Keep optional API sections intact; validate readiness before allowing their display. */
export async function readStatusHealth(response: Response, now: () => number = Date.now): Promise<StatusHealth | null> {
  if (response.status !== 200 || response.redirected) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    const value = await readBoundedJson(response, 32_768);
    // Body transfer consumes freshness too. Check the clock after the bounded read.
    return currentHealth(value, now()) ? value : null;
  } catch { return null; }
}
