import { expect, it } from "vitest";
import {
  assertVerifiedBrowserOriginalSourceContextCurrent,
  createSyntheticBrowserOriginalSourceAuthority,
  prepareBrowserSourceSigningAdmission,
  type VerifiedBrowserOriginalSourceContext,
} from "./browser-original-source-authority";
import type { BrowserSourceOriginalAdmission } from "../db/browser-signing-originals";
import { createServer } from "node:http";
import { once } from "node:events";
import { encodeFunctionResult } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { REGISTRY_ABI } from "../registry/registry-client";
import { browserSourceRegistryId } from "./browser-original-source-context";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import type { Source, SourceItem } from "../types";

it("cannot manufacture source authority by JSON serialization or a caller supplied frozen token", () => {
  const token = Object.freeze({}) as VerifiedBrowserOriginalSourceContext;
  const input = {} as BrowserSourceOriginalAdmission;
  expect(() =>
    assertVerifiedBrowserOriginalSourceContextCurrent(token, input)
  ).toThrow("refused");
  expect(() => prepareBrowserSourceSigningAdmission(input, token)).toThrow(
    "refused"
  );
});
it("synthetic composition refuses a production provider or credential-bearing localhost URL", () => {
  const catalog = {
    getSource: async () => null,
    getItem: async () => null,
    getArticleOffer: async () => null,
  };
  const registry = "0x2222222222222222222222222222222222222222";
  expect(() =>
    createSyntheticBrowserOriginalSourceAuthority(
      catalog,
      "https://rpc.testnet.arc.network",
      registry
    )
  ).toThrow("refused");
  expect(() =>
    createSyntheticBrowserOriginalSourceAuthority(
      catalog,
      "http://user:pass@127.0.0.1:1234",
      registry
    )
  ).toThrow("refused");
});
it("retains the resolver-start deadline across delayed native RPC resolution and repeated preparation", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const payout = "0x2222222222222222222222222222222222222222";
  const source: Source = {
    id: "source",
    name: "Source",
    url: "https://source.example/",
    description: "fixture",
    walletAddress: payout,
    fetchPrice: 0.001,
    tags: [],
    authors: [],
    createdAt: new Date().toISOString(),
    active: true,
    verified: true,
    onchainId: browserSourceRegistryId(
      account.address,
      "https://source.example/"
    ),
  };
  const item: SourceItem = {
    id: "item",
    sourceId: source.id,
    title: "Fixture",
    summary: "Preview",
    content: "Synthetic fixture",
    link: "https://source.example/item",
  };
  const queryId = crypto.randomUUID(),
    epoch = crypto.randomUUID();
  const input: BrowserSourceOriginalAdmission = {
    protocol: "durable-v3",
    queryNamespace: `0x${"33".repeat(32)}`,
    queryId,
    source: {
      sourceId: source.id,
      itemId: item.id,
      contentVersion: sourceItemContentVersion(item),
      offerId: null,
    },
    journal: {
      sessionId: account.address.toLowerCase(),
      requestId: crypto.randomUUID(),
      queryId,
      grantEpoch: epoch,
      signer: account.address,
      network: "eip155:5042002",
      token: "0x3600000000000000000000000000000000000000",
      gatewayContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
      sourceId: source.id,
      offerId: null,
      kind: "fetch",
      payee: payout,
      amountMicroUsdc: 1000,
      requirements: {
        scheme: "exact",
        network: "eip155:5042002",
        asset: "0x3600000000000000000000000000000000000000",
        amount: "1000",
        payTo: payout,
        maxTimeoutSeconds: 691200,
        extra: {
          name: "GatewayWalletBatched",
          version: "1",
          verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        },
      },
      payment: {
        kind: "fetch",
        queryId,
        sourceId: source.id,
        sourceName: source.name,
        payer: account.address,
        payee: payout,
        amountUsdc: 0.001,
        network: "eip155:5042002",
        grantEpoch: epoch,
        itemId: item.id,
        contentVersion: sourceItemContentVersion(item),
      },
    },
  };
  const hash = `0x${"44".repeat(32)}`;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rpc = JSON.parse(Buffer.concat(chunks).toString());
    const result =
      rpc.method === "eth_chainId"
        ? "0x4cef52"
        : rpc.method === "eth_call"
        ? encodeFunctionResult({
            abi: REGISTRY_ABI,
            functionName: "get",
            result: {
              creator: account.address,
              payoutWallet: payout,
              authors: [],
              fetchPriceUsdc6: BigInt(1000),
              contentCid: "",
              tags: "",
              active: true,
            },
          })
        : {
            number: "0x1",
            hash,
            timestamp: `0x${(Math.floor(Date.now() / 1000) - 1).toString(16)}`,
            transactions: [],
          };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Synthetic fixture unavailable");
    let catalogStartedAt = 0;
    const authority = createSyntheticBrowserOriginalSourceAuthority(
      {
        getSource: async () => {
          catalogStartedAt = Date.now();
          await new Promise((resolve) => setTimeout(resolve, 200));
          return source;
        },
        getItem: async () => item,
        getArticleOffer: async () => null,
      },
      `http://127.0.0.1:${address.port}`,
      payout
    );
    const startedAt = Date.now();
    const token = await authority.resolve(input);
    const first = prepareBrowserSourceSigningAdmission(input, token);
    expect(first.admissionDeadlineMs).toBeGreaterThanOrEqual(startedAt + 5000);
    expect(first.admissionDeadlineMs).toBeLessThanOrEqual(
      catalogStartedAt + 5000
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    const second = prepareBrowserSourceSigningAdmission(input, token);
    expect(second.admissionDeadlineMs).toBe(first.admissionDeadlineMs);
    expect(Date.parse(second.journal.admittedAt)).toBeGreaterThan(
      Date.parse(first.journal.admittedAt)
    );
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.hasOwn(second.input, "admissionDeadlineMs")).toBe(false);
    expect(Object.hasOwn(second.original, "admissionDeadlineMs")).toBe(false);
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
  }
});
