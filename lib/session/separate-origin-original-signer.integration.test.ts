import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SqliteAdapter } from "../db/sqlite-adapter";
import {
  browserQueryPolicyTypedData,
  BROWSER_SIGNING_SERVICE,
  type BrowserQueryPolicy,
} from "../payments/browser-query-policy";
import { createSyntheticOriginalObservationServer } from "../payments/browser-original-observation-server";
import { verifyBrowserSigningHeader } from "../payments/browser-signing-original";

let browser: Browser;
let workerJs: string;
let pageJs: string;
beforeAll(async () => {
  const bundle = async (file: string) =>
    (
      await build({
        entryPoints: [file],
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife",
      })
    ).outputFiles[0].text;
  workerJs = await bundle(
    "lib/session/fixtures/separate-origin-original-signer.worker.ts"
  );
  pageJs = await bundle(
    "lib/session/fixtures/separate-origin-original-signer-page.ts"
  );
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  const version = browser?.version();
  await browser?.close();
  expect(browser?.isConnected()).toBe(false);
  console.info("Synthetic Chromium fixture cleanup", {
    version,
    disconnected: !browser?.isConnected(),
  });
});
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture unavailable");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  expect(server.listening).toBe(false);
}
type Mode =
  | "exposed"
  | "prepared"
  | "cancelled"
  | "revoked"
  | "replaced"
  | "offline"
  | "late"
  | "lost-ack"
  | "truncated-ack"
  | "late-ack"
  | "failed"
  | "settled";
