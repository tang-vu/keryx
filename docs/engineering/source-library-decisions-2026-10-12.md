# Source library architecture decision —2026-10-12

Owner direction: rebuild Sources as a useful cumulative research library and
recover historical articles still available from original publishers. The previous
ten-item snapshot replacement lost articles from current discovery even though
their original pages might still exist. Enlarging that snapshot alone would keep
the same loss mechanism.

Use additive article, immutable version and inverted term-index tables separate
from payable creator storage. Feed snapshots become bounded recent metadata
previews; refresh/import atomically retains existing and incoming article bodies.
Retained article count has no per-publisher lifetime cap. A processing batch and
the model's context allowance remain distinct from retention.

Retrieve matching history by research target and admit distinct articles from one
publisher when needed. Preserve exact article identity, version, public reading
scope, deactivation, recency gates and claim/control/payment boundaries. Library
search and crawl discovery do not certify evidence, publisher independence or
ownership, and public material cannot enter the creator payout path solely by
being archived.

Historical recovery follows actual publisher links with an explicitly resumed
checkpoint. It does not guess feeds, bypass access restrictions, fabricate lost
content or enable a new background schedule. Failed and unsupported coverage
remains recorded. Read-only preview and isolated staging acceptance are separate
from production writes.

Exact predecessor storage profiles remain accepted; the additive archive profile
requires its own schema, fences, backup/drain and migration acceptance. Runtime
never creates missing enrolled tables or replaces a storage identity. Existing
schema/provenance enrollment bounds remain authority checks rather than promises
of unlimited migration capacity.

This rationale is staged here because `DECISIONS.md` is currently owned by the
PR440 recovery session. The release coordinator must append this decision after
that ownership is released; this task does not edit another owner's file.
