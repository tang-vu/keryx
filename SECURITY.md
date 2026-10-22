# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/tang-vu/keryx/security/advisories/new)
to report suspected vulnerabilities to the repository maintainers. Private reporting
is enabled for this repository. If that form is unavailable, email
[support@keryx.cc](mailto:support@keryx.cc) with a subject beginning `Security:`.
Email is a fallback contact, not an encrypted submission channel.

Do not disclose exploit details, credentials, private questions, buyer journals or
unredacted receipts in public issues, discussions or pull requests. A public issue
may ask for a private contact without including sensitive details.

Include the affected commit or package/app version, surface and environment,
expected and observed behavior, impact, and a minimal reproduction using synthetic
data. Identify whether a result came from offline fixtures, Arc testnet or mainnet.
For dependency reports, include the advisory and the affected dependency path;
an audit finding alone does not establish exploitability in Keryx.

Maintainers will triage the report, discuss reproduction and remediation privately,
and coordinate disclosure with the reporter. Response and fix times depend on
severity and maintainer availability; there is no guaranteed response deadline or
standing bounty program. Credit can be agreed with the reporter before disclosure.

## Supported versions and surfaces

Security fixes target the current `main` source and newly qualified releases.
There is no maintained backport branch or promise of support for older releases.
Report an issue on an older version if it may also affect current source.

Reports may cover the hosted web/API, Windows desktop and bundled Node helper,
CLI, remote/stdio MCP, browser extension, bots, contracts and operational workers
maintained in this repository. Include the exact affected surface: merging a fix
does not establish that every hosted, published or installed artifact contains it.
Use official downloads and verify the release source identity and checksums where
provided. Dependency/security updates are documented in
[the October 22 source review](docs/engineering/dependency-security-2026-10-22.md).

## Safe reproduction

Use an isolated local environment with synthetic records, offline fixtures or
testnet funds you control. Test only systems and accounts you are authorized to
test. Do not access another user's records, move real funds, exhaust shared services
or test destructive payloads against production. A vulnerability report grants no
payment, custody, funding or deployment authority.

If a secret was exposed, contact maintainers privately and identify the affected
credential without sending its full value. Preserve original payment and recovery
evidence; do not repeat a purchase to test whether an uncertain transaction settled.

Ordinary bugs and support questions belong in the channels in [SUPPORT.md](SUPPORT.md).
