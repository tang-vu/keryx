# Repository ask CLI private claims

`scripts/ask.mts` is a direct, unowned caller: it has no authenticated wallet,
session, API-key owner or original-payer input. It records the trusted `cli`
surface with ownership method `unknown`. A wallet written in a question, process
configuration or option does not establish ownership. The CLI does not accept an
owner option. Existing authenticated hosted callers bypass claim preparation
through their shared delivery adapter; seed/demo/evaluation roles and paid A2A,
stdio MCP and desktop original recovery keep their existing contracts.

Claims remain default-off through `KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED`. When the
operator explicitly enables them, a direct ask must also provide
`--private-claim-fd N`, where `N` is a canonical integer from 3 through 63. Before
loading providers, the CLI requires an already inherited writable pipe or socket
with a positive, stable descriptor identity distinct from stdout and stderr.
Linux uses the actual device/inode alias check. Windows reports different inodes
for duplicate pipe handles, so both public streams must instead be regular files
or actual console character devices; their types must be disjoint from the private
pipe/socket. Windows public pipes are refused even when distinct. Other platforms,
regular private files, public descriptors, missing handles and unsupported identity
semantics are refused. A zero-length descriptor write checks write access without
carrying a credential; the actual Windows read-only named-pipe fixture refuses at
this boundary. The ordinary claim store must independently admit the
request before research; native, sealed, archived and private storage acquire no
new capability or fallback. Enabling an option never installs a schema or enrolls
a domain. Default-off asks preserve their existing output and persistence.

The parent launcher must create a dedicated private pipe, pass its child endpoint
as the selected extra descriptor, and keep the read endpoint out of terminal
output, trace capture, exports, reports, receipts and logging. For example, a Node
launcher can spawn the existing Node/tsx ask entry with
`stdio: ["ignore", publicStdoutFd, publicStderrFd, "pipe"]` and arguments
`["--import", "tsx", "scripts/ask.mts", question, "--private-claim-fd", "3"]`.
On Windows, `publicStdoutFd` and `publicStderrFd` refer to already opened ordinary
public-output files or real console devices; piping public stdout/stderr through
a capture process does not meet the boundary. The parent must consume
`child.stdio[3]` separately from those public streams. This is an
explicit caller privacy responsibility; descriptor admission cannot prove what
the parent subsequently does with the bytes. Use a direct Node launcher: the npm
ask wrapper does not promise to forward extra descriptors. Synthetic acceptance
uses actual Windows public files and an inherited private pipe. Linux must retain
the device/inode check; this local Windows evidence does not qualify another OS.

Preparation precedes provider initialization. `collectRun` then saves the
original run before returning. Only after that boundary does the CLI complete
the shared one-shot delivery and attempt one private write of a typed packet,
bounded to 4,096 bytes and five seconds. The packet is separate from `QueryRun`,
public answer, reasoning trace, payment records and projectors. Storage receives
the token hash. Public output receives only a fixed delivery status, never the
credential or claim URL. Descriptor identity is checked again after issuance.

An issuance outage, closed/replaced output, short write or missing acknowledgement
does not discard the completed answer or change payment/reward records. No retry,
reissue, history lookup or lost-ack repair is available; a write failure can leave
delivery uncertain. Do not repeat paid research to recover a link. The credential
only attaches history ownership after durable authenticated claim acceptance; it
does not change payer, custody, settlement or creator rewards. Historical unknown
owners remain unknown.

Focused tests run the real ask entry with fixed synthetic provider substitutes,
outbound denied, no environment-file loading and an isolated ordinary SQLite
fixture. They test admission before providers, persistence before issuance,
private-pipe delivery, regular-file refusal, unavailable/native capability,
save failure, same-pipe aliases, read-only named pipes and late delivery failures.
Their simulated payment records are
compatibility fixtures, not production measurements. Activation, deployment and
actual hosted release acceptance remain separate gates.
