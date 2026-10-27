import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";

const state = vi.hoisted(() => ({ marketplace: vi.fn(), config: {
  networkId: "eip155:5042", externalDiscovery: true, externalDiscoveryLimit: 10, embeddingApiKey: "",
  embeddingBaseUrl: "https://embeddings.example/v1", embeddingModel: "test-embedding",
} }));
vi.mock("../config", () => ({ config: state.config }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { exec: Object.assign(vi.fn(), { [promisify.custom]: state.marketplace }) };
});

function marketplaceItems() {
  return [ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE].map(profile => ({
    name: `${profile.name} weather`, resource: `https://${profile.name}.example/weather`,
    description: "Weather data", accepts: [{ network: profile.networkId, amount: "2000", payTo: `${profile.name}-payee` }],
  }));
}

beforeEach(() => {
  vi.resetModules();
  state.marketplace.mockReset().mockResolvedValue({ stdout: JSON.stringify({ data: { items: marketplaceItems() } }) });
  state.config.externalDiscovery = true;
  state.config.embeddingApiKey = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("external marketplace selected-network metadata", () => {
  it.each([ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE])("matches $name without accepting the other network as compatible", async (profile) => {
    state.config.networkId = profile.networkId;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { discoverExternalCandidates } = await import("./external-discovery");
    const candidates = await discoverExternalCandidates("weather", []);
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      const matches = candidate.name.startsWith(profile.name + " ");
      expect(candidate.external?.onArc).toBe(matches);
      expect(candidate.id).toBe(`ext:${candidate.external?.resource}`);
      expect(candidate.fetchPrice).toBe(0.002);
      expect(candidate.description).toContain(matches ? "— includes Keryx's selected network" : "— does not include Keryx's selected network");
      expect(candidate.description).toContain("Discovery-only: evaluated but never purchased by Keryx");
      expect(candidate.external?.payTo).toBe(`${candidate.name.split(" ")[0]}-payee`);
    }
    expect(candidates[0].external?.chains).toEqual(["Arc mainnet"]);
    expect(candidates[1].external?.chains).toEqual(["Arc testnet"]);
    expect(state.marketplace).toHaveBeenCalledExactlyOnceWith("circle services search --output json --limit 200",
      expect.objectContaining({ timeout: 15000, windowsHide: true }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps an unknown advertised network distinct and discovery-only", async () => {
    state.config.networkId = ARC_MAINNET_PROFILE.networkId;
    state.marketplace.mockResolvedValue({ stdout: JSON.stringify({ data: { items: [{ name: "Weather service",
      resource: "https://other.example/weather", accepts: [{ network: "eip155:9999", amount: "2000" }] }] } }) });
    const { discoverExternalCandidates } = await import("./external-discovery");
    const [candidate] = await discoverExternalCandidates("weather", []);
    expect(candidate.external).toMatchObject({ onArc: false, chains: ["eip155:9999"] });
    expect(candidate.description).toContain("Advertises payment acceptance on eip155:9999");
  });

  it("degrades to no candidates on unavailable marketplace and caches the failure", async () => {
    state.marketplace.mockRejectedValue(new Error("Circle CLI unavailable"));
    const { discoverExternalCandidates } = await import("./external-discovery");
    expect(await discoverExternalCandidates("weather", [])).toEqual([]);
    expect(await discoverExternalCandidates("weather", [])).toEqual([]);
    expect(state.marketplace).toHaveBeenCalledOnce();
  });

  it("does not probe when external discovery is disabled", async () => {
    state.config.externalDiscovery = false;
    const { discoverExternalCandidates } = await import("./external-discovery");
    expect(await discoverExternalCandidates("weather", [])).toEqual([]);
    expect(state.marketplace).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function embeddingFetch() {
  state.config.embeddingApiKey = "synthetic-test-key";
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const { input } = JSON.parse(init.body as string) as { input: string[] };
    return { ok: true, json: async () => ({ data: input.map(() => ({ embedding: [1, 0] })) }) };
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("bounded marketplace discovery work", () => {
  it("shares an in-flight marketplace load across concurrent questions", async () => {
    const response = deferred<{ stdout: string }>();
    state.marketplace.mockReturnValue(response.promise);
    const { discoverExternalCandidates } = await import("./external-discovery");
    const first = discoverExternalCandidates("weather", []);
    const second = discoverExternalCandidates("weather forecast", []);
    expect(state.marketplace).toHaveBeenCalledOnce();
    response.resolve({ stdout: JSON.stringify({ data: { items: marketplaceItems() } }) });
    expect((await Promise.all([first, second])).every(items => items.length === 2)).toBe(true);
  });

  it("starts the successful snapshot TTL at completion and refreshes after expiry", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const response = deferred<{ stdout: string }>();
    state.marketplace.mockReturnValueOnce(response.promise);
    const { discoverExternalCandidates } = await import("./external-discovery");
    const first = discoverExternalCandidates("weather", []);
    clock.mockReturnValue(14_000);
    response.resolve({ stdout: JSON.stringify({ data: { items: marketplaceItems() } }) });
    await first;
    clock.mockReturnValue(30 * 60_000);
    await discoverExternalCandidates("weather", []);
    expect(state.marketplace).toHaveBeenCalledOnce();
    clock.mockReturnValue(30 * 60_000 + 14_000);
    await discoverExternalCandidates("weather", []);
    expect(state.marketplace).toHaveBeenCalledTimes(2);
  });

  it("retries an expired negative snapshot without retaining a failed in-flight load", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    state.marketplace.mockRejectedValueOnce(new Error("CLI unavailable"));
    const { discoverExternalCandidates } = await import("./external-discovery");
    expect(await discoverExternalCandidates("weather", [])).toEqual([]);
    clock.mockReturnValue(2 * 60_000 - 1);
    expect(await discoverExternalCandidates("weather", [])).toEqual([]);
    expect(state.marketplace).toHaveBeenCalledOnce();
    clock.mockReturnValue(2 * 60_000);
    expect(await discoverExternalCandidates("weather", [])).toHaveLength(2);
    expect(state.marketplace).toHaveBeenCalledTimes(2);
  });

  it("embeds a snapshot only once while embedding each distinct question", async () => {
    const fetch = embeddingFetch();
    const { discoverExternalCandidates } = await import("./external-discovery");
    const first = await discoverExternalCandidates("weather", []);
    const second = await discoverExternalCandidates("forecast", []);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(first.every(c => c.description.includes("semantic match 100%"))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    await discoverExternalCandidates("weather", []);
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [url] of fetch.mock.calls) expect(url).toBe("https://embeddings.example/v1/embeddings");
    expect(second.every(c => c.description.includes("Discovery-only: evaluated but never purchased"))).toBe(true);
  });

  it("shares pending question and snapshot embeddings across concurrent identical questions", async () => {
    const fetch = embeddingFetch();
    const response = deferred<Awaited<ReturnType<typeof fetch>>>();
    fetch.mockReturnValueOnce(response.promise);
    const { discoverExternalCandidates } = await import("./external-discovery");
    const first = discoverExternalCandidates("weather", []);
    const second = discoverExternalCandidates("weather", []);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    response.resolve({ ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a different question with the old 32-bit hash collision", async () => {
    const fetch = embeddingFetch();
    const { discoverExternalCandidates } = await import("./external-discovery");
    await discoverExternalCandidates("Aa", []);
    await discoverExternalCandidates("B@", []);
    const inputs = fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).input);
    expect(inputs).toContainEqual(["Aa "]);
    expect(inputs).toContainEqual(["B@ "]);
  });

  it("shares a pending snapshot embedding across distinct concurrent questions", async () => {
    const fetch = embeddingFetch();
    const response = deferred<Awaited<ReturnType<typeof fetch>>>();
    fetch.mockImplementation(async (_url, init) => {
      const { input } = JSON.parse(init.body as string) as { input: string[] };
      return input.length === 2 ? response.promise :
        { ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) };
    });
    const { discoverExternalCandidates } = await import("./external-discovery");
    const first = discoverExternalCandidates("weather", []);
    const second = discoverExternalCandidates("forecast", []);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    response.resolve({ ok: true, json: async () => ({ data: [{ embedding: [1, 0] }, { embedding: [1, 0] }] }) });
    const results = await Promise.all([first, second]);
    expect(results.map(items => items.length)).toEqual([2, 2]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("evicts the least recently used question when its bounded cache fills", async () => {
    const fetch = embeddingFetch();
    const { discoverExternalCandidates } = await import("./external-discovery");
    for (let i = 0; i < 128; i++) await discoverExternalCandidates(`question ${i}`, []);
    await discoverExternalCandidates("question 0", []);
    await discoverExternalCandidates("question 128", []);
    await discoverExternalCandidates("question 0", []);
    await discoverExternalCandidates("question 1", []);
    const inputs = fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).input);
    expect(inputs.filter(input => input.length === 2)).toHaveLength(1);
    expect(inputs.filter(input => input[0] === "question 0 ")).toHaveLength(1);
    expect(inputs.filter(input => input[0] === "question 1 ")).toHaveLength(2);
  });

  it("re-embeds refreshed marketplace metadata instead of reusing stale vectors", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const fetch = embeddingFetch();
    const { discoverExternalCandidates } = await import("./external-discovery");
    await discoverExternalCandidates("weather", []);
    state.marketplace.mockResolvedValue({ stdout: JSON.stringify({ data: { items: marketplaceItems().slice(0, 1) } }) });
    clock.mockReturnValue(30 * 60_000);
    expect(await discoverExternalCandidates("weather", [])).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(state.marketplace).toHaveBeenCalledTimes(2);
  });

  it("falls back on a failed embedding request and retries the next question", async () => {
    const fetch = embeddingFetch();
    fetch.mockRejectedValueOnce(new Error("provider unavailable"));
    const { discoverExternalCandidates } = await import("./external-discovery");
    const first = await discoverExternalCandidates("weather", []);
    expect(first.every(c => c.description.includes("keyword match"))).toBe(true);
    const second = await discoverExternalCandidates("weather", []);
    expect(second.every(c => c.description.includes("semantic match"))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries failed snapshot embeddings without repeating a successful question embedding", async () => {
    const fetch = embeddingFetch();
    fetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ data: [{ embedding: [1, 0] }] }) }));
    fetch.mockRejectedValueOnce(new Error("snapshot embedding unavailable"));
    const { discoverExternalCandidates } = await import("./external-discovery");
    expect((await discoverExternalCandidates("weather", [])).every(c => c.description.includes("keyword match"))).toBe(true);
    expect((await discoverExternalCandidates("weather", [])).every(c => c.description.includes("semantic match"))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([null, { data: [{ embedding: null }] }, { data: [{ embedding: ["1", 0] }] },
    { data: [{ embedding: [] }] }, { data: [{ embedding: [NaN, 0] }] }, { data: [] }])(
    "uses keyword fallback for a malformed query embedding (%j)", async body => {
      const fetch = embeddingFetch();
      fetch.mockResolvedValueOnce({ ok: true, json: async () => body } as Awaited<ReturnType<typeof fetch>>);
      const { discoverExternalCandidates } = await import("./external-discovery");
      const result = await discoverExternalCandidates("weather", []);
      expect(result).toHaveLength(2);
      expect(result.every(c => c.description.includes("keyword match"))).toBe(true);
    },
  );

  it("uses keyword fallback when snapshot dimensions differ from the question", async () => {
    const fetch = embeddingFetch();
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: [1, 0, 0] }] }) });
    const { discoverExternalCandidates } = await import("./external-discovery");
    const result = await discoverExternalCandidates("weather", []);
    expect(result).toHaveLength(2);
    expect(result.every(c => c.description.includes("keyword match"))).toBe(true);
  });
});

