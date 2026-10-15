import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), session: vi.fn(), defaults: vi.fn(), ready: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.db }));
vi.mock("../auth", () => ({ getSession: mocks.session }));
vi.mock("./auth", () => ({ privacyBinding: () => ({ network: "eip155:5042", origin: "https://synthetic.example" }) }));
import { prepareAskPublication, readResearchVisibility } from "./ask-publication";
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const request = (expected?: string) => new Request("https://synthetic.example/api/ask", {
  headers: expected === undefined ? {} : { "X-Keryx-Expected-Wallet": expected },
});
beforeEach(() => {
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");
  vi.clearAllMocks(); mocks.session.mockResolvedValue(null); mocks.defaults.mockResolvedValue("public");
  mocks.ready.mockResolvedValue(undefined);
  mocks.db.mockResolvedValue({ runPrivacyActive: true, runPrivacy: { defaults: mocks.defaults, creationReady: mocks.ready } });
});
afterEach(() => vi.unstubAllEnvs());
it("shows the anonymous public default without inventing account ownership", async () => {
  expect(await readResearchVisibility()).toEqual({ wallet: null, defaultVisibility: "public", privacyActive: true });
  expect(await prepareAskPublication(request("anonymous"), "public")).toEqual({ visibility: "public", privacyActive: true });
  expect(mocks.defaults).not.toHaveBeenCalled();
});
it("uses an authenticated saved private preference when the request omits its choice", async () => {
  mocks.session.mockResolvedValue({ address: alice }); mocks.defaults.mockResolvedValue("private");
  expect(await readResearchVisibility()).toMatchObject({ wallet: alice, defaultVisibility: "private" });
  expect(await prepareAskPublication(request(alice), undefined, alice)).toMatchObject({ visibility: "private" });
  expect(mocks.defaults).toHaveBeenCalledWith({ wallet: alice, binding: { network: "eip155:5042", origin: "https://synthetic.example" } });
});
it("allows a deliberate creation choice without rewriting the account default", async () => {
  mocks.defaults.mockResolvedValue("private");
  expect(await prepareAskPublication(request(alice), "public", alice)).toMatchObject({ visibility: "public" });
  expect(mocks.defaults).not.toHaveBeenCalled();
});
it.each([[alice, bob], [alice, undefined], ["anonymous", alice]] as const)("fences a changed account between preference read and submission", async (expected, actual) => {
  await expect(prepareAskPublication(request(expected), "public", actual)).rejects.toMatchObject({ code: "owner_changed", status: 409 });
  expect(mocks.db).not.toHaveBeenCalled();
});
it("refuses hidden asks when privacy is unavailable and private asks without an owner", async () => {
  await expect(prepareAskPublication(request(), "private")).rejects.toMatchObject({ code: "private_owner_required", status: 401 });
  mocks.db.mockResolvedValue({ runPrivacyActive: false });
  await expect(prepareAskPublication(request(alice), "private", alice)).rejects.toMatchObject({ code: "privacy_unavailable", status: 503 });
});
it("does not advertise a guessed preference when active storage is missing", async () => {
  mocks.db.mockResolvedValue({ runPrivacyActive: true });
  await expect(readResearchVisibility()).rejects.toThrow("privacy_unavailable");
});
it("refuses active storage without an admitted creation writer before offering or accepting Public", async () => {
  mocks.ready.mockRejectedValue(new Error("privacy_unavailable"));
  await expect(readResearchVisibility()).rejects.toThrow("privacy_unavailable");
  await expect(prepareAskPublication(request(), "public")).rejects.toThrow("privacy_unavailable");
  mocks.db.mockResolvedValue({ runPrivacyActive: true, runPrivacy: { defaults: mocks.defaults } });
  await expect(prepareAskPublication(request(), "public")).rejects.toThrow();
});
it("preserves closed legacy public facades while refusing unknown privacy under an ON rollout", async () => {
  const closed = new Proxy({}, { get(_target, property) { if (property === "then") return undefined; throw new Error("Unknown property refused"); } });
  mocks.db.mockResolvedValue(closed);
  expect(await prepareAskPublication(request(), undefined)).toEqual({ visibility: "public", privacyActive: false });
  await expect(prepareAskPublication(request(), "unlisted")).rejects.toMatchObject({ code: "privacy_unavailable" });
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  await expect(prepareAskPublication(request(), "public")).rejects.toThrow("Unknown property refused");
});
