const ENDPOINT = "https://keryx.cc/api/internal/source-upkeep";

export async function triggerSourceUpkeep(
  env: { SOURCE_UPKEEP_TOKEN: string }, fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(env.SOURCE_UPKEEP_TOKEN ?? "")) {
    throw new Error("Source upkeep credential unavailable");
  }
  // One fixed request, no retries, response body, URLs from callers or public manual trigger.
  const response = await fetcher(ENDPOINT, {
    method: "POST", redirect: "error",
    headers: { Authorization: `Bearer ${env.SOURCE_UPKEEP_TOKEN}` },
    signal: AbortSignal.timeout(55_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Source upkeep HTTP ${response.status}`);
}

const worker = {
  async scheduled(_event: unknown, env: { SOURCE_UPKEEP_TOKEN: string }): Promise<void> {
    await triggerSourceUpkeep(env);
  },
  async fetch(): Promise<Response> { return new Response("Not found", { status: 404 }); },
};

export default worker;
