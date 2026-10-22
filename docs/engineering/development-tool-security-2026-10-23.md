# Development-tool security follow-up, October 23, 2026

This follows the [Node/Next and production dependency review](dependency-security-2026-10-22.md).
It updates development and test dependencies in the root and Operator desktop
installations. Production package records, financial authority, runtime versions,
Worker schedules and separate MCP/Rust locks stay unchanged.

## Changes and exposure

Both existing Vitest development ranges start at `^4.1.12`, with the lockfiles
selecting Vitest/mocker 4.1.12 and Vite 8.3.5. Compatible resolver changes include
Rolldown and its platform bindings. Root tooling also selects Handlebars 4.7.10,
js-yaml 4.3.2/3.15.2, brace-expansion 1.1.21/2.1.7/5.0.12 and pbkdf2 3.1.7.
The patched Node engine policy remains intact. No new override forces a dependency
outside its existing parent's range.

- [Vitest manual-mock injection](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8)
  and [Windows redirect traversal](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp)
  are fixed in mocker 4.1.12. These affect reachable development servers using the
  relevant public interceptor plugins. Keryx's root and desktop Vitest configurations
  use the Node environment and do not register those plugins directly. Package
  presence alone does not establish a public Keryx exploit.
- Vite 8.3.5 passes the patch boundary for the
  [filesystem allowlist](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22)
  and [Wasm file-prefix exposure](https://github.com/vitejs/vite/security/advisories/GHSA-vfpm-58rq-9qcg)
  advisories. The newer [October 21 v6 regression](https://github.com/vitejs/vite/security/advisories/GHSA-8g5g-mxqh-grgj)
  specifically affects 6.4.4; these installations use Vite 8.
- [Handlebars AST injection](https://github.com/handlebars-lang/handlebars.js/security/advisories/GHSA-8r5x-fm3f-whwj)
  affects untrusted object ASTs passed to compilation; string-only templates have
  different exposure. [The separate prototype lookup issue](https://github.com/handlebars-lang/handlebars.js/security/advisories/GHSA-p8wg-vrv2-v86f)
  also has a 4.7.10 patch. Keryx's retained dependency is in `sc-istanbul` coverage
  reporting. The source review found no direct application Handlebars import or
  public endpoint accepting a Handlebars AST.
- [js-yaml's empty merge-source budget bypass](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh)
  is patched in both retained major lines. These are ESLint/Mocha/coverage tool
  dependencies. The separate `sc-istanbul` → js-yaml 3 → argparse 1 → sprintf-js
  moderate advisory remains visible in the audit.
- [Brace recursion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7)
  and [quadratic rewrite](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr)
  patches retain the existing major lines used by lint/test tooling.
  [pbkdf2's long-password rehash issue](https://github.com/browserify/pbkdf2/security/advisories/GHSA-477h-4r7f-fvrx)
  is updated within the existing development cryptography range. Wallet and payment
  implementations are unchanged.

## Validation and remaining gates

Clean isolated installs use verified Node 24.22.1/npm 11.19.0, with credential-free
environments and canonical temporary data. No shared dependency installation is
rewritten. Graph comparison requires every production package record to remain
identical and preserves the preceding production security patches, including `ws`.

Actual desktop tests pass 79 cases across eight files. Root MCP/HTTP/rate admission
and private export tests pass 71 cases across eight files, using the patched test
runner and existing failure-path assertions. Desktop, full application and
operational TypeScript checks pass. Required hosted acceptance is tracked in the
outcome receipt; these local checks do not replace it.

Bounded offline dependency probes reproduce the old Handlebars AST marker execution,
js-yaml empty-merge budget bypass and mocker generated-source injection. Patched
versions refuse or quote the same inputs, while valid template/merge controls,
six native-comparison PBKDF2 vectors per version and brace expansion controls pass.
The mocker probe calls its actual module generator and parses the generated code;
it does not evaluate a payload or claim WebSocket/public-service reachability.
No outbound requests occur.

Fresh audits report desktop **0 findings**, root **0 critical / 16 high / 37 moderate /
19 low**, and production **0 critical / 0 high / 17 moderate / 7 low**. Remaining
development findings include older Hardhat/coverage dependencies; this outcome
does not claim all advisories are resolved or apply an unqualified major migration.

The root-lock-bound controlled study was reproduced: all 48 offline trials and 468
runtime source bindings are identical, with zero outbound attempts. Only its
normalized lock hash and the corresponding generated write-up hash changed.
This establishes reproduction, not live task usefulness. Actual full production,
contract, platform and financial checks remain required, followed by exact-main/package acceptance. The existing release
owner retains version, artifact and runtime delivery authority. This document does
not claim these dependencies are installed in production or authorize another
deployment of release 86.
