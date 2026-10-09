import { describe, expect, it } from "vitest";
import { isConfiguredSameOrigin } from "./auth-origin";

const request = (origin?: string, headers: Record<string, string> = {}) => new Request("http://localhost:3939/api/me/bibliographies", {
  headers: { ...(origin === undefined ? {} : { Origin: origin }), ...headers },
});

describe("server-configured cookie mutation origin", () => {
  it("accepts the exact configured public origin despite Next's internal URL and ignores forwarded selectors", () => {
    for (const base of ["https://keryx.cc", "https://keryx.cc/", "https://keryx.cc:443"]) {
      expect(isConfiguredSameOrigin(request("https://keryx.cc", { Host: "evil.example", "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "http" }), base)).toBe(true);
    }
    expect(isConfiguredSameOrigin(request("http://127.0.0.1:49871", { "Sec-Fetch-Site": "same-origin" }), "http://127.0.0.1:49871")).toBe(true);
    expect(isConfiguredSameOrigin(request("https://evil.example", { Host: "evil.example", "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "https" }), "https://keryx.cc")).toBe(false);
  });
  it.each([undefined, "null", "https://evil.example", "http://keryx.cc", "https://keryx.cc:444", "https://keryx.cc:443", "https://keryx.cc/", "https://keryx.cc/path", "https://keryx.cc?x=1", "https://keryx.cc#x", "https://keryx.cc@evil.example", "https://user@keryx.cc", "https://keryx.cc, https://evil.example", "https://KERYX.CC", "https:\\keryx.cc"])("refuses missing, malformed or nonexact Origin %s", origin => {
    expect(isConfiguredSameOrigin(request(origin, { Host: "keryx.cc", "X-Forwarded-Host": "keryx.cc", "X-Forwarded-Proto": "https" }), "https://keryx.cc")).toBe(false);
  });
  it.each([undefined, null, 42, "", "keryx.cc", "https:keryx.cc", "ftp://keryx.cc", "file:///keryx.cc", "https://user@keryx.cc", "https://user:password@keryx.cc", "https://keryx.cc/path", "https://keryx.cc?x=1", "https://keryx.cc#x", "https://keryx.cc?", "https://keryx.cc#", "https://keryx.cc/.", "https://keryx.cc/%2e", " https://keryx.cc", "https://keryx.cc\n/", "https://keryx.cc\u0000", "https:\\keryx.cc"])("fails closed on invalid deployment configuration %s", base => {
    expect(isConfiguredSameOrigin(request("https://keryx.cc"), base)).toBe(false);
  });
  it.each(["cross-site", "same-site", "none", "same-origin, cross-site", ""])("refuses nonmatching fetch metadata %s", site => {
    expect(isConfiguredSameOrigin(request("https://keryx.cc", { "Sec-Fetch-Site": site }), "https://keryx.cc")).toBe(false);
  });
  it("refuses multiple Origin fields after the Fetch headers combine them", () => {
    const req = request("https://keryx.cc"); req.headers.append("origin", "https://keryx.cc");
    expect(isConfiguredSameOrigin(req, "https://keryx.cc")).toBe(false);
  });
});
