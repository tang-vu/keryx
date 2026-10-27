import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { researchGuidesCopy } from "../../locales/en/research-guides";

const copy = researchGuidesCopy.tool;
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';
    import{LiteratureReviewMatrix}from'./components/keryx/literature-review-matrix';
    createRoot(document.getElementById('root')).render(<LiteratureReviewMatrix/>);` }, bundle: true, write: false,
    platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "matrix-editor-link", setup(plugin) {
      plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "jsx", resolveDir: process.cwd(), contents: "export default function Link({children,prefetch,...props}){return <a {...props}>{children}</a>}" }));
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function fixture(width: number, test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const requests: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", route => {
      requests.push(route.request().url());
      return route.request().url() === "https://matrix-editor.test/" ? route.fulfill({ contentType: "text/html", body:
        '<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:12px}textarea,input{display:block;width:100%;font-size:16px}fieldset{margin:20px 0}button{min-height:44px}</style><main id="root"></main>' }) : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://matrix-editor.test/"); await page.addScriptTag({ content: bundle });
    await page.getByRole("button", { name: copy.add, exact: true }).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://matrix-editor.test/"]);
  } finally { await context.close(); }
}
const titles = (page: Page) => page.getByRole("textbox", { name: copy.columns.title, exact: true });

it.each([320, 1366])("focuses an inserted source title for immediate typing at %ipx", async width => {
  await fixture(width, async page => {
    const add = page.getByRole("button", { name: copy.add, exact: true });
    await add.focus(); await page.keyboard.press("Enter");
    await expect.poll(() => titles(page).last().evaluate(element => document.activeElement === element)).toBe(true);
    await page.keyboard.type("Original title");
    expect(await titles(page).first().inputValue()).toBe("Original title");
    await add.click();
    await expect.poll(() => titles(page).last().evaluate(element => document.activeElement === element)).toBe(true);
    await page.keyboard.type("Second title");
    expect(await titles(page).allTextContents()).toHaveLength(2);
    expect(await titles(page).first().inputValue()).toBe("Original title");
    expect(await titles(page).last().inputValue()).toBe("Second title");
    const bounds = (await titles(page).last().boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
  });
});

it("focuses the last actually inserted source when additions share a render", async () => {
  await fixture(390, async page => {
    await page.getByRole("button", { name: copy.add, exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect.poll(() => titles(page).count()).toBe(2);
    expect(await titles(page).last().evaluate(element => document.activeElement === element)).toBe(true);
    const finding = page.getByRole("textbox", { name: copy.columns.finding, exact: true }).first();
    await finding.fill("Retained finding");
    expect(await finding.evaluate(element => document.activeElement === element)).toBe(true);
    expect(await finding.inputValue()).toBe("Retained finding");
  });
});
