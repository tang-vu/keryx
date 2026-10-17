import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), payments: vi.fn(), withdrawals: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
import { GET as payments } from "../../app/api/payments/route";
import { GET as withdrawals } from "../../app/api/withdrawals/route";

beforeEach(() => {
  vi.clearAllMocks(); mocks.payments.mockResolvedValue([]); mocks.withdrawals.mockResolvedValue([]);
  mocks.getDb.mockResolvedValue({ listPayments: mocks.payments, listWithdrawals: mocks.withdrawals });
});

for (const [name, get, reader, fallback, cap] of [
  ["payments", payments, mocks.payments, 50, 200],
  ["withdrawals", withdrawals, mocks.withdrawals, 20, 100],
] as const) {
  const request = (query = "") => new NextRequest(`https://synthetic.example/api/${name}${query}`);
  it(`${name} refuses invalid limits before obtaining the database`, async () => {
    for (const value of ["-1", "-200", "0", "", "1.5", "1e2", "+1", "01", "bad", "9007199254740992", "25&limit=25"]) {
      const response = await get(request(`?limit=${value}`));
      expect(response.status, value).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_limit" });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(reader).not.toHaveBeenCalled();
  });
  it(`${name} keeps defaults and clamps positive integer requests to the existing cap`, async () => {
    for (const [query, expected] of [["", fallback], ["?limit=1", 1], ["?limit=25", 25], [`?limit=${cap}`, cap], ["?limit=1000", cap], ["?limit=9007199254740991", cap]] as const) {
      const response = await get(request(query)); expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ [name]: [] });
      expect(reader).toHaveBeenLastCalledWith(expected);
    }
  });
}
