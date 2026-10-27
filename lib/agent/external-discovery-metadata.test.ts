import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ marketplace: vi.fn(), config: {
  networkId: "eip155:5042", externalDiscovery: true, externalDiscoveryLimit: 10, embeddingApiKey: "",
  embeddingBaseUrl: "https://embeddings.test/v1", embeddingModel: "fixture",
} }));
vi.mock("../config", () => ({ config: fixture.config }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { exec: Object.assign(vi.fn(), { [promisify.custom]: fixture.marketplace }) };
});
const offer = { network: "eip155:5042", amount: "2000", payTo: "synthetic-payee" };
const item = (name: string) => ({ name: `Weather ${name}`, resource: `https://synthetic.test/weather/${name}`,
  description: "Weather observations", category: "weather", accepts: [offer] });
const first = item("first"), last = item("last"), suspect = item("suspect");
beforeEach(() => {
  vi.resetModules(); fixture.marketplace.mockReset(); fixture.config.embeddingApiKey = "";
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected outbound request"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function discover(items: unknown, limit?: number) {
  fixture.marketplace.mockResolvedValue({ stdout: JSON.stringify({ data: { items } }) });
  const { discoverExternalCandidates } = await import("./external-discovery");
  return discoverExternalCandidates("weather", [], limit);
}

it.each([
  null, false, 7, "weather", [], {}, { ...suspect, resource: 17 }, { ...suspect, resource: "" },
  { ...suspect, resource: "javascript:alert('weather')" }, { ...suspect, resource: "ftp://synthetic.test/weather" },
  { ...suspect, resource: "https://user:PRIVATE_SECRET@synthetic.test/weather" },
  { ...suspect, resource: " https://synthetic.test/weather" }, { ...suspect, resource: "https://synthetic.test/\nweather" },
  { ...suspect, name: { text: "Weather object" } }, { ...suspect, provider: ["provider"] },
  { ...suspect, description: { weather: true } }, { ...suspect, category: { weather: true } },
  { ...suspect, accepts: null }, { ...suspect, accepts: {} }, { ...suspect, accepts: [null] },
  { ...suspect, accepts: ["weather"] }, { ...suspect, accepts: [] },
  { ...suspect, name: "weather".repeat(43) }, { ...suspect, provider: "p".repeat(257) },
  { ...suspect, description: "d".repeat(8193) }, { ...suspect, category: "c".repeat(129) },
  { ...suspect, resource: "https://synthetic.test/weather/" + "r".repeat(4096) },
  { ...suspect, accepts: Array.from({ length: 65 }, () => offer) },
  { ...suspect, name: "Weather\u0000name" }, { ...suspect, description: "Weather\u0000description" },
  { ...suspect, category: "weather\u001b[2J" }, { ...suspect, resource: "https://synthetic.test\\weather" },
].map((bad, caseNumber) => ({ bad, caseNumber })))("contains malformed listing $caseNumber without losing valid neighbours", async ({ bad }) => {
  const candidates = await discover([first, bad, last]);
  expect(candidates.map(c => c.name)).toEqual([first.name, last.name]);
  expect(candidates.every(c => c.description.includes("Discovery-only: evaluated but never purchased"))).toBe(true);
  expect(JSON.stringify(candidates)).not.toContain("PRIVATE_SECRET");
  expect(fixture.marketplace).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
});

it.each([undefined, null, false, true, "", " ", "0x1000", "1e3", "1.5", "-1", "NaN", "Infinity", {}, [],
  1.5, -1, Number.MAX_SAFE_INTEGER + 1, "9007199254740993", Number.MAX_SAFE_INTEGER,
  9000000000007812, "9000000000007812"].map((amount, caseNumber) => ({ amount, caseNumber })))(
  "never replaces absent or inexact base-unit quote $caseNumber with a zero price", async ({ amount }) => {
    const candidates = await discover([first, { ...suspect, accepts: [{ ...offer, amount }] }, last]);
    expect(candidates.map(c => c.name)).toEqual([first.name, last.name]);
    expect(candidates.every(c => c.fetchPrice === 0.002)).toBe(true);
  });

it.each([["0", 0], [0, 0], ["2000", 0.002], [2000, 0.002], ["0002000", 0.002], ["1000000000000", 1_000_000],
  ["9000000000000000", 9_000_000_000]])(
  "retains an explicit exact quote %j without changing resource identity", async (amount, expected) => {
    const [candidate] = await discover([{ ...first, accepts: [{ ...offer, amount }] }]);
    expect(candidate.fetchPrice).toBe(expected); expect(candidate.external?.resource).toBe(first.resource);
    expect(candidate.id).toBe(`ext:${first.resource}`); expect(candidate.external?.onArc).toBe(true);
  });

it("keeps valid offers without borrowing network or payee from a malformed offer", async () => {
  const [candidate] = await discover([{ ...first, accepts: [null, { ...offer, amount: null },
    { ...offer, network: 42 }, { ...offer, payTo: { private: true } },
    { ...offer, network: "n".repeat(129) }, { ...offer, payTo: "p".repeat(257) },
    { ...offer, network: "eip155:5042\n" }, { ...offer, payTo: "synthetic\u0000payee" },
    { network: "eip155:8453", amount: "3000", payTo: "synthetic-base" },
    { network: "eip155:9999", amount: "1000", payTo: "synthetic-other" }] }]);
  expect(candidate.fetchPrice).toBe(0.001);
  expect(candidate.external).toMatchObject({ chains: ["Base", "eip155:9999"], onArc: false, payTo: "synthetic-base" });
  expect(candidate.description).toContain("does not include Keryx's selected network");
});

it("keeps nullable optional text and a nameless HTTP resource as plain metadata", async () => {
  const resource = "http://fallback.test/weather?value=$example&n=1";
  const [candidate] = await discover([{ resource, name: null, provider: null, description: "Weather\nobservations\tand notes", category: null,
    accepts: [{ amount: "2000", network: null, payTo: null }] }]);
  expect(candidate.name).toBe("fallback.test · weather");
  expect(candidate.external).toEqual({ resource, chains: [], onArc: false, payTo: "" });
  expect(candidate.fetchPrice).toBe(0.002); expect(fixture.marketplace.mock.calls[0][0]).toBe("circle services search --output json --limit 200");
  expect(candidate.description).toContain("Weather\nobservations\tand notes");
});

it("retains complete text and resource identity at the admission bounds", async () => {
  const resource = first.resource + "r".repeat(4096 - first.resource.length);
  const name = "Weather" + "n".repeat(249), description = "d".repeat(8192), category = "c".repeat(128);
  const [candidate] = await discover([{ resource, name, description, category, provider: "p".repeat(256),
    accepts: [{ ...offer, payTo: "p".repeat(256) }] }]);
  expect(candidate.id).toBe(`ext:${resource}`); expect(candidate.name).toBe(name);
  expect(candidate.description).toContain(description); expect(candidate.tags).toContain(category);
  expect(candidate.external?.payTo).toBe("p".repeat(256)); expect(candidate.fetchPrice).toBe(0.002);
});

it("keeps unknown advertised network strings separate from inherited object properties", async () => {
  const [candidate] = await discover([{ ...first, accepts: ["toString", "__proto__", "eip155:9999"].map(network => ({ ...offer, network })) }]);
  expect(candidate.external?.chains).toEqual(["toString", "__proto__", "eip155:9999"]);
  expect(candidate.external?.onArc).toBe(false);
});

it("displays a nonzero micro-USDC quote without rounding it to a zero advertisement", async () => {
  const [candidate] = await discover([{ ...first, accepts: [{ ...offer, amount: "1" }] }]);
  expect(candidate.fetchPrice).toBe(0.000001); expect(candidate.description).toContain("~$0.000001/call");
});

it("bounds the CLI sample to its requested 200 rows and retains its successful cache", async () => {
  const rows = Array.from({ length: 201 }, (_, i) => item(String(i)));
  const candidates = await discover(rows, 500);
  expect(candidates).toHaveLength(200); expect(candidates.at(-1)?.external?.resource).toBe(rows[199].resource);
  const { discoverExternalCandidates } = await import("./external-discovery");
  expect(await discoverExternalCandidates("weather", [], 500)).toEqual(candidates);
  expect(fixture.marketplace).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
});

it.each([null, {}, "weather", 1, { resource: first.resource }])("withholds a malformed item envelope: %j", async body => {
  expect(await discover(body)).toEqual([]); expect(fetch).not.toHaveBeenCalled();
});

it("embeds only admitted metadata and shares the same two successful requests on reuse", async () => {
  fixture.config.embeddingApiKey = "synthetic-only";
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const { input } = JSON.parse(String(init.body)) as { input: string[] };
    expect(input.join(" ")).not.toMatch(/PRIVATE_SECRET|Weather suspect/);
    return { ok: true, json: async () => ({ data: input.map((_, index) => ({ index, embedding: [1, 0] })) }) };
  });
  vi.stubGlobal("fetch", fetch);
  const candidates = await discover([first, null, { ...suspect, name: {} }, last]);
  expect(candidates.map(c => c.name)).toEqual([first.name, last.name]);
  const { discoverExternalCandidates } = await import("./external-discovery");
  expect(await discoverExternalCandidates("weather", [])).toEqual(candidates);
  expect(fetch).toHaveBeenCalledTimes(2); expect(fixture.marketplace).toHaveBeenCalledOnce();
  expect(fetch.mock.calls.every(([url]) => url === "https://embeddings.test/v1/embeddings")).toBe(true);
});
