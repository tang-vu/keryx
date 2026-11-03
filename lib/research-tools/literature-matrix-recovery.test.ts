import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { emptyMatrixRow } from "./literature-matrix";
import { literatureMatrixCsv } from "./literature-matrix";
import { MATRIX_RECOVERY_DISABLED, MATRIX_RECOVERY_KEY, readMatrixRecovery, writeMatrixRecovery } from "./literature-matrix-recovery";
import { researchGuidesCopy } from "../../locales/en/research-guides";

const copy = researchGuidesCopy.tool;
describe("closed matrix recovery record", () => {
  it("preserves multilingual and formula-like notes exactly", () => {
    const document = { question: "Thời tiết và khí hậu? 天气", rows: [{ ...emptyMatrixRow(), title: "Nguồn 🧪", finding: "=SUM(A1:A2)\n\tOriginal" }] };
    expect(readMatrixRecovery(writeMatrixRecovery(document))).toEqual(document);
    expect(readMatrixRecovery(MATRIX_RECOVERY_DISABLED)).toBe("disabled");
  });
  it("refuses CSV, foreign versions, extra fields and over-limit text", () => {
    const valid = JSON.parse(writeMatrixRecovery({ question: "Question", rows: [] }));
    for (const text of [literatureMatrixCsv("Question", []), "{}", JSON.stringify({ ...valid, version: 2 }),
      JSON.stringify({ ...valid, credential: "private" }), JSON.stringify({ ...valid, question: "x".repeat(2001) }),
      JSON.stringify({ format: "different", version: 1, question: "Q", rows: [] }), " ".repeat(6 * 1024 * 1024 + 1)]) {
      expect(() => readMatrixRecovery(text)).toThrow();
    }
  });
});

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{StrictMode} from 'react'; import {createRoot} from 'react-dom/client';
    import {LiteratureReviewMatrix} from './components/keryx/literature-review-matrix';
    const root=createRoot(document.getElementById('root'));
    function render(){ root.render(<StrictMode>{location.pathname==='/other'
      ? <a data-route href='/'>Return to matrix</a>
      : <><a data-route href='/other'>Leave matrix</a><LiteratureReviewMatrix/></>}</StrictMode>); }
    document.addEventListener('click',event=>{ const a=event.target.closest?.('a[data-route]');
      if(!a||event.defaultPrevented)return; event.preventDefault();history.pushState(null,'',a.href);render(); });
    addEventListener('popstate',render);render();` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "matrix-recovery-link", setup(plugin) {
      plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "jsx", resolveDir: process.cwd(),
        contents: "export default function Link({prefetch,children,...props}){return <a {...props}>{children}</a>}" }));
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function fixture(test: (page: Page) => Promise<void>, init?: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
  const forbidden: string[] = [], errors: string[] = [];
  try {
    if (init) await context.addInitScript(init);
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "https://matrix-recovery.test" || request.method() !== "GET") { forbidden.push(request.url()); return route.abort(); }
      if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
      return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}textarea{display:block;width:100%;font-size:16px}button{min-height:44px}body{margin:12px}</style><main id="root"></main><script src="/fixture.js"></script>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.type() === "confirm" ? dialog.dismiss() : dialog.accept());
    await page.goto("https://matrix-recovery.test/");
    await page.getByLabel(copy.question, { exact: true }).waitFor();
    await test(page);
    expect(forbidden).toEqual([]); expect(errors).toEqual([]);
  } finally { await context.close(); }
}
const question = (page: Page) => page.getByLabel(copy.question, { exact: true });
const stored = (page: Page) => page.evaluate(key => sessionStorage.getItem(key), MATRIX_RECOVERY_KEY);

it("recovers exact notes on reload without treating them as a downloaded backup", async () => fixture(async page => {
  await question(page).fill("Câu hỏi 天气 🧪");
  await page.getByRole("button", { name: copy.add, exact: true }).click();
  await page.getByLabel(copy.columns.finding, { exact: true }).fill("=1+2\nDữ liệu gốc");
  await expect.poll(() => stored(page)).toContain("Dữ liệu gốc");
  await page.reload(); await page.getByText(copy.recovered, { exact: true }).waitFor();
  expect(await question(page).inputValue()).toBe("Câu hỏi 天气 🧪");
  expect(await page.getByLabel(copy.columns.finding, { exact: true }).inputValue()).toBe("=1+2\nDữ liệu gốc");
  expect(await page.getByText(copy.unsaved, { exact: true }).count()).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}));

it("cancels in-app departure and recovers after an accepted departure and Browser Back", async () => fixture(async page => {
  await question(page).fill("Preserve my work");
  await page.getByRole("link", { name: "Leave matrix", exact: true }).click();
  expect(new URL(page.url()).pathname).toBe("/"); expect(await question(page).inputValue()).toBe("Preserve my work");
  page.removeAllListeners("dialog"); page.on("dialog", dialog => dialog.accept());
  await page.getByRole("link", { name: "Leave matrix", exact: true }).click();
  await page.getByRole("link", { name: "Return to matrix", exact: true }).waitFor();
  await page.goBack(); await page.getByText(copy.recovered, { exact: true }).waitFor();
  expect(await question(page).inputValue()).toBe("Preserve my work");
}));

it("removes notes from recovery when disabled and remembers the tab's choice", async () => fixture(async page => {
  await question(page).fill("Private notes"); await expect.poll(() => stored(page)).toContain("Private notes");
  await page.getByRole("checkbox", { name: copy.recoveryChoice, exact: true }).uncheck();
  expect(await stored(page)).toBe(MATRIX_RECOVERY_DISABLED);
  await question(page).fill("Never persist this"); await page.reload();
  expect(await question(page).inputValue()).toBe("");
  expect(await page.getByRole("checkbox", { name: copy.recoveryChoice, exact: true }).isChecked()).toBe(false);
  expect(await stored(page)).toBe(MATRIX_RECOVERY_DISABLED);
}));

it("retains unreadable recovery until an explicit replacement, with no content execution", async () => fixture(async page => {
  await page.getByText(copy.recoveryUnavailable, { exact: true }).waitFor();
  expect(await question(page).inputValue()).toBe(""); expect(await stored(page)).toBe('{"private":"<img src=x onerror=alert(1)>"}');
  await question(page).fill("New notes"); expect(await stored(page)).toContain('"private"');
  await page.getByRole("button", { name: copy.replaceRecovery, exact: true }).click();
  await expect.poll(() => stored(page)).toContain("New notes");
  expect(await page.locator('img[src="x"]').count()).toBe(0);
}, `sessionStorage.setItem(${JSON.stringify(MATRIX_RECOVERY_KEY)},'{"private":"<img src=x onerror=alert(1)>"}')`));

it("keeps the last recovery and current notes when the browser refuses a write", async () => fixture(async page => {
  await question(page).fill("Last persisted notes"); await expect.poll(() => stored(page)).toContain("Last persisted notes");
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, value) { if (k === key) throw new DOMException("Refused", "QuotaExceededError"); return original.call(this, k, value); };
  }, MATRIX_RECOVERY_KEY);
  await question(page).fill("Latest still visible notes"); await page.getByText(copy.recoveryUnavailable, { exact: true }).waitFor();
  expect(await stored(page)).toContain("Last persisted notes"); expect(await question(page).inputValue()).toBe("Latest still visible notes");
  await page.getByRole("checkbox", { name: copy.recoveryChoice, exact: true }).click();
  expect(await page.getByRole("checkbox", { name: copy.recoveryChoice, exact: true }).isChecked()).toBe(true);
  await page.getByRole("link", { name: "Leave matrix", exact: true }).click();
  expect(new URL(page.url()).pathname).toBe("/");
}));

it("keeps editing and navigation protection available when storage access is denied", async () => fixture(async page => {
  await page.getByText(copy.recoveryUnavailable, { exact: true }).waitFor();
  await question(page).fill("Work without storage");
  await page.getByRole("link", { name: "Leave matrix", exact: true }).click();
  expect(await question(page).inputValue()).toBe("Work without storage");
}, 'Object.defineProperty(window,"sessionStorage",{get(){throw new DOMException("Denied","SecurityError")}})'));
