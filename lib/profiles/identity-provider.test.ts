import { afterEach, expect, it, vi } from "vitest";
import { authorizationUrl, exchangeIdentity, type ProviderConfiguration } from "./identity-provider";
import { ProfileIdentityError } from "./verified-identities";

const github: ProviderConfiguration = { provider: "github", clientId: "fixture-client", clientSecret: "fixture-secret", redirectUri: "https://keryx.example/api/me/profile/identities/github/callback" };
const orcid = { ...github, provider: "orcid" as const, redirectUri: "https://keryx.example/api/me/profile/identities/orcid/callback" };
const state = "a".repeat(43), challenge = "b".repeat(43), codeVerifier = "c".repeat(64);
const input = { code: "fixture-code", codeVerifier };
const githubToken = { access_token: "gho_fixture_token", scope: "", token_type: "bearer" };
const orcidToken = { access_token: "fixture-orcid-token", scope: "/authenticate", token_type: "bearer", orcid: "0000-0002-1825-0097", name: "Fixture Researcher" };
const json = (value: unknown, headers?: HeadersInit) => Response.json(value, { headers });
const refuse = async (promise: Promise<unknown>) => {
  const error = await promise.catch(value => value);
  expect(error).toBeInstanceOf(ProfileIdentityError);
  if (!(error instanceof ProfileIdentityError)) throw new Error("Expected a sanitized identity refusal");
  expect(error.code).toBe("identity_unavailable");
  expect(error.message).toBe("identity_unavailable");
  expect(error.cause).toBeUndefined();
};
afterEach(() => vi.useRealTimers());

it("constructs fixed GitHub authorization with explicit empty scope and required S256", () => {
  const url = new URL(authorizationUrl(github, state, challenge));
  expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
  expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: github.clientId, redirect_uri: github.redirectUri,
    response_type: "code", state, scope: "", code_challenge: challenge, code_challenge_method: "S256" });
  expect(url.href).not.toContain(github.clientSecret);
});
it("constructs ORCID authentication only without claiming undocumented PKCE", () => {
  const url = new URL(authorizationUrl(orcid, state));
  expect(url.origin + url.pathname).toBe("https://orcid.org/oauth/authorize");
  expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: orcid.clientId, redirect_uri: orcid.redirectUri,
    response_type: "code", state, scope: "/authenticate" });
  expect(() => authorizationUrl(orcid, state, challenge)).toThrow(ProfileIdentityError);
});
it.each([undefined, "", "short", "x".repeat(42), "x".repeat(44), "=".repeat(43)])("refuses malformed or missing GitHub challenge %s", value => {
  expect(() => authorizationUrl(github, state, value)).toThrow(ProfileIdentityError);
});
it.each(["short", "x".repeat(129), "x".repeat(32) + "\n"])("refuses malformed state %s", value => {
  expect(() => authorizationUrl(github, value, challenge)).toThrow(ProfileIdentityError);
});
it.each(["http://keryx.example/callback", "https://user:password@keryx.example/callback", "https://keryx.example/callback?next=foreign", "https://keryx.example/callback#fragment", "not a URL"])("refuses unsafe configured callback %s before transport", async redirectUri => {
  const config = { ...github, redirectUri }, fetcher = vi.fn<typeof fetch>();
  expect(() => authorizationUrl(config, state, challenge)).toThrow(ProfileIdentityError);
  await refuse(exchangeIdentity(config, input, fetcher));
  expect(fetcher).not.toHaveBeenCalled();
});

