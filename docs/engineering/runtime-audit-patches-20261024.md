# Runtime validation security patches

The October 23 advisory refresh blocks the required high-severity production
dependency audit: Zod CVE-2023-54404 / GHSA-mrhx-c7xc-m3w5, body-parser
GHSA-27r3-jxmh-p828, and undici GHSA-xjj6-f33q-929c. The audit gate is unchanged.

Root runtime resolutions use Zod 4.6.7, body-parser 2.4.0, undici 8.12.3 and
supported nested 6.29.1 / 7.30.1 cohorts. Current Circle balance SDKs and x402
still declare Zod 3 and use its function/record APIs. The application also retains
Zod 3 UTF-16 length limits and refinement contracts. Native Zod 4 changes Unicode
length semantics and introduces JIT behavior incompatible with existing CSP.
`scripts/patch-legacy-zod.mjs` therefore maps the root package's bare entry and
types to its published `v3` compatibility entry and backports over-limit array
refusal to that runtime. Existing application/SDK source keeps its prior APIs.
Both `.max()` and oversized `.length()` reject before traversing elements, in
synchronous and asynchronous parsing, ESM and CommonJS. Other validation and
payment behavior remains upstream. Native Zod 4 subpaths remain unmodified;
Scalar's native-4 imports are made explicit as `zod/v4`. MCP protocol schemas
already use native-4 subpaths. Input defaults, requiredness and secret-free SDK
errors remain the established application contracts. The package version is
4.6.7; application validation intentionally uses its patched v3 compatibility code.

The patch manifest pins every affected package version and original/patched
SHA-256. It verifies the entire cohort before writing, is idempotent, and refuses
unknown bytes or upgrades. `postinstall` and the production build apply/verify
the patch. A root installation deliberately made with `--ignore-scripts` must
run `node scripts/patch-legacy-zod.mjs` before loading legacy SDKs. Do not bypass
this prerequisite. Remove the backport after upstream supports a fixed compatible
runtime; changing vendor versions requires reviewing and refreshing the manifest.

The MCP CLI bundles the unchanged Circle 3.5.0 buyer and the patched v3 validator.
The build explicitly resolves application validators to that qualified runtime,
including when separate MCP development dependencies exist. External dependencies
remain pinned MCP SDK, viem and its published Zod 4 package. This avoids
auto-installing Circle's x402 peer graph with old Zod in a fresh consumer, where
repository-level npm overrides cannot protect users. The build rejects additional
bundled dependencies, records every bundled input digest, and ships the upstream
Apache/MIT licenses, attribution and modification notice. Packed acceptance retains actual SDK signing,
both network profiles, limits, response-loss barriers and keyless recovery, while
also asserting that legacy peers were not installed. No custody defaults, keys,
funding, caps, recipients, receipts or settlement authority change.

Focused verification covers oversized-element getter refusal, valid/invalid arrays,
all patched hashes/tampering, nonempty x402 metadata through ESM/CJS/nested EVM
schemas, and actual Circle adapter construction. Existing signer tests verify the
economic tuple and cryptographic signature. Both production audit graphs have
zero high/critical findings; remaining moderate/low findings are not represented
as fixed. Required hosted CI and applicable platform checks remain merge gates.

References: [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[body-parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[undici advisory](https://github.com/advisories/GHSA-xjj6-f33q-929c).
