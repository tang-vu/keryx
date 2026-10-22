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

The lock update changes the Next framework, its matching environment/SWC packages
and matching ESLint configuration/plugin. It preserves every other package record,
including React 19.2.8, sharp 0.35.5 and the Circle/wallet/payment closure. The React
advisories concern `react-server-dom-*`; Next ships its own compiled server
implementation. Updating only the application React packages would not establish
that the framework contains these fixes.

The compiled-worker fixture now reads literal module-export calls with the
TypeScript parser: Next 16.4 mangles the worker helper's export name, so matching
only `.default(...)` no longer identifies its emitted reference. The fixture
requires one unambiguous descriptor whose bootstrap, runtime chunks and mainnet
entry all exist in the same inspected build. It still executes that actual
production worker in Chromium with the original synthetic transport and all
signing, custody, spend and payout assertions. Comments, string lookalikes,
dynamic chunk expressions, missing files and ambiguous references are refused.

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

## Audit residuals and release boundaries

The unchanged baseline root production lock audit returned **0 high/critical,
20 moderate and 7 low package records**. The full root audit, including development
tools, returned 19 high and 1 critical package records. Counts include transitive
propagation and are not distinct CVE counts or evidence of exploitation.
Development/worker updates remain necessary, including Vitest/Vite/Handlebars and
the separate Cloudflare sharp/Undici closures. Preserve the existing production
high/critical gate. Do not apply forced Hardhat major upgrades, Miniflare downgrades
or incompatible overrides to silence an audit.

The [previous dependency review](dependency-audit-2026-10-06.md) documents the
Circle/Solana/Jayson `stream-json` compatibility residual. It remains open; this
framework update does not relax payment, content, custody or evidence authority.

Web/API/remote MCP and root CLI/bots use the root installation and require the
updated runtime artifact. Desktop and the browser extension keep their existing
hosted-service handoffs. The standalone stdio MCP package has its own unchanged
dependency closure and updated engine requirement, but its host Node executable
still needs the Node security release. Separate Cloudflare locks and Rust locks
are unchanged by this outcome. Version
allocation, installer/package publication and deployment stay with the existing
release owner; merged source is not proof of an installed runtime update.
