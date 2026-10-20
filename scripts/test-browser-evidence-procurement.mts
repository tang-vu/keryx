/** Synthetic signed quotations and supplied text only. All HTTP is blocked except the fixture document. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, readFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";
import { privateKeyToAccount } from "viem/accounts";
import { buildEvidenceProcurement, procurementRequestHash, procurementOfferHash, procurementBodyHash, procurementOfferMessage, procurementDeliveryMessage } from "../lib/evidence-procurement/engine";
import { MAX_PROCUREMENT_BYTES, parseEvidenceProcurement, type EvidenceProcurementPacket, type ProcurementOffer, type ProcurementDelivery } from "../lib/evidence-procurement/contracts";
import { exportEvidenceProcurement } from "../lib/evidence-procurement/export";

// Known test key stays in the Node fixture. Only signatures and the public address reach the browser.
const account = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
const source = resolve(import.meta.dirname, ".."), dist = resolve(source, process.env.NEXT_DIST_DIR ?? ".next");
await readFile(join(dist, "BUILD_ID"), "utf8"); // The real production route is a required gate.
const request: EvidenceProcurementPacket["request"] = {
  id: "synthetic-request", network: "eip155:5042002", decision: "SYNTHETIC: Can example API A meet our region requirement?",
  budgetMicroUsdc: "50000", expiresAt: "2030-01-02T12:00:00.000Z",
  requirements: [{ id: "requirement1", question: "SYNTHETIC: Does the example API support region Z?", priority: 10, status: "missing" }],
};
const offer: ProcurementOffer = { id: "offer1", requestHash: procurementRequestHash(request), providerWallet: account.address,
  sourceUrl: "https://synthetic.example/report", deliverable: "SYNTHETIC: Region availability report", priceMicroUsdc: "30000",
  requirementIds: ["requirement1"], expiresAt: "2030-01-02T11:00:00.000Z", nonce: "synthetic-offer1" };
offer.signature = await account.signMessage({ message: procurementOfferMessage(request, offer) });
const expensive: ProcurementOffer = { ...offer, id: "expensive", priceMicroUsdc: "40000", nonce: "synthetic-expensive", deliverable: "SYNTHETIC: Additional region evidence" };
expensive.signature = await account.signMessage({ message: procurementOfferMessage(request, expensive) });
const body = 'SYNTHETIC: Example API A does not support region Z. Literal <script>not executed</script>.';
const delivery: ProcurementDelivery = { offerId: offer.id, offerHash: procurementOfferHash(offer), body, bodyHash: procurementBodyHash(body),
  excerpts: [{ requirementId: "requirement1", start: 0, end: body.length, stance: "refutes" }] };
delivery.signature = await account.signMessage({ message: procurementDeliveryMessage(request, offer, delivery) });
const expiryPacket: EvidenceProcurementPacket = { version: 1, scope: "private-evidence-procurement", request, offers: [offer], selectedOfferIds: [], deliveries: [], reviews: [] };
const boundaryPacket: EvidenceProcurementPacket = { ...expiryPacket, offers: [offer, expensive], deliveries: [offer, expensive].map(row => ({
  offerId: row.id, offerHash: procurementOfferHash(row), body: "SYNTHETIC", bodyHash: procurementBodyHash("SYNTHETIC"),
  excerpts: [{ requirementId: "requirement1", start: 0, end: 9, stance: "inconclusive" }],
})) };
const missingBytes = MAX_PROCUREMENT_BYTES - 1 - Buffer.byteLength(JSON.stringify(boundaryPacket));
for (const [index, row] of boundaryPacket.deliveries.entries()) {
  row.body += "x".repeat(index === 0 ? Math.floor(missingBytes / 2) : Math.ceil(missingBytes / 2)); row.bodyHash = procurementBodyHash(row.body);
}
assert.equal(Buffer.byteLength(JSON.stringify(boundaryPacket)), MAX_PROCUREMENT_BYTES - 1);
parseEvidenceProcurement(boundaryPacket);
const css = await postcss([tailwindcss()]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") });
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{EvidenceProcurementWorkspace}from'./components/keryx/evidence-procurement-workspace';
  const signer={address:${JSON.stringify(account.address)},signMessage:message=>new Promise(resolve=>{window.pendingSigningMessage=message;window.releaseSignature=resolve;})};
  const root=createRoot(document.getElementById('root'));
  function Fixture({address}){React.useEffect(()=>{window.procurementAccountReady=address;},[address]);return <EvidenceProcurementWorkspace signer={{...signer,address}}/>;}
  window.changeProcurementAccount=address=>root.render(<Fixture address={address}/>);
  window.unmountProcurement=()=>root.unmount();
  root.render(<Fixture address={signer.address}/>);`, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "pause-readable-receipt-after-real-render", setup(builder) {
    builder.onLoad({ filter: /[\\/]evidence-procurement[\\/]export\.ts$/ }, async args => ({ loader: "ts",
      contents: (await readFile(args.path, "utf8")).replace("export async function exportEvidenceProcurement(", "async function renderReceipt(") + `
        export async function exportEvidenceProcurement(...args: Parameters<typeof renderReceipt>) {
          const receipt=await renderReceipt(...args);
          if(window.pauseProcurementExport) await new Promise(resolve=>{window.releaseProcurementExport=()=>{window.pauseProcurementExport=false;delete window.releaseProcurementExport;resolve();};});
          return receipt;
        }` }));
  } }] });
const screenshots = process.env.EVIDENCE_PROCUREMENT_SCREENSHOTS ?? await mkdtemp(join(tmpdir(), "keryx-evidence-procurement-"));
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const boot = async (page: Page) => { await page.goto("https://evidence-procurement.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole("heading", { name: "1. Define the evidence you need" }).waitFor(); };
const download = async (page: Page, name: string) => {
  const waiting = page.waitForEvent("download"); await page.getByRole("button", { name, exact: true }).click();
  const saved = await waiting; return { name: saved.suggestedFilename(), text: await readFile((await saved.path())!, "utf8") };
};

async function verifyBuiltRoute(browser: Browser) {
  const fixture = join(screenshots, `runtime-${randomUUID()}`); await mkdir(join(fixture, "data"), { recursive: true });
  await copyNextConfigFixture(source, fixture);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(join(source, "node_modules"), join(fixture, "node_modules"), linkType);
  await symlink(dist, join(fixture, ".next"), linkType);
  await symlink(join(source, "public"), join(fixture, "public"), linkType);
  const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address(); assert(address && typeof address !== "string"); const port = address.port;
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  // Whitelist OS launch variables: no inherited credentials, env files or shared DB locations.
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "HOME", "LANG", "CI"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  Object.assign(env, { NODE_ENV: "production", BASE_URL: base, JWT_SECRET: randomBytes(32).toString("hex"),
    KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1", KERYX_EXTERNAL_DISCOVERY: "0",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_URL: "", SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" });
  const server = spawn(process.execPath, [join(source, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: fixture, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env });
  let output = "", didExit = false, startupError: Error | undefined;
  server.stdout.on("data", value => { output = (output + String(value)).slice(-3000); });
  server.stderr.on("data", value => { output = (output + String(value)).slice(-3000); });
  const exited = new Promise<void>(resolve => server.once("exit", () => { didExit = true; resolve(); }));
  server.once("error", error => { startupError = error; });
  const waitForExit = (milliseconds: number) => new Promise<boolean>(resolve => {
    const timeout = setTimeout(() => resolve(false), milliseconds);
    void exited.then(() => { clearTimeout(timeout); resolve(true); });
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startupError || didExit) throw new Error(`Built evidence server could not start: ${output}`);
      try { ready = (await fetch(`${base}/operator/evidence`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Starting */ }
      if (ready) break; await delay(250);
    }
    assert(ready, `Built evidence route failed readiness: ${output}`);
    for (const width of [320, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
      const errors: string[] = [], blocked: string[] = [];
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) { blocked.push(url.origin); return route.abort(); }
        if (url.pathname.startsWith("/api/")) { blocked.push(url.pathname); return route.fulfill({ status: 200, json: {} }); }
        assert.equal(route.request().method(), "GET"); return route.continue();
      });
      const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
      assert.equal((await page.goto(`${base}/operator/evidence`))?.status(), 200);
      await page.getByRole("heading", { name: "When the evidence you need is missing", exact: true }).waitFor();
      const workspace = page.getByRole("region", { name: "Private evidence procurement workspace", exact: true });
      await workspace.getByLabel("What decision are you trying to make?").fill(request.decision);
      await workspace.getByLabel("Network for quotation context").selectOption(request.network);
      await workspace.getByLabel("Request expiry (UTC)", { exact: true }).fill("2030-01-02T12:00");
      await workspace.getByLabel("Evidence question 1", { exact: true }).fill(request.requirements[0].question);
      await workspace.getByRole("button", { name: "Prepare evidence request", exact: true }).click();
      await workspace.getByRole("heading", { name: "Prepared request: request1", exact: true }).waitFor();
      assert.equal(await workspace.getByRole("button", { name: "Sign offer message", exact: true }).count(), 0, "No connected wallet is created or signed automatically");
      const saved = await download(page, "Download private plaintext packet");
      const parsed = JSON.parse(saved.text); assert.deepEqual(parsed.offers, []); assert.equal(parsed.request.decision, request.decision);
      await page.reload(); await workspace.getByRole("heading", { name: "1. Define the evidence you need", exact: true }).waitFor();
      assert.equal(await workspace.getByLabel("What decision are you trying to make?").inputValue(), "");
      await workspace.getByLabel("Restore private packet file (JSON, up to 64 KiB)", { exact: true }).setInputFiles({ name: "synthetic-packet.json", mimeType: "application/json", buffer: Buffer.from(saved.text) });
      await workspace.getByRole("button", { name: "Replace tab with validated packet", exact: true }).click();
      await workspace.getByRole("button", { name: "Compare current quotations", exact: true }).click();
      await workspace.getByText("Current proposal state: awaiting eligible offers", { exact: true }).waitFor();
      await workspace.getByText("Payment: not observed. No funds reserved or spent.", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Built route has no overflow at ${width}px`);
      await page.screenshot({ path: join(screenshots, `built-evidence-procurement-${width}.png`), fullPage: true });
      assert.equal(blocked.filter(path => /evidence-procurement|\/ask|\/source|\/cite|gateway|circle|alchemy/i.test(path)).length, 0, "No provider, paid read, procurement API or payment invocation");
      assert.deepEqual(errors, []); await context.close();
    }
    console.log("Built procurement route: real wallet wrapper, request/export/restore, no automatic signer/provider action and no overflow at 320px/1440px passed.");
  } finally {
    if (!didExit && server.pid !== undefined) {
      server.kill(); if (!await waitForExit(5000)) { server.kill("SIGKILL"); assert(await waitForExit(5000), "Built evidence server exit was not observed"); }
    }
  }
}
try {
  for (const width of [320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    await context.addInitScript(() => {
      const originalNow = Date.now;
      Date.now = () => (window as unknown as { procurementTestNow?: number }).procurementTestNow ?? originalNow();
    });
    const requests: string[] = [], errors: string[] = [];
    await context.route("**/*", route => {
      requests.push(route.request().url()); assert.equal(route.request().url(), "https://evidence-procurement.test/");
      assert.equal(route.request().method(), "GET");
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><style>${css.css}</style></head><body class="bg-paper-2"><main id="root" style="max-width:1040px;margin:auto;padding:16px"></main></body></html>` });
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message)); await boot(page);
    await page.getByLabel("Request identifier", { exact: true }).fill(request.id);
    await page.getByLabel("Network for quotation context").selectOption(request.network);
    await page.getByLabel("What decision are you trying to make?").fill(request.decision);
    await page.getByLabel("Request expiry (UTC)", { exact: true }).fill("2030-01-02T12:00");
    await page.getByLabel("Evidence question 1", { exact: true }).fill(request.requirements[0].question);
    await page.getByRole("button", { name: "Prepare evidence request", exact: true }).click();
    await page.getByRole("heading", { name: `Prepared request: ${request.id}` }).waitFor();
    await page.getByLabel("Provider wallet", { exact: true }).fill(account.address);
    await page.getByLabel("Source or delivery URL (HTTPS)").fill(offer.sourceUrl);
    await page.getByLabel("What will the provider deliver?").fill(offer.deliverable);
    await page.getByLabel("Quoted price (USDC)", { exact: true }).fill("0.03");
    await page.getByLabel("Offer expiry (UTC)", { exact: true }).fill("2030-01-02T11:00");
    await page.getByLabel("Provider nonce (unique for this wallet)").fill(offer.nonce);
    await page.getByRole("checkbox", { name: `requirement1: ${request.requirements[0].question}` }).check();
    const unsignedOffer = JSON.parse((await download(page, "Download provider offer JSON")).text);
    assert.equal(unsignedOffer.signature, undefined); assert.equal(unsignedOffer.priceMicroUsdc, "30000");
    assert.equal((await download(page, "Download offer signing message")).text, procurementOfferMessage(request, offer));

    // A wallet callback arriving after an edit cannot attach a stale signature.
    await page.getByRole("button", { name: "Sign offer message", exact: true }).click();
    await page.waitForFunction(() => typeof (window as unknown as { releaseSignature?: unknown }).releaseSignature === "function");
    await page.getByLabel("Quoted price (USDC)", { exact: true }).fill("0.031");
    await page.evaluate(signature => (window as unknown as { releaseSignature: (value: string) => void }).releaseSignature(signature), offer.signature!);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(element => element.textContent === "Sign offer message" && !element.disabled));
    assert.equal(await page.getByLabel("Offer signature (optional for a draft)").inputValue(), "");
    await page.getByLabel("Quoted price (USDC)", { exact: true }).fill("0.03");
    await page.getByRole("button", { name: "Sign offer message", exact: true }).click();
    assert.equal(await page.evaluate(() => (window as unknown as { pendingSigningMessage: string }).pendingSigningMessage), procurementOfferMessage(request, offer));
    await page.evaluate(signature => (window as unknown as { releaseSignature: (value: string) => void }).releaseSignature(signature), offer.signature!);
    await page.getByText("Provider message signed. Add it to the packet, then compare to verify the signature.", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Offer signature (optional for a draft)").inputValue(), offer.signature!);
    await page.getByRole("button", { name: "Add provider quotation", exact: true }).click();
    await page.getByRole("button", { name: "Compare current quotations", exact: true }).click();
    await page.getByText("Recommended next: highest declared missing priority per micro-USDC.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Select proposal offer1", exact: true }).click();
    await page.getByText("Proposal selection changed. Compare again before selecting another quotation.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Download decision receipt", exact: true }).isDisabled(), true, "Selection invalidates a receipt");
    await page.getByText("Import a provider's offer JSON instead", { exact: true }).click();
    await page.getByLabel("Provider offer JSON", { exact: true }).fill(JSON.stringify(expensive));
    await page.getByRole("button", { name: "Import provider offer", exact: true }).click();
    await page.getByRole("button", { name: "Compare current quotations", exact: true }).click();
    await page.getByText("Exceeds the remaining quote budget", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Select proposal expensive", exact: true }).isDisabled(), true);
    await page.getByText("Planned quote total: 0.030000 USDC · remaining: 0.020000 USDC", { exact: true }).waitFor();

    await page.getByLabel("Delivery for quotation", { exact: true }).selectOption(offer.id);
    await page.getByLabel("Supplied delivery text", { exact: true }).fill(body);
    await page.getByLabel("Requirement for highlighted passage", { exact: true }).selectOption("requirement1");
    await page.getByLabel("Provider-declared stance", { exact: true }).selectOption("refutes");
    await page.getByLabel("Supplied delivery text", { exact: true }).evaluate((element, length) => { (element as HTMLTextAreaElement).setSelectionRange(0, length); }, body.length);
    await page.getByRole("button", { name: "Attach highlighted passage", exact: true }).click();
    const unsignedDelivery = JSON.parse((await download(page, "Download provider delivery JSON")).text);
    assert.equal(unsignedDelivery.bodyHash, delivery.bodyHash); assert.deepEqual(unsignedDelivery.excerpts, delivery.excerpts);
    assert.equal((await download(page, "Download delivery signing message")).text, procurementDeliveryMessage(request, offer, delivery));
    await page.getByRole("button", { name: "Add supplied delivery", exact: true }).click();
    await page.getByRole("button", { name: "Compare current quotations", exact: true }).click();
    await page.getByText("Unsigned delivery — withheld from review", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Record caller review offer1", exact: true }).isDisabled(), true);
    await page.getByText("Import a provider's delivery JSON instead", { exact: true }).click();
    await page.getByLabel("Provider delivery JSON", { exact: true }).fill(JSON.stringify(delivery));
    await page.getByRole("button", { name: "Import provider delivery", exact: true }).click();
    await page.getByLabel("Reviewer name or identifier", { exact: true }).fill("Synthetic reviewer");
    await page.getByRole("button", { name: "Compare current quotations", exact: true }).click();
    await page.getByText("Signature authenticates these exact supplied bytes", { exact: true }).waitFor();
    const review = page.getByRole("article", { name: "Delivery review offer1", exact: true });
    assert.equal(await review.locator("blockquote").textContent(), body);
    await review.getByRole("checkbox", { name: "I reviewed requirement1 as useful refuting evidence", exact: true }).check();
    await review.getByLabel("Review note for offer1", { exact: true }).fill("SYNTHETIC: This supplied refutation rules out example API A. Still no factual or customer validation.");
    await review.getByRole("button", { name: "Record caller review offer1", exact: true }).click();
    await page.getByRole("button", { name: "Compare current quotations", exact: true }).click();
    await page.getByText("Still missing according to caller review: none", { exact: true }).waitFor();
    const receipt = JSON.parse((await download(page, "Download decision receipt")).text);
    assert.equal(receipt.payment.status, "not-observed"); assert.equal(receipt.reviews[0].authority, "caller-declared");
    assert.equal(receipt.deliveries[0].excerpts[0].stance, "refutes"); assert.equal(receipt.deliveries[0].excerpts[0].text, body);
    assert.equal(receipt.quoteBudget.authority, "proposal-only");
    for (const format of ["markdown", "csv"]) {
      await page.getByRole("combobox", { name: "Download decision receipt", exact: true }).selectOption(format);
      const saved = await download(page, "Download decision receipt");
      const expected = await exportEvidenceProcurement(receipt.packet, format, Date.parse(receipt.observedAt));
      assert.equal(saved.name, `private-evidence-procurement-receipt.${expected.extension}`); assert.equal(saved.text, expected.text);
      assert(saved.text.includes("not-observed")); assert(saved.text.includes("refutes")); assert(saved.text.includes("caller-reviewed"));
    }
    await page.getByRole("combobox", { name: "Download decision receipt", exact: true }).selectOption("json");
    assert.deepEqual(JSON.parse((await download(page, "Download decision receipt")).text), receipt, "Selecting a presentation format preserves the displayed inspection");
    const exported = await download(page, "Download private plaintext packet");
    assert.equal(exported.name, "private-evidence-procurement-packet.json");
    assert.equal(JSON.parse(exported.text).reviews[0].reviewer, "Synthetic reviewer");
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.equal(await page.locator("script").count(), 1, "Supplied text stays text");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `No horizontal overflow at ${width}px`);
    await page.screenshot({ path: join(screenshots, `evidence-procurement-${width}.png`), fullPage: true });

    const restoreInput = page.getByLabel("Restore private packet file (JSON, up to 64 KiB)", { exact: true });
    await restoreInput.setInputFiles({ name: "corrupt.json", mimeType: "application/json", buffer: Buffer.from("{broken") });
    await page.getByText("Unsupported or invalid packet. Existing work has been kept.", { exact: true }).waitFor();
    assert.equal((await download(page, "Download private plaintext packet")).text, exported.text);
    await restoreInput.setInputFiles({ name: "receipt.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(receipt)) });
    await page.getByText("Unsupported or invalid packet. Existing work has been kept.", { exact: true }).waitFor();
    await restoreInput.setInputFiles({ name: "packet.json", mimeType: "application/json", buffer: Buffer.from(exported.text) });
    await page.getByRole("region", { name: "Validated restore preview", exact: true }).waitFor();
    assert.equal((await download(page, "Download private plaintext packet")).text, exported.text, "Restore preview does not overwrite the current packet");
    await page.getByRole("button", { name: "Cancel packet restore", exact: true }).click();
    await boot(page);
    assert.equal(await page.getByLabel("What decision are you trying to make?").inputValue(), "", "Reload has no retained private memory");
    await page.getByLabel("Restore private packet file (JSON, up to 64 KiB)", { exact: true }).setInputFiles({ name: "packet.json", mimeType: "application/json", buffer: Buffer.from(exported.text) });
    await page.getByRole("button", { name: "Replace tab with validated packet", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Download decision receipt", exact: true }).isDisabled(), true, "Restore recomputes rather than trusting a cached result");
    await page.getByRole("button", { name: "Compare current quotations", exact: true }).click();
    await page.getByText("Still missing according to caller review: none", { exact: true }).waitFor();
    const recomputed = await buildEvidenceProcurement(JSON.parse(exported.text));
    const restored = JSON.parse((await download(page, "Download decision receipt")).text);
    assert.deepEqual(restored.reviews, recomputed.reviews);

    // Time passes after comparison: fresh admission must refuse both quote and request expiry.
    for (const expiredAt of ["2030-01-02T11:00:00Z", "2030-01-02T12:00:00Z"]) {
      await page.evaluate(value => { (window as unknown as { procurementTestNow: number }).procurementTestNow = value; }, Date.parse("2030-01-02T10:00:00Z"));
      await page.getByLabel("Restore private packet file (JSON, up to 64 KiB)", { exact: true }).setInputFiles({ name: "expiry-packet.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(expiryPacket)) });
      await page.getByRole("button", { name: "Replace tab with validated packet", exact: true }).click();
      await page.getByRole("button", { name: "Compare current quotations", exact: true }).click();
      await page.getByText("Recommended next: highest declared missing priority per micro-USDC.", { exact: false }).waitFor();
      await page.evaluate(value => { (window as unknown as { procurementTestNow: number }).procurementTestNow = value; }, Date.parse(expiredAt));
      // A download preserves the displayed observation; selecting a proposal
      // remains a separate fresh-expiry check immediately afterward.
      await page.getByRole("combobox", { name: "Download decision receipt", exact: true }).selectOption("json");
      const displayed = JSON.parse((await download(page, "Download decision receipt")).text);
      await page.getByRole("combobox", { name: "Download decision receipt", exact: true }).selectOption("markdown");
      assert.equal((await download(page, "Download decision receipt")).text,
        (await exportEvidenceProcurement(displayed.packet, "markdown", Date.parse(displayed.observedAt))).text);
      await page.getByRole("combobox", { name: "Download decision receipt", exact: true }).selectOption("json");
      await page.getByRole("button", { name: "Select proposal offer1", exact: true }).click();
      await page.getByText("Quotation cannot be selected now. It expired or no longer adds eligible coverage. Compare again.", { exact: true }).waitFor();
      assert.deepEqual(JSON.parse((await download(page, "Download private plaintext packet")).text).selectedOfferIds, []);
    }
    const historical = { ...expiryPacket, selectedOfferIds: [offer.id] };
    await page.getByLabel("Restore private packet file (JSON, up to 64 KiB)", { exact: true }).setInputFiles({ name: "historical-packet.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(historical)) });
    await page.getByRole("button", { name: "Replace tab with validated packet", exact: true }).click();
    await page.getByRole("button", { name: "Compare current quotations", exact: true }).click();
    await page.getByText("Current proposal state: Request expired", { exact: true }).waitFor();
    assert.equal(JSON.parse((await download(page, "Download private plaintext packet")).text).selectedOfferIds[0], offer.id);
    await page.getByRole("button", { name: "Remove selection offer1", exact: true }).click();
    assert.deepEqual(JSON.parse((await download(page, "Download private plaintext packet")).text).selectedOfferIds, [], "Historical expired proposal can still be explicitly removed");
    await page.evaluate(() => { delete (window as unknown as { procurementTestNow?: number }).procurementTestNow; });

    // A valid compact packet near the input byte limit must produce a restorable export.
    await page.getByLabel("Restore private packet file (JSON, up to 64 KiB)", { exact: true }).setInputFiles({ name: "boundary-packet.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(boundaryPacket)) });
    await page.getByRole("button", { name: "Replace tab with validated packet", exact: true }).click();
    const boundaryExport = await download(page, "Download private plaintext packet");
    assert.equal(Buffer.byteLength(boundaryExport.text), MAX_PROCUREMENT_BYTES - 1);
    assert.deepEqual(parseEvidenceProcurement(JSON.parse(boundaryExport.text)), boundaryPacket);
    await page.getByLabel("Restore private packet file (JSON, up to 64 KiB)", { exact: true }).setInputFiles({ name: "boundary-export.json", mimeType: "application/json", buffer: Buffer.from(boundaryExport.text) });
    await page.getByRole("button", { name: "Replace tab with validated packet", exact: true }).click();
    assert.equal((await download(page, "Download private plaintext packet")).text, boundaryExport.text);
    // Pause after the real renderer completes, so a stale asynchronous callback
    // cannot download private data after an edit, account change or unmount.
    for (const action of ["edit", "account", "unmount"]) {
      await page.getByLabel("Restore private packet file (JSON, up to 64 KiB)", { exact: true }).setInputFiles({ name: "packet.json", mimeType: "application/json", buffer: Buffer.from(exported.text) });
      await page.getByRole("button", { name: "Replace tab with validated packet", exact: true }).click();
      await page.getByRole("button", { name: "Compare current quotations", exact: true }).click();
      await page.getByRole("combobox", { name: "Download decision receipt", exact: true }).selectOption("csv");
      let staleDownloads = 0; const countDownload = () => { staleDownloads++; }; page.on("download", countDownload);
      await page.evaluate(() => { (window as unknown as { pauseProcurementExport: boolean }).pauseProcurementExport = true; });
      await page.getByRole("button", { name: "Download decision receipt", exact: true }).click();
      await page.waitForFunction(() => typeof (window as unknown as { releaseProcurementExport?: unknown }).releaseProcurementExport === "function");
      if (action === "edit") await page.getByLabel("What decision are you trying to make?", { exact: true }).fill("Edited private decision");
      else if (action === "account") {
        const changed = `0x${"2".repeat(40)}`;
        await page.evaluate(value => (window as unknown as { changeProcurementAccount: (value: string) => void }).changeProcurementAccount(value), changed);
        await page.waitForFunction(value => (window as unknown as { procurementAccountReady: string }).procurementAccountReady === value, changed);
      } else {
        await page.evaluate(() => (window as unknown as { unmountProcurement: () => void }).unmountProcurement());
        assert.equal(await page.locator("#root").textContent(), "");
      }
      await page.evaluate(() => (window as unknown as { releaseProcurementExport: () => void }).releaseProcurementExport());
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      assert.equal(staleDownloads, 0, `${action} invalidates a pending private receipt`); page.off("download", countDownload);
    }
    await boot(page);
    const nonDisplayable = JSON.parse(exported.text) as EvidenceProcurementPacket;
    nonDisplayable.request.decision += "\u0000";
    nonDisplayable.selectedOfferIds = [];
    await page.getByLabel("Restore private packet file (JSON, up to 64 KiB)", { exact: true }).setInputFiles({ name: "control.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(nonDisplayable)) });
    await page.getByRole("button", { name: "Replace tab with validated packet", exact: true }).click();
    await page.getByRole("button", { name: "Compare current quotations", exact: true }).click();
    await page.getByRole("combobox", { name: "Download decision receipt", exact: true }).selectOption("csv");
    await page.getByRole("button", { name: "Download decision receipt", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Could not validate this change." }).waitFor();
    await page.getByRole("combobox", { name: "Download decision receipt", exact: true }).selectOption("json");
    assert.deepEqual(JSON.parse((await download(page, "Download decision receipt")).text).packet, nonDisplayable, "A refused readable export preserves the JSON fallback");
    await page.getByRole("button", { name: "Clear tab packet", exact: true }).click();
    assert.equal(await page.getByLabel("What decision are you trying to make?").inputValue(), "");
    assert.equal(await page.getByRole("button", { name: "Download private plaintext packet", exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []); assert(requests.every(url => url === "https://evidence-procurement.test/"));
    await context.close();
  }
  await verifyBuiltRoute(browser);
  console.log(`Evidence procurement browser acceptance passed at 320px and 1440px, including the required production route. Synthetic fixtures only. Screenshots: ${screenshots}`);
} finally { await browser.close(); }
