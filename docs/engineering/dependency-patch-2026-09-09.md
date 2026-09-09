# Framework dependency patch — September 9, 2026

CI run `34317251612` for `35736f8` passed TypeScript and tests, then failed the
unchanged production high-severity dependency audit before its production build.
The local audit reproduced one critical Next.js and one high sharp finding.

Official advisory references:

- [Next.js Windows-hosted RCE](https://github.com/advisories/GHSA-p293-qw3h-jr36)
- [Next.js AVIF image optimization RCE](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)
- [sharp bundled libheif vulnerabilities](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)

Raise the Next.js and matching ESLint integration floor to 16.3.3. The refreshed
lockfile resolves both to 16.3.4. Update the existing Next-scoped sharp override
from 0.35.3 to 0.35.4, including its matching native/libvips packages. The inspected
version diff is limited to Next.js, its SWC/env/ESLint family and sharp's native family.
Do not use `npm audit fix --force` to downgrade or replace unrelated wallet dependencies.

The production VPS is Linux, while local development uses Windows; the AVIF advisory
is not limited to Windows. These advisories establish a patch requirement, not proof
that this deployment was exploited. No audit gate or payment policy is relaxed.

Local validation after installation:

- TypeScript passed.
- Economics and buyer suites: 46 tests passed across five files.
- Generated an 8×8 AVIF with sharp, decoded it and encoded PNG successfully.
- Production audit JSON: 0 high, 0 critical, 7 low, 17 moderate. This is not a clean
  audit or independent security review; remaining transitive findings stay visible.

The initial economics deploy was already building when the advisory gate failed.
Do not run a second deploy against that live build process. The patched commit must
pass CI's production build and be deployed after the first deploy terminates; public
health must identify the patched commit before calling this remediation deployed.
