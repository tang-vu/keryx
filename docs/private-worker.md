# Private worker operator integration

`privateWorkerBootstrap(db)` prepares the private worker but does not start a process,
run a tick, fund a wallet or enable checkout. It returns null when
`KERYX_PRIVATE_WORKER_ENABLED` is unset or `0`. Other values except `1` fail closed.
The operator command is available, but no production process or checkout-readiness
signal is activated by installing this release.

```sh
npm run private-worker -- --help
node --env-file=.env.private-worker.local --import tsx --no-warnings scripts/private-research-worker.mts --once
```

Omit `--once` to poll every five seconds after each completed tick. The npm command
does not automatically load any environment file. With the enable flag absent or `0`,
it prints `disabled` and exits before loading configuration, signers or the database.
SIGINT/SIGTERM wake idle polling and prevent another job from starting; the process
waits for active execution to finish before closing SQLite. Configure any supervisor's
shutdown grace period to accommodate the complete job, not just the poll interval.
Do not use a short forced kill as normal shutdown. An external forced kill or crash
can still leave a permanent claim requiring operator recovery.

Output is JSON status/counters only. Errors and unpersisted results make the eventual
exit code nonzero; the daemon continues polling until stopped. `--once` is a single
work tick, not a readiness check: if enabled and funded, it can execute paid creator
operations for eligible jobs. No command generates keys or funds a wallet.

When explicitly enabled, both `KERYX_PRIVATE_WORKER_ENABLED=1` and
`KERYX_PRIVATE_RESEARCH_ENABLED=1` are required, together with the existing private
runtime policy: dedicated merchant and treasury addresses, capacity, service fee,
reserved private payees, exact model/provider/base URL, provider credentials and the
approved endpoint list. `KERYX_PRIVATE_TREASURY_PRIVATE_KEY` is read only from the
environment. Keep it in an ignored environment file; do not put it in command arguments.

The bootstrap derives its signer from that key and checks its address against the
configured private treasury. It rejects reuse of the configured public funder, public
seller or reserved merchant identities. The operator must still inventory other public
or legacy signing wallets; this comparison does not discover every wallet in use.
The configured reserved-payee list must agree with the public seller's cached guard.
Only Arc testnet (`eip155:5042002`, Gateway domain 26) is accepted.
The [Circle supported-chain reference](https://developers.circle.com/gateway/references/supported-blockchains),
rechecked September 10, 2026, lists Arc as testnet-only with domain 26.

The actual Circle `BatchEvmScheme` wraps the private EOA. Balance checks call the
existing Gateway reader for that same address and preserve integer micro-USDC. Unknown
balances throw; zero is never interpreted as permission to deposit. Startup performs
no balance read and does not prove that the configured lifetime capacity is backed.
The executor checks live availability before claiming each job.

Tests use ephemeral unfunded keys, verify an SDK-created signature locally and inject
balance responses. They cover disabled configuration, address binding, wrong domain,
public-funder reuse and unknown-versus-zero balance. No live signature, funding,
provider request or payment is sent by these tests.

Remaining activation work includes production process configuration, verified dedicated
funding and signer inventory, health/readiness shared with checkout, reconciliation,
claimed-but-unpersisted result recovery, and an owner-operated testnet acceptance run.
Do not treat constructing a worker or setting these flags as completion of those gates.
