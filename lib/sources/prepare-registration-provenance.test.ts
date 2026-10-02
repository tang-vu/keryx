import { expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
vi.mock("../config", async original => {
  const actual = await original<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, registryAddress: undefined } };
});
vi.mock("./create-source", () => ({ createSource: create }));
vi.mock("../demand-intent", () => ({ resolveGapOffer: vi.fn(), queueGapOffer: vi.fn() }));
import { prepareSourceRegistration } from "./prepare-registration";
import type { KeryxDB } from "../db";

it("does not accept public caller source or item provenance", async () => {
  create.mockResolvedValue({ id: "new", name: "Publisher", walletAddress: "wallet", fetchPrice: 0.01, verified: false, authors: [] });
  const item = { title: "Post", summary: "Summary", content: "Full post", link: "https://publisher.test/post" };
  const response = await prepareSourceRegistration({} as KeryxDB, "wallet", {
    name: "Publisher", description: "Publication", evidenceProvenance: "synthetic-demo",
    items: [{ ...item, evidenceProvenance: "synthetic-demo" }],
  });
  expect(response.status).toBe(200);
  const input = create.mock.calls[0][1];
  expect(input).not.toHaveProperty("evidenceProvenance");
  expect(input.items).toEqual([item]);
  expect(input.verified).toBe(false);
});
