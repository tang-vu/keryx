# Existing treasury spend-wallet custody

The server treasury path requires an existing valid `data/spend-wallet.json`.
`RealGateway` never creates a replacement when that file is missing, unreadable,
malformed or inconsistent. It refuses before constructing its signer, Gateway SDK
client or funding wallet. Fresh testnet demos now require an explicitly provisioned
owner-held wallet; starting the application is not wallet provisioning.

The legacy document has exactly two literal fields, `privateKey` and `address`,
in either order. The key must be a valid secp256k1 private key and derive the stored
address. Lowercase or checksummed matching addresses remain compatible. The loader
reads at most 4 KiB from an existing regular file with one hard link, refuses final
symlinks and checks its retained handle and path identity around the read. It never
rewrites bytes, changes permissions, creates directories or publishes private keys
in errors. Reconciliation and pending acknowledgement use the same validation and
receive only the derived public address, or an unavailable result.

This is a custody-integrity check, not deployment enrollment, complete ACL
validation, unused-key proof, funding authorization or global signer exclusion.
Protect the file and parent directories using the host's private account/ACL policy.
Parent symlinks, privileged local owners and races after the checked read remain
host trust; POSIX no-follow/nonblocking open flags do not establish Windows ACLs.
Temporary byte buffers are cleared, but JavaScript strings and account objects are
not guaranteed to be zeroized. Concurrent readers retain the same valid key; they
do not gain permission to fund or sign concurrently.

## Owner recovery and fresh testnet preparation

On the fixed `Persistent treasury wallet unavailable; owner recovery required`
error, stop treasury admission and inspect the selected deployment and file
privately. Preserve the original file and encrypted backup; verify access and the
known address against trusted owner records. Recover the original key through the
existing owner recovery procedure. Do not delete a corrupt file, generate another
key or move an unverified backup into place to make startup pass. Missing state can
represent a funded wallet whose access has been lost.

Local web/demo wallets also retain their existing identity. The web CLI's explicit
legacy variant may additionally contain one canonical ISO `rotatedAt` timestamp;
the dedicated loader preserves those bytes without allowing rotation. The server
treasury format still rejects that third field. An exhausted balance is a funding
or owner recovery decision, never permission to replace a wallet and lose history.

A genuinely new isolated testnet deployment needs separate deliberate owner
provisioning of that exact legacy document, private host permissions and a retained
backup/address record before any treasury call. This release supplies no creation
or repair command and does not authorize funds, mainnet or production key changes.
The legacy `generate-wallets` command is retired before key, environment-file or
wallet access. It previously printed private keys and replaced environment custody
under obsolete buyer labels. Owner-managed server funding uses
`AGENT_FUNDER_PRIVATE_KEY`; the distinct caller-owned buyer/stdio role uses
`KERYX_BUYER_PRIVATE_KEY` with its documented trusted merchant policy. Set secrets
privately in the appropriate environment files, preserve historical funded custody
and retain owner backups. Neither environment setup nor this retired command
recovers or provisions the persistent treasury spend wallet.

## Supported surfaces

| Surface | Effect and retained authority |
| --- | --- |
| Web, HTTP API, remote MCP and server bots | Their existing treasury research path shares the strict `RealGateway` loader. Browser-funded sessions keep their separate co-sign authority. |
| CLI and stdio MCP | Direct server treasury callers use the same loader. Caller-funded buyer transport and its private journals keep their current authority. |
| Desktop and extension | Their existing API/Operator boundaries remain; they neither load nor provision the server treasury key. No package or installer contract changes. |
| Worker and operator scripts | Treasury gateway creation refuses unavailable custody; reconciliation/acknowledgement cannot derive a payer from invalid state. Read-only balance display retains its existing address-only metadata contract and confers no signer authority. |

The focused Linux/Windows CI uses disposable synthetic keys and files, actual
constructor rejection and independent-process reads. It does not read production
keys, contact Circle/RPC, submit a payment, establish exclusive custody history or
close [M2](mainnet-delivery-plan.md). A release must pass review/CI and separately
verify the deployed commit before claiming this fix is live.
