# Dependency security follow-up, October 23, 2026

This follows the [Node/Next and production dependency review](dependency-security-2026-10-22.md).
It patches the root Anchor TOML parser and development/test closures in the root and
Operator desktop installations. TOML is the only changed production package record;
other production versions, financial authority, Node policy, runtime versions,
Worker schedules and separate MCP/Rust locks stay unchanged.

## Anchor parser and legacy transport

The existing TOML override moves from 4.3.0 to 5.0.1. The maintainer fixes resource
exhaustion through [array-of-table headers](https://github.com/BinaryMuse/toml-node/security/advisories/GHSA-4qx8-w7c3-pj3p),
[dotted paths](https://github.com/BinaryMuse/toml-node/security/advisories/GHSA-9j65-hcg3-gc64)
and [long integer literals](https://github.com/BinaryMuse/toml-node/security/advisories/GHSA-9qmh-m7c6-f92p).
Version 5 requires Node 20 or later; Keryx's stricter patched Node policy remains in
force. This is an explicitly qualified parser major update.

The observed SDK call is Anchor's lazy Node workspace loader reading a local
`Anchor.toml` Buffer. Keryx application source exposes no direct TOML upload/parser
endpoint. Actual workspace construction was exercised with root Anchor 0.32.1 and
both Circle SDK copies of Anchor 0.31.1, before and after the update. Provider and
program strings, ordinary integer values, `parse(Buffer)`, and prototype/depth
refusals remain valid. Synthetic providers forbid connection operations and signing.
No public exploitability or live settlement claim follows from these tests.

The legacy development provider `@ethersproject/providers` 5.8.0 pins `ws` 8.18.0.
An explicit `ws@8.18.0` override selects 8.21.3 for that version. The lock removes
the vulnerable nested development copy, retaining every production WebSocket record
and other major line. This override is outside the parent's exact pin; compatibility
is supported by actual read-only JSON-RPC, subscription, refusal-code and lifecycle
controls against a loopback server.

The [ws fragment exhaustion advisory](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p)
is fixed from 8.21.0. Bounded receiver checks use three one-byte fragments: the old
version ignores a configured two-fragment limit, while the patched version refuses
it; both accept the valid three-fragment control. These are protocol checks, not an
OOM workload or performance benchmark.

## Development and test tooling

Both Vitest development ranges start at `^4.1.12`, selecting Vitest/mocker 4.1.12
and Vite 8.3.5. Resolver changes include Rolldown/platform bindings. Root tooling
also selects Handlebars 4.7.10, js-yaml 4.3.2/3.15.2,
brace-expansion 1.1.21/2.1.7/5.0.12 and pbkdf2 3.1.7.

- [Vitest manual mock injection](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8)
  and [Windows redirect traversal](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp)
  require the relevant reachable development interceptor setup. Root and desktop
  Vitest configurations use Node and do not register those public plugins directly.
- Vite passes the [filesystem allowlist](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22)
  and [Wasm file-prefix exposure](https://github.com/vitejs/vite/security/advisories/GHSA-vfpm-58rq-9qcg)
  patch boundaries. The [October 21 v6 regression](https://github.com/vitejs/vite/security/advisories/GHSA-8g5g-mxqh-grgj)
  affects 6.4.4; these installations use Vite 8.
- [Handlebars AST injection](https://github.com/handlebars-lang/handlebars.js/security/advisories/GHSA-8r5x-fm3f-whwj)
  affects untrusted object ASTs reaching compilation. Its retained Keryx parent is
  coverage reporting; no direct application Handlebars import or public AST
  compilation endpoint was found.
- [js-yaml's empty merge-budget bypass](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh)
  is patched in both retained major lines. The separate inherited
  `sc-istanbul` to js-yaml 3, argparse 1 and sprintf-js advisory remains visible.
  [Brace recursion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7)
  and [quadratic rewrite](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr)
  patches retain their major lines. The development
  [pbkdf2 patch](https://github.com/browserify/pbkdf2/security/advisories/GHSA-477h-4r7f-fvrx)
  retains known-output compatibility with native PBKDF2.

## Acceptance and residuals

Local acceptance uses isolated installs on verified Node 24.22.1/npm 11.19.0,
credential-free environments and canonical synthetic data. Existing HTTP/MCP/rate,
private-export, desktop and parser assertions remain intact. Added parser checks
cover refusal before BigInt conversion and valid bounded table shapes. Types and
actual full hosted production, contract, financial and platform checks remain
required for the final candidate.

Offline vendor probes reproduce the old Handlebars AST marker, YAML merge-budget
bypass and mocker generated-source injection. Patched controls pass; generated mock
source is parsed without evaluating a payload. The controlled study is reproduced
on the final root lock, preserving all 48 trial outputs and 468 runtime bindings.
This establishes reproduction, not live task usefulness.

The qualified parser/transport graph audit reports root **0 critical / 15 high /
35 moderate / 21 low**, production **0 critical / 0 high / 17 moderate / 7 low**,
and desktop **0 findings**. Snapshots are dated evidence, not a permanent guarantee.
Remaining high findings include older Hardhat/coverage and unpatched `braces`
closures. No unqualified Hardhat migration or Next downgrade suppresses them.
The outcome does not claim all CVEs are resolved.

The existing release owner retains artifact, version and runtime delivery authority.
Exact-main/package acceptance and installed identities remain separate from source
checks. No deployment of these dependencies is claimed here, and installed release
86 must not be repeated.
