/** Generated keys, isolated actual SQLite and native localhost HTTP only. */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { DatabaseSync } from "node:sqlite";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import { REGISTRY_ABI } from "../registry/registry-abi";
import { browserSourceRegistryId } from "./browser-original-source-context";
import { createSyntheticBrowserOriginalSourceAuthority } from "./browser-original-source-authority";
import { admitSqliteBrowserSourceSigningOriginal } from "../db/sqlite-browser-source-context";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import { SqliteAdapter } from "../db/sqlite-adapter";
import {
  browserQueryPolicyTypedData,
  type BrowserQueryPolicy,
} from "./browser-query-policy";
import type { BrowserOriginalAdmission } from "../db/browser-signing-originals";
import type { BrowserX402SettlementLocator } from "./browser-x402-settlement-observer";

export async function browserTransferFixture() {
  const directory = mkdtempSync(join(tmpdir(), "browser-transfer-fact-")),
    file = join(directory, "fixture.sqlite");
  const adapter = new SqliteAdapter(file);
  let cleanupNative: DatabaseSync | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  try {
    await adapter.init();
    const native = (cleanupNative = new DatabaseSync(file));
    const owner = privateKeyToAccount(generatePrivateKey()),
      signer = privateKeyToAccount(generatePrivateKey());
    const epoch = randomUUID(),
      sessionId = owner.address.toLowerCase(),
      queryId = randomUUID(),
      requestId = randomUUID();
    const payee = `0x${"2".repeat(40)}`,
      gateway = "0x0077777d7eba4688bdef3e311b846f25870a19b9",
      asset = "0x3600000000000000000000000000000000000000";
    await adapter.upsertSessionGrant({
      sessionId,
      ownerAddr: owner.address,
      sessAddr: signer.address,
      cap: 0.00001,
      expiry: Date.now() + 7200000,
      txHash: "synthetic-unfunded",
      grantEpoch: epoch,
    });
    await adapter.activateBrowserJournal();
    native.exec("UPDATE browser_signing_v2_control SET active=1 WHERE id=1");
    const policy: BrowserQueryPolicy = {
      protocol: "durable-v2" as const,
      service: "https://keryx.cc" as const,
      owner: owner.address,
      signer: signer.address,
      policyId: `0x${"3".repeat(64)}`,
      grantEpoch: epoch,
      requestNonce: `0x${"4".repeat(64)}`,
      queryId,
      questionDigest: `0x${"5".repeat(64)}`,
      queryCeilingMicros: "2",
      lifetimeCeilingMicros: "4",
      jobLimit: 2,
      expiresAt: Date.now() + 3600000,
    };
    const approved = await adapter.admitBrowserQueryPolicy(
      {
        policy,
        signature: await owner.signTypedData(
          browserQueryPolicyTypedData(policy)
        ),
      },
      sessionId
    );
    if (approved.status !== "admitted")
      throw new Error("Synthetic owner policy refused");
    const input: BrowserOriginalAdmission = {
      queryNamespace: approved.namespace,
      queryId,
      journal: {
        sessionId,
        requestId,
        queryId,
        grantEpoch: epoch,
        signer: signer.address,
        network: "eip155:5042002",
        token: asset,
        gatewayContract: gateway,
        sourceId: "synthetic-source",
        offerId: null,
        kind: "fetch",
        payee,
        amountMicroUsdc: 1,
        requirements: {
          scheme: "exact",
          network: "eip155:5042002",
          asset,
          amount: "1",
          payTo: payee,
          maxTimeoutSeconds: 691200,
          extra: {
            name: "GatewayWalletBatched",
            version: "1",
            verifyingContract: gateway,
          },
        },
        payment: {
          kind: "fetch",
          queryId,
          sourceId: "synthetic-source",
          sourceName: "Synthetic",
          payer: signer.address,
          payee,
          amountUsdc: 0.000001,
          network: "eip155:5042002",
          grantEpoch: epoch,
        },
      },
    };
    const admitted = await adapter.admitBrowserSigningOriginal(input);
    if (admitted.status !== "admitted")
      throw new Error("Synthetic original refused");
    const locator: BrowserX402SettlementLocator = {
      namespace: approved.namespace,
      queryId,
      sessionId,
      requestId,
    };
    const transfer = {
      id: randomUUID(),
      status: "confirmed",
      token: "USDC",
      sendingNetwork: "eip155:5042002",
      recipientNetwork: "eip155:5042002",
      fromAddress: signer.address,
      toAddress: payee,
      amount: "1",
      nonce: admitted.original.authorization.nonce,
      txHash: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let handler = (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, {
        "Content-Type": "application/json",
        Connection: "close",
      });
      res.end(JSON.stringify({ transfers: [transfer] }));
    };
    let calls = 0;
    let registryOrigin: string | null = null;
    const failures: string[] = [];
    server = createServer((req, res) => {
      calls++;
      try {
        handler(req, res);
      } catch {
        failures.push("Synthetic transfer HTTP fixture failed");
        res.destroy();
      }
    });
    const ownedServer = server;
    await new Promise<void>((resolve) =>
      ownedServer.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Synthetic localhost unavailable");
    const snapshot = () => {
      const tables = native
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as { name: string }[];
      return JSON.stringify(
        tables.map(({ name }) => [
          name,
          native.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all(),
        ])
      );
    };
    return {
      adapter,
      native,
      locator,
      transfer,
      admitted,
      input,
      failures,
      calls: () => calls,
      registryOrigin: () => registryOrigin,
      origin: `http://127.0.0.1:${address.port}`,
      handle: (next: typeof handler) => {
        handler = next;
      },
      snapshot,
      expose: () => adapter.exposeBrowserJournal(sessionId, requestId),
      async admitV3() {
        const url = "https://synthetic.invalid/source",
          registry = `0x${"6".repeat(40)}`;
        const registryId = browserSourceRegistryId(owner.address, url);
        await adapter.upsertSource({
          id: "synthetic-source",
          name: "Synthetic",
          url,
          description: "Synthetic",
          walletAddress: payee,
          fetchPrice: 0.000001,
          tags: [],
          authors: [],
          createdAt: new Date().toISOString(),
          active: true,
          verified: true,
          onchainId: registryId,
        });
        const item = {
          id: "synthetic-item",
          sourceId: "synthetic-source",
          title: "Synthetic",
          summary: "Preview",
          content: "Synthetic generated article",
          link: `${url}/item`,
        };
        await adapter.addItems([item]);
        const rpc = createServer(async (req, res) => {
          try {
            let text = "";
            for await (const chunk of req) {
              text += chunk;
              if (Buffer.byteLength(text) > 8192) throw new Error();
            }
            const payload = JSON.parse(text);
            let result: unknown;
            if (payload.method === "eth_chainId") result = "0x4cef52";
            else if (payload.method === "eth_getBlockByNumber")
              result = {
                number: "0x1",
                hash: `0x${"7".repeat(64)}`,
                parentHash: `0x${"8".repeat(64)}`,
                timestamp: `0x${(Math.floor(Date.now() / 1000) - 1).toString(
                  16
                )}`,
                transactions: [],
                gasLimit: "0x100000",
                gasUsed: "0x0",
                extraData: "0x",
                miner: payee,
                size: "0x1",
              };
            else if (payload.method === "eth_call") {
              const decoded = decodeFunctionData({
                abi: REGISTRY_ABI,
                data: payload.params[0].data,
              });
              if (
                payload.params[0].to.toLowerCase() !== registry ||
                payload.params[1] !== "0x1" ||
                decoded.functionName !== "get" ||
                decoded.args?.[0] !== registryId
              )
                throw new Error();
              result = encodeFunctionResult({
                abi: REGISTRY_ABI,
                functionName: "get",
                result: {
                  creator: owner.address,
                  payoutWallet: payee as `0x${string}`,
                  authors: [],
                  fetchPriceUsdc6: BigInt(1),
                  contentCid: "",
                  tags: "",
                  active: true,
                },
              });
            } else throw new Error();
            res.writeHead(200, {
              "Content-Type": "application/json",
              Connection: "close",
            });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
          } catch {
            failures.push("Synthetic registry RPC fixture failed");
            res.destroy();
          }
        });
        await new Promise<void>((resolve) =>
          rpc.listen(0, "127.0.0.1", resolve)
        );
        try {
          const rpcAddress = rpc.address();
          if (!rpcAddress || typeof rpcAddress === "string")
            throw new Error("Synthetic registry unavailable");
          registryOrigin = `http://127.0.0.1:${rpcAddress.port}`;
          native.exec(
            "UPDATE browser_signing_v2_control SET min_original_version=3 WHERE id=1"
          );
          const version = sourceItemContentVersion(item),
            sourceRequest = randomUUID();
          const sourceInput = {
            ...input,
            protocol: "durable-v3" as const,
            source: {
              sourceId: item.sourceId,
              itemId: item.id,
              contentVersion: version,
              offerId: null,
            },
            journal: {
              ...input.journal,
              requestId: sourceRequest,
              payment: {
                ...input.journal.payment,
                itemId: item.id,
                contentVersion: version,
              },
            },
          };
          const authority = createSyntheticBrowserOriginalSourceAuthority(
            adapter,
            `http://127.0.0.1:${rpcAddress.port}`,
            registry
          );
          const result = await admitSqliteBrowserSourceSigningOriginal(
            native,
            sourceInput,
            authority
          );
          if (result.status !== "admitted")
            throw new Error("Synthetic v3 admission refused");
          if (!(await adapter.exposeBrowserJournal(sessionId, sourceRequest)))
            throw new Error("Synthetic v3 exposure refused");
          locator.requestId = sourceRequest;
          transfer.nonce = result.original.authorization.nonce;
          return result;
        } finally {
          registryOrigin = null;
          rpc.closeAllConnections();
          await new Promise<void>((resolve) => rpc.close(() => resolve()));
        }
      },
      async close() {
        ownedServer.closeAllConnections();
        await new Promise<void>((resolve) =>
          ownedServer.close(() => resolve())
        );
        native.close();
        adapter.close();
        rmSync(directory, { recursive: true });
      },
    };
  } catch (error) {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    cleanupNative?.close();
    adapter.close();
    rmSync(directory, { recursive: true });
    throw error;
  }
}
