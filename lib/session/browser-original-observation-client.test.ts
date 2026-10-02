import { expect, it } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import path from "node:path";
import { observationFixture } from "../payments/browser-original-observation.test-fixture";
import { createSyntheticOriginalObservationServer } from "../payments/browser-original-observation-server";
import { createSyntheticOriginalObservationClient } from "./browser-original-observation-client";
import { OBSERVATION_PATH } from "../payments/browser-original-observation-protocol";
async function serve(
  f: Awaited<ReturnType<typeof observationFixture>>,
  override?: (req: IncomingMessage, res: ServerResponse) => boolean
) {
  let handler: ReturnType<typeof createSyntheticOriginalObservationServer>,
    origin = "",
    reads = 0;
  const server = createServer((req, res) => {
    if (override?.(req, res)) return;
    void (async () => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (typeof value === "string") headers.set(key, value);
      const response = await handler(
        new Request(origin + req.url, { method: req.method, headers })
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    })().catch(() => {
      res.writeHead(503);
      res.end('{"error":"fixture_unavailable"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  handler = createSyntheticOriginalObservationServer(
    {
      async readExposedBrowserSigningSnapshotForSigner(...args) {
        reads++;
        return f.db.readExposedBrowserSigningSnapshotForSigner(...args);
      },
    },
    origin
  );
  return {
    origin,
    reads: () => reads,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
it("uses actual native HTTP and captured locator to read without writes or credential issuance", async () => {
  const f = await observationFixture(),
    http = await serve(f);
  try {
    const before = f.state(),
      input = { sessionId: f.sessionId, requestId: f.requestId },
      client = createSyntheticOriginalObservationClient(f.signer, http.origin),
      pending = client.observe(input);
    input.requestId = "different";
    const result = await pending;
    expect(result !== null).toBe(true);
    expect(result?.state.journal.requestId === f.requestId).toBe(true);
    expect(Object.keys(client)).toEqual(["observe"]);
    expect(http.reads()).toBe(1);
    expect(f.state() === before).toBe(true);
  } finally {
    await http.close();
    f.close();
  }
});
it("rejects native redirects, streamed oversized clock bodies and mismatched challenge before any backend read", async () => {
  const f = await observationFixture();
  try {
    for (const kind of ["redirect", "oversized", "challenge"]) {
      const http = await serve(f, (req, res) => {
        if (!req.url?.includes("/clock")) return false;
        if (kind === "redirect") {
          res.writeHead(302, { Location: "http://127.0.0.1:1/foreign" });
          res.end();
        } else if (kind === "oversized") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.write(" ".repeat(1025));
          res.end("{}");
        } else {
          const utc = Date.now();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              version: "1",
              challenge: `0x${"00".repeat(32)}`,
              serverTimeMs: utc,
              expiresAtMs: utc + 5000,
            })
          );
        }
        return true;
      });
      try {
        expect(
          await createSyntheticOriginalObservationClient(
            f.signer,
            http.origin
          ).observe({ sessionId: f.sessionId, requestId: f.requestId })
        ).toBe(null);
        expect(http.reads()).toBe(0);
      } finally {
        await http.close();
      }
    }
  } finally {
    f.close();
  }
});
it("rejects chunked oversized observation and stale response binding", async () => {
  const f = await observationFixture();
  try {
    for (const kind of ["oversized", "binding"]) {
      const http = await serve(f, (req, res) => {
        if (req.url !== OBSERVATION_PATH) return false;
        res.writeHead(200, { "Content-Type": "application/json" });
        if (kind === "oversized") {
          res.write(" ".repeat(16385));
          res.end("{}");
        } else
          res.end(
            JSON.stringify({
              version: "1",
              readOnly: true,
              challenge: `0x${"00".repeat(32)}`,
            })
          );
        return true;
      });
      try {
        expect(
          await createSyntheticOriginalObservationClient(
            f.signer,
            http.origin
          ).observe({ sessionId: f.sessionId, requestId: f.requestId })
        ).toBe(null);
      } finally {
        await http.close();
      }
    }
  } finally {
    f.close();
  }
});
it("total timeout includes delayed actual proof generation and keeps the client busy until underlying completion", async () => {
  const f = await observationFixture(),
    http = await serve(f);
  let release: (() => void) | undefined;
  try {
    const account: typeof f.signer = {
        ...f.signer,
        async signTypedData(parameters) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return f.signer.signTypedData(parameters);
        },
      },
      client = createSyntheticOriginalObservationClient(
        account,
        http.origin,
        100
      );
    expect(
      await client.observe({ sessionId: f.sessionId, requestId: f.requestId })
    ).toBe(null);
    expect(release !== undefined).toBe(true);
    expect(
      await client.observe({ sessionId: f.sessionId, requestId: f.requestId })
    ).toBe(null);
    expect(http.reads()).toBe(0);
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(http.reads()).toBe(0);
  } finally {
    release?.();
    await http.close();
    f.close();
  }
});
it("actual Chromium accepts stable UTC offsets and refuses injected elapsed jumps/sleep models", async () => {
  const f = await observationFixture();
  const bundle = await build({
    stdin: {
      contents: `import{privateKeyToAccount}from'viem/accounts';import{createSyntheticOriginalObservationClient}from'./browser-original-observation-client';window.observe=async(key,origin,locator)=>{const result=await createSyntheticOriginalObservationClient(privateKeyToAccount(key),origin).observe(locator);return result!==null&&result.readOnly===true;};`,
      resolveDir: path.resolve("lib/session"),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    logLevel: "silent",
  });
  let handler: ReturnType<typeof createSyntheticOriginalObservationServer>;
  let origin = "",
    delay = 0,
    clockSuccess = 0,
    originalReads = 0;
  const server = createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<script>${bundle.outputFiles[0].text}</script>`);
      return;
    }
    void (async () => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (typeof value === "string") headers.set(key, value);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const response = await handler(
        new Request(origin + req.url, { headers })
      );
      if (req.url?.includes("/clock") && response.status === 200)
        clockSuccess++;
      if (req.url === OBSERVATION_PATH) originalReads++;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    })().catch(() => {
      res.writeHead(503);
      res.end();
    });
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  handler = createSyntheticOriginalObservationServer(f.db, origin);
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-background-networking", "--disable-component-update"],
    });
    const before = f.state();
    for (const mode of ["past", "future", "forward", "backward", "sleep"]) {
      delay = ["forward", "backward", "sleep"].includes(mode) ? 600 : 0;
      const context = await browser.newContext({ serviceWorkers: "block" });
      try {
        await context.route("**/*", (r) =>
          new URL(r.request().url()).origin === origin
            ? r.continue()
            : r.abort()
        );
        await context.addInitScript((mode) => {
          const original = Date.now.bind(Date),
            baseline =
              mode === "past" ? -86400000 : mode === "future" ? 86400000 : 0;
          let jump = 0;
          Date.now = () => original() + baseline + jump;
          if (mode === "sleep") {
            const captured = performance.now();
            Object.defineProperty(performance, "now", {
              value: () => captured,
            });
          }
          (window as unknown as { beginClockJump: () => void }).beginClockJump =
            () => {
              if (mode === "forward" || mode === "backward")
                setTimeout(() => {
                  jump = mode === "forward" ? 86400000 : -86400000;
                }, 100);
            };
        }, mode);
        const page = await context.newPage();
        await page.goto(origin);
        const pass = await page.evaluate(
          async (args) => {
            const fixture = window as unknown as {
              beginClockJump: () => void;
              observe: (
                key: string,
                origin: string,
                locator: { sessionId: string; requestId: string }
              ) => Promise<boolean>;
            };
            fixture.beginClockJump();
            return fixture.observe(args.key, args.origin, args.locator);
          },
          {
            key: f.key,
            origin,
            locator: { sessionId: f.sessionId, requestId: f.requestId },
          }
        );
        expect(pass).toBe(mode === "past" || mode === "future");
      } finally {
        await context.close();
      }
    }
    expect(clockSuccess).toBe(5);
    expect(originalReads).toBe(2);
    expect(f.state() === before).toBe(true);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.close();
  }
}, 30000);
