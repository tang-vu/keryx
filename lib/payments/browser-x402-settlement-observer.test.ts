import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../canonical-json";
import { browserTransferFixture } from "./browser-x402-settlement-observer.test-fixture";
import type { KeryxDB } from "../db/keryx-db";
import type { VerifiedBrowserX402TransferObservation } from "./browser-x402-settlement-observer";

const state = vi.hoisted(() => ({ adapter: null as KeryxDB | null }));
// Only the installed-backend accessor is redirected, to an actual isolated adapter.
vi.mock("../db", () => ({
  getDb: async () => {
    if (!state.adapter) throw new Error("Synthetic adapter unavailable");
    return state.adapter;
  },
}));
let fixture: Awaited<ReturnType<typeof browserTransferFixture>>;
let observer: typeof import("./browser-x402-settlement-observer");
const nativeFetch = globalThis.fetch.bind(globalThis);
beforeAll(async () => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (
      fixture &&
      url.origin === fixture.registryOrigin() &&
      init?.method === "POST"
    )
      return nativeFetch(input, init);
    if (
      url.origin !== "https://gateway-api-testnet.circle.com" ||
      url.pathname !== "/v1/x402/transfers"
    )
      throw new Error("Unexpected synthetic URL");
    return nativeFetch(`${fixture.origin}${url.pathname}${url.search}`, init);
  });
  observer = await import("./browser-x402-settlement-observer");
});
afterEach(async () => {
  if (fixture) {
    expect(fixture.failures).toEqual([]);
    await fixture.close();
  }
  state.adapter = null;
});
async function setup(exposed = true) {
  fixture = await browserTransferFixture();
  state.adapter = fixture.adapter;
  if (exposed) expect(await fixture.expose()).toBe(true);
  return fixture;
}
async function observe() {
  const before = fixture.snapshot(),
    result = await observer.observeBrowserX402Settlement(fixture.locator);
  expect(fixture.snapshot()).toBe(before);
  return result;
}
function response(
  rows: unknown[],
  res: import("node:http").ServerResponse,
  headers: Record<string, string> = {}
) {
  res.writeHead(200, {
    "Content-Type": "application/json",
    Connection: "close",
    ...headers,
  });
  res.end(JSON.stringify({ transfers: rows }));
}
describe("installed SQLite original and bounded native Circle API observation", () => {
  it("consumes an actual immutable v3 registry-bound fetch original without changing retained context", async () => {
    await setup();
    const admitted = await fixture.admitV3();
    expect(admitted.original.protocol).toBe("durable-v3");
    const context = canonicalJson(admitted.original),
      before = fixture.snapshot();
    const result = await observe();
    expect(result.status).toBe("observed");
    if (result.status !== "observed") return;
    const evidence = await observer.unsealBrowserX402TransferObservation(
      result.token,
      fixture.locator
    );
    expect(evidence.transfer.nonce).toBe(admitted.original.authorization.nonce);
    const retained =
      await fixture.adapter.readExposedBrowserSigningSnapshotForSigner(
        admitted.original.authorization.from,
        fixture.locator.sessionId,
        fixture.locator.requestId
      );
    expect(canonicalJson(retained?.original)).toBe(context);
    expect(fixture.snapshot()).toBe(before);
  });
  it.each(["proof", "context"])(
    "refuses administratively corrupted retained %s before HTTP",
    async (mode) => {
      await setup();
      const admitted = await fixture.admitV3();
      // Deliberate synthetic administrative corruption, outside ordinary table
      // privileges: the observer must still validate actual stored bytes.
      if (mode === "context") {
        fixture.native.exec("DROP TRIGGER browser_signing_original_immutable");
        const bad = {
          ...admitted.original,
          sourceContextDigest: `0x${"f".repeat(64)}`,
        };
        fixture.native
          .prepare(
            "UPDATE browser_signing_originals SET original=? WHERE nonce=?"
          )
          .run(canonicalJson(bad), admitted.original.authorization.nonce);
      } else {
        const row = fixture.native
          .prepare("SELECT proof FROM browser_signing_queries WHERE query_id=?")
          .get(fixture.locator.queryId) as { proof: string };
        fixture.native.exec("DROP TRIGGER browser_signing_query_immutable");
        const bad = JSON.parse(row.proof);
        bad.signature = `0x${"00".repeat(65)}`;
        fixture.native
          .prepare(
            "UPDATE browser_signing_queries SET proof=? WHERE query_id=?"
          )
          .run(canonicalJson(bad), fixture.locator.queryId);
      }
      expect((await observe()).status).toBe("unavailable");
      expect(fixture.calls()).toBe(0);
    }
  );
  it.each(["received", "batched", "confirmed", "completed", "failed"])(
    "honestly records %s without chain finality or reward authority",
    async (status) => {
      await setup();
      fixture.transfer.status = status;
      const result = await observe();
      expect(result.status).toBe("observed");
      if (result.status !== "observed") return;
      const value = await observer.unsealBrowserX402TransferObservation(
        result.token,
        fixture.locator
      );
      expect(value).toMatchObject({
        basis: "circle-api",
        chainFinality: "not-verified",
        backendTrust: "installed-runtime-adapter",
        scope: "nonce-filtered-returned-api-pages",
        transfer: { status, txHash: null },
      });
      expect(Object.isFrozen(value.transfer)).toBe(true);
      expect("eligible" in value).toBe(false);
    }
  );
  it.each([
    "prepared",
    "cancelled",
    "foreign-namespace",
    "foreign-query",
    "foreign-request",
  ])("refuses %s before HTTP with no tuple", async (mode) => {
    await setup(mode !== "prepared" && mode !== "cancelled");
    if (mode === "cancelled")
      expect(
        await fixture.adapter.cancelPreparedBrowserJournal(
          fixture.locator.sessionId,
          fixture.locator.requestId
        )
      ).toBe(true);
    if (mode === "foreign-namespace")
      fixture.locator.namespace = `0x${"f".repeat(64)}`;
    if (mode === "foreign-query") fixture.locator.queryId = crypto.randomUUID();
    if (mode === "foreign-request")
      fixture.locator.requestId = crypto.randomUUID();
    expect(await observe()).toEqual({
      status: "unavailable",
      reason: "binding",
    });
    expect(fixture.calls()).toBe(0);
  });
  it.each([
    "nonce",
    "fromAddress",
    "toAddress",
    "amount",
    "token",
    "sendingNetwork",
    "recipientNetwork",
    "txHash",
    "duplicate",
    "hint",
    "extra",
  ])("does not mint from %s mismatch", async (field) => {
    await setup();
    const bad = { ...fixture.transfer };
    if (field === "nonce") bad.nonce = `0x${"f".repeat(64)}`;
    if (field === "fromAddress" || field === "toAddress")
      bad[field] = `0x${"f".repeat(40)}`;
    if (field === "amount") bad.amount = "2";
    if (field === "token") bad.token = "OTHER";
    if (field === "txHash")
      Object.assign(bad, { txHash: "fabricated-reference" });
    if (field === "sendingNetwork" || field === "recipientNetwork")
      bad[field] = "eip155:1";
    if (field === "hint") fixture.locator.transferIdHint = crypto.randomUUID();
    fixture.handle((_req, res) =>
      response(
        field === "duplicate"
          ? [bad, bad]
          : [field === "extra" ? { ...bad, invented: true } : bad],
        res
      )
    );
    expect((await observe()).status).toBe("unavailable");
  });
  it("rejects extra callbacks and accessor locators without invoking them", async () => {
    await setup();
    let calls = 0;
    expect(
      (
        await observer.observeBrowserX402Settlement({
          ...fixture.locator,
          callback: () => calls++,
        } as typeof fixture.locator)
      ).status
    ).toBe("unavailable");
    const accessor = { ...fixture.locator };
    Object.defineProperty(accessor, "requestId", {
      enumerable: true,
      get() {
        calls++;
        return fixture.locator.requestId;
      },
    });
    expect((await observer.observeBrowserX402Settlement(accessor)).status).toBe(
      "unavailable"
    );
    expect(calls).toBe(0);
    expect(fixture.calls()).toBe(0);
  });
  it("shares batch hashes as API metadata without treating them as original identity", async () => {
    await setup();
    Object.assign(fixture.transfer, { txHash: `0x${"a".repeat(64)}` });
    const result = await observe();
    expect(result.status).toBe("observed");
    if (result.status !== "observed") return;
    expect(
      (
        await observer.unsealBrowserX402TransferObservation(
          result.token,
          fixture.locator
        )
      ).chainFinality
    ).toBe("not-verified");
  });
  it("captures input before waits and binds opaque token to exact locator/backend", async () => {
    await setup();
    const original = { ...fixture.locator },
      pending = observer.observeBrowserX402Settlement(fixture.locator);
    fixture.locator.queryId = crypto.randomUUID();
    const result = await pending;
    fixture.locator = original;
    expect(result.status).toBe("observed");
    if (result.status !== "observed") return;
    await expect(
      observer.unsealBrowserX402TransferObservation(
        {} as VerifiedBrowserX402TransferObservation,
        original
      )
    ).rejects.toThrow();
    await expect(
      observer.unsealBrowserX402TransferObservation(result.token, {
        ...original,
        requestId: "foreign",
      })
    ).rejects.toThrow();
    expect(
      (
        await observer.unsealBrowserX402TransferObservation(
          result.token,
          original
        )
      ).queryId
    ).toBe(original.queryId);
    await fixture.adapter.deleteSessionGrant(original.sessionId);
    expect(
      (
        await observer.unsealBrowserX402TransferObservation(
          result.token,
          original
        )
      ).transfer.status
    ).toBe("confirmed");
  });
  it("uses complete bounded returned pages and refuses cursor cycles/truncation", async () => {
    await setup();
    fixture.handle((req, res) => {
      const url = new URL(req.url!, "http://localhost");
      expect(url.searchParams.get("nonce")).toBe(fixture.transfer.nonce);
      if (!url.searchParams.has("pageAfter"))
        response([], res, {
          Link: '<https://gateway-api-testnet.circle.com/v1/x402/transfers?pageAfter=second>; rel="next", <https://gateway-api-testnet.circle.com/v1/x402/transfers>; rel="self"',
        });
      else response([fixture.transfer], res);
    });
    expect((await observe()).status).toBe("observed");
    expect(fixture.calls()).toBe(2);
    fixture.handle((_req, res) =>
      response([fixture.transfer], res, {
        Link: '<https://gateway-api-testnet.circle.com/v1/x402/transfers?pageAfter=repeated>; rel="next"',
      })
    );
    expect(await observe()).toEqual({
      status: "unavailable",
      reason: "incomplete",
    });
    let page = 0;
    fixture.handle((_req, res) =>
      response(page++ === 0 ? [fixture.transfer] : [], res, {
        Link: `<https://gateway-api-testnet.circle.com/v1/x402/transfers?pageAfter=${page}>; rel="next"`,
      })
    );
    expect(await observe()).toEqual({
      status: "unavailable",
      reason: "incomplete",
    });
  });
  it.each(["redirect", "outage", "malformed", "oversized", "foreign-link"])(
    "bounds %s without backend writes",
    async (mode) => {
      await setup();
      fixture.handle((_req, res) => {
        if (mode === "redirect") {
          res.writeHead(302, {
            Location: "https://synthetic.invalid/",
            Connection: "close",
          });
          res.end();
        }
        if (mode === "outage") res.destroy();
        if (mode === "malformed") {
          res.writeHead(200, { Connection: "close" });
          res.end("{");
        }
        if (mode === "oversized") {
          res.writeHead(200, {
            "Content-Length": String(4 * 1024 * 1024 + 1),
            Connection: "close",
          });
          res.end();
        }
        if (mode === "foreign-link")
          response([fixture.transfer], res, {
            Link: '<https://synthetic.invalid/?pageAfter=x>; rel="next"',
          });
      });
      expect((await observe()).status).toBe("unavailable");
    }
  );
  it("cancels an actual blocked body within the fixed per-request deadline", async () => {
    await setup();
    fixture.handle((_req, res) => {
      res.writeHead(200, { Connection: "close" });
      res.flushHeaders();
      res.write('{"transfers":[');
    });
    const started = performance.now();
    expect(await observe()).toEqual({
      status: "unavailable",
      reason: "deadline",
    });
    expect(performance.now() - started).toBeLessThan(6500);
  }, 10000);
  it("does not restart the earliest observation TTL after a delayed actual backend reread", async () => {
    await setup();
    const real =
      fixture.adapter.readExposedBrowserSigningSnapshotForSigner.bind(
        fixture.adapter
      );
    let reads = 0;
    fixture.adapter.readExposedBrowserSigningSnapshotForSigner = async (
      ...args
    ) => {
      const value = await real(...args);
      if (++reads === 2)
        await new Promise((resolve) => setTimeout(resolve, 5100));
      return value;
    };
    expect(await observe()).toEqual({
      status: "unavailable",
      reason: "deadline",
    });
    expect(reads).toBe(2);
  }, 10000);
  it("bounds the aggregate bytes across pages, not each page independently", async () => {
    await setup();
    let calls = 0;
    fixture.handle((_req, res) => {
      const body =
        JSON.stringify({ transfers: calls++ === 0 ? [fixture.transfer] : [] }) +
        " ".repeat(2 * 1024 * 1024 + 100);
      res.writeHead(200, {
        "Content-Type": "application/json",
        Connection: "close",
        Link: '<https://gateway-api-testnet.circle.com/v1/x402/transfers?pageAfter=second>; rel="next"',
      });
      res.end(body);
    });
    expect(await observe()).toEqual({
      status: "unavailable",
      reason: "incomplete",
    });
    expect(calls).toBe(2);
  });
  it("refuses a token after the installed adapter instance changes", async () => {
    await setup();
    const result = await observe();
    expect(result.status).toBe("observed");
    if (result.status !== "observed") return;
    const other = await browserTransferFixture();
    try {
      state.adapter = other.adapter;
      await expect(
        observer.unsealBrowserX402TransferObservation(
          result.token,
          fixture.locator
        )
      ).rejects.toThrow();
    } finally {
      state.adapter = fixture.adapter;
      await other.close();
    }
  });
  it("keeps all eight slots occupied after unseal TTL expires until actual backend waits settle", async () => {
    await setup();
    const result = await observe();
    expect(result.status).toBe("observed");
    if (result.status !== "observed") return;
    await new Promise((resolve) => setTimeout(resolve, 4200));
    const real =
      fixture.adapter.readExposedBrowserSigningSnapshotForSigner.bind(
        fixture.adapter
      );
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    fixture.adapter.readExposedBrowserSigningSnapshotForSigner = async (
      ...args
    ) => {
      entered++;
      await wait;
      return real(...args);
    };
    const pending = Array.from({ length: 8 }, () =>
      observer
        .unsealBrowserX402TransferObservation(result.token, fixture.locator)
        .then(
          () => "unexpected",
          () => "expired"
        )
    );
    while (entered < 8) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(await Promise.all(pending)).toEqual(Array(8).fill("expired"));
    expect(await observe()).toEqual({
      status: "unavailable",
      reason: "capacity",
    });
    release();
    fixture.adapter.readExposedBrowserSigningSnapshotForSigner = real;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await observe()).status).toBe("observed");
  }, 15000);
});
