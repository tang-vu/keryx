# App0.27.66 ready native capability batch

This version prepares one deployment of merged PRs #486, #485 and #487, based on
`5213bdf632653dbaa0203c1a9294c0782bd44276`. Production remains app0.27.65 at
`6ce450e851420e955caf67a2b2a4469f8c9389b6` until the release owner records actual
delivery. Private profile issue #260 was closed after genuine web CRUD, explicitly
scoped API/remote/published-stdio read and update, privacy checks and QA cleanup.

The batch exposes the selected native store's public usage, verified identity and
decision review ports. Their tables are already present in the accepted release65
nineteen-table migration. This release requires no additional DDL or historical
backfill. Preserve the enrolled store, manifest/identity/schema, original records,
custody, spending limits, held private workers and schedules. Unfinished Account,
Public Profile and private job-history outcomes continue in later focused PRs.

Ready GitHub identity configuration uses the existing account-authorized client
credentials and the fixed `https://keryx.cc` OAuth origin. The serialized release
changes only the commit label and those three configuration entries; existing
privacy, anonymous claim, alert, fee and custody declarations remain unchanged.
Credential presence does not establish a successful provider callback. Actual
native-store, signed-in owner, saved profile, provider callback and owner readback
acceptance remain required before claiming delivered GitHub verification. ORCID
and whole issue #265 acceptance remain separate; API keys/MCP do not link identities.

Web and hosted APIs consume the new native ports. Remote MCP and existing HTTPS
stdio/CLI clients consume the corresponding scoped hosted contracts. Desktop,
extension and bots retain their established hosted handoffs and private boundaries.
The exhaustive sixteen-path runtime/test/document diff from release65 does not
intersect the MCP entry's local bundled source graph or the desktop helper,
renderer, bridge and style source graphs. Their entry points, dependency/build
controls, native Rust sources and extension payload/control inputs are unchanged.
Retain npm/Registry MCP0.4.21, desktop0.4.19, hosted MCP0.3.18 and extension0.1.4.2.
This is source/capability reuse, not whole desktop byte equality: fresh desktop
source markers and native manifests bind their actual acceptance commit. Verify
any automatically published app66-tagged desktop assets against that provenance;
do not overwrite the existing app65 release or relabel installed clients.

Before the single deployment, require this PR's review/CI and full exact-final-main
acceptance, verify applicable surface identities, retain current backups and ENV,
then use the reviewed role/drain deployment flow with no migration controls.
After normal/source/originals/ENV/custody/Operator/holds and loopback checks, clear
the exact owned maintenance window promptly, verify public delivery, run the four
existing #274 confirmation cases and post one authorized product update. No new
funding, spending allowance, schedules or App54 execution is authorized.