it("exchanges GitHub code once, then projects only durable ID and login", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...githubToken, refresh_token: "discard-this-refresh" }))
    .mockResolvedValueOnce(json({ id: 123, login: "fixture-user", name: "Excluded full name", email: "excluded@example.invalid",
      avatar_url: "https://foreign.invalid/avatar", private_gists: 50, extra: "discard" }, { "X-OAuth-Scopes": "" }));
  expect(await exchangeIdentity(github, input, fetcher)).toEqual({ provider: "github", externalId: "123", label: "fixture-user" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe("https://github.com/login/oauth/access_token");
  expect(request).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" } });
  expect(Object.fromEntries(new URLSearchParams(request?.body as string))).toEqual({ client_id: github.clientId, client_secret: github.clientSecret,
    redirect_uri: github.redirectUri, code: input.code, code_verifier: codeVerifier });
  const [userUrl, userRequest] = fetcher.mock.calls[1];
  expect(userUrl).toBe("https://api.github.com/user");
  expect(userRequest).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", headers: {
    Authorization: `Bearer ${githubToken.access_token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" } });
  expect(request?.signal?.aborted).toBe(true); expect(userRequest?.signal?.aborted).toBe(true);
});
it("projects ORCID ID/name without any record, userinfo or refresh read", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...orcidToken, refresh_token: "discard", email: "excluded@example.invalid", works: [{ secret: "excluded" }] }));
  expect(await exchangeIdentity(orcid, { code: "fixture-code" }, fetcher)).toEqual({ provider: "orcid", externalId: orcidToken.orcid, label: orcidToken.name });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe("https://orcid.org/oauth/token");
  expect(request).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
  expect(Object.fromEntries(new URLSearchParams(request?.body as string))).toEqual({ client_id: orcid.clientId, client_secret: orcid.clientSecret,
    redirect_uri: orcid.redirectUri, code: "fixture-code", grant_type: "authorization_code" });
});
it.each([null, undefined, "", "  "])("uses authenticated ORCID ID as display when name is absent %s", async name => {
  expect(await exchangeIdentity(orcid, { code: "fixture-code" }, vi.fn<typeof fetch>().mockResolvedValue(json({ ...orcidToken, name })))).toEqual({ provider: "orcid", externalId: orcidToken.orcid, label: orcidToken.orcid });
});

it.each(["repo", "read:user", "user:email", "offline_access", "/authenticate", undefined, null, " "])("refuses nonempty or omitted GitHub token scope %s before user read", async scope => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...githubToken, scope }));
  await refuse(exchangeIdentity(github, input, fetcher)); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(["/read-public", "/read-limited", "/authenticate /read-limited", "openid", "", undefined])("refuses widened or missing ORCID scope %s", async scope => {
  await refuse(exchangeIdentity(orcid, { code: "fixture-code" }, vi.fn<typeof fetch>().mockResolvedValue(json({ ...orcidToken, scope }))));
});
it("refuses contradictory GitHub resource scopes", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(githubToken)).mockResolvedValueOnce(json({ id: 1, login: "fixture" }, { "X-OAuth-Scopes": "repo" }));
  await refuse(exchangeIdentity(github, input, fetcher)); expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each([0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, "123", null])("refuses malformed GitHub numeric ID %s", async id => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(githubToken)).mockResolvedValueOnce(json({ id, login: "fixture" }));
  await refuse(exchangeIdentity(github, input, fetcher));
});
it.each(["-fixture", "fixture/other", "x".repeat(40), "fixture\n", null])("refuses malformed GitHub login %s", async login => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(githubToken)).mockResolvedValueOnce(json({ id: 1, login }));
  await refuse(exchangeIdentity(github, input, fetcher));
});
it.each([
  { orcid: "0000-0002-1825-0098" }, { orcid: "https://orcid.org/0000-0002-1825-0097" },
  { name: "x".repeat(161) }, { name: "Fixture\nResearcher" }, { name: "Fixture\u202e" }, { name: "\ud800" }, { name: 5 },
])("refuses invalid ORCID identity %j", async fields => {
  await refuse(exchangeIdentity(orcid, { code: "fixture-code" }, vi.fn<typeof fetch>().mockResolvedValue(json({ ...orcidToken, ...fields }))));
});
it.each([{ error: "fixture-secret-provider-error", error_description: "fixture-secret" }, { access_token: "bad\r\ntoken" },
  { access_token: "" }, { token_type: "mac" }, { error: null }])("refuses token errors and malformed bearer data without disclosure %j", async fields => {
  await refuse(exchangeIdentity(github, input, vi.fn<typeof fetch>().mockResolvedValue(json({ ...githubToken, ...fields }))));
});
it.each([undefined, "short", "a".repeat(129), "a".repeat(43) + "+"])("refuses invalid GitHub verifier %s before transport", async value => {
  const fetcher = vi.fn<typeof fetch>();
  await refuse(exchangeIdentity(github, { code: "fixture-code", codeVerifier: value }, fetcher)); expect(fetcher).not.toHaveBeenCalled();
});
it("refuses undocumented ORCID verifier rather than silently treating it as protection", async () => {
  const fetcher = vi.fn<typeof fetch>(); await refuse(exchangeIdentity(orcid, input, fetcher)); expect(fetcher).not.toHaveBeenCalled();
});

it.each([302, 401, 429, 500])("refuses HTTP %s without following location or retrying", async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret body", { status, headers: { Location: "https://foreign.invalid", "Retry-After": "1" } }));
  await refuse(exchangeIdentity(github, input, fetcher)); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
});
it("refuses a fetcher-reported followed redirect", async () => {
  const response = json(githubToken); Object.defineProperty(response, "redirected", { value: true });
  await refuse(exchangeIdentity(github, input, vi.fn<typeof fetch>().mockResolvedValue(response)));
});
it.each(["text/html", "text/plain", "application/x-www-form-urlencoded"])("refuses non-JSON MIME %s", async type => {
  await refuse(exchangeIdentity(github, input, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(githubToken), { headers: { "Content-Type": type } }))));
});
it.each(["{invalid secret}", "[]", "null", "123"])("refuses malformed/non-object JSON %s", async body => {
  await refuse(exchangeIdentity(github, input, vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { "Content-Type": "application/json" } }))));
});
it("refuses advertised oversized response without consuming its body", async () => {
  const cancel = vi.fn(), pull = vi.fn();
  const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  await refuse(exchangeIdentity(github, input, vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { "Content-Type": "application/json", "Content-Length": "65537" } }))));
  expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1);
});
it("bounds real streamed bytes even when length is missing or lies", async () => {
  const cancel = vi.fn(); let emitted = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(32769)); emitted++; }, cancel }, { highWaterMark: 0 });
  await refuse(exchangeIdentity(github, input, vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { "Content-Type": "application/json", "Content-Length": "5" } }))));
  expect(emitted).toBe(2); expect(cancel).toHaveBeenCalledTimes(1);
});
it("refuses invalid UTF-8 before JSON interpretation", async () => {
  await refuse(exchangeIdentity(github, input, vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([0xff]), { headers: { "Content-Type": "application/json" } }))));
});
it("enforces timeout even if an injected fetch ignores abort", async () => {
  vi.useFakeTimers(); const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
  const result = refuse(exchangeIdentity(github, input, fetcher));
  await vi.advanceTimersByTimeAsync(10_000); await result;
  expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("enforces the same timeout while a response body stalls", async () => {
  vi.useFakeTimers(); const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response), result = refuse(exchangeIdentity(github, input, fetcher));
  await vi.advanceTimersByTimeAsync(10_000); await result;
  expect(cancel).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it("sanitizes thrown transport errors and never retries", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("fixture-secret leaked-token provider-body"));
  await refuse(exchangeIdentity(github, input, fetcher)); expect(fetcher).toHaveBeenCalledTimes(1);
});
