import { describe, expect, it } from "vitest";
import { canonicalLocaleOwner, createLocaleEpoch, decodeLocaleValue, encodeLocaleValue, localeScopeKey, parseLocaleBody,
  parseLocaleReply, readBrowserLocale, readLocaleJson, selectPreference, writeBrowserLocale } from "./locale-preference";
import { preparedLocales, shippedUiLocales } from "./locales";

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const scope = { origin: "https://keryx.test", network: "eip155:5042", owner: alice };
describe("bounded interface preference (source candidate; runtime acceptance remains separate)", () => {
  it("orders explicit, account, owner-scoped browser, quality-ranked header, English", () => {
    expect(selectPreference({ explicit: "vi", account: "zh-Hans", browser: "en", acceptLanguage: "en" }, preparedLocales).locale).toBe("vi");
    expect(selectPreference({ account: "zh-Hans", browser: "vi" }, preparedLocales).locale).toBe("zh-Hans");
    expect(selectPreference({ account: "corrupt", browser: "vi", acceptLanguage: "zh-Hans" }, preparedLocales).locale).toBe("vi");
    expect(selectPreference({ acceptLanguage: "vi;q=0.1,zh-CN;q=0.9" }, preparedLocales).locale).toBe("zh-Hans");
    expect(selectPreference({ acceptLanguage: "vi;q=0,vi-VN;q=1,zh-TW" }, preparedLocales).locale).toBe("en");
    expect(selectPreference({ explicit: "vi", account: "zh-Hans", browser: "vi" }, shippedUiLocales).locale).toBe("en");
    expect(shippedUiLocales).toEqual(["en"]);
  });
  it("admits exact tiny versioned scalars and canonical account wallets only", () => {
    for (const locale of preparedLocales) expect(decodeLocaleValue(encodeLocaleValue(locale))).toBe(locale);
    for (const value of ["vi", " keryx-ui-locale-v1:vi", "keryx-ui-locale-v2:vi", "keryx-ui-locale-v1:vi-VN", "x".repeat(10000), {}, null]) expect(decodeLocaleValue(value)).toBeNull();
    expect(canonicalLocaleOwner(alice.toUpperCase().replace("0X", "0x"))).toBe(alice);
    expect(canonicalLocaleOwner("session-hash")).toBeNull();
  });
  it("refuses excess fields, prototypes, symbols and accessors without invoking them", () => {
    expect(parseLocaleBody({ version: 1, locale: "vi" })).toBe("vi");
    const accessor = Object.defineProperty({ version: 1 }, "locale", { enumerable: true, get() { throw new Error("must not run"); } });
    for (const value of [accessor, { version: 2, locale: "vi" }, { version: 1, locale: "zh-TW" }, { version: 1, locale: "vi", owner: bob },
      Object.assign(Object.create({ inherited: true }), { version: 1, locale: "en" }), { version: 1, locale: "en", [Symbol()]: true }]) expect(parseLocaleBody(value)).toBeNull();
  });
  it("isolates origin, owner, guest and network without copying a stored account preference", () => {
    const data = new Map<string, string>(); const storage = () => ({ getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } });
    expect(writeBrowserLocale(storage, scope, "vi")).toBe(true);
    expect(readBrowserLocale(storage, scope)).toBe("vi");
    for (const other of [{ ...scope, owner: bob }, { ...scope, owner: null }, { ...scope, network: "eip155:5042002" }, { ...scope, origin: "https://other.test" }]) expect(readBrowserLocale(storage, other)).toBeNull();
    expect(() => localeScopeKey({ ...scope, owner: "body-owner" })).toThrow();
  });
  it("handles denied, corrupt, and silently failed browser storage without claiming persistence", () => {
    const denied = () => { throw new Error("storage disabled"); };
    expect(readBrowserLocale(denied, scope)).toBeNull(); expect(writeBrowserLocale(denied, scope, "vi")).toBe(false);
    const corrupt = () => ({ getItem: () => "corrupt", setItem: () => {} });
    expect(readBrowserLocale(corrupt, scope)).toBeNull(); expect(writeBrowserLocale(corrupt, scope, "vi")).toBe(false);
  });
  it("refuses wrong-owner/network/origin responses, accessors and oversized response JSON", async () => {
    const reply = { version: 1, locale: "vi", owner: alice, origin: scope.origin, network: scope.network, acceptLanguage: "zh-CN" };
    expect(parseLocaleReply(reply, scope)?.locale).toBe("vi");
    for (const wrong of [{ ...reply, owner: bob }, { ...reply, network: "eip155:5042002" }, { ...reply, origin: "https://other.test" }, { ...reply, extra: true }, { ...reply, locale: "corrupt" }]) expect(parseLocaleReply(wrong, scope)).toBeNull();
    const getter = Object.defineProperty({ ...reply }, "locale", { get() { throw new Error("never read"); }, enumerable: true });
    expect(parseLocaleReply(getter, scope)).toBeNull();
    await expect(readLocaleJson(new Response("x".repeat(9000)))).rejects.toThrow();
  });
  it("invalidates every historical response ticket on logout/refresh/selection", () => {
    const epoch = createLocaleEpoch(), read = epoch.capture(); epoch.invalidate();
    expect(epoch.current(read)).toBe(false); const selected = epoch.capture(); epoch.invalidate();
    expect(epoch.current(selected)).toBe(false);
  });
});
