import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ marketplace: vi.fn(), config: {
  networkId: "eip155:5042002", externalDiscovery: true, externalDiscoveryLimit: 10,
  embeddingApiKey: "synthetic-only", embeddingBaseUrl: "https://embeddings.test/v1", embeddingModel: "fixture",
} }));
vi.mock("../config", () => ({ config: fixture.config }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { exec: Object.assign(vi.fn(), { [promisify.custom]: fixture.marketplace }) };
});
const vectors = { aligned: [3, 4], oblique: [4, 3], orthogonal: [4, -3], opposite: [-3, -4], zero: [0, 0] };
const names = Object.keys(vectors) as Array<keyof typeof vectors>;
beforeEach(() => {
  vi.resetModules();
  fixture.marketplace.mockReset().mockResolvedValue({ stdout: JSON.stringify({ data: { items: names.map(name => ({
    name, resource: `https://synthetic.test/${name}`, description: "Synthetic geometry fixture",
    accepts: [{ network: fixture.config.networkId, amount: "2000", payTo: "synthetic-payee" }],
  })) } }) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([
  { label: "ordinary", queryScale: 1, endpointScale: 1 },
  { label: "overflowing products", queryScale: 1e200, endpointScale: 1e200 },
  { label: "underflowing products", queryScale: 1e-200, endpointScale: 1e-200 },
  { label: "large query and tiny endpoints", queryScale: 1e200, endpointScale: 1e-200 },
  { label: "tiny query and large endpoints", queryScale: 1e-200, endpointScale: 1e200 },
  { label: "very large finite components", queryScale: 1e307, endpointScale: 1e307 },
  { label: "very small normal components", queryScale: 1e-300, endpointScale: 1e-300 },
  { label: "subnormal components", queryScale: Number.MIN_VALUE, endpointScale: Number.MIN_VALUE },
])("keeps cosine ranking invariant for $label without another request or purchase", async ({ queryScale, endpointScale }) => {
  const query = [3 * queryScale, 4 * queryScale];
  const documents = names.map(name => vectors[name].map(value => value * endpointScale));
  expect([...query, ...documents.flat()].every(Number.isFinite)).toBe(true);
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const input = (JSON.parse(String(init.body)) as { input: string[] }).input;
    const rows = input.length === 1 ? [query] : documents;
    expect(input.length).toBe(rows.length);
    // Exercise the already-supported provider index mapping while varying magnitude.
    return { ok: true, json: async () => ({ data: rows.map((embedding, index) => ({ embedding, index })).reverse() }) };
  });
  vi.stubGlobal("fetch", fetch);
  const { discoverExternalCandidates } = await import("./external-discovery");
  const candidates = await discoverExternalCandidates("quartzquestion", []);
  expect(candidates.map(candidate => candidate.name)).toEqual(["aligned", "oblique"]);
  expect(candidates[0].description).toContain("semantic match 100%");
  expect(candidates[1].description).toContain("semantic match 96%");
  for (const candidate of candidates) {
    expect(candidate.description).toContain("Discovery-only: evaluated but never purchased");
    expect(candidate.description).not.toMatch(/NaN|Infinity/);
    expect(candidate.external?.onArc).toBe(true);
    expect(candidate.fetchPrice).toBe(0.002);
  }
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fixture.marketplace).toHaveBeenCalledOnce();
  const limited = await discoverExternalCandidates("quartzquestion", [], 1);
  expect(limited.map(candidate => candidate.name)).toEqual(["aligned"]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fixture.marketplace).toHaveBeenCalledOnce();
});
