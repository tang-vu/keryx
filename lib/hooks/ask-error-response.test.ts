import { once } from "node:events";
import { request } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createMaintenanceFrontDoor } from "../maintenance/front-door";
import { WINDOW_FORMAT } from "../maintenance/planned-window";
import { parseAskHttpError } from "./ask-error-response";

const require = createRequire(import.meta.url);
const circleBrowserLoader = require("../../scripts/circle-sdk-browser-loader.cjs") as (this: { resourcePath: string }, source: string) => string;

let body: string;
beforeAll(async () => {
  // Actual local front-door emitter, synthetic active window, no application admission.
  const front = createMaintenanceFrontDoor({ upstreamPort: 1, clock: () => Date.parse("2026-10-11T10:05:00.000Z"),
    readControl: () => ({ kind: "valid", window: { format: WINDOW_FORMAT, id: "synthetic-browser-refusal",
      announcedAt: "2026-10-11T10:00:00.000Z", startsAt: "2026-10-11T10:05:00.000Z",
      endsAt: "2026-10-11T10:15:00.000Z", phase: "active", message: "Synthetic maintenance fixture." } }) });
  front.server.listen(0, "127.0.0.1"); await once(front.server, "listening");
  try {
    body = await new Promise<string>((resolve, reject) => {
      const outgoing = request({ hostname: "127.0.0.1", port: (front.server.address() as { port: number }).port,
        path: "/api/ask", method: "POST", agent: false, headers: { Host: "keryx.cc", "X-Forwarded-Proto": "https" } }, response => {
        expect(response.statusCode).toBe(503); expect(response.headers["retry-after"]).toBe("600");
        const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(chunk)); response.on("error", reject);
        response.on("end", () => resolve(Buffer.concat(chunks).toString()));
      }); outgoing.on("error", reject); outgoing.end();
    });
  } finally { await front.close(); }
});

it("recognizes the exact front-door 503 and bounds its informational wait", () => {
  expect(parseAskHttpError(body, 503, "999999")).toEqual({ code: "KERYX_PLANNED_MAINTENANCE",
    message: "New application requests are held.", retryAfter: 600,
    maintenance: { statusPath: "/maintenance/status", upstreamOutcome: "not-dispatched" } });
  for (const seconds of [1, 1800]) {
    const value = JSON.parse(body); value.error.retryAfterSeconds = seconds;
    expect(parseAskHttpError(JSON.stringify(value), 503, null).retryAfter).toBe(seconds);
  }
  const unknown = JSON.parse(body); unknown.error.code = "KERYX_UPSTREAM_UNAVAILABLE";
  unknown.error.planned = false;
  Object.assign(unknown.error.maintenance, { state: "normal", planned: false, admissionClosed: false, window: null });
  unknown.error.upstreamOutcome = "unknown";
  expect(parseAskHttpError(JSON.stringify(unknown), 503, null).message).toContain("may already have been handled");
  expect(parseAskHttpError(body, 400, null).maintenance).toBeUndefined();
});

it("preserves ordinary flat errors, message-only responses and non-JSON text", () => {
  expect(parseAskHttpError('{"error":"invalid_question","message":"Question is required."}', 400, null))
    .toEqual({ code: "invalid_question", message: "Question is required.", retryAfter: null });
  expect(parseAskHttpError('{"error":"session_expired"}', 401, null).code).toBe("session_expired");
  expect(parseAskHttpError('{"error":"rate_limit","message":"Quota held","retryAfter":12}', 429, "30"))
    .toEqual({ code: "rate_limit", message: "Quota held", retryAfter: 12 });
  expect(parseAskHttpError('{"message":"Ordinary refusal"}', 400, null).message).toBe("Ordinary refusal");
  expect(parseAskHttpError("Upstream unavailable", 502, null).message).toBe("Upstream unavailable");
});

it("keeps normal front-door draining, expired windows and unplanned unknown outcomes distinct", () => {
  const draining = JSON.parse(body);
  Object.assign(draining.error, { code: "KERYX_FRONT_DOOR_DRAINING", planned: false, frontDoorDraining: true });
  Object.assign(draining.error.maintenance, { state: "normal", planned: false, admissionClosed: false, window: null });
  expect(parseAskHttpError(JSON.stringify(draining), 503, null).maintenance?.upstreamOutcome).toBe("not-dispatched");
  const expired = JSON.parse(body);
  Object.assign(expired.error, { code: "KERYX_MAINTENANCE_WINDOW_EXPIRED", planned: false, retryAfterSeconds: 60 });
  Object.assign(expired.error.maintenance, { state: "overrun", planned: false, checkedAt: expired.error.maintenance.window.endsAt });
  expect(parseAskHttpError(JSON.stringify(expired), 503, null).code).toBe("KERYX_MAINTENANCE_WINDOW_EXPIRED");
  const unavailable = JSON.parse(body);
  Object.assign(unavailable.error, { code: "KERYX_MAINTENANCE_CONTROL_UNAVAILABLE", planned: false, retryAfterSeconds: 60 });
  Object.assign(unavailable.error.maintenance, { state: "control-unavailable", planned: false, window: null });
  expect(parseAskHttpError(JSON.stringify(unavailable), 503, null).code).toBe("KERYX_MAINTENANCE_CONTROL_UNAVAILABLE");
});

