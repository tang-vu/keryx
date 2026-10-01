# Dormant Gateway funding source release

This candidate gathers the staged policy, canonical transaction validation,
corroborated receipts, preflight, current availability, one-shot execution,
bounded orchestration, native SQLite journal and keyless inspection in one
main-based source tree. The Supabase journal client remains an unused client
for separately staged restricted RPCs. Deployment SQL migrations are excluded.
The isolated PostgreSQL acceptance script consumes authority SQL copies only
from `scripts/test-fixtures/funding-postgres`, outside migration discovery.

The existing application DB selector, SQLite/Supabase adapters, RealGateway,
buyer route and all deployed writers retain their current behavior. None imports
these new modules. Installing source does not enroll storage, create an owner
authorization, migrate a database, or enable funding. Keyless inspection can
inspect only an explicitly supplied, already enrolled, identity-bound journal;
it cannot adopt a legacy database or initialize application adapters.

`lib/operator/gateway-funding-composition.ts` is explicitly disabled. All
requests refuse before inspecting caller authority, loading keys or importing
the executor. No environment opt-in is supported. A future reviewed production
activation issuer must establish trusted enrolled binding before dynamic import
and key loading; that issuer is absent here. Generated-key/native-store/local
HTTP fixtures are synthetic acceptance only and cannot be supplied as
production activation evidence.

Cutover remains a separate release: trusted owner issuance, complete existing-key
history or reviewed isolated unused keys, lifetime and nonce namespace ownership,
funded legacy provenance, both-backend acceptance, paused and drained writers,
restore quarantine/global exclusivity, identity-aware rollback, exact-head CI
and independent payment review. The strict adapter/runtime stack in PR70 and
its funding schema extensions in PR76 remain unmerged. Mainnet additionally
requires its full release gates and explicit owner launch approval.

The source extraction reuses reviewed staged algorithms. New integration checks
prove the default composition refuses environment/caller activation and check
literal imports in application source for accidental funding/enrollment coupling.
This regression check is not a general call-graph or security proof. The release
diff preserves existing runtime files byte-for-byte; source review also checks
their imports. Fresh
candidate CI must validate the integrated tree; historical component passes
are evidence for unchanged code, not a claim that this candidate passed.
