import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { SiweMessage } from "siwe";
import { expect, it } from "vitest";

/** Actual hook, React and serializer chunks; synthetic accounts/HTTP, no wallet signing or funds. */
it("keeps SIWE out of the initial hook bundle and handles deferred chunk delivery in Chromium", async () => {
  const temporaryRoot = path.resolve(process.env.KERYX_TEST_TMP_ROOT ?? ".local/tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryRoot, "siwe-browser-"));
  const outputDirectory = path.join(temporary, "assets");
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "jsx", contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import{useSiweAuth}from'./lib/hooks/use-siwe-auth';
      import{CIRCLE_GOOGLE_CONNECTOR_ID}from'./lib/circle-wallet-config';
      window.fixture={account:{address:'0x'+'11'.repeat(20),isConnected:true,connector:{id:'injected'}},signed:[],view:{},googleId:CIRCLE_GOOGLE_CONNECTOR_ID};
      function Probe(){const auth=useSiweAuth();window.fixture.view={state:auth.authState,session:auth.session};
        window.fixture.start=()=>auth.signIn().then(result=>{window.fixture.result=result}).catch(error=>{window.fixture.error=error.message});
        window.fixture.logout=()=>auth.signOut();return <button onClick={()=>window.fixture.start()}>Sign in</button>}
      const root=createRoot(document.getElementById('root'));window.fixture.unmount=()=>root.unmount();root.render(<Probe/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "esm", splitting: true, minify: true,
    outdir: outputDirectory, entryNames: "entry", metafile: true,
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"', "process.env": "{}" },
    plugins: [{ name: "synthetic-wallet-only", setup(plugin) {
      plugin.onResolve({ filter: /^wagmi$/ }, () => ({ path: "wagmi", namespace: "fixture" }));
      plugin.onResolve({ filter: /circle-wallet-browser$/ }, () => ({ path: "circle", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ resolveDir: process.cwd(), contents: args.path === "circle"
        ? "export const circleWalletIdentity=()=>null;export function clearCircleWalletIdentity(){}"
        : `import{useSyncExternalStore}from'react';const subscribe=callback=>{window.addEventListener('fixture-wallet',callback);return()=>window.removeEventListener('fixture-wallet',callback)};
          export function useAccount(){return useSyncExternalStore(subscribe,()=>window.fixture.account,()=>window.fixture.account)}
          export function useSignMessage(){return{signMessageAsync:async({message})=>{window.fixture.signed.push(message);return'fixture-signature'}}}` }));
    } }],
  });
  const entries = Object.entries(bundle.metafile.outputs);
  const entry = entries.find(([, metadata]) => metadata.entryPoint === "<stdin>")!;
  const serializer = entries.find(([, metadata]) => metadata.entryPoint?.endsWith("lib/auth/browser-sign-in-message.ts"))!;
  expect(entry).toBeDefined(); expect(serializer).toBeDefined();
  const eager = new Set<string>();
  const visit = (name: string) => {
    if (eager.has(name)) return;
    eager.add(name);
    for (const dependency of bundle.metafile.outputs[name].imports) {
      if (dependency.kind !== "dynamic-import" && !dependency.external) visit(dependency.path);
    }
  };
  visit(entry[0]);
  const eagerInputs = [...eager].flatMap(name => Object.keys(bundle.metafile.outputs[name].inputs));
  expect(eagerInputs.some(name => /node_modules[/\\](siwe|ethers)[/\\]/.test(name))).toBe(false);
  const assets = new Map(bundle.outputFiles.map(file => [`/assets/${path.basename(file.path)}`, file.text]));
  const entryUrl = `/assets/${path.basename(entry[0])}`;
  const serializerUrl = `/assets/${path.basename(serializer[0])}`;
  const browser = await chromium.launchPersistentContext(path.join(temporary, "profile"), { headless: true });
  browser.setDefaultTimeout(3000); browser.setDefaultNavigationTimeout(3000);
  try {
    for (const scenario of ["success", "load-failure", "wallet-change", "logout", "unmount", "google"]) {
      const page = await browser.newPage();
      const browserErrors: string[] = [];
      page.on("pageerror", error => browserErrors.push(error.message));
      const requests: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let session: { address: string; role: string } | null = null;
      let failSerializer = scenario === "load-failure";
      const wallet = `0x${"11".repeat(20)}`;
      await page.route("**/*", async route => {
        const url = new URL(route.request().url()); requests.push(url.pathname);
        if (url.pathname === "/") {
          return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script type="module" src="${entryUrl}"></script>` });
        }
        if (url.pathname === serializerUrl) {
          await gate;
          if (failSerializer) return route.fulfill({ status: 503, body: "fixture unavailable" });
        }
        if (assets.has(url.pathname)) return route.fulfill({ contentType: "text/javascript", body: assets.get(url.pathname)! });
        if (url.pathname === "/api/auth/session") return route.fulfill({ json: { session } });
        if (url.pathname === "/api/auth/nonce") return route.fulfill({ json: { nonce: "0123456789abcdef",
          issuedAt: "2026-10-28T00:00:00.000Z", challengeExpiresAt: "2026-10-28T00:05:00.000Z",
          sessionExpiresAt: "2026-11-04T00:00:00.000Z" } });
        if (url.pathname === "/api/auth/verify") {
          const body = route.request().postDataJSON() as { message: string; signature: string };
          const parsed = new SiweMessage(body.message);
          expect(parsed.domain).toBe("keryx-auth-fixture.invalid"); expect(parsed.uri).toBe("https://keryx-auth-fixture.invalid");
          expect(parsed.address).toBe(wallet); expect(parsed.chainId).toBe(5042); expect(parsed.nonce).toBe("0123456789abcdef");
          expect(body.signature).toBe("fixture-signature"); session = { address: wallet, role: "asker" };
          return route.fulfill({ json: { ok: true, ...session } });
        }
        if (url.pathname === "/api/auth/signout") { session = null; return route.fulfill({ json: { ok: true } }); }
        throw new Error(`Unexpected fixture IO: ${url.href}`);
      });
      await page.goto("https://keryx-auth-fixture.invalid/");
      await page.waitForFunction("window.fixture?.view.session === null").catch(error => {
        throw new Error(`${scenario}: ${browserErrors.join("; ")} ${String(error)}`);
      });
      expect(requests).not.toContain(serializerUrl); expect(requests).not.toContain("/api/auth/nonce");
      if (scenario === "google") {
        session = { address: wallet, role: "asker" };
        await page.evaluate("window.fixture.account={...window.fixture.account,connector:{id:window.fixture.googleId}};window.dispatchEvent(new Event('fixture-wallet'))");
      }
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      if (scenario === "google") {
        await page.waitForFunction("window.fixture.result?.ok === true");
        expect(requests).not.toContain(serializerUrl); expect(requests).not.toContain("/api/auth/nonce");
      } else {
        await page.waitForFunction("window.fixture.view.state === 'signing'");
        await expect.poll(() => requests.includes(serializerUrl), { timeout: 5000 }).toBe(true);
        expect(requests).not.toContain("/api/auth/nonce");
        if (scenario === "wallet-change") {
          await page.evaluate("window.fixture.account={...window.fixture.account,address:'0x'+'22'.repeat(20)};window.dispatchEvent(new Event('fixture-wallet'))");
        } else if (scenario === "logout") {
          await page.evaluate("window.fixture.logout()");
        } else if (scenario === "unmount") {
          await page.evaluate("window.fixture.unmount()");
        }
        release();
        await page.waitForFunction("window.fixture.result !== undefined || window.fixture.error !== undefined");
        const result = await page.evaluate<{ result?: { ok: boolean }; error?: string; signed: string[] }>("({result:window.fixture.result,error:window.fixture.error,signed:window.fixture.signed})");
        if (scenario === "success") {
          expect(result.result?.ok).toBe(true); expect(result.signed).toHaveLength(1); expect(requests).toContain("/api/auth/verify");
        } else {
          if (scenario === "load-failure") expect(result.error).toBe("Sign-in is unavailable. Refresh the page and try again.");
          else expect(result.result?.ok).toBe(false);
          expect(result.signed).toHaveLength(0); expect(requests).not.toContain("/api/auth/nonce"); expect(requests).not.toContain("/api/auth/verify");
          if (scenario === "load-failure") {
            failSerializer = false;
            await page.reload(); await page.waitForFunction("window.fixture?.view.session === null");
            await page.getByRole("button", { name: "Sign in", exact: true }).click();
            await page.waitForFunction("window.fixture.result?.ok === true");
          }
        }
      }
      expect(browserErrors).toEqual([]);
      release(); await page.close();
    }
  } finally { await browser.close(); }
});
