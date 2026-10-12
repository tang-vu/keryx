import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SupabaseAdapter } from "./supabase-adapter";
import { botControlResponse, botControlsCatalogues, botPreferenceKey, readBotHelpPreference,
  type BotRecipient } from "../bots/language";

vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...await importOriginal<typeof import("@supabase/supabase-js")>(),
  createClient: vi.fn(),
}));

const recipient: BotRecipient = { platform: "telegram", scope: "telegram", userId: "789" };
type ReadResult = { data: { value: string } | null; error: unknown };
let outbound: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  outbound = vi.fn(() => { throw new Error("External requests forbidden in this fixture"); });
  vi.stubGlobal("fetch", outbound);
});
afterEach(() => {
  expect(outbound).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks();
});

/** Actual adapter/helper, with only the SDK query port replaced; no backend or init call. */
function legacy(read: ReadResult) {
  const maybeSingle = vi.fn(async (): Promise<ReadResult> => read);
  const upsert = vi.fn(async () => ({ data: null, error: null }));
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle, upsert };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  vi.mocked(createClient).mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);
  return { db: new SupabaseAdapter(), from, query };
}

describe("checked Supabase sync-state reads for bot preferences", () => {
  it("keeps a successful missing row distinct from a failed read", async () => {
    const { db, from, query } = legacy({ data: null, error: null });
    expect(await db.getSyncState(botPreferenceKey(recipient)!)).toBeNull();
    expect(await readBotHelpPreference(recipient, async () => db)).toEqual({ available: true, preference: "auto" });
    const reply = await botControlResponse({ control: { action: "language" }, recipient }, async () => db);
    expect(reply.text).toContain(botControlsCatalogues.en.languageCurrent.replace("{preference}", "auto"));
    expect(query.select).toHaveBeenCalledWith("value");
    expect(query.eq).toHaveBeenCalledWith("key", botPreferenceKey(recipient));
    expect(from.mock.calls.every(([table]) => table === "sync_state")).toBe(true);
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it("retains a successful recorded preference without writing", async () => {
    const { db, query } = legacy({ data: { value: "vi" }, error: null });
    expect(await readBotHelpPreference(recipient, async () => db)).toEqual({ available: true, preference: "vi" });
    const reply = await botControlResponse({ control: { action: "language" }, recipient }, async () => db);
    expect(reply.language).toBe("vi");
    expect(reply.text).toContain(botControlsCatalogues.vi.languageCurrent.replace("{preference}", "vi"));
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it.each([null, { value: "vi" }])("refuses returned errors even with stale data (%j)", async data => {
    const detail = "private backend/token/recipient detail";
    const { db, query } = legacy({ data, error: { message: detail, code: "synthetic_failure" } });
    await expect(db.getSyncState(botPreferenceKey(recipient)!)).rejects.toThrow("Sync-state read unavailable");
    expect(await readBotHelpPreference(recipient, async () => db)).toEqual({ available: false, preference: "auto" });
    const reply = await botControlResponse({ control: { action: "language" }, recipient, platformLocale: "vi" }, async () => db);
    expect(reply.text).toContain(botControlsCatalogues.vi.languageUnavailable);
    expect(reply.text).not.toContain(botControlsCatalogues.vi.languageCurrent.replace("{preference}", "auto"));
    expect(reply.text).not.toContain(detail);
    expect(query.upsert).not.toHaveBeenCalled();
    // A completed write cannot be confirmed when its required readback fails.
    const save = await botControlResponse({ control: { action: "language", value: "es" }, recipient }, async () => db);
    expect(save.text).toContain(botControlsCatalogues.en.languageUnavailable);
    expect(save.text).not.toContain(botControlsCatalogues.es.languageSaved.replace("{preference}", "es"));
    expect(save.text).not.toContain(detail);
    expect(query.upsert).toHaveBeenCalledTimes(1);
  });
});
