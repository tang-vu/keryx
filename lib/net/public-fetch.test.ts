/**
 * The guard on a URL a stranger typed. What must never break: nothing on this box's own network is
 * reachable through a public endpoint, in any of the notations that address it.
 */

import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPublicAddress, UnsafeTargetError } from "./public-fetch";

describe("isPublicAddress", () => {
  it("accepts routable addresses", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });

  it("refuses loopback, private, link-local and CGNAT space", () => {
    for (const addr of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata — the address this guard exists for
      "100.64.0.1",
      "224.0.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
    ]) {
      expect(isPublicAddress(addr), addr).toBe(false);
    }
  });

  it("unwraps IPv4-mapped IPv6, the same address wearing a different notation", () => {
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:7f00:1")).toBe(false);
    expect(isPublicAddress("0:0:0:0:0:ffff:a9fe:a9fe")).toBe(false);
    expect(isPublicAddress("::ffff:93.184.216.34")).toBe(true);
    expect(isPublicAddress("::ffff:5db8:d822")).toBe(true);
  });

  it("treats 172.15 and 172.32 as public — the private block is 16..31 only", () => {
    expect(isPublicAddress("172.15.0.1")).toBe(true);
    expect(isPublicAddress("172.32.0.1")).toBe(true);
  });

  it("refuses anything that is not an IP at all", () => {
    expect(isPublicAddress("not-an-ip")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  const refuses = async (url: string) =>
    expect(assertPublicUrl(url)).rejects.toBeInstanceOf(UnsafeTargetError);

  it("refuses non-http schemes", async () => {
    await refuses("file:///etc/passwd");
    await refuses("gopher://example.com/");
    await refuses("not a url");
  });

  it("refuses an IP literal on the local network", async () => {
    await refuses("http://127.0.0.1:3000/feed.xml");
    await refuses("http://169.254.169.254/latest/meta-data/");
    await refuses("http://[::1]:8080/feed");
    // WHATWG URL canonicalizes the dotted tail to ::ffff:7f00:1 before the guard sees it.
    await refuses("http://[::ffff:127.0.0.1]:3000/feed.xml");
  });

  it("refuses credentials in the URL — how a probe smuggles a host past a naive check", async () => {
    await refuses("http://example.com@127.0.0.1/feed.xml");
  });

  it("passes a public IP literal through without touching DNS", async () => {
    const url = await assertPublicUrl("https://93.184.216.34/feed.xml");
    expect(url.hostname).toBe("93.184.216.34");
  });
});
