import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { expect, it } from "vitest";
import { creatorRegistrationCopy as copy } from "../../locales/en/creator-registration";
import * as displayFormat from "../i18n/format";
import * as signingAmount from "../../components/keryx/signing-amount";
import * as displayTime from "../../components/keryx/display-time";
import * as uiCopy from "../i18n/ui-copy";
import { createMessages } from "../i18n/messages";
import { createRichMessages } from "../i18n/rich-messages";
import * as registrationReturn from "../registration-return";
import * as sourceClaimContract from "../sources/public-source-claim";
import fixtures from "./fixtures/registration-copy-english.json";

const require = createRequire(import.meta.url);
const wallet = "0x" + "a".repeat(40);
const profile = { chainId: 5042, networkId: "eip155:5042", label: "Arc mainnet", explorerUrl: "https://explorer.invalid" };
const forbidden = () => { throw new Error("A copy fixture must not perform I/O or signing"); };

function component(source: string, states: unknown[], authenticated = true, overrides: Record<string, unknown> = {}) {
  let stateIndex = 0;
  const nextState = () => [states[stateIndex++], forbidden];
  const ReactFixture = { ...React, useState: nextState, useEffect: () => {}, useLayoutEffect: () => {},
    useCallback: (callback: unknown) => callback,
    useRef: (value: unknown) => ({ current: value }) };
  const modules: Record<string, unknown> = {
    "react": ReactFixture, "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": (props: React.ComponentProps<"a">) => React.createElement("a", props),
    "wagmi": { useAccount: () => ({ address: authenticated ? wallet : undefined, chainId: 5042, isConnected: authenticated }),
      useConfig: () => ({}), useSignTypedData: () => ({ signTypedDataAsync: forbidden }) },
    "wagmi/actions": { getConnection: forbidden },
    "viem": require("viem"),
    "@/lib/hooks/use-siwe-auth": { useSiweAuth: () => ({ session: { address: wallet } }) },
    "@/lib/browser-payment-profile": { browserPaymentProfile: () => profile, browserRegistryAddress: () => "0x" + "b".repeat(40) },
    "@/lib/sources/registration-status": { registrationId: forbidden, confirmsIndex: forbidden },
    "@/lib/sources/registration-sponsor-protocol": { registrationIntentDigest: forbidden, registrationTypedData: forbidden, sponsoredRegistrationSchema: { parse: forbidden } },
    "@/lib/registry/registry-version": { getBrowserRegistryVersion: forbidden },
    "@/locales/en/creator-registration": { creatorRegistrationCopy: copy },
    // This VM fixture fixes English and manually supplies React hook state.
    // Keep its no-I/O boundary and all original markup/control assertions.
    "@/lib/i18n/ui-copy": { ...uiCopy, useUiCopy: <T>(_namespace: string, value: T) => value,
      useUiCopyFunction: <T>(_namespace: string, value: T) => value,
      useUiMessages: () => createMessages("en"), useUiRichMessages: () => createRichMessages("en") },
    "@/lib/i18n/format": displayFormat,
    "@/lib/registration-return": registrationReturn,
    "@/lib/sources/public-source-claim": sourceClaimContract,
    "./signing-amount": signingAmount,
    "./display-time": displayTime,
    "@/components/keryx/site-header": { SiteHeader: () => null },
    "@/components/keryx/site-footer": { SiteFooter: () => null },
    "@/components/keryx/sponsored-registration-form": { SponsoredRegistrationForm: () => null },
    "./sponsored-registration-form": { SponsoredRegistrationForm: () => null },
    "./public-source-claim-form": { PublicSourceClaimForm: () => null },
    "./public-source-claim-policy": { PublicSourceClaimPolicy: () => null },
    "./public-source-claim-api": { claimRequest: forbidden },
    ...overrides,
  };
  const fixtureModule = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(compiled, { module: fixtureModule, exports: fixtureModule.exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected fixture import: ${name}`);
    return modules[name];
  }, fetch: forbidden, URL, URLSearchParams, Error }, { timeout: 1000 });
  return fixtureModule.exports as Record<string, (props: Record<string, unknown>) => React.ReactNode | Promise<React.ReactNode>>;
}

function visible(html: string) {
  const window = new JSDOM(html).window;
  try {
    return [...window.document.querySelectorAll("h1,h2,p,button,label,a,input,section[aria-label]")].map(element => ({
      tag: element.tagName.toLowerCase(), text: element.textContent ?? "",
      attributes: Object.fromEntries([...element.attributes].filter(attribute => attribute.name !== "class").map(attribute => [attribute.name, attribute.value])),
    }));
  } finally { window.close(); }
}

/** Explicitly adapt the intentional draft links, recovery grouping and micro-USDC input.
 * All other historical English text and control attributes retain their stored baseline. */
function currentFormBaseline(fixture: (typeof fixtures.forms)[number]) {
  const params = new URLSearchParams();
  if (fixture.authenticated) params.set("owner", wallet);
  if (fixture.claim) params.set("sourceClaimId", fixture.claim.id);
  params.set("fetchPrice", String(Number(fixture.price)));
  params.set("chainId", "5042");
  const connect = `/connect?returnTo=${encodeURIComponent(`/register?${params}`)}`;
  params.set("mode", "wallet-funded");
  const fallback = `/register?${params}`;
  return fixture.visible.map(item => {
    const attributes = { ...item.attributes } as Record<string, string>;
    if (attributes.href === "/connect") attributes.href = connect;
    if (attributes.href === "/register" && item.text === copy.walletFundedRegistrationLink) attributes.href = fallback;
    if (attributes.type === "number") attributes.step = "0.000001";
    const text = item.tag === "section" && !fixture.row
      ? item.text.replace(copy.recoverRequestLabel, copy.advancedRecovery + copy.recoverRequestLabel) : item.text;
    return { ...item, text, attributes };
  });
}

it("keeps the English area catalogue and state labels immutable", () => {
  expect(Object.isFrozen(copy)).toBe(true);
  expect(Object.isFrozen(copy.stateLabels)).toBe(true);
  expect(Reflect.set(copy, "formLabel", "Changed")).toBe(false);
  expect(Reflect.set(copy.stateLabels, "prepared", "Changed")).toBe(false);
});

for (const fixture of fixtures.forms) {
  it(`preserves original visible text, accessibility and controls: ${fixture.name}`, async () => {
    const row = fixture.row ? { ...fixture.row, policyDigest: `0x${"e".repeat(64)}` } : null;
    const states = [fixture.available === null ? null : { available: fixture.available,
      ...(row ? { sponsorAddress: row.relayer, policyDigest: row.policyDigest } : {}) }, fixture.claim, row,
      fixture.error, fixture.price, fixture.busy, fixture.indexed, false, fixture.manualId, new Set(fixture.attemptedIds)];
    const source = readFileSync(new URL("../../components/keryx/sponsored-registration-form.tsx", import.meta.url), "utf8");
    const form = component(source, states, fixture.authenticated).SponsoredRegistrationForm;
    const element = await form({ claimId: fixture.claim?.id });
    const html = renderToStaticMarkup(element), rendered = visible(html), baseline = currentFormBaseline(fixture);
    if (!row && fixture.authenticated) {
      const window = new JSDOM(html).window;
      try {
        const recovery = window.document.querySelector("details");
        expect(recovery?.querySelector("summary")?.textContent).toBe(copy.advancedRecovery);
        expect(recovery?.hasAttribute("open")).toBe(false);
        expect(recovery?.querySelector("button")?.textContent).toBe(copy.inspectSavedButton);
      } finally { window.close(); }
      if (Number(fixture.price) < 0) {
        const fallback = rendered.find(item => item.tag === "a" && item.text === copy.walletFundedRegistrationLink);
        expect(() => registrationReturn.registrationDraft(new URL(fallback!.attributes.href, "https://draft.invalid").searchParams))
          .toThrow("Use an exact, nonnegative USDC read price with at most six decimal places.");
      }
    }
    if (row && ["signing", "submitted"].includes(row.state)) {
      expect(rendered).toContainEqual({ tag: "p", attributes: {}, text: copy.resumeOriginalExplanation });
      expect(rendered).toContainEqual({ tag: "button", attributes: fixture.busy || !fixture.available ? { disabled: "" } : {}, text: copy.resumeOriginalButton });
      expect(rendered).toContainEqual({ tag: "p", attributes: {}, text: copy.resolveExpiredExplanation });
      expect(rendered).toContainEqual({ tag: "button", attributes: fixture.busy || !fixture.available ? { disabled: "" } : {}, text: copy.resolveExpiredButton });
      // Preserve the historical copy baseline separately from the intentional new execution control.
      const additions: readonly string[] = [copy.resumeOriginalExplanation, copy.resumeOriginalButton, copy.resolveExpiredExplanation, copy.resolveExpiredButton];
      const original = rendered.filter(item => !additions.includes(item.text))
        .map(item => ({ ...item, text: item.text.replace(copy.resumeOriginalExplanation + copy.resumeOriginalButton, "").replace(copy.resolveExpiredExplanation + copy.resolveExpiredButton, "") }));
      expect(original).toEqual(baseline);
    } else if (row?.state === "reverted" && fixture.claim && fixture.available) {
      expect(rendered).toContainEqual({ tag: "p", attributes: {}, text: copy.revertedRequestExplanation });
      expect(rendered).toContainEqual({ tag: "button", attributes: fixture.busy ? { disabled: "" } : {}, text: copy.prepareReplacementButton });
      const revertedAdditions: readonly string[] = [copy.revertedRequestExplanation, copy.prepareReplacementButton];
      const original = rendered.filter(item => !revertedAdditions.includes(item.text))
        .map(item => ({ ...item, text: item.text.replace(copy.revertedRequestExplanation + copy.prepareReplacementButton, "") }));
      expect(original).toEqual(baseline);
    } else expect(rendered).toEqual(baseline);
  });
}

for (const fixture of fixtures.invitations) {
  it(`preserves original invitation visibility and link: ${fixture.name}`, async () => {
    const source = readFileSync(new URL("../../components/keryx/registration-sponsor-link.tsx", import.meta.url), "utf8");
    const link = component(source, [fixture.result]).RegistrationSponsorLink;
    const href = `/register?owner=${wallet}${fixture.claimId ? `&sourceClaimId=${fixture.claimId}` : ""}&chainId=5042`;
    expect(visible(renderToStaticMarkup(await link({ wallet, claimId: fixture.claimId })))).toEqual(
      fixture.visible.map(item => item.tag === "a" ? { ...item, attributes: { ...item.attributes, href } } : item));
  });
}

it("preserves invitation copy while retaining the complete public source draft at /register", async () => {
  const source = readFileSync(new URL("../../components/keryx/registration-sponsor-link.tsx", import.meta.url), "utf8");
  const link = component(source, [{ wallet, available: true }]).RegistrationSponsorLink;
  const rendered = visible(renderToStaticMarkup(await link({ wallet, claimId: "1".repeat(64),
    publisherUrl: "https://feed.invalid/science", rssUrl: "https://feed.invalid/rss", name: "Science & reading", fetchPrice: 0.016 })))
    .find(item => item.tag === "a");
  const target = new URL(rendered!.attributes.href, "https://draft.invalid");
  expect(target.pathname).toBe("/register");
  expect(Object.fromEntries(target.searchParams)).toEqual({ url: "https://feed.invalid/science", rss: "https://feed.invalid/rss",
    name: "Science & reading", owner: wallet, sourceClaimId: "1".repeat(64), fetchPrice: "0.016", chainId: "5042" });
  expect(rendered!.text).toBe(copy.sponsoredRegistrationLink);
});

it("preserves page metadata and delegates exact public draft context to the unified registration flow", async () => {
  const source = readFileSync(new URL("../../app/register/sponsored/page.tsx", import.meta.url), "utf8");
  let received: Record<string, unknown> | undefined;
  const page = component(source, [], true, { "@/components/keryx/creator-registration": {
    CreatorRegistration: (props: Record<string, unknown>) => { received = props; return null; },
  } });
  expect(page.metadata).toEqual(fixtures.page.metadata);
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ claimId: "1".repeat(64),
    url: "https://feed.invalid/science", rss: "https://feed.invalid/rss", name: "Science & reading",
    owner: wallet, fetchPrice: "0.016", chainId: "5042" }) }));
  expect(received).toEqual({ initial: { sourceClaimId: "1".repeat(64), url: "https://feed.invalid/science",
    rssUrl: "https://feed.invalid/rss", name: "Science & reading", owner: wallet, fetchPrice: 0.016, chainId: 5042 }, initialError: "" });
  expect(visible(html)).toEqual([]); // The shared child owns the introduction; the route adds no duplicate copy.
  renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ owner: "invalid" }) }));
  expect(received).toEqual({ initial: {}, initialError: "Invalid initiating wallet." });
});

it("renders the unified introduction and keeps review and earnings permission behind verified state", async () => {
  const source = readFileSync(new URL("../../components/keryx/creator-registration.tsx", import.meta.url), "utf8");
  const flow = component(source, [{}, { draft: {}, error: "" }, null, null, "", false, 0]).CreatorRegistration;
  const rendered = visible(renderToStaticMarkup(await flow({})));
  expect(rendered).toContainEqual({ tag: "h1", attributes: {}, text: "Register your source" });
  expect(rendered).toContainEqual({ tag: "p", attributes: {}, text: "Verify your RSS feed, review the registration and sign with your creator wallet. Keryx covers gas while its sponsorship wallet has enough funds. You keep control and receive creator payments." });
  expect(rendered).toContainEqual({ tag: "h2", attributes: { id: "creator-verify-title" }, text: "1. Verify your source" });
  expect(rendered).toContainEqual({ tag: "p", attributes: {}, text: "Publish a proof on your website or in your RSS feed. Verification alone does not enable paid distribution." });
  expect(rendered.filter(item => item.tag === "h2")).toHaveLength(1);
  const fallback = rendered.find(item => item.tag === "a" && item.text === copy.walletFundedRegistrationLink);
  expect(fallback?.attributes.href).toBe(`/register?owner=${wallet}&chainId=5042&mode=wallet-funded`);
});

it("preserves both original listing-update explanations at their actual conditional", () => {
  const source = readFileSync(new URL("../../app/creator/[id]/listing-controls-panel.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("listing.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isConditionalExpression(node) && node.whenTrue.getText(ast) === "copy.priceOnlyUpdateExplanation") expression = node.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast); expect(expression).toBeDefined();
  for (const fixture of fixtures.listing) {
    const compiled = ts.transpileModule(`module.exports = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const fixtureModule = { exports: "" };
    runInNewContext(compiled, { module: fixtureModule, copy, data: { registryVersion: fixture.version } }, { timeout: 1000 });
    expect(fixtureModule.exports).toBe(fixture.text);
  }
});

it("retains all original recovery-warning text through catalogue-backed error paths", () => {
  const source = readFileSync(new URL("../../components/keryx/sponsored-registration-form.tsx", import.meta.url), "utf8");
  for (const [key, original] of Object.entries(fixtures.errors)) {
    expect(source).toContain(`copy.${key}`);
    expect(copy[key as keyof typeof copy]).toBe(original);
  }
});

it("treats interpolated display data as escaped text without changing money units", () => {
  const element = React.createElement("p", null, copy.gasReservation({ gasUsdc: "0.02<script>" }));
  expect(renderToStaticMarkup(element)).toBe("<p>Keryx gas reservation: up to 0.02&lt;script&gt; USDC. This is separate from creator earnings.</p>");
});
