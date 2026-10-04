export async function claimRequest(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The source check could not finish. Reload its current status before retrying.");
  return data;
}
