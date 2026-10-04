import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";

it("recovers exact failed capacity once across tabs and epochs while retaining nonces and question limits", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {reserveBrowserSessionAuthorization as reserve} from './lib/session/browser-session-capacity';
    import * as storage from './lib/session/browser-session-withdrawal-storage';
    import {readBrowserSessionPaymentAccounting as inspect} from './lib/session/browser-session-withdrawal-liabilities';
    import {releaseBrowserSessionFailedAuthorizations as release} from './lib/session/browser-session-failure-recovery';
    import {ARC_MAINNET_PROFILE as profile} from './lib/arc-network-profile';
    Object.assign(window,{reserve,storage,inspect,release,profile});
  ` }, bundle: true, write: false, platform: "browser", format: "iife", define: {
    "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x1111111111111111111111111111111111111111"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": '"0x1111111111111111111111111111111111111111"',
    "process.env.NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS": '"300"',
  } });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route("**/*", route => route.request().url() === "https://keryx.cc/"
      ? route.fulfill({ contentType: "text/html", body: `<script>${bundle.outputFiles[0].text}</script>` }) : route.abort());
    const first = await context.newPage(), second = await context.newPage();
    const errors: string[] = [];
    first.on("pageerror", error => errors.push(error.message));
    await Promise.all([first.goto("https://keryx.cc/"), second.goto("https://keryx.cc/")]);
    expect(errors).toEqual([]);
    const fixture = await first.evaluate(async () => {
      const { reserve, storage, inspect, profile } = window as unknown as {
        reserve: typeof import("./browser-session-capacity").reserveBrowserSessionAuthorization;
        storage: typeof import("./browser-session-withdrawal-storage");
        inspect: typeof import("./browser-session-withdrawal-liabilities").readBrowserSessionPaymentAccounting;
        profile: typeof import("../arc-network-profile").ARC_MAINNET_PROFILE;
      };
      const owner = `0x${"11".repeat(20)}`, signer = `0x${"22".repeat(20)}`, payTo = `0x${"ab".repeat(20)}`;
      const epoch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reqId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", nonce = `0x${"44".repeat(32)}`;
      const requirements = { scheme: "exact" as const, network: profile.networkId, amount: "500000", payTo,
        asset: profile.usdcAddress.toLowerCase(), maxTimeoutSeconds: 691200,
        extra: { name: "GatewayWalletBatched" as const, version: "1" as const, verifyingContract: profile.gatewayWallet.toLowerCase() } };
      const original = { sessionId: owner, sessAddr: signer, reqId, grantEpoch: epoch, sourceId: "source", kind: "citation" as const,
        expectedNonce: nonce, browserAuthorizationProtocol: "durable-v1" as const, requirements };
      await reserve("failure-recovery", epoch, nonce, BigInt(500000), BigInt(1000000), { id: reqId, budgetMicroUsdc: "500000" }, original);
      const snapshot = await storage.readBrowserSessionExposure("failure-recovery");
      const journal = { nonce, sessionId: owner, signer, requestId: reqId, grantEpoch: epoch, phase: "failed", requirements,
        signedHeaderHash: "55".repeat(32), payment: { authorizationId: nonce, payer: signer, payee: payTo, network: profile.networkId,
          sourceId: "source", kind: "citation", amountUsdc: 0.5, settled: false, settlementStatus: "failed", txHash: "circle-original" } };
      const result = await inspect(snapshot.authorizations, owner, signer, epoch, async () => ({ network: profile.networkId,
        sessAddr: signer, retryAuthorized: false, payments: [journal], nextCursor: null }));
      return { failures: result.failures, epoch, nonce, question: reqId };
    });
    const amounts = await Promise.all([first, second].map(page => page.evaluate(failures =>
      (window as unknown as { release: typeof import("./browser-session-failure-recovery").releaseBrowserSessionFailedAuthorizations })
        .release("failure-recovery", failures), fixture.failures)));
    expect(amounts.sort()).toEqual([0, 1]);
    const result = await first.evaluate(async f => {
      const { reserve, storage, release } = window as unknown as {
        reserve: typeof import("./browser-session-capacity").reserveBrowserSessionAuthorization;
        storage: typeof import("./browser-session-withdrawal-storage");
        release: typeof import("./browser-session-failure-recovery").releaseBrowserSessionFailedAuthorizations;
      };
      const message = async (operation: () => Promise<unknown>) => { try { await operation(); return "admitted"; } catch { return "refused"; } };
      const renewedEpoch = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const reused = await message(() => reserve("failure-recovery", renewedEpoch, f.nonce, BigInt(1), BigInt(1000000)));
      const oldQuestion = await message(() => reserve("failure-recovery", f.epoch, `0x${"66".repeat(32)}`, BigInt(1), BigInt(1000000),
        { id: f.question, budgetMicroUsdc: "500000" }));
      await reserve("failure-recovery", renewedEpoch, `0x${"77".repeat(32)}`, BigInt(750000), BigInt(1000000));
      const repeated = await release("failure-recovery", f.failures);
      const overCap = await message(() => reserve("failure-recovery", renewedEpoch, `0x${"88".repeat(32)}`, BigInt(250001), BigInt(1000000)));
      const altered = await message(() => release("failure-recovery", [{ ...f.failures[0], evidenceDigest: "99".repeat(32) }]));
      const snapshot = await storage.readBrowserSessionExposure("failure-recovery");
      return { reused, oldQuestion, repeated, overCap, altered, retained: snapshot.authorizations.length };
    }, fixture);
    expect(result).toEqual({ reused: "refused", oldQuestion: "refused", repeated: 0, overCap: "refused", altered: "refused", retained: 2 });
  } finally { await browser.close(); }
});