it("renders malformed or unknown nested bodies as plain fallback with no status authority", () => {
  const changes = [
    { statusPath: "https://evil.invalid/" }, { code: "UNKNOWN" }, { retryAfterSeconds: 0 },
    { retryAfterSeconds: 1801 }, { retryAfterSeconds: "60" }, { automaticRetry: true },
    { authorizationConsumedByFrontDoor: true }, { upstreamOutcome: "settled" }, { message: { unsafe: true } },
    { maintenance: {} }, { inventedField: true },
    { planned: false }, { frontDoorDraining: true },
    { code: ["KERYX_PLANNED_MAINTENANCE"] }, { code: { value: "KERYX_PLANNED_MAINTENANCE" } },
    { upstreamOutcome: ["unknown"] }, { upstreamOutcome: { value: "unknown" } },
  ];
  for (const change of changes) {
    const value = JSON.parse(body); Object.assign(value.error, change);
    expect(parseAskHttpError(JSON.stringify(value), 503, null)).toEqual({ message: "Research request failed (HTTP 503).", retryAfter: null });
  }
  for (const [field, literal] of [["state", "active"], ["phase", "active"]]) {
    for (const malformed of [[literal], { value: literal }]) {
      const value = JSON.parse(body);
      if (field === "state") value.error.maintenance.state = malformed;
      else value.error.maintenance.window.phase = malformed;
      expect(parseAskHttpError(JSON.stringify(value), 503, null).maintenance).toBeUndefined();
    }
  }
  for (const value of [{ error: {} }, { error: ["not text"] }, { error: { message: "invented" }, message: "Do not promote nested errors" }, null, []])
    expect(parseAskHttpError(JSON.stringify(value), 503, null).message).toBe("Research request failed (HTTP 503).");
});

it("renders a maintenance refusal in the real conversation, restores its draft and never retries or signs", async () => {
  // Wallet panel alone is inert. Mirror Next's existing pinned Circle browser transform;
  // this standalone bundle checks presentation, not a production build or payment acceptance.
  const bundle = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{ResearchChat}from'./components/keryx/research-chat';
    window.calls=[];window.refusal=${JSON.stringify(body)};
    window.fetch=async(url,init)=>{
      window.calls.push({url,method:init?.method??'GET'});
      if(url==='/api/ask')return new Response(window.refusal,{status:503,headers:{'Retry-After':'600'}});
      if(url==='/api/sources')return Response.json({sources:[]});
      if(url==='/api/models')return Response.json({models:[]});
      if(url==='/api/ask/visibility')return Response.json({wallet:null,defaultVisibility:'public',privacyActive:true});
      if(url==='/api/research/availability')return Response.json({state:'not-paused'});
      throw Error('Unexpected synthetic endpoint: '+url);
    };
    createRoot(document.getElementById('root')).render(<ResearchChat/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", plugins: [{ name: "inert-wallet-panel", setup(builder) {
    builder.onResolve({ filter: /^\.\/session-grant-panel$/ }, () => ({ path: "wallet-panel", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export function SessionGrantPanel(){return null}", loader: "js" }));
    builder.onLoad({ filter: /@circle-fin[\\/]w3s-pw-web-sdk[\\/]dist[\\/]src[\\/]index\.js$/ }, args => ({
      contents: circleBrowserLoader.call({ resourcePath: args.path }, readFileSync(args.path, "utf8")), loader: "js" }));
  } }], define: { "process.env": "{}", "process.browser": "true", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" } });
  const browser = await chromium.launch({ headless: true, ...(process.env.KERYX_CLAIMS_BROWSER_EXECUTABLE ? { executablePath: process.env.KERYX_CLAIMS_BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://maintenance.invalid/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect.poll(async () => ({ mounted: await page.locator("#ask-question").count(), errors }),
      { timeout: 5000, message: "Real conversation mounted" }).toEqual({ mounted: 1, errors: [] });
    expect(errors).toEqual([]);
    const draft = page.locator("#ask-question"), dispatch = page.locator('[data-tour="dispatch-btn"]');
    await page.getByText("No global research pause was observed.", { exact: false }).waitFor();
    await draft.fill("Synthetic retained question"); await expect.poll(() => dispatch.isEnabled()).toBe(true);
    await dispatch.click(); await page.getByRole("alert").waitFor();
    expect(await page.getByRole("alert").innerText()).toContain("New application requests are held.");
    expect(await page.getByRole("link", { name: "Check service status", exact: true }).getAttribute("href")).toBe("/maintenance/status");
    expect(await page.getByRole("alert").innerText()).toContain("600s. Requests will not retry automatically.");
    await expect.poll(() => draft.inputValue()).toBe("Synthetic retained question");
    await draft.fill("A new draft must stay in this tab");
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await draft.inputValue()).toBe("A new draft must stay in this tab");
    const calls = await page.evaluate(() => (window as unknown as { calls: Array<{ url: string }> }).calls);
    expect(calls.filter(call => call.url === "/api/ask")).toHaveLength(1);
    expect(calls.filter(call => call.url === "/api/ask/sign")).toHaveLength(0); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 20_000);
