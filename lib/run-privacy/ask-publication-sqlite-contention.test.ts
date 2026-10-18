import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";

const mocks = vi.hoisted(() => ({ db: vi.fn(), session: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.db }));
vi.mock("../auth", () => ({ getSession: mocks.session }));
vi.mock("./auth", () => ({ privacyBinding: () => ({ network: "eip155:5042002", origin: "https://synthetic.example" }) }));
import { prepareAskPublication } from "./ask-publication";
import { GET } from "../../app/api/ask/visibility/route";

const alice = `0x${"a".repeat(40)}`;
const directories: string[] = [], connections: DatabaseSync[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  mocks.session.mockResolvedValue(null);
});
afterEach(() => {
  for (const db of connections.splice(0).reverse()) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function fixture(readOnly = false) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-visibility-contention-"));
  directories.push(directory);
  const file = join(directory, "synthetic.sqlite"), seed = new DatabaseSync(file);
  try {
    seed.exec("PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE");
    installSqliteApplicationSchema(seed);
    seed.exec(RUN_PRIVACY_SQL);
    seed.prepare("INSERT INTO run_privacy_defaults(wallet,visibility) VALUES(?,?)").run(alice, "private");
    seed.exec("COMMIT");
  } finally { seed.close(); }
  const db = new DatabaseSync(file, { readOnly });
  connections.push(db);
  // Shorten contention only on this ordinary synthetic fixture. Production
  // enrolled connection settings and their authority guards remain unchanged.
  db.exec("PRAGMA busy_timeout=25");
  const store = createSqliteRunPrivacy(db);
  mocks.db.mockResolvedValue({ runPrivacyActive: true, runPrivacy: store });
  return { file, db };
}

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBe("Cookie, Authorization, X-Keryx-Expected-Wallet");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
}

it.each([false, true])("reads visibility during another connection's write reservation (authenticated=%s), but still refuses submission", async authenticated => {
  const f = fixture(), before = readFileSync(f.file), blocker = new DatabaseSync(f.file);
  connections.push(blocker);
  if (authenticated) mocks.session.mockResolvedValue({ address: alice });
  expect(f.db.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe("delete");
  blocker.exec("BEGIN IMMEDIATE");
  try {
    const response = await GET();
    expect(response.status).toBe(200);
    expectPrivateHeaders(response);
    expect(await response.json()).toEqual({ wallet: authenticated ? alice : null,
      defaultVisibility: authenticated ? "private" : "public", privacyActive: true });
    const request = new Request("https://synthetic.example/api/ask", {
      headers: { "X-Keryx-Expected-Wallet": authenticated ? alice : "anonymous" },
    });
    await expect(prepareAskPublication(request, "public", authenticated ? alice : undefined)).rejects.toThrow("privacy_unavailable");
  } finally { blocker.exec("ROLLBACK"); }
  expect(readFileSync(f.file)).toEqual(before);
  // A temporary competing writer grants no retry, but must not destroy the
  // reader or bypass the fresh submission-time creation check after release.
  await expect(prepareAskPublication(new Request("https://synthetic.example/api/ask"), "public"))
    .resolves.toEqual({ visibility: "public", privacyActive: true });
});

it("reads the saved visibility through a read-only connection while submission still requires a writer", async () => {
  const f = fixture(true), before = readFileSync(f.file);
  mocks.session.mockResolvedValue({ address: alice });
  const response = await GET();
  expect(response.status).toBe(200);
  expectPrivateHeaders(response);
  expect(await response.json()).toEqual({ wallet: alice, defaultVisibility: "private", privacyActive: true });
  await expect(prepareAskPublication(new Request("https://synthetic.example/api/ask"), "public", alice))
    .rejects.toThrow("privacy_unavailable");
  expect(readFileSync(f.file)).toEqual(before);
});

it("keeps unavailable or changed active privacy storage fail-closed and private", async () => {
  const f = fixture();
  mocks.session.mockResolvedValue({ address: alice });
  f.db.exec("DROP TABLE run_privacy_defaults");
  const response = await GET();
  expect(response.status).toBe(503);
  expectPrivateHeaders(response);
  expect(await response.json()).toEqual({ error: "visibility_unavailable" });
});
