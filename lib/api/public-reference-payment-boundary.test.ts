import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn(() => { throw new Error("Payment DB must not initialize"); }) }));
vi.mock("@/lib/db", () => ({ getDb }));
import { GET as sourceGet } from "../../app/api/source/[id]/route";
import { GET as itemGet } from "../../app/api/source/[id]/item/[itemId]/route";
import { POST as citePost } from "../../app/api/cite/[id]/route";
import { sourceFetchTerms } from "../registry/source-fetch-payto";
import type { Source } from "../types";

describe("public reference IDs cannot authorize payment", () => {
  it("refuses direct source, article and citation requests before DB/settlement", async () => {
    const id = "public:cloudflare-workers";
    const request = new NextRequest(`https://keryx.cc/api/source/${id}?author=0xattacker&amount=1`, {
      headers: { "PAYMENT-SIGNATURE": "forged" },
    });
    for (const response of [
      await sourceGet(request, { params: Promise.resolve({ id }) }),
      await itemGet(request, { params: Promise.resolve({ id, itemId: "forged" }) }),
      await citePost(request, { params: Promise.resolve({ id }) }),
    ]) expect(response.status).toBe(410);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses registry terms even for a forged paid Source carrying a reserved public ID", async () => {
    await expect(sourceFetchTerms({ id: "public:forged", walletAddress: "0xattacker", fetchPrice: 1 } as Source))
      .rejects.toThrow("no payment terms");
  });
});
