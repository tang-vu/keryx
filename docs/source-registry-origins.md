# Source-specific registry authority

New registrations may use V3 while existing sources retain V1. Each source's
`registryAuthority` records its exact network, contract address, version, runtime
code hash and deployment block. Global registry settings select new registration;
they never migrate a retained listing, creator, payout wallet or read price.

`KERYX_REGISTRY_ORIGINS` and `NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS` must contain the
same JSON array of one to four exact origin profiles. Each profile uses
`network`, `address`, `version`, `codeHash` and `deployBlock`. Addresses and hashes
are lowercase; the deployment block is an integer string. The selected global
registration address/version/deploy block must match one member. An API response
cannot enroll an address. Bound reads verify the configured runtime hash and, for
V2/V3, the contract's declared version before reading its record.

SQLite retains the immutable origin in the existing `sync_state` table under
`keryx:source-registry-origin:v1:<onchainId>`. `setSourceMeta` admits the origin and
metadata atomically; `upsertSource` preserves the binding and original on-chain
identity. Both require exact configured membership before admission. Source CRUD
projects the origin into public catalog, browser payment index and creator
listing snapshots. This adds no production columns or DDL. Supabase refuses
origin admissions because it lacks this native immutable protocol.

Before selecting V3, drain the existing indexer, retain a filesystem/database
backup, and bind each existing listing through the enrolled adapter using its
verified original V1 profile and unchanged metadata. The maintenance process
needs matching public/server origin profiles including V1. Read back its origin,
creator-owned registry record, payout, read price, authors and activity before
changing global selection. No existing creator must sign another registration.
Unbound on-chain sources refuse in origin-profile mode.

Payout reads, browser signing allowlists, creator discovery and edits, claims and
scholarly adapters use the source's original origin. Creator edits still require
the live creator and an unchanged reviewed snapshot; V2/V3 retain atomic revision
checks. Mainnet scholarly activation remains outside this change. CLI, MCP,
desktop, extension and bot research roles consume the same hosted catalog and
payment paths; they gain no publisher or sponsor custody. The historical testnet
backfill refuses origin-profile mode.

The mainnet signer worker and headless web CLI independently resolve each ID from
the hosted catalog, then check its exact allowed origin, code and declared version
at one pinned block with a final block-hash reread. Their catalog response cannot
enroll an origin. Headless operators must supply the reviewed public origin JSON
in both `KERYX_REGISTRY_ORIGINS` and `NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS`, alongside
matching mainnet network settings; copy the public deployment profiles from the
reviewed release configuration, never infer them from a sign request or arbitrary
API response. A client without these pins refuses bound sources before signing.
Existing installations must update that configuration before using the mixed
registry catalog; no new key, funding, creator registration or custody migration
is required. Single-registry unbound catalogs keep their previous configuration.

New native claim payments compare the claim to the stored immutable source
origin inside the financial writer transaction. The testnet-only durable-v3
original lane additionally retains the exact origin in its context and checks
the current stored binding before a new authorization. Historical originals
continue to verify and replay their original evidence without current RPC or
origin-config inference. This does not activate that lane on mainnet.

The indexer maintains a separate checkpoint for each network/address/version/code
hash. A unique V1 origin may bootstrap from historical `lastSyncedBlock` after
code, chain and head-window checks. V2/V3 never inherit that cursor and scan their
deployment block inclusively. The old cursor remains retained. One origin's
failure does not discard another origin's completed catch-up.

A same-ID event from another known origin is withheld before source mutation.
Bounded collision evidence under `keryx:registry-collision:v1:` retains both exact
origins, the protected row ID and first event/transaction/block. Native SQLite CAS
preserves that first record across competing indexers. Later valid events can
index and the scoped checkpoint can advance. An unknown/unbound origin, RPC/code
failure or failed evidence persistence still refuses the chunk. Parity includes
all actual chain records and reports `withheldCollision`; it does not erase the
collision or describe the new registry as empty.

Local tests prove origin isolation, old payee/price preservation, creator edit
targets, immutable admission, cursor separation and collision containment using
synthetic transport. They do not prove deployment, funded sponsorship, production
continuity or creator adoption. Those need their own authorized acceptance and
exact deployed-source readback.
