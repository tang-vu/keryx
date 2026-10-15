/** Existing stock Next build + real loopback routes/DOM. Synthetic ordinary SQLite only; no response interception. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium, type Browser } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";
import { qualifyOwnedNextFixtureExit, type OwnedNextFixtureExit } from "../test-support/owned-next-fixture-exit";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { installSqliteApplicationSchema } from "../lib/db/sqlite-application-schema";
import { RUN_PRIVACY_SQL } from "../lib/db/run-privacy-sqlite";
import { issueWebSession } from "../lib/auth-session";

assert.deepEqual(process.argv.slice(2), ["--acceptance"]);
assert.equal(process.platform, "linux", "Hosted Linux fixture only; no dependency junction changes");
assert.equal(process.env.KERYX_NETWORK, "arcTestnet");
assert.equal(process.env.NEXT_PUBLIC_KERYX_NETWORK, "arcTestnet");
assert.equal(process.env.KERYX_FORCE_OFFLINE, "1");
assert.equal(process.env.KERYX_PUBLIC_PROFILES_ENABLED, "true");
assert.equal(process.env.KERYX_RUN_PRIVACY_ENABLED, "true");
const source = resolve(import.meta.dirname, ".."), dist = join(source, ".next");
const fixture = join(source, ".artifacts", `public-profile-built-${randomUUID()}`);
await mkdir(join(fixture, "data"), { recursive: true });
let database: SqliteAdapter | undefined, browser: Browser | undefined, child: ReturnType<typeof spawn> | undefined;
let didExit = false, childCode: number | null = null, childSignal: NodeJS.Signals | null = null;
let stdoutEof = false, stderrEof = false;
let childExit: OwnedNextFixtureExit["exit"] = null, ownedStopRequest: OwnedNextFixtureExit["stopRequest"] = null;
let childTermination: ReturnType<typeof qualifyOwnedNextFixtureExit> = null;
let startupError: Error | undefined, stopped: Promise<void> | undefined, failure: unknown;
let stdout = "", stderr = "", buildId: string | undefined;
const checks: string[] = [], blockedRequests: string[] = [], widths: number[] = [];
const readinessFailures: Array<Record<string, unknown>> = [];
try {
  buildId = (await readFile(join(dist, "BUILD_ID"), "utf8")).trim();
  assert(buildId, "A successful stock Next build is required");
  await copyNextConfigFixture(source, fixture);
  // The compiled OG route reads the same bundled assets from its isolated CWD.
  // Copy only these fixed local font files, retaining their complete bytes.
  await mkdir(join(fixture, "app/fonts/og"), { recursive: true });
  for (const name of ["noto-sans-regular.ttf", "noto-sans-math-regular.ttf", "noto-sans-sc-regular.otf"]) {
    const original = await readFile(join(source, "app/fonts/og", name));
    const target = join(fixture, "app/fonts/og", name);
    await writeFile(target, original, { flag: "wx" });
    assert((await readFile(target)).equals(original), "Retain exact bundled OG font bytes");
  }
  // Reuse the actual build on Linux. Dependencies resolve through the unchanged
  // repository ancestry; do not add/alter node_modules links, loaders or config.
  await symlink(dist, join(fixture, ".next"), "dir");
  const databasePath = join(fixture, "data", "keryx.sqlite");
  // Privacy rollout stays explicit: install only in this fresh UUID-owned fixture.
  const bootstrap = new DatabaseSync(databasePath);
  try {
    installSqliteApplicationSchema(bootstrap);
    bootstrap.exec(RUN_PRIVACY_SQL);
  } finally { bootstrap.close(); }
  database = new SqliteAdapter(databasePath);
  await database.init();
  assert(database.privateProfiles && database.publicProfiles && database.runPrivacy);
  const alice = `0x${"a".repeat(40)}`, secret = randomBytes(32).toString("hex");
  await database.privateProfiles.update(alice, { handle: "fixture_researcher", displayName: "Fixture researcher",
    bio: "UNSELECTED PRIVATE PROFILE BIO", purpose: "Explicit public method", links: [] });
  const session = await issueWebSession(database, secret, alice, "asker");
  const [record] = await database.listWebSessions(alice, Date.now()); assert(record);
  const publicId = randomUUID(), privateId = randomUUID(), question = `Public question ${"longword".repeat(30)}`;
  for (const [id, text] of [[publicId, question], [privateId, "UNSELECTED PRIVATE QUESTION"]]) {
    await database.saveQueryRun({ id, question: text, asker: alice, createdAt: new Date().toISOString(), answer: "UNEXPORTED PRIVATE ANSWER",
      budget: 0, totalSpent: 0, totalToCreators: 0, engine: "heuristic", paymentMode: "offline", subClaims: [], decisions: [], trace: [], citations: [] }, { visibility: "private" });
  }
  const listener = createServer();
  await new Promise<void>((done, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", done); });
  const address = listener.address(); assert(address && typeof address === "object"); const port = address.port;
  await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
  const origin = `http://127.0.0.1:${port}`;
  await database.runPrivacy.change(publicId, { wallet: alice, sessionHash: record.hash, binding: { network: "eip155:5042002", origin } },
    { visibility: "public", revision: 0, requestId: randomUUID() });
  const environment: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", JWT_SECRET: secret, BASE_URL: origin,
    KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1", KERYX_EXTERNAL_DISCOVERY: "0",
    KERYX_WEB_RESEARCH: "0", KERYX_PUBLIC_PROFILES_ENABLED: "true", KERYX_RUN_PRIVACY_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" };
  child = spawn(process.execPath, [join(source, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: fixture, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", value => { stdout = (stdout + String(value)).slice(-16000); });
  child.stderr!.on("data", value => { stderr = (stderr + String(value)).slice(-16000); });
  child.stdout!.once("end", () => { stdoutEof = true; });
  child.stderr!.once("end", () => { stderrEof = true; });
  child.once("error", error => { startupError = error; });
  child.once("exit", (code, signal) => { childExit = { code, signal }; });
  stopped = new Promise<void>(done => child!.once("close", (code, signal) => { didExit = true; childCode = code; childSignal = signal; done(); }));
  const request = (path: string, init: RequestInit = {}) => {
    const url = new URL(path, origin); assert.equal(url.origin, origin);
    return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10000) });
  };
  const owner = (method = "GET", value?: unknown): RequestInit => ({ method,
    headers: { Cookie: `keryx_session=${session.token}`, Origin: origin, "X-Keryx-Expected-Wallet": alice,
      ...(value === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (startupError) throw startupError; assert(!didExit, "Owned server exited before readiness");
    try { ready = (await request("/api/me/public-profile", owner())).status === 200; } catch { /* bounded startup only */ }
    if (ready) break;
    await new Promise(done => setTimeout(done, 250));
  }
  assert(ready, "Actual built owner route did not become ready");
  const publicPaths = ["/u/fixture_researcher", "/api/u/fixture_researcher", "/u/fixture_researcher/opengraph-image"];
  for (const path of publicPaths) assert.equal((await request(path)).status, 404);
  assert.equal((await request("/api/me/public-profile", { headers: { "X-Keryx-Expected-Wallet": alice } })).status, 401);
  const input = { published: true, fields: ["displayName", "purpose"], runIds: [publicId, privateId], revision: 0 };
  const foreign = owner("PUT", input); foreign.headers = { ...foreign.headers, Origin: "https://foreign.invalid" };
  assert.equal((await request("/api/me/public-profile", foreign)).status, 403);
  const published = await request("/api/me/public-profile", owner("PUT", input)), publication = await published.json();
  const refusalCodes = new Set(["same_origin_required", "not_owned", "profile_owner_changed", "conflict", "unauthenticated", "profile_required", "public_profile_unavailable"]);
  const refusal = typeof publication?.error === "string" && refusalCodes.has(publication.error) ? publication.error : "unclassified_publication_refusal";
  assert.equal(published.status, 200, `Owner publication must be confirmed: ${refusal}`);
  assert.equal(publication.revision, 1);
  const json = await request("/api/u/fixture_researcher"); assert.equal(json.status, 200);
  assert.match(json.headers.get("cache-control") ?? "", /no-store/);
  const packet = await json.json(); assert.deepEqual(packet.runs.map((run: { id: string }) => run.id), [publicId]);
  assert.doesNotMatch(JSON.stringify(packet), /UNSELECTED|UNEXPORTED|0xaaaa/);
  // Next blocks metadata for this HTML-limited crawler, exposing the actual head.
  // Keep ordinary Chromium navigation below unchanged, including its rendering gates.
  const html = await request("/u/fixture_researcher", { headers: { "User-Agent": "facebookexternalhit/1.1" } }); assert.equal(html.status, 200);
  const documentHtml = await html.text(); assert.match(documentHtml, /application\/ld\+json/);
  assert.match(documentHtml, /og:title/); assert.match(documentHtml, /Profile JSON/); assert.doesNotMatch(documentHtml, /UNSELECTED|UNEXPORTED/);
  assert(Buffer.byteLength(documentHtml) <= 1024 * 1024, "Synthetic profile HTML exceeds the metadata parsing bound");
  const head = documentHtml.match(/<head\b[^>]*>([\s\S]*?)<\/head>/)?.[1]; assert(head, "Actual compiled head is required");
  // Same bounded double-quoted tag-attribute pattern as the existing wanted built harness.
  // These generated URLs are ASCII; no owner text is interpreted as markup or executed.
  const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1].toLowerCase(), match[2]]));
  const links = [...head.matchAll(/<link\b[^>]*>/g)].map(match => attributes(match[0]));
  const canonical = `${origin}/u/fixture_researcher`;
  const languages = [["en", canonical], ["x-default", canonical]];
  assert.deepEqual(links.filter(link => link.rel === "canonical").map(link => link.href), [canonical]);
  assert.deepEqual(links.filter(link => link.rel === "alternate" && link.hreflang)
    .map(link => [link.hreflang, link.href]).sort(), languages);
  assert.deepEqual(links.filter(link => link.rel === "alternate" && link.type === "application/json")
    .map(link => link.href), [`${origin}/api/u/fixture_researcher`]);
  const schemas = [...documentHtml.matchAll(/<script\b[^>]*\btype="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => JSON.parse(match[1])).filter(schema => schema?.["@type"] === "ProfilePage");
  assert.equal(schemas.length, 1);
  const schema = schemas[0]; assert.equal(schema.url, canonical); assert.equal(schema.inLanguage, "en");
  assert.equal(schema.mainEntity["@type"], "Person"); assert.equal(schema.mainEntity.name, packet.displayName);
  assert.equal(packet.about, undefined); assert.equal(schema.mainEntity.description, undefined); // Unselected owner bio stays private.
  assert.equal((JSON.stringify(schema).match(/"inLanguage"\s*:/g) ?? []).length, 1, "Only the ProfilePage wrapper declares English");
  assert.doesNotMatch(JSON.stringify(packet), /"inLanguage"\s*:/, "Profile JSON and selected originals gain no language declaration");
  const image = await request("/u/fixture_researcher/opengraph-image"); assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type") ?? "", /image\/png/);
  assert.match(image.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(Array.from(new Uint8Array(await image.arrayBuffer()).slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const sitemap = await request("/sitemap.xml"); assert.equal(sitemap.status, 200);
  const sitemapXml = await sitemap.text(); assert.match(sitemapXml, /\/u\/fixture_researcher/);
  assert(Buffer.byteLength(sitemapXml) <= 1024 * 1024, "Synthetic sitemap exceeds the metadata parsing bound");
  const profileRows = [...sitemapXml.matchAll(/<url>([\s\S]*?)<\/url>/g)]
    .map(match => match[1]).filter(row => row.includes(`<loc>${canonical}</loc>`));
  assert.equal(profileRows.length, 1, "Only the admitted profile row supplies its alternates");
  const sitemapLinks = [...profileRows[0].matchAll(/<xhtml:link\b[^>]*>/g)].map(match => attributes(match[0]));
  assert(sitemapLinks.every(link => link.rel === "alternate"));
  assert.deepEqual(sitemapLinks.map(link => [link.hreflang, link.href]).sort(), languages);
  checks.push("actual compiled head canonical/en/x-default/JSON; English ProfilePage wrapper only; admitted sitemap alternates; PNG no-store");
  checks.push("actual stock-built owner authorization/publication; selected PUBLIC JSON/HTML/PNG/sitemap; no private projection");
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
    try {
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue(); // No synthetic positive responses.
        blockedRequests.push(url.origin); return route.abort();
      });
      const page = await context.newPage(), errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const staticAssets: Array<{ path: string; kind: string; status?: number; failure?: string }> = [];
      const noteStatic = (request: { url(): string; resourceType(): string }, result: { status?: number; failure?: string }) => {
        const url = new URL(request.url()), kind = request.resourceType();
        if (staticAssets.length < 80 && url.origin === origin && (url.pathname.startsWith("/_next/static/") || kind === "font" || kind === "stylesheet"))
          staticAssets.push({ path: url.pathname.slice(0, 512), kind, ...result }); // No query, headers, cookies or response bodies.
      };
      page.on("response", response => noteStatic(response.request(), { status: response.status() }));
      page.on("requestfailed", request => noteStatic(request, { failure: (request.failure()?.errorText ?? "Unknown request failure").slice(0, 256) }));
      const navigation = await page.goto(origin + "/u/fixture_researcher", { waitUntil: "domcontentloaded" });
      assert.equal(navigation?.status(), 200); assert.equal(page.url(), origin + "/u/fixture_researcher");
      await page.getByRole("heading", { name: "Fixture researcher", exact: true }).waitFor();
      // Readiness belongs to this visible authored surface, not unrelated network quiescence.
      // Keep the default bounded wait; no intercepted positive responses or timeout extension.
      await page.waitForFunction(() => {
        const main = document.querySelector("main"), heading = main?.querySelector("h1");
        if (!main || !heading || heading.textContent !== "Fixture researcher") return false;
        const rect = heading.getBoundingClientRect(), style = getComputedStyle(heading);
        const primaryFamily = style.fontFamily.split(",")[0].trim(); // Preserve the CSS-serialized quoted name for check().
        const primaryName = primaryFamily.replace(/^["']|["']$/g, "");
        const primaryFaceLoaded = Array.from(document.fonts).some(face =>
          face.family.replace(/^["']|["']$/g, "") === primaryName && face.status === "loaded");
        return rect.width > 0 && rect.height > 0 && style.visibility === "visible" && style.display !== "none" &&
          parseFloat(style.opacity) > 0 && parseFloat(getComputedStyle(main).paddingLeft) >= 15 &&
          parseFloat(style.fontSize) >= 28 && document.fonts.status === "loaded" &&
          primaryFaceLoaded && document.fonts.check(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${primaryFamily}`, heading.textContent ?? "");
      }).catch(async error => {
        const diagnostic: Record<string, unknown> = { width, staticAssets, pageErrors: errors.slice(0, 20) };
        readinessFailures.push(diagnostic);
        try {
          diagnostic.computed = await page.evaluate(() => {
            const main = document.querySelector("main"), heading = main?.querySelector("h1");
            const style = heading ? getComputedStyle(heading) : null, mainStyle = main ? getComputedStyle(main) : null;
            const rect = heading?.getBoundingClientRect(), mainRect = main?.getBoundingClientRect();
            const font = style ? `${style.fontSize} ${style.fontFamily}` : null;
            const primaryFamily = style?.fontFamily.split(",")[0].trim() ?? null;
            const primaryFont = style && primaryFamily ? `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${primaryFamily}` : null;
            const primaryFaceLoaded = !!primaryFamily && Array.from(document.fonts).some(face =>
              face.family.replace(/^["']|["']$/g, "") === primaryFamily.replace(/^["']|["']$/g, "") && face.status === "loaded");
            return { mainFound: !!main, headingFound: !!heading, headingExact: heading?.textContent === "Fixture researcher",
              headingRect: rect ? { width: rect.width, height: rect.height, left: rect.left, right: rect.right } : null,
              mainRect: mainRect ? { width: mainRect.width, height: mainRect.height, left: mainRect.left, right: mainRect.right } : null,
              visibility: style?.visibility, display: style?.display, opacity: style?.opacity, mainPaddingLeft: mainStyle?.paddingLeft,
              headingFontSize: style?.fontSize, headingFontFamily: style?.fontFamily, headingFontStyle: style?.fontStyle, headingFontWeight: style?.fontWeight,
              predicates: { headingSized: !!rect && rect.width > 0 && rect.height > 0, visibility: style?.visibility === "visible",
                display: !!style && style.display !== "none", opacity: !!style && parseFloat(style.opacity) > 0,
                mainPadding: !!mainStyle && parseFloat(mainStyle.paddingLeft) >= 15, fontSize: !!style && parseFloat(style.fontSize) >= 28,
                fontsLoaded: document.fonts.status === "loaded", registeredPrimaryFaceLoaded: primaryFaceLoaded,
                primaryFamilyCheck: primaryFont ? document.fonts.check(primaryFont, heading?.textContent ?? "") : null },
              fullFallbackFamilyCheck: font ? document.fonts.check(font) : null,
              fontsStatus: document.fonts.status, primaryFamilyCheck: primaryFont ? document.fonts.check(primaryFont, heading?.textContent ?? "") : null,
              fontFaces: Array.from(document.fonts).slice(0, 64).map(face => ({ family: face.family.slice(0, 160),
                status: face.status, style: face.style, weight: face.weight })) };
          });
        } catch (observationError) { diagnostic.observationError = observationError instanceof Error ? observationError.message.slice(0, 512) : "Observation failed"; }
        try {
          await page.screenshot({ path: join(fixture, `profile-readiness-failure-${width}.png`), fullPage: true, timeout: 2000 });
          diagnostic.screenshotSaved = true;
        } catch (screenshotError) { diagnostic.screenshotSaved = false; diagnostic.screenshotError = screenshotError instanceof Error ? screenshotError.message.slice(0, 512) : "Screenshot failed"; }
        throw error; // Preserve the original readiness failure; observations never grant acceptance.
      });
      assert.equal(await page.getByRole("link", { name: question, exact: true }).getAttribute("href"), `/dispatch/${publicId}`);
      assert.equal(await page.getByRole("link", { name: "Stored receipts", exact: true }).getAttribute("href"), `/api/dispatch/${publicId}/receipt`);
      assert.equal(await page.getByRole("link", { name: "Profile JSON", exact: true }).getAttribute("href"), "/api/u/fixture_researcher");
      assert.doesNotMatch(await page.locator("main").innerText(), /UNSELECTED|UNEXPORTED/);
      assert.equal(await page.locator("main article[lang], main article [lang]").count(), 0, "Selected originals receive no UI-language label");
      const geometry = await page.locator("main").evaluate(element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return { left: rect.left, right: rect.right, padding: parseFloat(style.paddingLeft), width: innerWidth,
          overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      assert(geometry.left >= -1 && geometry.right <= geometry.width + 1 && !geometry.overflow);
      assert(geometry.padding >= 15, "Actual production CSS must provide the authored profile padding");
      assert.deepEqual(errors, []);
      await page.getByRole("link", { name: "Profile JSON", exact: true }).focus();
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("href")), "/api/u/fixture_researcher");
      await page.screenshot({ path: join(fixture, `profile-${width}.png`), fullPage: true }); widths.push(width);
    } finally { await context.close(); }
  }
  checks.push("real Chromium DOM/production CSS/keyboard link at 320,390,768,1366px; no intercepted API/HTML");
  assert.equal((await request("/api/me/public-profile", owner("DELETE"))).status, 200);
  for (const path of publicPaths) assert.equal((await request(path)).status, 404);
  assert.doesNotMatch(await (await request("/sitemap.xml")).text(), /\/u\/fixture_researcher/);
  assert.equal((await request("/api/me/public-profile", owner("PUT", input))).status, 409);
  await database.revokeWebSession(record.hash, alice);
  assert.equal((await request("/api/me/public-profile", owner())).status, 401);
  checks.push("unpublish removes subsequent HTML/JSON/PNG/sitemap; stale consent conflicts; revoked session refused");
} catch (error) { failure = error; }
finally {
  try { await browser?.close(); } catch (error) { failure ??= error; }
  if (child && !didExit && child.pid !== undefined) {
    ownedStopRequest = { pid: child.pid, signal: "SIGTERM", sent: false, atUtc: new Date().toISOString(),
      exitObservedBeforeRequest: childExit !== null, closeObservedBeforeRequest: didExit };
    ownedStopRequest.sent = child.kill("SIGTERM"); // Only this returned child; no discovery/force kill or signal-ack inference.
    const ended = await Promise.race([stopped!.then(() => true), new Promise<false>(done => setTimeout(() => done(false), 5000))]);
    if (!ended) failure ??= Error("Owned Next child did not close after graceful stop");
  }
  childTermination = qualifyOwnedNextFixtureExit({ pid: child?.pid, exit: childExit,
    close: didExit ? { code: childCode, signal: childSignal } : null, stdoutEof, stderrEof, stopRequest: ownedStopRequest });
  if (child && childTermination === null) failure ??= Error("Owned Next child exit/close/pipe completion was not accepted");
  try { database?.close(); } catch (error) { failure ??= error; }
  await writeFile(join(fixture, "stdout.txt"), stdout); await writeFile(join(fixture, "stderr.txt"), stderr);
  const pins = await Promise.all(["scripts/test-public-profiles-built.mts", "test-support/owned-next-fixture-exit.ts", ".github/workflows/ci.yml",
    "lib/db/public-profiles-sqlite.ts", "supabase/migrations/0091_public_researcher_profiles.sql"].map(async path =>
    ({ path, sha256: createHash("sha256").update(await readFile(join(source, path))).digest("hex") })));
  await writeFile(join(fixture, "acceptance.json"), JSON.stringify({ issue: 264, accepted: !failure && childTermination !== null, buildId,
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim(), pins, checks, widths, readinessFailures,
    blockedExternalRequests: blockedRequests.length, childCode, childSignal, childClosed: didExit,
    childExited: childExit !== null, childExit, ownedStopRequest, childTermination,
    stdoutEof, stderrEof, syntheticOnly: true, costs: 0, productionActivation: false,
    error: failure instanceof Error ? failure.message : failure ? "Fixture failure" : null }, null, 2));
}
if (failure) throw failure;
assert(childTermination !== null, "Actual owned child exit/close and both pipe completion required");
console.log("#264 actual built public routes, private exclusion, responsive production CSS and revocation accepted; synthetic/offline only.");
