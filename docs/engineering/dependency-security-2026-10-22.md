# October 22 security dependency review

The root application pins Next.js and `eslint-config-next` to **16.4.1** to
include the October 14 upstream security fixes. CI, release preparation and the
desktop runtime now pin **Node.js 24.22.1** for the October 21 security release.
The public-origin server and its
compiled browser acceptance fixtures require that same exact framework version.
This source update requires production-build, public-origin, privacy and payment
acceptance before merge, followed by the existing coordinated runtime release.

## Next.js advisories and current application conditions

| Advisory | Vendor description | Current source observation |
| --- | --- | --- |
| [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) | Critical RCE in Cache Components when a `use cache` function returns multiple typed arrays; patched in 16.4.1. | `next.config.ts` leaves Cache Components disabled. The vendor explicitly recommends upgrading even without such functions. |
| [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) / CVE-2026-96889 | Critical image-optimization RCE under the documented glibc Linux conditions; patched Next selects a fixed image dependency. | The root lock and existing override already select `sharp@0.35.5`, the vendor workaround. This dependency stays unchanged. |
| [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r) | High CPU denial of service in App Router applications with Server Actions; patched in 16.4.1. | No application `use server` directive was found during the source review. This narrows demonstrated reachability; it does not replace the framework update. |

See the [vendor security release](https://nextjs.org/blog/nextjs-security-update-october-14-2026).
The October 22 npm audit result did not enumerate these Next advisories, so its
severity totals alone cannot establish that the framework is patched.

The framework portion of the update changes Next, its matching environment/SWC
packages and matching ESLint configuration/plugin. At that stage it preserved
every other package record, including React 19.2.8, sharp 0.35.5 and the
Circle/wallet/payment closure. The compatible three-record follow-up is described
below. The React
advisories concern `react-server-dom-*`; Next ships its own compiled server
implementation. Updating only the application React packages would not establish
that the framework contains these fixes.

Next 16.4 enables export-key mangling by default in production. Keryx explicitly
sets the documented `experimental.turbopackMangleExportNames: false` to preserve
the named exports inspected by its compiled evidence, HTML and research-allowance
checks. Ordinary production JavaScript minification remains enabled. Acceptance
executes the same actual build used for delivery, including the unchanged mainnet
Chromium worker, signing, custody, spend and payout assertions. This preserves
the existing compiler behavior while taking the security release.

The fixture's registration reader also follows Next16.4's optional leading array
of strict factories. It retains each original factory and module ID, rejects
malformed groups and keeps export ambiguity checks. No factory is executed by
the inspector; the existing fixtures then invoke the selected compiled exports
through the real Next runtime with their original hermetic dependencies.

Next also moved its native image helpers to
`next/dist/server/image-optimizer/transform`. The image fixture follows that
actual implementation and retains its native version, malformed-input, pixel,
optimizer output and desktop-brand checks. The 48 offline study trials were
rerun against the new lock: their outputs and source bindings stayed identical;
only the recorded lock hash and its generated write-up changed.

## Node.js source pins and runtime delivery

The [October 21 Node.js security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
fixes the Brotli decoder RCE CVE-2026-111497 and DNS/TLS issues. The patched
24.x release is **24.22.1**; the patched 22.x and 26.x releases are 22.23.4 and
26.12.1. The initial audit found CI/build tooling and the bundled desktop runtime
pinned to 24.21.0. This update changes those source pins, the preparation/review
checks and the desktop binary/archive hashes together. Root and stdio MCP engine
ranges require patched 22.x/24.x versions or 26.12.1 and later. The development
machine's default executable was 24.21.0; focused checks use a separately verified
24.22.1 binary. The global default and live server executable were not replaced
by this source change.

Keryx's public fetch path uses Undici to read untrusted public responses. The
installed Undici implementation calls Node's Brotli decoder. Bounding bytes
after decompression is not a fix for a native decoder memory-safety issue.
Delivery must cover the server, development/build executables and the desktop
binary with artifact verification. The Windows x64 ZIP and extracted node.exe
were downloaded from the official 24.22.1 release, checked against its published
SHA-256 values and executed locally. The binary SHA-256 is
`d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5`.
Merged source does not replace an older running process, installation or builder
image. Those remain with the existing release owner.
These security pins replace the older Node 24.21.0/22.19.0 examples in retained
setup and release documentation; all other release, isolation and custody
requirements remain in force.

## Compatible production dependency follow-up

The root lock also advances exactly three existing package records, with no
manifest change and no added or removed packages:

| Package | Root lock change | Advisory and reviewed use |
| --- | --- | --- |
| `fast-uri` | 3.1.7 → 3.1.9 | [GHSA-hrr3-gc8f-f4qj](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj), patched in 3.1.8: inconsistent host case normalization with encoded octets. AJV uses this resolver; MCP SDK 1.32.1 constructs its default AJV provider. Keryx's tools use Zod and do not expose arbitrary schema/form elicitation, so the specific host-policy bypass is not demonstrated on the public route. |
| `hono` | 4.13.7 → 4.13.13 | [GHSA-5r4p-p66f-jhc7](https://github.com/honojs/hono/security/advisories/GHSA-5r4p-p66f-jhc7), patched in 4.13.11: static-file path decoding can bypass middleware mounted on a protected prefix. Hono is present in the SDK example closure; Keryx's `/mcp` and mandate MCP routes use Web Standard transport and do not serve files through Hono. |
| `ip-address` | 10.5.0 → 10.7.4 | [GHSA-h3mg-xc3c-68pw](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-h3mg-xc3c-68pw), patched in 10.7.1: unbounded IPv6 parse diagnostics. It is pulled through `express-rate-limit` in the SDK OAuth helpers. Keryx's routes retain their own key, IP, scope and rate-limit admission rather than mounting those helpers. |

The review distinguishes installed dependency presence from a demonstrated
exploitable application path. It does not remove guards or declare the remaining
closure unreachable. SDK, AJV, React, Next, Circle/wallet/payment packages and all
other package records retain their existing versions.

Bounded in-memory probes reproduce the old encoded-host inconsistency and a
Hono malformed-percent protected-file bypass, then confirm refusal/canonicalization
with the patched libraries. An 8 KiB invalid IPv6 string previously produced a
278,528-character diagnostic; the new parser rejects it with a typed, short error
and no expanded diagnostic. Valid IPv6 and the rate-limit helper remain compatible.
The actual SDK validator retains valid/invalid data, local references and caching.
These probes made no external requests and did not run destructive oversized inputs.

Fifty-three existing HTTP/MCP/rate-limit cases pass on the isolated new graph,
including stateless initialize/list/call, body bounds and deadlines, origin/scoped
access refusal, private-history fences and durable rate-limit behavior. Local
fixtures use synthetic data, Arc testnet/offline settings and isolated storage;
they do not establish mainnet settlement or runtime delivery. Full applicable
hosted acceptance and the existing coordinated runtime release remain required.

The 48-trial offline study was also reproduced and checked against this lock.
Its outputs and all 468 application source bindings stayed identical; only the
lock hash and that hash in the generated write-up changed. This updates provenance
without treating synthetic results as live user or settlement evidence.

The separate stdio MCP lock already contains `fast-uri` 3.1.8, Hono 4.13.12 and
`ip-address` 10.7.2, at or above the three advisory patch boundaries. Its manifest
and lock are unchanged by this follow-up. Its host executable still needs the
Node security release, independently of package audit results.

## Audit residuals and release boundaries

The baseline root production lock audit returned **0 high/critical, 20 moderate
and 7 low package records**. After the three compatible root records above, the
fresh production audit returns **0 high/critical, 17 moderate and 7 low**. The
baseline full root audit, including development tools, returned 19 high and
1 critical package records. Counts include transitive
propagation and are not distinct CVE counts or evidence of exploitation.
Development tool updates remain necessary, including Vitest/Vite/Handlebars.
The separate Cloudflare sharp/Undici toolchain closures have their own reviewed
[Worker update](https://github.com/tang-vu/keryx/pull/637) and independent lock,
vendor-build and native-runtime acceptance. Preserve the existing production
high/critical gate. Do not apply forced Hardhat major upgrades, Miniflare downgrades
or incompatible overrides to silence an audit.

The [previous dependency review](dependency-audit-2026-10-06.md) documents the
Circle/Solana/Jayson `stream-json` compatibility residual. It remains open; this
framework update does not relax payment, content, custody or evidence authority.

Web/API/remote MCP and root CLI/bots use the root installation and require the
updated runtime artifact. Desktop and the browser extension keep their existing
hosted-service handoffs. The standalone stdio MCP package has its own unchanged
dependency closure and updated engine requirement, but its host Node executable
still needs the Node security release. The root follow-up does not modify the
separate Cloudflare or Rust locks, configure a Worker or change schedules. Version
allocation, installer/package publication and deployment stay with the existing
release owner; merged source is not proof of an installed runtime update.
