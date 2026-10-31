import assert from "node:assert/strict";
import type { Browser, Locator, Page } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { preparedLocales, uiLocaleNames } from "../lib/i18n/locales";
import { productGuideCopy } from "../locales/en/product-guide";
import { answerLanguageInstructions } from "../shared/i18n/answer-language-instructions";
import { setupCopy } from "../locales/en/get-started";
import { installationLinks, setupExamples } from "../lib/public-installation";

/** Integration setup checks shared by compiled pages and the explicitly mocked source fixture. */
export async function checkIntegrationGuide(page: Page, locale: string, width: number, entries: Readonly<Record<string, { text: string }>>, output?: string) {
  const guide = setupCopy.integrations;
  const translated = (key: string, original: string) => entries[key]?.text ?? original;
  const examples = [
    ["remoteEndpoint", guide.remoteEndpoint, setupExamples.remoteEndpoint], ["stdioConfig", guide.stdioConfig, setupExamples.stdio],
    ["apiReadOnly", guide.apiReadOnly, setupExamples.models], ["apiExample", guide.apiExample, setupExamples.chat],
    ["cliSetup", guide.cliSetup, setupExamples.cli],
  ] as const;
  const codes = page.locator("main pre"); assert.equal(await codes.count(), examples.length);
  for (const [index, [key, original, command]] of examples.entries()) {
    const code = codes.nth(index), header = code.locator("xpath=preceding-sibling::div[1]");
    const title = key === "apiExample" ? original : translated(`integrations.${key}`, original);
    assert.equal(await code.textContent(), command);
    assert.equal(await code.getAttribute("aria-labelledby"), await header.locator("p").getAttribute("id"));
    assert.equal(await code.locator("code").getAttribute("lang"), "en"); assert.equal(await code.getAttribute("translate"), "no");
    assert.equal(await code.evaluate(element => getComputedStyle(element).direction), "ltr");
    assert.equal(await header.locator("p span").textContent(), title);
    assert.equal(await header.locator("p span").getAttribute("lang"), title === original ? "en" : locale);
    assert.equal(await header.locator("button").getAttribute("aria-label"), `${entries["common.copy"].text} ${title}`);
  }
  for (const original of [guide.body, guide.remoteBody, guide.remoteStep, guide.stdioBody, guide.stdioRequirements,
    guide.stdioStep, guide.apiBody, guide.apiExampleNotice, guide.a2aBody, guide.cliBoundary, guide.botsBody]) {
    const leaf = page.locator("main").getByText(original, { exact: true }); assert.equal(await leaf.count(), 1);
    assert.equal(await leaf.evaluate(element => element.closest("[lang]")?.getAttribute("lang")), "en");
  }
  const botCards = page.locator("#bots article");
  assert.equal(await botCards.count(), 3);
  for (const [index, [key, original, token]] of [
    ["telegramBody", guide.telegramBody, "/ask"], ["discordBody", guide.discordBody, "/ask"], ["slackBody", guide.slackBody, "/keryx"],
  ].entries()) {
    const body = botCards.nth(index).locator("p > span"), command = body.locator("bdi");
    const text = translated(`integrations.${key}`, original);
    assert.equal(await body.textContent(), text);
    assert.equal(await body.getAttribute("lang"), text === original ? "en" : locale);
    assert.equal(await command.textContent(), token); assert.equal(await command.getAttribute("lang"), "en");
    assert.equal(await command.evaluate(element => getComputedStyle(element).direction), "ltr");
    assert.equal(await command.evaluate(element => getComputedStyle(element).whiteSpace), "nowrap");
  }
  const packageName = page.locator("#cli > p").first().locator("bdi");
  assert.equal(await packageName.textContent(), "keryx-mcp");
  assert.equal(await packageName.evaluate(element => getComputedStyle(element).direction), "ltr");
  assert.equal(await packageName.evaluate(element => getComputedStyle(element).whiteSpace), "nowrap");
  const versions = page.locator("#cli > p").nth(1).locator("bdi");
  assert.deepEqual(await versions.allTextContents(), ["22.19+", "24+", "11.19.0"]);
  for (const version of await versions.all()) assert.equal(await version.evaluate(element => getComputedStyle(element).direction), "ltr");
  assert.deepEqual(await page.locator("#bots article > a:first-of-type").evaluateAll(links => links.map(link => link.getAttribute("href"))), [
    installationLinks.telegram, installationLinks.discord, `${installationLinks.docs}slack-bot-setup.md`,
  ]);
  const botLinks = await botCards.locator("a").all();
  await botLinks[0].focus();
  for (let index = 1; index < botLinks.length; index++) {
    await botLinks[index - 1].press("Tab");
    assert.equal(await botLinks[index].evaluate(element => document.activeElement === element), true);
  }
  assert.equal(await page.locator('nav a[aria-current="page"]').getAttribute("href"), "/integrations");
  assert((await page.title()).includes(guide.metadata));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${locale}/${width} integration overflow`);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (output) await page.screenshot({ path: resolve(output, `${locale}-${width}-integrations.png`), fullPage: true });
  await page.evaluate(() => {
    const state = window as unknown as { setupPreviewCopies: string[] }; state.setupPreviewCopies = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText(text: string) { state.setupPreviewCopies.push(text); } } });
  });
  for (const code of await codes.all()) {
    const wrapper = code.locator(".."); const button = wrapper.locator("button");
    await button.press("Enter"); await wrapper.getByRole("status").getByText(entries["common.copied"].text, { exact: true }).waitFor();
    await button.press("Tab"); assert.equal(await code.evaluate(element => document.activeElement === element), true);
  }
  assert.deepEqual(await page.evaluate(() => (window as unknown as { setupPreviewCopies: string[] }).setupPreviewCopies), examples.map(example => example[2]));
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText() { throw Error("synthetic clipboard refusal"); } } }));
  await codes.first().locator("..").locator("button").press("Enter");
  const failure = codes.first().locator("..").getByRole("status");
  await failure.getByText(setupCopy.common.copyFailed, { exact: true }).waitFor();
  assert.equal(await failure.locator("span").getAttribute("lang"), "en");
  assert.equal(await failure.locator("span").evaluate(element => getComputedStyle(element).direction), "ltr");
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), examples[0][2]);
}

/** Real compiled pages and language controls; no research, payment or external requests. */
export async function checkUiPreviews(browser: Browser, base: string, output?: string) {
  assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Local preview only");
  if (output) await mkdir(output, { recursive: true });
  const locales = preparedLocales.filter(locale => locale !== "en");
  const drafts = Object.fromEntries(await Promise.all(locales.map(async locale => [locale,
    Object.fromEntries(await Promise.all(["core-inline", "get-started", "ui-preference", "product-guide"].map(async namespace =>
      [namespace, JSON.parse(await readFile(`locales/${locale}/ui-drafts/${namespace}.json`, "utf8"))])))])));
  const checkSetupPage = async (page: Page, locale: typeof locales[number], width: number) => {
    const entries = drafts[locale]["get-started"].entries;
    const cards = page.locator('[aria-labelledby="choose-keryx"] article');
    assert.equal(await cards.count(), setupCopy.surfaces.length);
    for (const [index, surface] of setupCopy.surfaces.entries()) {
      const card = cards.nth(index);
      for (const field of ["title", "tag", "action"] as const) {
        const text = entries[`surfaces.${index}.${field}`].text;
        const leaf = card.getByText(text, { exact: true });
        assert.equal(await leaf.count(), 1, `${locale}/${width} ${surface.id} ${field}`);
        const language = text === surface[field] ? "en" : locale;
        assert.equal(await leaf.evaluate(element => element.closest("[lang]")?.getAttribute("lang")), language);
        if (locale === "ar")
          assert.equal(await leaf.evaluate(element => getComputedStyle(element).direction), language === "ar" ? "rtl" : "ltr");
      }
      assert.equal(await card.locator("a").getAttribute("href"), surface.href);
      if (surface.id !== "desktop")
        assert.equal(await card.getByText(entries[`surfaces.${index}.body`].text, { exact: true }).count(), 1);
    }
    const retained = cards.nth(1).getByText(setupCopy.surfaces[1].body, { exact: true });
    assert.equal(await retained.evaluate(element => element.closest("[lang]")?.getAttribute("lang")), "en");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${locale}/${width} setup overflow`);
    if (output) await page.screenshot({ path: resolve(output, `${locale}-${width}-setup.png`), fullPage: true });
    const platform = page.locator('[aria-labelledby="setup-faq"] details').nth(2);
    const summary = platform.locator("summary");
    assert.equal(await summary.textContent(), entries["start.faq.2.question"].text);
    await summary.press("Enter");
    assert.equal(await platform.getAttribute("open"), "");
    const answer = platform.getByText(entries["start.faq.2.answer"].text, { exact: true });
    assert.equal(await answer.evaluate(element => element.closest("[lang]")?.getAttribute("lang")), locale);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${locale}/${width} expanded platform guidance overflow`);
    if (output) await platform.screenshot({ path: resolve(output, `${locale}-${width}-setup-platform.png`) });
    await summary.press("Space");
    assert.equal(await platform.getAttribute("open"), null);
  };
  const checkDownloadPage = async (page: Page, locale: typeof locales[number], width: number) => {
    const entries = drafts[locale]["get-started"].entries;
    const copy = setupCopy.download;
    const checkLeaf = async (scope: Locator, key: string, original: string) => {
      const text = entries[key]?.text ?? original;
      const leaf = scope.getByText(text, { exact: true });
      assert.equal(await leaf.count(), 1, `${locale}/${width} download ${key}`);
      const language = text === original ? "en" : locale;
      assert.equal(await leaf.evaluate(element => element.closest("[lang]")?.getAttribute("lang")), language);
      if (locale === "ar")
        assert.equal(await leaf.evaluate(element => getComputedStyle(element).direction), language === "ar" ? "rtl" : "ltr");
    };
    await checkLeaf(page.locator("main h1"), "download.title", copy.title);
    for (const [id, fields, steps] of [
      ["desktop", ["desktopTitle", "desktopTag", "desktopRequirements", "installer", "portable", "manifest", "webview"], copy.desktopSteps],
      ["extension", ["extensionTitle", "extensionTag", "extensionBody", "extensionDownload", "extensionRequirements"], copy.extensionSteps],
    ] as const) {
      const section = page.locator(`#${id}`);
      for (const field of fields) await checkLeaf(section, `download.${field}`, copy[field]);
      assert.equal(await section.locator("ol li").count(), steps.length);
      for (const [index, original] of steps.entries()) {
        const key = `download.${id}Steps.${index}`;
        // Critical later steps remain canonical English under the current filter.
        const text = id === "desktop" && index >= 2 || id === "extension" && index === 3 ? original : entries[key].text;
        const leaf = section.locator("ol li").nth(index).locator("span");
        assert.equal(await leaf.textContent(), text);
        assert.equal(await leaf.getAttribute("lang"), text === original ? "en" : locale);
        if (locale === "ar") assert.equal(await leaf.evaluate(element => getComputedStyle(element).direction), text === original ? "ltr" : "rtl");
        const literals = text === original ? [] : [...original.matchAll(/-setup\.exe|-win32-x64\.zip|-release\.json|-SHA256SUMS\.txt|manifest\.json|chrome:\/\/extensions|edge:\/\/extensions|Developer mode|Load unpacked/gu)]
          .map(match => match[0]).filter(token => text.includes(token)).sort();
        assert.deepEqual((await leaf.locator("bdi").allTextContents()).sort(), literals);
        for (const token of await leaf.locator("bdi").all()) {
          assert.equal(await token.getAttribute("lang"), "en");
          assert.equal(await token.evaluate(element => getComputedStyle(element).direction), "ltr");
          assert.equal(await token.evaluate(element => getComputedStyle(element).whiteSpace), "nowrap");
        }
      }
    }
    for (const field of ["alternativeTitle", "alternativeBody"] as const)
      await checkLeaf(page.locator("main"), `download.${field}`, copy[field]);
    for (const original of [copy.body, copy.desktopBody, copy.desktopBoundary, copy.desktopVersion,
      copy.extensionVersion, copy.extensionBoundary]) {
      const leaf = page.getByText(original, { exact: true });
      assert.equal(await leaf.count(), 1);
      assert.equal(await leaf.evaluate(element => element.closest("[lang]")?.getAttribute("lang")), "en");
    }
    assert.deepEqual(await page.locator("#desktop a").evaluateAll(links => links.map(link => link.getAttribute("href"))), [
      installationLinks.installer, installationLinks.portable, installationLinks.release,
      installationLinks.manifest, installationLinks.webview, `${installationLinks.docs}desktop-alpha.md`,
    ]);
    assert.deepEqual(await page.locator("#extension a").evaluateAll(links => links.map(link => link.getAttribute("href"))), [
      installationLinks.extensionSource, installationLinks.extensionStore,
      "https://github.com/tang-vu/keryx/blob/main/extension/README.md",
    ]);
    assert.equal(await page.locator('nav a[aria-current="page"]').getAttribute("href"), "/download");
    assert((await page.title()).includes(copy.metadata), "Download metadata retains English authority");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${locale}/${width} download overflow`);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (output) await page.screenshot({ path: resolve(output, `${locale}-${width}-download.png`), fullPage: true });
  };
  const checkIntegrationPage = (page: Page, locale: typeof locales[number], width: number) =>
    checkIntegrationGuide(page, locale, width, drafts[locale]["get-started"].entries, output);
  const results = [];
  for (const width of [390, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: "en-US" });
    try {
      const page = await context.newPage(), errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      let askRequests = 0;
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin) return route.abort();
        if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
        if (url.pathname === "/api/ask/visibility") {
          assert.equal(route.request().method(), "GET", "Language help reads only the original public visibility context");
          return route.fulfill({ json: { wallet: null, defaultVisibility: "public", privacyActive: true } });
        }
        if (url.pathname === "/api/ask" || url.pathname === "/api/ask/sign") { askRequests++; return route.abort(); }
        return route.continue();
      });
      await page.goto(base, { waitUntil: "networkidle" });
      const select = () => page.locator("[data-language-switcher] select:visible").first();
      await select().waitFor();
      await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>("[data-language-switcher] select")?.disabled);
      const original = "Keep my exact unsent draft: <Question> {count} USDC";
      for (const locale of locales) {
        assert.equal(await select().locator(`option[value="${locale}"]`).textContent(), uiLocaleNames[locale]);
        await page.locator("#ask-question").fill(original);
        await select().selectOption(locale);
        const expected = drafts[locale]["core-inline"].entries["researchEntry.question"].text;
        await page.locator('label[for="ask-question"]').filter({ hasText: expected }).waitFor();
        assert.equal(await page.locator(`label[for="ask-question"] [lang="${locale}"]`).count(), 1, `${locale} question label exposes its language`);
        assert.equal(await page.locator(`h1 [lang="${locale}"]`).count(), 1, `${locale} headline exposes its language`);
        assert.equal(await page.locator('.kx-research-intro [lang="en"]').count(), 1, "Critical English introduction retains its own language");
        assert.equal(await page.locator("option span").count(), 0, "Native select options retain text-only content");
        assert.equal(await page.locator("#ask-question").inputValue(), original);
        assert.equal(await page.locator("#ask-question").getAttribute("placeholder"), drafts[locale]["core-inline"].entries["researchEntry.placeholder"].text);
        assert.equal(await select().getAttribute("title"), drafts[locale]["ui-preference"].entries.previewNotice.text);
        const help = page.locator("[data-answer-language-help]");
        const helpButton = help.getByRole("button", { name: drafts[locale]["ui-preference"].entries.answerLanguageTitle.text, exact: true });
        await helpButton.waitFor();
        assert.equal(await helpButton.getAttribute("aria-expanded"), "false");
        await helpButton.press("Enter");
        assert.equal(await helpButton.getAttribute("aria-expanded"), "true");
        assert((await help.innerText()).includes(drafts[locale]["ui-preference"].entries.answerLanguageBody.text));
        assert.equal(await help.locator(`p [lang="${locale}"]`).count(), 2, "Translated explanatory copy declares its own language");
        assert.equal(await help.getByRole("listitem").count(), answerLanguageInstructions.length);
        for (const example of answerLanguageInstructions) {
          assert.equal(await help.locator(`code[lang="${example.language}"]`).textContent(), example.instruction);
          assert.equal(await help.locator(`li > span[lang="${example.language}"]`).textContent(), example.name);
          const direction = example.language === "ar" ? "rtl" : "ltr";
          assert.equal(await help.locator(`code[lang="${example.language}"]`).evaluate(element => getComputedStyle(element).direction), direction);
        }
        assert.equal(await page.locator("#ask-question").inputValue(), original, "Opening language guidance never edits the question");
        if (locale === "ar") {
          const etymology = page.locator("footer p").filter({ hasText: "From the Greek" });
          assert.equal(await etymology.locator(':scope > [lang="en"]').getAttribute("dir"), "ltr");
          assert.equal(await etymology.locator('[lang="el"]').textContent(), "κῆρυξ");
        }
        assert.equal(askRequests, 0, "Language guidance never submits or signs research");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "Expanded language guidance fits the viewport");
        if (output) await page.screenshot({ path: resolve(output, `${locale}-${width}-answer-language-help.png`), fullPage: true });
        await helpButton.press("Space");
        assert.equal(await helpButton.getAttribute("aria-expanded"), "false");
        const [headline, guide, globe] = await Promise.all([page.locator("h1").evaluate(element => {
          const range = document.createRange(); range.selectNodeContents(element);
          return range.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number };
        }),
          page.getByTestId("hero-guide").boundingBox(), page.getByTestId("chat-globe").boundingBox()]);
        assert(headline && guide && globe, `${locale}/${width} hero elements are present`);
        for (const [name, obstacle] of [["guide", guide], ["globe", globe]] as const) {
          assert(headline.x + headline.width <= obstacle.x || headline.x >= obstacle.x + obstacle.width ||
            headline.y + headline.height <= obstacle.y || headline.y >= obstacle.y + obstacle.height,
          `${locale}/${width} headline must not overlap ${name}`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${locale}/${width} homepage overflow`);
        if (output) await page.screenshot({ path: resolve(output, `${locale}-${width}-home.png`), fullPage: true });
        await page.goto(`${base}/about`, { waitUntil: "networkidle" });
        const about = drafts[locale]["product-guide"].entries;
        const aboutHeading = page.getByRole("heading", { level: 1, name: about["about.title"].text, exact: true });
        await aboutHeading.waitFor();
        assert.equal(await aboutHeading.locator(`[lang="${locale}"]`).count(), 1, `${locale} About headline exposes its language`);
        const explanation = page.getByText(about["about.projectBody"].text, { exact: true });
        await explanation.waitFor();
        assert.equal(await explanation.evaluate(element => element.closest("[lang]")?.getAttribute("lang")), locale);
        const legalNotice = page.getByText(productGuideCopy("about.projectLegalNotice"), { exact: true });
        await legalNotice.waitFor();
        assert.equal(await legalNotice.evaluate(element => element.closest("[lang]")?.getAttribute("lang")), "en");
        const scope = page.locator('a[href="https://github.com/tang-vu/keryx/blob/main/docs/licensing.md"]');
        assert.equal(await scope.textContent(), productGuideCopy("about.projectLegalLink"));
        assert.equal(await scope.evaluate(element => (element.querySelector("[lang]") ?? element).closest("[lang]")?.getAttribute("lang")), "en");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${locale}/${width} About overflow`);
        if (output) await page.screenshot({ path: resolve(output, `${locale}-${width}-about.png`), fullPage: true });
        await page.goto(`${base}/get-started`, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["start.title"].text, exact: true }).waitFor();
        await checkSetupPage(page, locale, width);
        await page.reload({ waitUntil: "networkidle" });
        await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["start.title"].text, exact: true }).waitFor();
        await page.goto(`${base}/download`, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["download.title"].text, exact: true }).waitFor();
        await checkDownloadPage(page, locale, width);
        await page.reload({ waitUntil: "networkidle" });
        await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["download.title"].text, exact: true }).waitFor();
        await page.goto(`${base}/integrations`, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["integrations.title"].text, exact: true }).waitFor();
        await checkIntegrationPage(page, locale, width);
        await page.reload({ waitUntil: "networkidle" });
        await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["integrations.title"].text, exact: true }).waitFor();
        await page.goto(base, { waitUntil: "networkidle" });
        await page.locator('label[for="ask-question"]').filter({ hasText: expected }).waitFor();
      }
      await select().selectOption("en");
      await page.locator('label[for="ask-question"]').filter({ hasText: "What do you want to know?" }).waitFor();
      if (width === 390) {
        await page.setViewportSize({ width: 320, height: 950 });
        await page.goto(`${base}/get-started`, { waitUntil: "networkidle" });
        for (const locale of locales) {
          await select().selectOption(locale);
          await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["start.title"].text, exact: true }).waitFor();
          await checkSetupPage(page, locale, 320);
        }
        await page.goto(`${base}/download`, { waitUntil: "networkidle" });
        for (const locale of locales) {
          await select().selectOption(locale);
          await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["download.title"].text, exact: true }).waitFor();
          await checkDownloadPage(page, locale, 320);
        }
        await page.goto(`${base}/integrations`, { waitUntil: "networkidle" });
        for (const locale of locales) {
          await select().selectOption(locale);
          await page.getByRole("heading", { name: drafts[locale]["get-started"].entries["integrations.title"].text, exact: true }).waitFor();
          await checkIntegrationPage(page, locale, 320);
        }
        await select().selectOption("en");
      }
      assert.equal(askRequests, 0, "Language changes must never submit or sign research");
      assert.deepEqual(errors, [], "No browser runtime errors");
      results.push({ width, locales: ["en", ...locales], routes: ["/", "/about", "/get-started", "/download", "/integrations"], errors, askRequests,
        setupChoices: { locales, surfaces: setupCopy.surfaces.length, originalDestinations: true,
          platformDisclosureKeyboard: true, widths: width === 390 ? [320, 390] : [1366] },
        downloadGuidance: { locales, originalDestinations: true, technicalLiterals: true,
          criticalEnglishRetained: true, reload: true, widths: width === 390 ? [320, 390] : [1366] },
        integrationGuidance: { locales, originalCommandsAndDestinations: true, accessibleTranslatedTitles: true,
          originalLtrExamplesAndLiterals: true, keyboardCopyAndManualSelection: true, criticalEnglishRetained: true,
          reload: true, widths: width === 390 ? [320, 390] : [1366] },
        answerLanguageHelp: { locales, examples: answerLanguageInstructions.length, nativeLanguageTags: true,
          openedWithEnter: true, closedWithSpace: true, originalQuestionUnchanged: true } });
    } finally {
      await context.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  }
  if (output) await writeFile(resolve(output, "result.json"), JSON.stringify(results, null, 2));
  console.log(`PASS: ${locales.length} interface previews at 390/1366px, seven setup choices and download guidance at 320/390/1366px, exact installation destinations and step language, keyboard platform guidance, native answer-language instructions and keyboard help, About explanations, English legal copy, navigation, reload, exact drafts and English reset.`);
}
