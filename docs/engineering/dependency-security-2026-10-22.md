# October 22 security dependency review

The root application pins Next.js and `eslint-config-next` to **16.4.1** to
include the October 14 upstream security fixes. The public-origin server and its
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

## Runtime upgrade remains a separate requirement

The [October 21 Node.js security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
fixes the Brotli decoder RCE CVE-2026-111497 and DNS/TLS issues. The patched
24.x release is **24.22.1**; the patched 22.x and 26.x releases are 22.23.4 and
26.12.1. At this review, CI/build tooling and the bundled desktop runtime still
pin 24.21.0. The development executable was also 24.21.0; the live server
executable was not independently inspected by this dependency change.

Keryx's public fetch path uses Undici to read untrusted public responses. The
installed Undici implementation calls Node's Brotli decoder. Bounding bytes
after decompression is not a fix for a native decoder memory-safety issue.
The Node upgrade must cover the server, development/build/CI executables and the
desktop binary with its official archive/binary hashes and artifact verification.
This Next update alone does not repair an older Node executable or installed app.

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
lock, but its host Node executable still needs the Node security release. Separate
Cloudflare locks and Rust locks are unchanged by this Next outcome. Version
allocation, installer/package publication and deployment stay with the existing
release owner; merged source is not proof of an installed runtime update.
