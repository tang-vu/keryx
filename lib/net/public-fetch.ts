/**
 * Fetching a URL a stranger typed.
 *
 * Every feed Keryx has ever read arrived from a wallet that had already signed in, so the outbound
 * fetch was only ever as hostile as a registered creator. A public tool that reads a feed for
 * anyone changes that: the caller now chooses an address the server will connect to from inside its
 * own network. `http://127.0.0.1:3000`, `http://169.254.169.254/latest/meta-data/` and every service
 * on the box that never expected a request from itself are one paste away.
 *
 * So the target is resolved before it is fetched, and only public addresses are allowed. Two details
 * carry most of the value:
 *
 *  - **Every address behind the name, not the first.** `dns.lookup` with `all` returns the whole
 *    record set; a name answering with one public and one loopback address is a probe, not a feed.
 *  - **Every hop, not just the first.** Redirects are followed by hand precisely so each new
 *    location is checked the same way — a public host that 302s to the metadata endpoint is the
 *    obvious way around a check that only looks at what was typed.
 *
 * Residual, stated rather than papered over: the name is resolved here and again by the socket, so
 * a record that changes between the two (DNS rebinding) is not stopped by this. Closing it means
 * pinning the resolved address and carrying the Host header by hand — worth it if this ever guards
 * something that writes, and overkill for reading an RSS file into a page that renders no HTML.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export interface FetchLimits {
  timeoutMs?: number;
  maxBytes?: number;
  maxHops?: number;
}

export interface PublicRequestLimits {
  timeoutMs?: number;
}

const DEFAULTS = { timeoutMs: 10_000, maxBytes: 2_000_000, maxHops: 3 } satisfies Required<FetchLimits>;

/** Why a URL was refused. Phrased for the person who pasted it. */
export class UnsafeTargetError extends Error {}

/**
 * Is this a routable public address?
 *
 * Rejects loopback, the RFC-1918 private blocks, link-local (which is where cloud metadata lives),
 * carrier-grade NAT, multicast, and the IPv6 equivalents. IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is
 * unwrapped first — it is the same address wearing a different notation, and reads as public
 * otherwise.
 */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const addr = mapped ? mapped[1]! : address;
  const family = isIP(addr);
  if (family === 4) {
    const [a, b] = addr.split(".").map(Number) as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false; // link-local — cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a >= 224) return false; // multicast + reserved
    return true;
  }
  if (family === 6) {
    const lower = addr.toLowerCase();
    if (lower === "::" || lower === "::1") return false;
    if (/^f[cd]/.test(lower)) return false; // unique-local
    if (/^fe[89ab]/.test(lower)) return false; // link-local
    if (lower.startsWith("ff")) return false; // multicast
    return true;
  }
  return false;
}

/**
 * Parse a caller-supplied URL and prove every address it resolves to is public.
 *
 * Credentials in the URL are refused outright: they carry no meaning for a feed and are how a
 * probe smuggles a payload past a naive host check (`http://public.example@127.0.0.1/`).
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  return (await resolvePublicUrl(raw)).url;
}

async function resolvePublicUrl(raw: string): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeTargetError("that is not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeTargetError("only http and https addresses can be read");
  }
  if (url.username || url.password) {
    throw new UnsafeTargetError("remove the credentials from the URL");
  }

  const host = url.hostname.replace(/^\[|\]$/g, ""); // an IPv6 literal arrives bracketed
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => {
        throw new UnsafeTargetError("that host does not resolve");
      })).map((r) => r.address);

  if (addresses.length === 0) throw new UnsafeTargetError("that host does not resolve");
  if (!addresses.every(isPublicAddress)) {
    throw new UnsafeTargetError("that address is on a private network");
  }
  return { url, addresses };
}

function pinnedAgent(address: string): Agent {
  const family = isIP(address) as 4 | 6;
  return new Agent({
    connect: {
      // assertPublicUrl validated every answer. Pin the socket to one of those exact answers so
      // the HTTP client cannot perform a second DNS lookup that rebinds to a private address.
      lookup(_hostname, _options, callback) {
        callback(null, address, family);
      },
    },
  });
}

/**
 * Read a public URL as text, checking every redirect hop and stopping at a size cap.
 *
 * The cap is read off the stream rather than trusted from `content-length`, which a hostile server
 * simply lies about. Nothing here is cached or stored — the caller renders a comparison and throws
 * the body away.
 */
export async function fetchPublicText(raw: string, limits: FetchLimits = {}): Promise<string> {
  const { timeoutMs, maxBytes, maxHops } = { ...DEFAULTS, ...limits };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    let target = raw;
    for (let hop = 0; hop <= maxHops; hop++) {
      const { url, addresses } = await resolvePublicUrl(target);
      const dispatcher = pinnedAgent(addresses[0]!);
      try {
        const res = await undiciFetch(url, {
          dispatcher,
          redirect: "manual",
          signal: ctrl.signal,
          headers: { "User-Agent": "Keryx-FeedCheck/1", Accept: "application/rss+xml, application/xml, text/xml, */*" },
        });

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location) throw new UnsafeTargetError("that address redirects nowhere");
          await res.body?.cancel();
          target = new URL(location, url).toString();
          continue;
        }
        if (!res.ok) throw new UnsafeTargetError(`the feed answered ${res.status}`);
        return await readCapped(res as unknown as Response, maxBytes);
      } finally {
        await dispatcher.close();
      }
    }
    throw new UnsafeTargetError("that address redirects too many times");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one request to an untrusted public URL. Redirects are refused: replaying a signed
 * webhook POST elsewhere is surprising, and following it unchecked would re-open SSRF.
 */
export async function fetchPublicUrl(
  raw: string,
  init: RequestInit,
  limits: PublicRequestLimits = {},
): Promise<Response> {
  const { url, addresses } = await resolvePublicUrl(raw);
  const dispatcher = pinnedAgent(addresses[0]!);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), limits.timeoutMs ?? DEFAULTS.timeoutMs);
  const onAbort = () => ctrl.abort();
  init.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const requestInit = {
      ...init,
      dispatcher,
      redirect: "error" as const,
      signal: ctrl.signal,
    } as unknown as Parameters<typeof undiciFetch>[1];
    const response = await undiciFetch(url, requestInit);
    await response.body?.cancel();
    return response as unknown as Response;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
    await dispatcher.close();
  }
}

/** Drain a response body up to `maxBytes`, refusing anything larger. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UnsafeTargetError("that file is too large to read");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks, total));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