async function fixture(mode: Mode = "exposed") {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "keryx-isolated-signer-")
  );
  const file = path.join(folder, "journal.sqlite");
  const db = new SqliteAdapter(file);
  try {
    await db.init();
  } catch {
    db.close();
    fs.rmSync(folder, { recursive: true, force: true });
    throw new Error("Fixture unavailable");
  }
  const native = new DatabaseSync(file);
  const context = await browser
    .newContext({ serviceWorkers: "block" })
    .catch(() => {
      native.close();
      db.close();
      fs.rmSync(folder, { recursive: true, force: true });
      throw new Error("Fixture unavailable");
    });
  const allowed = new Set<string>();
  const requestedOrigins: string[] = [];
  context.on("request", (request) =>
    requestedOrigins.push(new URL(request.url()).origin)
  );
  let parentOrigin = "",
    signerOrigin = "";
  let callbacks = 0,
    reads = 0,
    preflights = 0;
  let retainedHeader: string | undefined;
  const deliveredHeaders: string[] = [];
  let callbackLocator: { sessionId: string; requestId: string } | undefined;
  let runningHandlers = 0;
  let inFlightReads = 0;
  let handler:
    | ReturnType<typeof createSyntheticOriginalObservationServer>
    | undefined;
  const parentServer = createServer(async (req, res) => {
    runningHandlers++;
    try {
      if (req.url === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(`<script>window.statuses=[];addEventListener('message',e=>{
          if(e.origin===${JSON.stringify(
            signerOrigin
          )} && e.source===window.signerPopup) statuses.push(e.data);
        });window.openSigner=()=>window.signerPopup=window.open(${JSON.stringify(
          signerOrigin
        )},'signer');</script>`);
        return;
      }
      if (req.headers.origin !== signerOrigin) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", signerOrigin);
      const pathname = new URL(req.url ?? "/", parentOrigin).pathname;
      const callback = pathname === "/fixture/callback";
      const read =
        pathname === "/api/ask/original-observation" ||
        pathname === "/api/ask/original-observation/clock";
      if (!callback && !read) {
        res.writeHead(403).end();
        return;
      }
      const method = callback ? "POST" : "GET";
      const permittedHeader = callback
        ? "content-type"
        : "x-keryx-observation-proof";
      res.setHeader("Vary", "Origin");
      res.setHeader("Cache-Control", "no-store");
      if (req.method === "OPTIONS") {
        const requestedHeaders = String(
          req.headers["access-control-request-headers"] ?? ""
        )
          .toLowerCase()
          .split(",")
          .map((header) => header.trim())
          .filter(Boolean);
        if (
          req.headers["access-control-request-method"] !== method ||
          requestedHeaders.some((header) => header !== permittedHeader)
        ) {
          res.writeHead(403).end();
          return;
        }
        preflights++;
        res.setHeader("Access-Control-Allow-Methods", method);
        res.setHeader("Access-Control-Allow-Headers", permittedHeader);
        res.writeHead(204).end();
        return;
      }
      if (req.method !== method) {
        res.writeHead(405).end();
        return;
      }
      if (req.url === "/fixture/callback" && req.method === "POST") {
        callbacks++;
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const part of req) {
          bytes += part.length;
          if (bytes > 10000) throw new Error("Fixture refused");
          chunks.push(part);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          Object.keys(body).sort().join(",") !== "header,requestId,sessionId" ||
          body.sessionId !== callbackLocator?.sessionId ||
          body.requestId !== callbackLocator?.requestId ||
          typeof body.header !== "string" ||
          !(await db.signBrowserSigningOriginal(
            body.sessionId,
            body.requestId,
            body.header
          ))
        )
          throw new Error("Fixture refused");
        retainedHeader = body.header;
        deliveredHeaders.push(body.header);
        res.setHeader("Content-Type", "application/json");
        if (mode === "lost-ack") res.destroy();
        else if (mode === "truncated-ack") {
          // Start the response before truncating its ACK; avoid Chromium's connection-level retry.
          res.writeHead(200, { "Content-Length": "17" });
          res.flushHeaders();
          res.write('{"');
          res.destroy();
        } else if (mode === "late-ack") {
          await new Promise((resolve) => setTimeout(resolve, 5500));
          res.writeHead(200).end(
            JSON.stringify({
              version: "1",
              sessionId: body.sessionId,
              requestId: body.requestId,
              recorded: true,
            })
          );
        } else
          res.writeHead(200).end(
            JSON.stringify({
              version: "1",
              sessionId: body.sessionId,
              requestId: body.requestId,
              recorded: true,
            })
          );
        return;
      }
      if (!handler) throw new Error("Fixture unavailable");
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers))
        if (typeof value === "string") headers.set(name, value);
      const result = await handler(
        new Request(parentOrigin + req.url, { method: req.method, headers })
      );
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      if (!res.destroyed) res.writeHead(503).end();
    } finally {
      runningHandlers--;
    }
  });
  const signerServer = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src ${parentOrigin}`
    );
    if (req.url === "/worker.js" || req.url === "/page.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(req.url === "/worker.js" ? workerJs : pageJs);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        `<script>window.fixtureParentOrigin=${JSON.stringify(
          parentOrigin
        )}</script><script src='/page.js'></script>`
      );
    }
  });
  let parent: Page | undefined, popup: Page | undefined;
  try {
    parentOrigin = await listen(parentServer);
    signerOrigin = await listen(signerServer);
    allowed.add(parentOrigin);
    allowed.add(signerOrigin);
    parent = await context.newPage();
    await parent.goto(parentOrigin);
    const opened = parent.waitForEvent("popup");
    await parent.evaluate("openSigner()");
    popup = await opened;
    await popup.waitForFunction(
      () => typeof window.fixtureAddress === "string"
    );
    const signer = await popup.evaluate(
      () => window.fixtureAddress! as `0x${string}`
    );
    const owner = privateKeyToAccount(generatePrivateKey());
    const sessionId = owner.address.toLowerCase(),
      grantEpoch = crypto.randomUUID(),
      queryId = crypto.randomUUID(),
      requestId = crypto.randomUUID();
    await db.upsertSessionGrant({
      sessionId,
      sessAddr: signer,
      ownerAddr: owner.address,
      cap: 0.00001,
      expiry: Date.now() + 60000,
      txHash: "synthetic",
      grantEpoch,
    });
    await db.activateBrowserJournal();
    native.exec("UPDATE browser_signing_v2_control SET active=1 WHERE id=1");
    const policy: BrowserQueryPolicy = {
      protocol: "durable-v2",
      service: BROWSER_SIGNING_SERVICE,
      owner: owner.address,
      signer,
      grantEpoch,
      queryId,
      policyId: `0x${"11".repeat(32)}`,
      requestNonce: `0x${"22".repeat(32)}`,
      questionDigest: `0x${"33".repeat(32)}`,
      queryCeilingMicros: "2",
      lifetimeCeilingMicros: "4",
      jobLimit: 2,
      expiresAt: Date.now() + 30000,
    };
    const query = await db.admitBrowserQueryPolicy(
      {
        policy,
        signature: await owner.signTypedData(
          browserQueryPolicyTypedData(policy)
        ),
      },
      sessionId
    );
    if (query.status !== "admitted") throw new Error("Fixture unavailable");
    const payee = "0x2222222222222222222222222222222222222222";
    const original = await db.admitBrowserSigningOriginal({
      queryNamespace: query.namespace,
      queryId,
      journal: {
        sessionId,
        requestId,
        queryId,
        grantEpoch,
        signer,
        network: "eip155:5042002",
        token: "0x3600000000000000000000000000000000000000",
        gatewayContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        sourceId: "source",
        offerId: null,
        kind: "fetch",
        payee,
        amountMicroUsdc: 1,
        requirements: {
          scheme: "exact",
          network: "eip155:5042002",
          asset: "0x3600000000000000000000000000000000000000",
          amount: "1",
          payTo: payee,
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
          sourceId: "source",
          sourceName: "Synthetic",
          payer: signer,
          payee,
          amountUsdc: 0.000001,
          network: "eip155:5042002",
          grantEpoch,
        },
      },
    });
    if (original.status !== "admitted") throw new Error("Fixture unavailable");
    callbackLocator = { sessionId, requestId };
    if (mode === "cancelled")
      await db.cancelPreparedBrowserJournal(sessionId, requestId);
    else if (mode !== "prepared")
      await db.exposeBrowserJournal(sessionId, requestId);
    if (mode === "revoked") await db.deleteSessionGrant(sessionId);
    if (mode === "failed")
      await db.failPendingPayment(
        original.journal.payment.id!,
        original.journal.nonce,
        "synthetic-terminal"
      );
    if (mode === "settled")
      await db.settlePendingPayment(
        original.journal.payment.id!,
        original.journal.nonce,
        "synthetic-terminal"
      );
    if (mode === "replaced")
      await db.upsertSessionGrant({
        sessionId,
        sessAddr: signer,
        ownerAddr: owner.address,
        cap: 0.00001,
        expiry: Date.now() + 60000,
        txHash: "synthetic",
        grantEpoch: crypto.randomUUID(),
      });
    handler = createSyntheticOriginalObservationServer(
      {
        async readExposedBrowserSigningSnapshotForSigner(
          address,
          session,
          request
        ) {
          reads++;
          inFlightReads++;
          try {
            if (mode === "offline") return null;
            if (mode === "late")
              await new Promise((resolve) => setTimeout(resolve, 5500));
            return await db.readExposedBrowserSigningSnapshotForSigner(
              address,
              session,
              request
            );
          } finally {
            inFlightReads--;
          }
        },
      },
      parentOrigin
    );
    const binding = {
      backend: parentOrigin,
      owner: owner.address.toLowerCase(),
      sessionId,
      requestId,
      queryId,
      grantEpoch,
    };
    await popup.evaluate((value) => window.fixtureConfigure(value), binding);
    await popup.waitForFunction(() => window.fixtureConfigured);
    const send = async (data: unknown, ports = false) =>
      parent!.evaluate(
        ({ data, origin, ports }) => {
          if (ports) {
            const channel = new MessageChannel();
            (
              window as unknown as { signerPopup: Window }
            ).signerPopup.postMessage(data, origin, [channel.port2]);
            channel.port1.close();
          } else
            (
              window as unknown as { signerPopup: Window }
            ).signerPopup.postMessage(data, origin);
        },
        { data, origin: signerOrigin, ports }
      );
    const state = () =>
      JSON.stringify(
        native
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
          )
          .all()
          .map((row) => [
            row.name,
            native
              .prepare(
                'SELECT * FROM "' + String(row.name).replaceAll('"', '""') + '"'
              )
              .all(),
          ])
      );
    return {
      db,
      parent,
      popup,
      context,
      send,
      state,
      binding,
      signer,
      original: original.original,
      callbacks: () => callbacks,
      reads: () => reads,
      preflights: () => preflights,
      cachedHeader: () => retainedHeader,
      identicalDeliveredHeaders: () =>
        deliveredHeaders.length > 0 &&
        deliveredHeaders.every((header) => header === retainedHeader),
      async terminal() {
        await popup!.waitForFunction(
          () =>
            window.fixtureTelemetry?.attempted && !window.fixtureTelemetry.busy
        );
      },
      async cleanup() {
        await context.close();
        await close(parentServer);
        await close(signerServer);
        const deadline = Date.now() + 10000;
        while ((runningHandlers || inFlightReads) && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 10));
        native.close();
        db.close();
        fs.rmSync(folder, { recursive: true, force: true });
        expect(requestedOrigins.every((origin) => allowed.has(origin))).toBe(
          true
        );
        expect(runningHandlers).toBe(0);
        expect(inFlightReads).toBe(0);
      },
    };
  } catch (error) {
    await context.close();
    if (parentServer.listening) await close(parentServer);
    if (signerServer.listening) await close(signerServer);
    native.close();
    db.close();
    fs.rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

it("allowed malicious parent cannot extract or replace terms; actual cross-origin original signs once", async () => {
  const f = await fixture();
  try {
    const before = f.state();
    const invalid = [
      "export-key",
      "credential",
      "bundle",
      "signTypedData",
      "signTransaction",
      "restore",
      "configure",
    ];
    for (const command of invalid)
      await f.send({ version: "1", command, correlationId: command });
    for (const field of [
      "queryId",
      "payee",
      "value",
      "domain",
      "nonce",
      "sessionId",
      "requestId",
      "workerURL",
      "status",
    ])
      await f.send({
        version: "1",
        command: "sign-original",
        correlationId: field,
        [field]: "attacker",
      });
    await f.send(
      { version: "1", command: "sign-original", correlationId: "port" },
      true
    );
    await f.send({
      version: "1",
      command: "sign-original",
      correlationId: "x".repeat(65),
    });
    await f.parent.evaluate(() => {
      const popup = (window as unknown as { signerPopup: Window }).signerPopup;
      let denied = false;
      try {
        void popup.document.body;
      } catch {
        denied = true;
      }
      if (!denied) throw new Error("Origin boundary failed");
    });
    await f.popup.waitForFunction(() => window.fixtureRejected === 18);
    expect(f.callbacks()).toBe(0);
    expect(f.reads()).toBe(0);
    expect(f.state() === before).toBe(true);
    expect(
      await f.popup.evaluate(() => window.fixtureTelemetry!.paymentSignatures)
    ).toBe(0);
    await f.send({
      version: "1",
      command: "sign-original",
      correlationId: "valid",
    });
    await f.terminal();
    const counters = await f.popup.evaluate(() => window.fixtureTelemetry!);
    expect(counters.readSignatures).toBe(1);
    expect(counters.paymentSignatures).toBe(1);
    expect(counters.producedPaymentSignatures).toBe(1);
    expect(counters.callbackFetchStarts).toBe(1);
    expect(f.callbacks()).toBe(1);
    await f.parent.waitForFunction(() =>
      (window as unknown as { statuses: { status: string }[] }).statuses.some(
        (row) => row.status === "recorded"
      )
    );
    expect(f.preflights()).toBeGreaterThan(0);
    expect(
      (await f.db.getBrowserJournal(f.binding.sessionId, f.binding.requestId))
        ?.phase
    ).toBe("signed");
    const header = f.cachedHeader();
    expect(typeof header).toBe("string");
    if (!header) throw new Error("Fixture unavailable");
    await verifyBrowserSigningHeader(f.original, header);
    const signedState = f.state();
    expect(
      await f.db.signBrowserSigningOriginal(
        f.binding.sessionId,
        f.binding.requestId,
        header
      )
    ).toBe(true);
    expect(f.state() === signedState).toBe(true);
    for (const correlationId of ["valid", "different"])
      await f.send({ version: "1", command: "sign-original", correlationId });
    await f.popup.waitForFunction(() => window.fixtureRejected === 19);
    await f.parent.waitForFunction(
      () => (window as unknown as { statuses: unknown[] }).statuses.length >= 2
    );
    expect(
      (await f.popup.evaluate(() => window.fixtureTelemetry!)).paymentSignatures
    ).toBe(1);
    expect(f.callbacks()).toBe(1);
    const statuses = await f.parent.evaluate(
      () =>
        (window as unknown as { statuses: Record<string, unknown>[] }).statuses
    );
    expect(
      statuses.every(
        (row) =>
          Object.keys(row).sort().join(",") === "correlationId,status,version"
      )
    ).toBe(true);
  } finally {
    await f.cleanup();
  }
}, 30000);

it.each([
  "prepared",
  "cancelled",
  "revoked",
  "replaced",
  "offline",
  "late",
  "failed",
  "settled",
] as const)(
  "%s original/current authority refuses with zero payment crypto and callbacks",
  async (mode) => {
    const f = await fixture(mode);
    try {
      const before = f.state();
      if (mode === "failed" || mode === "settled") {
        const snapshot = await f.db.readExposedBrowserSigningSnapshotForSigner(
          f.signer,
          f.binding.sessionId,
          f.binding.requestId
        );
        expect(snapshot?.active).toBe(true);
        expect(snapshot?.currentGrant?.grantEpoch).toBe(f.binding.grantEpoch);
        expect(snapshot?.journal.phase).toBe(mode);
      }
      await f.send({
        version: "1",
        command: "sign-original",
        correlationId: "first",
      });
      await f.terminal();
      expect(
        (await f.popup.evaluate(() => window.fixtureTelemetry!))
          .paymentSignatures
      ).toBe(0);
      expect(f.callbacks()).toBe(0);
      expect(
        (await f.popup.evaluate(() => window.fixtureTelemetry!))
          .producedPaymentSignatures
      ).toBe(0);
      expect(
        (await f.popup.evaluate(() => window.fixtureTelemetry!))
          .callbackFetchStarts
      ).toBe(0);
      expect(f.state() === before).toBe(true);
    } finally {
      await f.cleanup();
    }
  },
  30000
);

it.each(["lost-ack", "truncated-ack", "late-ack"] as const)(
  "%s retains one economic original without application retry; transport may redeliver",
  async (mode) => {
    const f = await fixture(mode);
    try {
      await f.send({
        version: "1",
        command: "sign-original",
        correlationId: "first",
      });
      await f.terminal();
      await f.parent.waitForFunction(
        () =>
          (window as unknown as { statuses: { status: string }[] }).statuses
            .length > 0
      );
      expect(
        await f.parent.evaluate(
          () =>
            (window as unknown as { statuses: { status: string }[] })
              .statuses[0].status
        )
      ).toBe("uncertain");
      const before = f.state();
      const deliveries = f.callbacks();
      console.info("Synthetic ACK boundary", {
        mode,
        paymentCryptoCalls: 1,
        paymentCryptoReturns: 1,
        applicationFetchStarts: 1,
        nativeDeliveries: deliveries,
      });
      expect(deliveries).toBeGreaterThanOrEqual(1);
      expect(f.identicalDeliveredHeaders()).toBe(true);
      expect(
        (await f.popup.evaluate(() => window.fixtureTelemetry!))
          .producedPaymentSignatures
      ).toBe(1);
      expect(
        (await f.popup.evaluate(() => window.fixtureTelemetry!))
          .callbackFetchStarts
      ).toBe(1);
      expect(
        (await f.db.getBrowserJournal(f.binding.sessionId, f.binding.requestId))
          ?.phase
      ).toBe("signed");
      await f.send({
        version: "1",
        command: "sign-original",
        correlationId: "again",
      });
      await f.parent.waitForFunction(
        () =>
          (window as unknown as { statuses: unknown[] }).statuses.length >= 2
      );
      expect(
        (await f.popup.evaluate(() => window.fixtureTelemetry!))
          .paymentSignatures
      ).toBe(1);
      expect(
        (await f.popup.evaluate(() => window.fixtureTelemetry!))
          .callbackFetchStarts
      ).toBe(1);
      expect(f.callbacks()).toBe(deliveries);
      expect(f.state() === before).toBe(true);
    } finally {
      await f.cleanup();
    }
  },
  30000
);

it("different same-origin source, foreign source and forged status refuse against valid authority; restart never registers", async () => {
  const f = await fixture();
  try {
    const before = f.state();
    const siblingOpened = f.parent.waitForEvent("popup");
    await f.parent.evaluate(
      (url) => window.open(url, "sibling"),
      f.parent.url()
    );
    const sibling = await siblingOpened;
    await sibling.waitForLoadState();
    await sibling.evaluate((origin) => {
      window.opener.signerPopup.postMessage(
        {
          version: "1",
          command: "sign-original",
          correlationId: "wrong-source",
        },
        origin
      );
    }, f.popup.url().replace(/\/$/, ""));
    await f.popup.evaluate(() =>
      window.postMessage(
        { version: "1", command: "sign-original", correlationId: "foreign" },
        location.origin
      )
    );
    await f.send({ version: "1", correlationId: "fake", status: "recorded" });
    await f.popup.waitForFunction(() => window.fixtureRejected === 3);
    expect(f.callbacks()).toBe(0);
    expect(f.reads()).toBe(0);
    expect(
      await f.popup.evaluate(() => window.fixtureTelemetry!.paymentSignatures)
    ).toBe(0);
    expect(f.state() === before).toBe(true);
    await f.send({
      version: "1",
      command: "sign-original",
      correlationId: "baseline",
    });
    await f.terminal();
    expect(f.callbacks()).toBe(1);
    const signed = f.state();
    await f.popup.evaluate(() => window.fixtureRestart());
    await f.popup.waitForFunction(
      () => typeof window.fixtureAddress === "string"
    );
    expect(
      await f.popup.evaluate(() => window.fixtureAddress !== undefined)
    ).toBe(true);
    expect(
      await f.popup.evaluate(() =>
        window.fixtureAddress === undefined ? false : window.fixtureAddress
      )
    ).not.toBe(f.signer);
    await f.popup.evaluate(
      (binding) => window.fixtureConfigure(binding),
      f.binding
    );
    await f.popup.waitForFunction(() => window.fixtureConfigured);
    await f.send({
      version: "1",
      command: "sign-original",
      correlationId: "after-restart",
    });
    await f.terminal();
    expect(
      (await f.popup.evaluate(() => window.fixtureTelemetry!)).paymentSignatures
    ).toBe(0);
    expect(f.callbacks()).toBe(1);
    expect(f.state() === signed).toBe(true);
  } finally {
    await f.cleanup();
  }
}, 30000);
