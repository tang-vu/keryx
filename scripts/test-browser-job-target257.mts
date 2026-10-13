/** Hermetic real-component fixture. Every browser request is intercepted; no server/ENV/provider. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({ write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { flushSync } from "react-dom";
    import { ResearchJobEscalation } from "./components/keryx/research-job-escalation";
    import { ResearchJobTarget } from "./components/keryx/research-job-target";
    const initial = { state: "within_target", escalationNeeded: false,
      acceptedAt: "2026-10-12T00:00:00.000Z", observedAt: "2026-10-12T00:02:59.000Z",
      targetCompletionAt: "2026-10-12T00:03:00.000Z", targetCompletionMs: 180000, elapsedMs: 179000,
      lastRecordedStage: "creator_payment_boundary", failureCode: null, creatorPaymentState: "pending_recorded",
      evaluation: "on_observation", objectiveKind: "provisional_slo", remedy: "none" };
    function Fixture() {
      const [snapshot, setSnapshot] = useState(initial);
      globalThis.updateJobTargetFixture = value => flushSync(() => setSnapshot(value === "completed" ?
        { ...initial, state: "completed" } : { ...initial, observedAt: "2026-10-12T00:02:58.000Z", elapsedMs: 178000 }));
      return <><ResearchJobTarget mode="quick" version="1.0.0" />
        <ResearchJobTarget mode="deep" version="1.0.0" monthly />
        <ResearchJobEscalation escalation={snapshot} /></>;
    }
    createRoot(document.getElementById("fixture")).render(<Fixture />);
  ` } });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    let requests = 0;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      requests++;
      assert.equal(route.request().url(), "http://job-target257.test/");
      return route.fulfill({ contentType: "text/html", body: `<div id="fixture"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    // Intentionally foreign wall clock: the warning must use monotonic/server elapsed time.
    await page.clock.install({ time: new Date("2040-01-01T00:00:00Z") });
    await page.clock.pauseAt(new Date("2040-01-01T00:01:00Z"));
    await page.goto("http://job-target257.test/");
    await page.getByText("Quick completion target:", { exact: false }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.clock.runFor(1000);
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.clock.runFor(1);
    await page.getByRole("alert").waitFor();
    const alert = page.getByRole("alert");
    assert.match(await alert.innerText(), /elapsed since the last status check/);
    assert.match(await alert.innerText(), /pending/);
    assert.match(await alert.innerText(), /does not establish its current state/);
    for (const [choice, guidance] of [["Wait", "Waiting does not restart"],
      ["Partial-result guidance", "No partial result"], ["Human-review guidance", "has not contacted a responder"]]) {
      await page.getByRole("button", { name: choice, exact: true }).click();
      assert.match(await page.getByRole("status").innerText(), new RegExp(guidance));
    }
    assert.equal(requests, 1, "Guidance and deadline crossing must make no request");
    await page.evaluate(() => (globalThis as any).updateJobTargetFixture("completed"));
    await alert.waitFor({ state: "detached" });
    await page.clock.runFor(60_000);
    assert.equal(await page.getByRole("alert").count(), 0, "Completed status must cancel stale warning");
    await page.evaluate(() => (globalThis as any).updateJobTargetFixture("new-observation"));
    await page.clock.runFor(2001);
    await page.getByRole("alert").waitFor();
    assert.deepEqual(errors, []);
    assert.equal(requests, 1);
    await page.close();
    console.log(`PASS original deadline/pending leg/guidance/terminal update; viewport ${width}; one intercepted request`);
  }
} finally { await browser.close(); }
