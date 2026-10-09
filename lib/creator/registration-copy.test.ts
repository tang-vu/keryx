import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { expect, it } from "vitest";
import { creatorRegistrationCopy as copy } from "../../locales/en/creator-registration";
import fixtures from "./fixtures/registration-copy-english.json";

const require = createRequire(import.meta.url);
const wallet = "0x" + "a".repeat(40);
const profile = { chainId: 5042, label: "Arc mainnet", explorerUrl: "https://explorer.invalid" };
const forbidden = () => { throw new Error("A copy fixture must not perform I/O or signing"); };

function component(source: string, states: unknown[], authenticated = true) {
  let stateIndex = 0;
  const nextState = () => [states[stateIndex++], forbidden];
  const ReactFixture = { ...React, useState: nextState, useEffect: () => {}, useLayoutEffect: () => {},
    useRef: (value: unknown) => ({ current: value }) };
  const modules: Record<string, unknown> = {
    "react": ReactFixture, "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": (props: React.ComponentProps<"a">) => React.createElement("a", props),
    "wagmi": { useAccount: () => ({ address: authenticated ? wallet : undefined, chainId: 5042 }),
      useConfig: () => ({}), useSignTypedData: () => ({ signTypedDataAsync: forbidden }) },
    "wagmi/actions": { getConnection: forbidden },
    "viem": require("viem"),
    "@/lib/hooks/use-siwe-auth": { useSiweAuth: () => ({ session: { address: wallet } }) },
    "@/lib/browser-payment-profile": { browserPaymentProfile: () => profile, browserRegistryAddress: () => "0x" + "b".repeat(40) },
    "@/lib/sources/registration-status": { registrationId: forbidden, confirmsIndex: forbidden },
    "@/lib/sources/registration-sponsor-protocol": { registrationIntentDigest: forbidden, registrationTypedData: forbidden, sponsoredRegistrationSchema: { parse: forbidden } },
    "@/lib/registry/registry-version": { getBrowserRegistryVersion: forbidden },
    "@/locales/en/creator-registration": { creatorRegistrationCopy: copy },
    "@/components/keryx/site-header": { SiteHeader: () => null },
    "@/components/keryx/site-footer": { SiteFooter: () => null },
    "@/components/keryx/sponsored-registration-form": { SponsoredRegistrationForm: () => null },
  };
  const fixtureModule = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(compiled, { module: fixtureModule, exports: fixtureModule.exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected fixture import: ${name}`);
    return modules[name];
  }, fetch: forbidden }, { timeout: 1000 });
  return fixtureModule.exports as Record<string, (props: Record<string, unknown>) => React.ReactNode | Promise<React.ReactNode>>;
}

function visible(html: string) {
  const window = new JSDOM(html).window;
  try {
    return [...window.document.querySelectorAll("h1,h2,p,button,label,a,input,section[aria-label]")].map(element => ({
      tag: element.tagName.toLowerCase(), text: element.textContent,
      attributes: Object.fromEntries([...element.attributes].filter(attribute => attribute.name !== "class").map(attribute => [attribute.name, attribute.value])),
    }));
  } finally { window.close(); }
}

it("keeps the English area catalogue and state labels immutable", () => {
  expect(Object.isFrozen(copy)).toBe(true);
  expect(Object.isFrozen(copy.stateLabels)).toBe(true);
  expect(Reflect.set(copy, "formLabel", "Changed")).toBe(false);
  expect(Reflect.set(copy.stateLabels, "prepared", "Changed")).toBe(false);
});

for (const fixture of fixtures.forms) {
  it(`preserves original visible text, accessibility and controls: ${fixture.name}`, async () => {
    const row = fixture.row;
    const states = [fixture.available === null ? null : { available: fixture.available }, fixture.claim, row,
      fixture.error, fixture.price, fixture.busy, fixture.indexed, fixture.manualId, new Set(fixture.attemptedIds)];
    const source = readFileSync(new URL("../../components/keryx/sponsored-registration-form.tsx", import.meta.url), "utf8");
    const form = component(source, states, fixture.authenticated).SponsoredRegistrationForm;
    const element = await form({ claimId: fixture.claim?.id });
    expect(visible(renderToStaticMarkup(element))).toEqual(fixture.visible);
  });
}

for (const fixture of fixtures.invitations) {
  it(`preserves original invitation visibility and link: ${fixture.name}`, async () => {
    const source = readFileSync(new URL("../../components/keryx/registration-sponsor-link.tsx", import.meta.url), "utf8");
    const link = component(source, [fixture.result]).RegistrationSponsorLink;
    expect(visible(renderToStaticMarkup(await link({ wallet, claimId: fixture.claimId })))).toEqual(fixture.visible);
  });
}

it("preserves original page metadata and visible introduction", async () => {
  const source = readFileSync(new URL("../../app/register/sponsored/page.tsx", import.meta.url), "utf8");
  const page = component(source, []);
  expect(page.metadata).toEqual(fixtures.page.metadata);
  expect(visible(renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ claimId: "1".repeat(64) }) })))).toEqual(fixtures.page.visible);
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