function indexedResponse(data: unknown) {
  return { ok: true, json: async (): Promise<unknown> => ({ data }) };
}

function indexedEmbeddingFetch() {
  state.config.embeddingApiKey = "synthetic-test-key";
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const { input } = JSON.parse(init.body as string) as { input: string[] };
    return indexedResponse(input.map((_, index) => ({ index, embedding: index === 0 ? [1, 0] : [0, 1] })));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("embedding response identity", () => {
  it("binds declared indices to the correct endpoint before caching a reordered response", async () => {
    const fetch = indexedEmbeddingFetch();
    fetch.mockResolvedValueOnce(indexedResponse([{ index: 0, embedding: [1, 0] }]));
    fetch.mockResolvedValueOnce(indexedResponse([
      { index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] },
    ]));
    const { discoverExternalCandidates } = await import("./external-discovery");
    const first = await discoverExternalCandidates("weather", []);
    expect(first.map(candidate => candidate.external?.resource)).toEqual([marketplaceItems()[0].resource]);
    expect(first[0].description).toContain("semantic match 100%");
    expect(await discoverExternalCandidates("weather", [])).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("accepts complete ordered indices without changing source metadata or discovery-only authority", async () => {
    indexedEmbeddingFetch();
    const { discoverExternalCandidates } = await import("./external-discovery");
    const result = await discoverExternalCandidates("weather", []);
    expect(result).toHaveLength(1);
    expect(result[0].external?.resource).toBe(marketplaceItems()[0].resource);
    expect(result[0].external?.payTo).toBe(marketplaceItems()[0].accepts[0].payTo);
    expect(result[0].description).toContain("Discovery-only: evaluated but never purchased by Keryx");
  });

  it.each([
    ["duplicate", [0, 0]], ["negative", [-1, 1]], ["out of range", [0, 2]],
    ["fractional", [0, 0.5]], ["string", ["0", 1]], ["null", [0, null]],
    ["partly absent", [0, undefined]],
  ])("rejects %s endpoint indices and retries the snapshot without poisoning its cache", async (_name, indices) => {
    const fetch = indexedEmbeddingFetch();
    fetch.mockResolvedValueOnce(indexedResponse([{ index: 0, embedding: [1, 0] }]));
    fetch.mockResolvedValueOnce(indexedResponse((indices as unknown[]).map(index => ({
      ...(index === undefined ? {} : { index }), embedding: [1, 0],
    }))));
    const { discoverExternalCandidates } = await import("./external-discovery");
    const first = await discoverExternalCandidates("weather", []);
    expect(first).toHaveLength(2);
    expect(first.every(candidate => candidate.description.includes("keyword match"))).toBe(true);
    const retried = await discoverExternalCandidates("weather", []);
    expect(retried.map(candidate => candidate.external?.resource)).toEqual([marketplaceItems()[0].resource]);
    expect(retried[0].description).toContain("semantic match 100%");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid single-question index and permits a fresh successful retry", async () => {
    const fetch = indexedEmbeddingFetch();
    fetch.mockResolvedValueOnce(indexedResponse([{ index: 1, embedding: [1, 0] }]));
    const { discoverExternalCandidates } = await import("./external-discovery");
    const first = await discoverExternalCandidates("weather", []);
    expect(first).toHaveLength(2);
    expect(first.every(candidate => candidate.description.includes("keyword match"))).toBe(true);
    expect((await discoverExternalCandidates("weather", []))[0].description).toContain("semantic match 100%");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retains ordered index-free compatibility when the whole endpoint batch omits indices", async () => {
    const fetch = indexedEmbeddingFetch();
    fetch.mockResolvedValueOnce(indexedResponse([{ index: 0, embedding: [1, 0] }]));
    fetch.mockResolvedValueOnce(indexedResponse([{ embedding: [1, 0] }, { embedding: [0, 1] }]));
    const { discoverExternalCandidates } = await import("./external-discovery");
    const result = await discoverExternalCandidates("weather", []);
    expect(result.map(candidate => candidate.external?.resource)).toEqual([marketplaceItems()[0].resource]);
    expect(result[0].description).toContain("semantic match 100%");
  });
});
