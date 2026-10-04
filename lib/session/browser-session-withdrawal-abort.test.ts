import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { sessionWithdrawalFixture } from "../gateway/session-withdrawal-test-fixture";
import { createSessionWithdrawalAbort, sessionWithdrawalAbortMessage, verifySessionWithdrawalAbort } from "../gateway/session-withdrawal-abort";

it("binds a local abort to the complete original and original session holder", async () => {
  const p = await sessionWithdrawalFixture(), key = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const proof = await createSessionWithdrawalAbort(p, await key.signMessage({ message: sessionWithdrawalAbortMessage(p) }));
  expect(await verifySessionWithdrawalAbort(proof, p)).toEqual(proof);
  await expect(verifySessionWithdrawalAbort(proof, { ...p, height: { ...p.height, observedAt: "2020-01-01T00:00:00.000Z" } })).rejects.toThrow();
  await expect(verifySessionWithdrawalAbort({ ...proof, requestId: `0x${"77".repeat(32)}` }, p)).rejects.toThrow();
  await expect(createSessionWithdrawalAbort(p, await privateKeyToAccount(`0x${"33".repeat(32)}`).signMessage({ message: sessionWithdrawalAbortMessage(p) }))).rejects.toThrow();
});

it.each(["exposed", "cancelled_unexposed"] as const)("fences old publication and recovers lost ACK after %s, including an expired original", async initialPhase => {
  const p = await sessionWithdrawalFixture();
  const bundle = await build({ stdin: { contents: `
    import * as storage from './lib/session/browser-session-withdrawal-storage';
    import {createBrowserSessionWithdrawalRuntime as runtime} from './lib/session/browser-session-withdrawal-runtime';
    import {browserSessionCustodyContext as context} from './lib/session/browser-session-custody';
    import {ARC_MAINNET_PROFILE as profile} from './lib/arc-network-profile';
    import {privateKeyToAccount} from 'viem/accounts';
    import {sessionWithdrawalAbortMessage,createSessionWithdrawalAbort} from './lib/gateway/session-withdrawal-abort';
    Object.assign(window,{storage,runtime,context,profile,privateKeyToAccount,sessionWithdrawalAbortMessage,createSessionWithdrawalAbort});
  `, resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "esm",
    define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"', "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined",
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS": '"300"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route("https://keryx.cc/**", route => route.fulfill(route.request().url().endsWith("/bundle.js")
      ? { contentType: "text/javascript", body: bundle.outputFiles[0].text }
      : { contentType: "text/html", body: '<script type="module" src="/bundle.js"></script>' }));
    const first = await context.newPage(), old = await context.newPage();
    const pageErrors: string[] = [];
    first.on("pageerror", error => pageErrors.push(error.message));
    await Promise.all([first.goto("https://keryx.cc"), old.goto("https://keryx.cc")]);
    expect(pageErrors).toEqual([]);
    const result = await first.evaluate(async ({ preparation, initialPhase }) => {
      const w = window as unknown as {
        storage: typeof import("./browser-session-withdrawal-storage"); runtime: typeof import("./browser-session-withdrawal-runtime").createBrowserSessionWithdrawalRuntime;
        context: typeof import("./browser-session-custody").browserSessionCustodyContext; profile: typeof import("../arc-network-profile").ARC_MAINNET_PROFILE;
        privateKeyToAccount: typeof import("viem/accounts").privateKeyToAccount;
        sessionWithdrawalAbortMessage: typeof import("../gateway/session-withdrawal-abort").sessionWithdrawalAbortMessage;
        createSessionWithdrawalAbort: typeof import("../gateway/session-withdrawal-abort").createSessionWithdrawalAbort;
      };
      const ownerContext = w.context(w.profile, location.origin, preparation.ownerAddr), ns = ownerContext.storageNamespace;
      const storage = w.storage, signer = w.privateKeyToAccount(`0x${"22".repeat(32)}`);
      await storage.reserveBrowserSessionWithdrawal(ns, preparation, "0");
      await storage.retainBrowserSessionWithdrawalOutcome(ns, preparation, { exposed: true });
      let ack: unknown, failAck = true, posts = 0, chainCalls = 0;
      const response = () => ({ preparation, signingPhase: ack ? "aborted_before_publication" : initialPhase, ...(ack ? { publicationAbort: ack } : {}),
        cancellation: !ack && initialPhase === "cancelled_unexposed" ? {format:"keryx-session-withdrawal-cancellation-v1",network:preparation.network,
          requestId:preparation.requestId,ownerAddr:preparation.ownerAddr,sessAddr:preparation.sessAddr,reason:"cancelled-unexposed"} : null,
        progress: { status: ack ? "aborted-before-publication" : "prepared", retryAuthorized: false, chainFinalityVerified: false },
        attestation: null, mint: null, completion: null });
      const runtime = w.runtime({ context: ownerContext, address: preparation.sessAddr as `0x${string}`,
        async signWithdrawalPreparation() { throw new Error("Unexpected burn"); },
        async signWithdrawalAbort(value) { return signer.signMessage({ message: w.sessionWithdrawalAbortMessage(value as typeof preparation) }); },
      }, { async json(path, method, body) {
        if (!(await storage.readBrowserSessionWithdrawal(ns, preparation.requestId))?.publicationAbort) throw new Error("HTTP preceded publication fence");
        if (method === "POST") {
          if (path !== "/api/session/withdraw/abort") throw new Error("Unexpected write");
          posts++;
          ack = await w.createSessionWithdrawalAbort(preparation, (body as {signature:string}).signature);
          if (failAck) { failAck = false; throw new Error("Synthetic lost ACK"); }
        }
        return response();
      }, async chain() { chainCalls++; throw new Error("Expired original"); } });
      let lostAck = false; try { await runtime.abortWithdrawal(preparation.requestId); } catch { lostAck = true; }
      const retained = await storage.readBrowserSessionWithdrawal(ns, preparation.requestId);
      Object.assign(window, { abortTestRuntime: runtime });
      return { ns, lostAck, posts, chainCalls, pending: retained?.publicationAbort?.pending,
        legacyCancelled: retained?.cancelled, barrier: (await storage.readBrowserSessionExposure(ns)).withdrawal };
    }, { preparation: p, initialPhase });
    expect(result).toMatchObject({ lostAck: true, posts: 1, chainCalls: 0, pending: true, legacyCancelled: true, barrier: p.requestId });
    // The old implementation's exact pre-existing cancelled/completion guards are
    // enough: pending crypto cannot store or return its result after the tombstone.
    const refused = await old.evaluate(async ({ ns, preparation }) => {
      const storage = (window as unknown as {storage:typeof import("./browser-session-withdrawal-storage")}).storage;
      try { await storage.retainBrowserSessionWithdrawalOutcome(ns, preparation, { signature: `0x${"11".repeat(65)}` }); return false; }
      catch { return true; }
    }, { ns: result.ns, preparation: p });
    expect(refused).toBe(true);
    const done = await first.evaluate(async ({ ns, id }) => {
      const w = window as unknown as {storage:typeof import("./browser-session-withdrawal-storage"); abortTestRuntime:ReturnType<typeof import("./browser-session-withdrawal-runtime").createBrowserSessionWithdrawalRuntime>};
      const result = await w.abortTestRuntime.abortWithdrawal(id);
      const row = await w.storage.readBrowserSessionWithdrawal(ns, id);
      return { result, pending: row?.publicationAbort?.pending, exposed: row?.exposed, signature: row?.signature ?? null,
        barrier: (await w.storage.readBrowserSessionExposure(ns)).withdrawal };
    }, { ns: result.ns, id: p.requestId });
    expect(done).toEqual({ result: {requestId:p.requestId, abortedBeforePublication:true}, pending:false, exposed:true, signature:null, barrier:null });
    await context.close();
  } finally { await browser.close(); }
}, 30000);
