import { chromium } from "playwright";
import { resolve } from "node:path";
import { checkUiPreviews } from "../test-support/ui-preview-acceptance";

const browser = await chromium.launch({ headless: true });
try {
  await checkUiPreviews(browser, process.env.UI_PREVIEW_BASE_URL ?? "http://127.0.0.1:4067",
    resolve(process.env.UI_PREVIEW_OUTPUT ?? "output/ui-preview-browser"));
} finally { await browser.close(); }
