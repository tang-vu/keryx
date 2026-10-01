import { expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  prepareBrowserJournal,
  type BrowserJournalAdmission,
} from "../db/browser-authorization-journal";
import {
  prepareBrowserSigningOriginal,
  browserSigningTypedData,
  serializeBrowserSigningHeader,
  verifyBrowserSigningHeader,
} from "./browser-signing-original";
import { validateSessionPayment } from "../session/session-signing-policy";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import path from "node:path";
const account = privateKeyToAccount(generatePrivateKey()),
  payee = "0x2222222222222222222222222222222222222222";
function original(timeout = 691200) {
  const epoch = crypto.randomUUID(),
    query = crypto.randomUUID();
  const input: BrowserJournalAdmission = {
    sessionId: account.address.toLowerCase(),
    requestId: crypto.randomUUID(),
    queryId: query,
    grantEpoch: epoch,
    signer: account.address,
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
      maxTimeoutSeconds: timeout,
      extra: {
        name: "GatewayWalletBatched",
        version: "1",
        verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
      },
    },
    payment: {
      kind: "fetch",
      queryId: query,
      sourceId: "source",
      sourceName: "Source",
      payer: account.address,
      payee,
      amountUsdc: 0.000001,
      network: "eip155:5042002",
      grantEpoch: epoch,
    },
  };
  return prepareBrowserSigningOriginal(
    prepareBrowserJournal(input),
    `0x${"11".repeat(32)}`
  );
}
it("freezes the original UTC window without adding callback slack", () => {
  const o = original(),
    seconds = Math.floor(Date.parse(o.admittedAt) / 1000);
  expect(o.authorization.validAfter).toBe(String(seconds - 600));
  expect(o.authorization.validBefore).toBe(String(seconds + 691200));
});
it("verifies the canonical actual ECDSA header and refuses recipient/window mutation", async () => {
  const o = original(),
    sig = await account.signTypedData(browserSigningTypedData(o)),
    header = serializeBrowserSigningHeader(o, sig);
  const metadata = await verifyBrowserSigningHeader(o, header);
  expect(metadata.headerHash).toMatch(/^[0-9a-f]{64}$/);
  await expect(
    verifyBrowserSigningHeader(
      {
        ...o,
        authorization: {
          ...o.authorization,
          to: account.address.toLowerCase(),
        },
      },
      header
    )
  ).rejects.toThrow();
  await expect(
    verifyBrowserSigningHeader(
      {
        ...o,
        authorization: {
          ...o.authorization,
          validBefore: String(BigInt(o.authorization.validBefore) + BigInt(1)),
        },
      },
      header
    )
  ).rejects.toThrow();
});
it("refuses noncanonical JSON even when the underlying signed authorization is valid", async () => {
  const o = original(),
    sig = await account.signTypedData(browserSigningTypedData(o));
  const noncanonical = btoa(
    JSON.stringify({ signature: sig, authorization: o.authorization }, null, 2)
  );
  await expect(verifyBrowserSigningHeader(o, noncanonical)).rejects.toThrow();
});
it("keeps SDK seven-day minimum and refuses delayed short-headroom signing", () => {
  const o = original(604900),
    seconds = Math.floor(Date.parse(o.admittedAt) / 1000);
  expect(() =>
    validateSessionPayment(
      browserSigningTypedData(o),
      account.address,
      seconds + 101
    )
  ).toThrow(/lifetime/);
  expect(o.authorization.validBefore).toBe(String(seconds + 604900));
});
it("produces byte-identical full headers with actual installed viem across fresh Chromium contexts", async () => {
  const key = generatePrivateKey(),
    a = privateKeyToAccount(key),
    o = original();
  o.authorization.from = a.address.toLowerCase();
  const bundle = await build({
    stdin: {
      contents: `import {privateKeyToAccount} from 'viem/accounts';import {browserSigningTypedData,serializeBrowserSigningHeader} from './browser-signing-original';export async function sign(key,original){return serializeBrowserSigningHeader(original,await privateKeyToAccount(key).signTypedData(browserSigningTypedData(original)));}`,
      resolveDir: path.resolve("lib/payments"),
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "Fixture",
    platform: "browser",
    logLevel: "silent",
  });
  const server = createServer((_, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<script>${bundle.outputFiles[0].text}</script>`);
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture unavailable");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-background-networking", "--disable-component-update"],
    });
    const headers: string[] = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      try {
        await context.route("**/*", (r) =>
          new URL(r.request().url()).origin === origin
            ? r.continue()
            : r.abort()
        );
        const page = await context.newPage();
        await page.goto(origin);
        headers.push(
          await page.evaluate(
            async ({ key, original }) => {
              const fixture = window as unknown as {
                Fixture: {
                  sign: (key: string, o: typeof original) => Promise<string>;
                };
              };
              return fixture.Fixture.sign(key, original);
            },
            { key, original: o }
          )
        );
      } finally {
        await context.close();
      }
    }
    expect(headers[0] === headers[1]).toBe(true);
    await verifyBrowserSigningHeader(o, headers[0]);
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }
}, 30000);

it("captures the original before asynchronous signature recovery", async () => {
  const o = original(),
    sig = await account.signTypedData(browserSigningTypedData(o)),
    header = serializeBrowserSigningHeader(o, sig);
  const expected = o.authorization.validBefore,
    pending = verifyBrowserSigningHeader(o, header);
  o.authorization.validBefore = String(BigInt(expected) + BigInt(1));
  expect((await pending).validBefore).toBe(expected);
});
