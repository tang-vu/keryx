import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), published: vi.fn(), summary: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.db }));
vi.mock("../config", () => ({ config: { profile: { networkId: "eip155:5042" } } }));
import { GET } from "../../app/api/runs/summary/route";
const request = (query = "") => new Request(`https://synthetic.example/api/runs/summary?network=eip155:5042&period=all${query}`);
beforeEach(() => {
  vi.clearAllMocks(); mocks.published.mockResolvedValue({ windowRuns: 123, runs: [{}] });
  mocks.db.mockResolvedValue({ runPrivacyActive: true, runPrivacy: {}, publicUsage: { publishedHistory: mocks.published, summary: mocks.summary } });
});
it("counts the public population rather than the one-row or 50-row sample", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ publicQuestions: 123, network: "eip155:5042", complete: true });
  expect(mocks.published).toHaveBeenCalledWith(expect.objectContaining({ network: "eip155:5042", period: "all" }), "default", 1);
  expect(mocks.summary).not.toHaveBeenCalled();
});
it("keeps an unavailable active reader distinct from a genuine zero", async () => {
  mocks.published.mockRejectedValue(new Error("Unavailable"));
  const response = await GET(request()); expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "public_history_summary_unavailable", complete: false });
  mocks.published.mockResolvedValue({ windowRuns: 0, runs: [] });
  expect(await (await GET(request())).json()).toMatchObject({ publicQuestions: 0, complete: true });
});
it("refuses a missing active privacy port and an invalid population", async () => {
  mocks.db.mockResolvedValueOnce({ runPrivacyActive: true, publicUsage: { publishedHistory: mocks.published } });
  expect((await GET(request())).status).toBe(503);
  mocks.published.mockResolvedValue({ windowRuns: -1, runs: [] }); expect((await GET(request())).status).toBe(503);
});
it("retains the inactive public-history cohort rule using the complete classified summary", async () => {
  mocks.db.mockResolvedValue({ runPrivacyActive: false, publicUsage: { summary: mocks.summary } });
  mocks.summary.mockResolvedValue({ columns: [{ cohort: "outside", researchRuns: 3 }, { cohort: "team", researchRuns: 2 },
    { cohort: "unknown", researchRuns: 1 }, { cohort: "scripted", researchRuns: 80 }] });
  expect(await (await GET(request())).json()).toMatchObject({ publicQuestions: 6 });
});
it("refuses invalid or archive filters before reading the store", async () => {
  expect((await GET(request("&archive=testnet"))).status).toBe(400);
  expect((await GET(request("&cohort=guessed"))).status).toBe(400);
  expect(mocks.db).not.toHaveBeenCalled();
});
