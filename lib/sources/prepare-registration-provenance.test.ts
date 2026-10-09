import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn(), ingest: vi.fn(), store: vi.fn(), registryAddress: undefined as string | undefined }));
vi.mock("../config", async original => {
  const actual = await original<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, get registryAddress() { return m.registryAddress; } } };
});
vi.mock("./create-source", () => ({ createSource: m.create }));
vi.mock("../ingest/rss", () => ({ ingestRss: m.ingest }));
vi.mock("./store-source-item", () => ({ storeSourceItems: m.store }));
vi.mock("../demand-intent", () => ({ resolveGapOffer: vi.fn(), queueGapOffer: vi.fn() }));
import { prepareSourceRegistration } from "./prepare-registration";
import type { KeryxDB } from "../db";
import type { SourceItem } from "../types";

beforeEach(() => { vi.clearAllMocks(); m.registryAddress = undefined; });

it("does not accept public caller source or item provenance", async () => {
  m.create.mockResolvedValue({ id: "new", name: "Publisher", walletAddress: "wallet", fetchPrice: 0.01, verified: false, authors: [] });
  const item = { title: "Post", summary: "Summary", content: "Full post", link: "https://publisher.test/post" };
  const response = await prepareSourceRegistration({} as KeryxDB, "wallet", {
    name: "Publisher", description: "Publication", evidenceProvenance: "synthetic-demo",
    items: [{ ...item, evidenceProvenance: "synthetic-demo" }],
  });
  expect(response.status).toBe(200);
  const input = m.create.mock.calls[0][1];
  expect(input).not.toHaveProperty("evidenceProvenance");
  expect(input.items).toEqual([item]);
  expect(input.verified).toBe(false);
});

it("retains one copy and the original item identity across two preparations before the source is indexed", async () => {
  m.registryAddress = `0x${"d".repeat(40)}`;
  const wallet = `0x${"a".repeat(40)}`;
  const item = { title: "Post", summary: "Summary", content: "Full post", link: "https://publisher.test/post" };
  m.ingest.mockResolvedValue({ feedTitle: "Publisher", feedDescription: "Publication", link: "https://publisher.test", items: [item] });
  m.store.mockImplementation(async (items: SourceItem[]) => items.map(value => ({ ...value, storageMode: "db_encrypted" })));
  const retained: SourceItem[] = [];
  const getItems = vi.fn(async (rowId: string) => retained.filter(value => value.sourceId === rowId));
  const addItems = vi.fn(async (items: SourceItem[]) => { retained.push(...items); });
  const listSources = vi.fn(async () => []);
  const setCached = vi.fn(), setSourceMeta = vi.fn();
  const db = { listSources, getItems, addItems, setCached, setSourceMeta } as unknown as KeryxDB;
  const body = { rssUrl: "https://publisher.test/feed", fetchPrice: 0.002, tags: ["research"] };

  const first = await prepareSourceRegistration(db, wallet, body);
  expect(first.status).toBe(200); expect(retained).toHaveLength(1);
  const originalId = retained[0].id;
  const second = await prepareSourceRegistration(db, wallet, body);

  expect(second.status).toBe(200);
  expect(second.payload.sourceId).toBe(first.payload.sourceId);
  expect(second.payload.registerParams).toEqual(first.payload.registerParams);
  expect(second.payload.registerParams).toMatchObject({ payoutWallet: wallet,
    authors: [{ wallet, basisPoints: 10000 }], fetchPriceUsdc6: "2000", tags: "research" });
  expect(listSources).toHaveBeenCalledTimes(2); // Both preparations precede the first indexer event.
  expect(getItems).toHaveBeenCalledTimes(2);
  expect(getItems).toHaveBeenNthCalledWith(1, first.payload.sourceId);
  expect(getItems).toHaveBeenNthCalledWith(2, first.payload.sourceId);
  expect(retained).toHaveLength(1); expect(retained[0].id).toBe(originalId);
  expect(retained[0]).toMatchObject({ sourceId: first.payload.sourceId, link: item.link, storageMode: "db_encrypted" });
  expect(m.store).toHaveBeenCalledTimes(1); expect(addItems).toHaveBeenCalledTimes(1);
  expect(setCached).toHaveBeenCalledTimes(1); expect(setSourceMeta).toHaveBeenCalledTimes(2);
  expect(m.create).not.toHaveBeenCalled();
});
