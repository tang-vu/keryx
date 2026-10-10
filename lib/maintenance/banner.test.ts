import { once } from "node:events";
import { request } from "node:http";
import { beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createMaintenanceFrontDoor } from "./front-door";
import { WINDOW_FORMAT, type MaintenanceStatus, type PlannedWindow, type WindowControl } from "./planned-window";

const window: PlannedWindow = { format: WINDOW_FORMAT, id: "synthetic-banner-281", announcedAt: "2026-10-11T10:00:00.000Z",
  startsAt: "2026-10-11T10:05:00.000Z", endsAt: "2026-10-11T10:15:00.000Z", phase: "active" as const,
  message: "Synthetic <script>plain notice</script>." };
const statuses: MaintenanceStatus[] = [];
let bundle: string;
beforeAll(async () => {
  let control: WindowControl = { kind: "valid", window }, clock = Date.parse(window.announcedAt);
  const front = createMaintenanceFrontDoor({ upstreamPort: 1, readControl: () => control, clock: () => clock });
  front.server.listen(0, "127.0.0.1"); await once(front.server, "listening");
  try {
    // Actual independent emitter, bounded public GETs. No application/provider/payment admission.
    for (const state of ["upcoming", "active", "overrun", "control-unavailable"]) {
      clock = Date.parse(state === "upcoming" ? window.announcedAt : state === "overrun" ? window.endsAt : window.startsAt);
      control = state === "control-unavailable" ? { kind: "unavailable" } : { kind: "valid", window };
      statuses.push(await new Promise<MaintenanceStatus>((resolve, reject) => {
        const outgoing = request({ hostname: "127.0.0.1", port: (front.server.address() as { port: number }).port,
          path: "/maintenance/status", method: "GET", agent: false, headers: { Host: "keryx.cc", "X-Forwarded-Proto": "https" } }, response => {
          expect(response.statusCode).toBe(200);
          const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(chunk)); response.on("error", reject);
          response.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        }); outgoing.on("error", reject); outgoing.end();
      }));
    }
  } finally { await front.close(); }
  const built = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{MaintenanceBanner}from'./components/keryx/maintenance-banner';
    window.calls=[];window.snapshot=window.fixtureSnapshot??${JSON.stringify(statuses[0])};window.replyStatus=window.fixtureReplyStatus??200;
    window.fetch=async(path,init)=>{window.calls.push({path,method:init.method,credentials:init.credentials,redirect:init.redirect});
      if(path!=='/maintenance/status'||init.method!=='GET')throw Error('Unexpected endpoint');
      return Response.json(window.snapshot,{status:window.replyStatus});};
    createRoot(document.getElementById('root')).render(<><MaintenanceBanner/><input aria-label="Retained question" defaultValue="Retained draft"/>
      <button onClick={()=>window.asks=(window.asks??0)+1}>Caller dispatch</button></>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' } });
  bundle = built.outputFiles[0].text;
});

it("shows last-observed plaintext dates/state and unknown health, preserves the caller and stops on a failed refresh", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://maintenance.invalid/");
    // Far-future client time must not turn the server's upcoming snapshot into overrun/readiness.
    await page.clock.install({ time: new Date("2099-01-01T00:00:00Z") });
    await page.addScriptTag({ content: bundle }); await page.clock.runFor(1);
    await page.getByText("Upcoming planned maintenance", { exact: true }).waitFor();
    expect(await page.locator("aside").textContent()).toContain(window.startsAt);
    expect(await page.locator("aside").textContent()).toContain(window.endsAt);
    expect(await page.locator("aside").textContent()).toContain("Last observed public status");
    expect(await page.locator("aside").textContent()).toContain("Application health is not probed");
    expect(await page.locator("aside").textContent()).toContain(window.message);
    expect(await page.locator("aside script").count()).toBe(0);
    expect(await page.getByRole("link", { name: "Check service status" }).getAttribute("href")).toBe("/maintenance/status");
    const draft = page.getByRole("textbox", { name: "Retained question" }); await draft.fill("Newly edited draft");
    for (let index = 1; index < statuses.length; index++) {
      await page.evaluate(value => { (window as unknown as { snapshot: unknown }).snapshot = value; }, statuses[index]);
      await page.clock.runFor(60_000);
      await page.getByText(index === 1 ? "Maintenance status reports new requests held" : index === 2
        ? "Expected maintenance end has passed; requests remain held" : "Maintenance controls unavailable; requests remain held", { exact: true }).waitFor();
      expect(await draft.inputValue()).toBe("Newly edited draft");
      expect(await page.getByRole("button", { name: "Caller dispatch" }).isEnabled()).toBe(true);
    }
    await page.evaluate(() => { (window as unknown as { replyStatus: number }).replyStatus = 404; });
    await page.clock.runFor(60_000); await page.getByText("Current maintenance status unavailable", { exact: true }).waitFor();
    await page.clock.runFor(10 * 60_000);
    const captured = await page.evaluate(() => ({ calls: (window as unknown as { calls: unknown[] }).calls,
      asks: (window as unknown as { asks?: number }).asks ?? 0 }));
    expect(captured.calls).toHaveLength(5);
    expect(captured.calls.every(value => (value as { method: string }).method === "GET")).toBe(true);
    expect(captured.asks).toBe(0); expect(await draft.inputValue()).toBe("Newly edited draft"); expect(errors).toEqual([]);
  } finally { await browser.close(); }
});

it("keeps an inert404 or malformed initial front door hidden and never retries", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const malformed of [false, true]) {
      const page = await browser.newPage();
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
      await page.goto("https://maintenance.invalid/"); await page.clock.install();
      await page.evaluate(value => {
        const fixture = window as unknown as { fixtureReplyStatus: number; fixtureSnapshot: unknown };
        fixture.fixtureReplyStatus = value ? 200 : 404;
        fixture.fixtureSnapshot = value ? { state: ["active"] } : null;
      }, malformed);
      await page.addScriptTag({ content: bundle });
      await page.clock.runFor(10 * 60_000);
      expect(await page.locator("aside").count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as { calls: unknown[] }).calls.length)).toBe(1);
      expect(await page.getByRole("textbox").inputValue()).toBe("Retained draft"); await page.close();
    }
  } finally { await browser.close(); }
});
