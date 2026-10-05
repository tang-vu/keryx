import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { SqliteAdapter } from "./db/sqlite-adapter";
import { AUTH_CHALLENGE_TTL_MS } from "./auth-time-policy";

const mocks = vi.hoisted(() => ({ db: vi.fn(), cookies: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => null, clientIp: () => "synthetic-circle-storage-client" }));
vi.mock("@/lib/config", async importOriginal => {
  const actual = await importOriginal<typeof import("./config")>();
  const { ARC_TESTNET_PROFILE } = await import("./arc-network-profile");
  return { ...actual, config: { ...actual.config, profile: ARC_TESTNET_PROFILE, jwtSecret: "synthetic-circle-storage-secret" } };
});
import { POST } from "@/app/api/auth/circle/device/route";
import { CIRCLE_LOGIN_COOKIE, circleLoginHash } from "./circle-wallet-server";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("issues a Google challenge accepted by the real schema, with exact expiry and single-use consumption", async () => {
  const directory = mkdtempSync(join(tmpdir(), "keryx-circle-auth-storage-"));
  const db = new SqliteAdapter(join(directory, "db.sqlite"));
  try {
    await db.init();
    mocks.db.mockResolvedValue(db);
    const set = vi.fn(); mocks.cookies.mockResolvedValue({ set });
    vi.stubEnv("KERYX_CIRCLE_GOOGLE_ENABLED", "true");
    vi.stubEnv("CIRCLE_API_KEY", "synthetic-device-api-key");
    vi.stubEnv("NEXT_PUBLIC_CIRCLE_APP_ID", "synthetic-circle-app");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "synthetic-google-client");
    const fetcher = vi.fn(async () => Response.json({ data: { deviceToken: "synthetic-device-token", deviceEncryptionKey: "synthetic-device-key" } }));
    vi.stubGlobal("fetch", fetcher);
    const created = vi.spyOn(db, "createAuthChallenge");
    const issue = () => POST(new Request("https://keryx.cc/api/auth/circle/device", {
      method: "POST", headers: { Origin: "https://keryx.cc", "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "00000000-0000-4000-8000-000000000001" }),
    }));
    const response = await issue();
    expect(response.status).toBe(200);
    const first = await response.json();
    const [hash, issued, expires] = created.mock.calls[0];
    expect(hash).toBe(circleLoginHash(first.state));
    expect(expires - issued).toBe(AUTH_CHALLENGE_TTL_MS);
    expect(first.expiresAt).toBe(expires);
    expect(set).toHaveBeenCalledWith(CIRCLE_LOGIN_COOKIE, first.state, expect.objectContaining({
      httpOnly: true, sameSite: "strict", maxAge: AUTH_CHALLENGE_TTL_MS / 1000,
    }));
    await expect(db.createAuthChallenge(circleLoginHash("b".repeat(64)), issued, issued + AUTH_CHALLENGE_TTL_MS + 1)).rejects.toThrow();
    expect(await db.consumeAuthChallenge(hash, expires - 1)).toBe(true);
    expect(await db.consumeAuthChallenge(hash, expires - 1)).toBe(false);
    const second = await (await issue()).json();
    expect(await db.consumeAuthChallenge(circleLoginHash(second.state), second.expiresAt)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
