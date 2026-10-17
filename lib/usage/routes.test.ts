import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";
import { newRunUsage, createTrustedUsageContext } from "../research/usage-provenance";
import { config } from "../config";
import { GET as figures } from "../../app/api/usage/route";
import { GET as history } from "../../app/api/runs/route";
const { getDb, getArchive } = vi.hoisted(() => ({ getDb: vi.fn(), getArchive: vi.fn().mockResolvedValue(null) }));
vi.mock("../db", () => ({ getDb }));
vi.mock("../history/testnet-archive", () => ({ getTestnetArchive: getArchive }));
afterEach(() => { vi.resetAllMocks(); getArchive.mockResolvedValue(null); });
const run = (id: string, scripted = false) => ({ id, question: "Synthetic", createdAt: "2026-10-10T00:00:00.000Z", answer: "Fixture",
  usage: newRunUsage({ usageContext: createTrustedUsageContext(config.profile.networkId, { actor: "unknown", funding: "unknown", scripted }) }, config.profile.networkId, []) } as QueryRun);
describe("public classified usage/history routes", () => {
  it("unavailable profiles expose no fake figures or outside-only empty page", async () => {
    const listRecentQueries = vi.fn().mockResolvedValue([run("scripted", true), run("unknown")]);
    getDb.mockResolvedValue({ listRecentQueries } as unknown as KeryxDB);
    const unavailable = await figures(new Request("https://keryx.invalid/api/usage")); expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ complete: false, figures: null });
    const outside = await history(new Request("https://keryx.invalid/api/runs?cohort=outside")); expect(outside.status).toBe(503);
    expect(listRecentQueries).not.toHaveBeenCalled();
    const sample = await history(new Request("https://keryx.invalid/api/runs")); expect(sample.headers.get("X-Keryx-History-Coverage")).toContain("incomplete");
    expect((await sample.json()).map((row: { id: string }) => row.id)).toEqual(["unknown"]);
  });
  it("validated filters go to the storage page selector; invalid filters never reach storage", async () => {
    const reader = vi.fn().mockResolvedValue([run("selected")]); getDb.mockResolvedValue({ publicUsage: { history: reader } } as unknown as KeryxDB);
    expect((await history(new Request("https://keryx.invalid/api/runs?network=other"))).status).toBe(400); expect(reader).not.toHaveBeenCalled();
    const response = await history(new Request("https://keryx.invalid/api/runs?network=eip155:5042&period=7d&cohort=outside"));
    expect(response.status).toBe(200); expect(reader).toHaveBeenCalledWith(expect.objectContaining({ network: "eip155:5042", period: "7d" }), "outside", 50);
    expect(response.headers.get("X-Keryx-History-Coverage")).toContain("filtered-before-page");
  });
  it("bounds an explicit recent-page limit before any store or archive read", async () => {
    const reader = vi.fn().mockResolvedValue([run("selected")]);
    getDb.mockResolvedValue({ publicUsage: { history: reader } } as unknown as KeryxDB);
    for (const limit of ["0", "51", "-1", "1.5", "25&limit=25", "", "01", "1e1"]) {
      expect((await history(new Request(`https://keryx.invalid/api/runs?limit=${limit}`))).status).toBe(400);
    }
    expect(getDb).not.toHaveBeenCalled(); expect(getArchive).not.toHaveBeenCalled();
    const response = await history(new Request("https://keryx.invalid/api/runs?network=eip155:5042&period=all&limit=25"));
    expect(response.status).toBe(200);
    expect(reader).toHaveBeenCalledWith(expect.objectContaining({ network: "eip155:5042", period: "all" }), "default", 25);
  });
});
