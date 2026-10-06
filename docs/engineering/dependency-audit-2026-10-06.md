# Dependency audit and compatibility — October 6, 2026

The Sources release candidate `05e67fd` failed the existing production dependency
gate in CI run `37403113774`. The dependency closure was unchanged by the source
catalog work. The actual high/critical blockers are `proxy-addr@2.0.7` and
`source-map-js@1.2.1`; the newly reported `stream-json` findings are **moderate**.
Keep `npm audit --omit=dev --audit-level=high` intact. Do not use a forced audit
repair, downgrade Circle/wallet dependencies, remove supported functionality, or
silently describe remaining findings as resolved.

## Compatible patches

| Package | Prior root lock | Compatible target | Primary advisory |
| --- | --- | --- | --- |
| proxy-addr | 2.0.7 | 2.0.8 | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), critical |
| source-map-js | 1.2.1 | 1.2.2 | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), high |

The root closure is `@modelcontextprotocol/sdk@1.30.0` → `express@5.2.1` →
`proxy-addr@^2.0.7`. Version 2.0.8 satisfies the existing range, keeps the CommonJS
export shape (`proxyaddr`, `all`, `compile`) and retains exactly the existing
`forwarded@0.2.0` / `ipaddr.js@1.9.1` runtime dependencies. The patch restricts when
IPv4 addresses can match IPv6 trust subnets and normalizes mapped candidates;
it does not require an MCP SDK or Express major change. See the
[2.0.8 package metadata](https://github.com/jshttp/proxy-addr/blob/v2.0.8/package.json)
and [patched implementation](https://github.com/jshttp/proxy-addr/blob/v2.0.8/index.js).

The root `source-map-js` instance is shared by Next.js's nested PostCSS, jsdom's
`css-tree`, and development PostCSS/Tailwind. Each inspected direct parent declares
`^1.2.1`, admitting 1.2.2 without a manifest override. The advisory describes
unvalidated indexed source-map section line offsets causing synchronous excessive
work and identifies 1.2.2 as patched. This establishes the need for a compatible
patch, not evidence that the production service was exploited. See the
[upstream release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2).

The primary agent refreshed the root lock only with npm 11.19.0, changing these two
package entries and proxy-addr's published funding metadata. `package.json` and
all Circle/wallet version declarations remain unchanged. A subsequent local
production-only audit against that lock reported **0 high, 0 critical, 19 moderate
and 7 low**. This audit reads the lock; it does not establish that an existing
`node_modules`, deployed process, package or installer already uses the patch.
During investigation the shared checkout still had proxy-addr 2.0.7 installed
while its new lock selected 2.0.8. A separate clean worktree subsequently completed
npm 11.19.0 `ci` against the patched lock and passed all four committed security
regressions against the actually installed packages. Its production-only audit
reported the same 0 high / 0 critical, 19 moderate / 7 low result. The desktop lock
also selects source-map-js 1.2.2, with all other entries preserved. These are local
observations; final CI, deployed processes and applicable distribution readback
remain independent release gates.

## Observed regression evidence

The independent investigation fetched the exact npm proxy-addr 2.0.8 artifact,
verified its SHA-512 digest against its registry `dist.integrity`, and loaded the
artifact's `index.js` in memory against the unchanged dependency versions. No
project package, lock, installed dependency, production process or Git state was
modified by this proof.

Nine bounded trust cases passed for 2.0.8: short mapped trust prefixes and native
zero-leading IPv6 prefixes reject external plain/mapped IPv4 candidates; properly
spelled mapped `/104` and plain IPv4 `/8` ranges retain correct inside/outside
behavior; the multiple-subnet branch also rejects an external IPv4 candidate.
Five malicious cases that passed trust in 2.0.7 fail in 2.0.8. With a fabricated
`X-Forwarded-For` value of `198.51.100.44` and socket origin `203.0.113.7`, the
short mapped trust configuration returns the forged value on 2.0.7 and the socket
origin on 2.0.8. These are documentation/test addresses and an in-memory request,
not a request to Keryx or a production exploit.

`scripts/security-dependencies.test.mjs` checks forged-header rejection for short
mapped/native IPv6 prefixes and the multiple-subnet branch, together with valid
IPv4, mapped IPv4 and IPv6 forwarded chains. Source-map regressions reject negative,
fractional, non-finite, string and unsafe offsets at construction, reject a large
line offset and excessive accumulated nested offsets, and retain an ordinary
indexed-map/SourceNode round trip. The malicious maps are never passed to the
potentially unbounded SourceNode path. All four tests passed against the clean
patched installation. CI runs them before the unchanged high/critical audit gate.

## Moderate stream-json residual

The unchanged closure is Circle's adapter/Gateway/unified-balance dependencies
and Anchor → `@solana/web3.js@1.98.4` → `jayson@4.3.0` → `stream-json@^1.9.1`.
The installed and locked stream-json version is 1.9.1. npm reports moderate
[JSONC comment rescanning](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x),
[object prototype replacement](https://github.com/advisories/GHSA-mjw6-4jj6-33hc)
and the existing
[nested filter complexity finding](https://github.com/advisories/GHSA-528h-pc64-c93x).

The first two advisory version tables now identify **3.6.0 as patched**. Their
old proof-of-concept prose still describes the formerly unpatched state; that
prose must not be used to claim no fixed release exists. The npm registry observed
on October 6 has stream-json 3.7.0 as latest, while 1.9.1 remains the newest 1.x
release. A patched upstream exists; a same-major transitive fix for the installed
Jayson range was not found.

Overriding 1.9.1 directly to 3.6.0/3.7.0 is incompatible with the inspected caller.
Jayson 4.3.0 eagerly requires the CommonJS paths
`stream-json/streamers/StreamValues` and `stream-json/utils/Verifier`, uses a
Verifier constructor and a stream-returning `StreamValues.withParser()`.
The newer library is ESM, maps exports to `src/`, uses lower kebab-case paths and
separates the pipeline factories from `asStream`/`withParserAsStream` wrappers.
See [Jayson 4.3.0 calls](https://github.com/tedeh/jayson/blob/v4.3.0/lib/utils.js),
[stream-json 3.6.0 exports](https://github.com/uhop/stream-json/blob/3.6.0/package.json),
[stream-values wrappers](https://github.com/uhop/stream-json/blob/3.6.0/src/streamers/stream-values.js)
and [verifier wrappers](https://github.com/uhop/stream-json/blob/3.6.0/src/utils/verifier.js).

Jayson **5.0.0** is published and removes both stream-json and uuid. It requires
Node.js 20+ and changes TCP/TLS framing: messages must end in a configured
delimiter, defaulting to newline; concatenated JSON without delimiters is no
longer accepted. That is a real major compatibility change outside Solana's
`^4.1.1` range, even though Keryx's Node runtime meets its engine requirement.
Do not force it into the payment dependency closure as a lock repair. See the
[Jayson 5 changelog](https://github.com/tedeh/jayson/blob/v5.0.0/README.md#changelog-only-notable-milestoneschanges)
and [versioned package metadata](https://github.com/tedeh/jayson/blob/v5.0.0/package.json).

The inspected Solana runtime imports `jayson/lib/client/browser`; that entry uses
JSON.parse and does not import Jayson utils or its stream parser. Repository
inspection found no application use of Jayson `parseStream`, JSONC parsing or
stream-json filters. This narrows demonstrated reachability; it does not certify
every supplier path or eliminate the installed vulnerability. A bounded local
1.9.1 StreamValues proof reproduced prototype replacement: the parsed object
inherited an injected `isAdmin` value and lacked an own `__proto__` key, while
native JSON.parse retained an own key and ordinary prototype. No application
authorization path was exercised and the global Object prototype was not changed.

Retain this residual explicitly. A future upstream-compatible upgrade needs a
separate dependency review, proven caller compatibility, JSON-RPC request/response
and error behavior, and Circle/browser-wallet/payment regression checks. Do not
introduce untrusted stream parsing while the affected closure remains. No moderate
finding is reclassified, hidden or called fixed by this release.

## Supported surface audit

| Surface | Observed dependency role and release boundary |
| --- | --- |
| Hosted web, API and remote MCP | Use the root lock. `/mcp` uses Next.js and `WebStandardStreamableHTTPServerTransport`, not an Express wrapper; no repository `trust proxy` configuration or Express app construction was found. The SDK nevertheless includes the Express/proxy-addr dependency closure. Patch the closure and rebuild/redeploy the app; do not infer an exposed proxy-spoofing path from package presence. Next/PostCSS and jsdom/css-tree share root source-map-js. |
| Root CLI and server-side bots | Use root-installed dependencies and the shared deployed service. They inherit the compatible root lock update where those modules are loaded. No separate npm distribution or scheduler/payment change is introduced. |
| Local and published stdio MCP | `mcp/package-lock.json` already selects proxy-addr 2.0.8 through SDK 1.31.0/Express 5.2.1 and has neither stream-json nor source-map-js. The stdio entry imports the stdio transport, not an Express listener. `mcp/package.json` pins the SDK, whose Express/proxy transitive ranges admit the patch. A scripts-disabled npm 11.19.0 pack dry-run includes only README, `dist/keryx-mcp.mjs` and package.json, with no bundled dependencies or lockfile; dependencies resolve at consumer installation. The root lock patch changes no stdio package bytes. Existing consumer installations/locks may retain old transitive versions and need their own update/audit; a new publication alone would not repair them. |
| Desktop | The desktop lock had dev-only source-map-js 1.2.1 via Vitest 4.1.11 → Vite 8.3.1 → PostCSS 8.5.28, whose range admits 1.2.2. This release refreshes that entry to 1.2.2 and preserves other entries. In-memory esbuild metafiles for the actual helper, renderer and bridge entry points contain 56/11/3 inputs respectively and none of proxy-addr, source-map-js, stream-json, Jayson, Express or the MCP SDK. The packaged Rust writer/host and pinned Node binary do not embed these npm modules. The patch therefore changes build/test dependency closure, with no demonstrated affected installer bytes or need for an installer version bump solely for this patch. |
| Browser extension | Manifest and plain browser scripts call the hosted service. Its packaging allowlist contains no npm dependencies or node_modules. It benefits from the hosted release; these patches change no extension bytes. |
| Cloudflare upkeep and monitoring workers | Their separate lockfiles contain none of the three investigated packages. They call the hosted endpoints; this patch changes no worker byte, timer or allowance. |
| Arc primitives package | Its separate lock already selects source-map-js 1.2.2 in development tooling. No package/runtime API change is needed for these findings. |

The esbuild inspections used `write:false` and placeholder compile-time commit
identity only to inspect module inputs. They did not run the helper, build a release,
replace an installer, or establish distribution synchronization. Final clean
install/test/build, unchanged CI gate, deployed-commit verification and applicable
published package/installer readback belong to the coordinated release record.
This investigation edits only this audit note and does not perform those releases.
