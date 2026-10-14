# App0.27.65 ready user-domain release candidate

This is source preparation for one release of the ready merged batch. Production
remains app0.27.64 at `ae298ff41c239b292a043b3442df33f1701a4b99` until actual
delivery is recorded. A version change does not establish deployment or close an issue.

The batch includes the reviewed fixed 19-table native user-domain migration and
same-store ownership/privacy ports from PRs #477 and #478, plus the reviewed private
profile port once PR #480 passes its required CI and merges. Other already merged
runtime changes join this single deployment. Unresolved native helper failures and
OAuth account requirements continue separately; they do not delay ready outcomes.

PR #480's current `b79c9120` candidate failed its main unit shard on two native
profile CRUD/handle-collision cases exceeding the existing 10-second deadlines.
That source must be corrected, pass required CI and merge before the final source
study and this profile release can be accepted.

The migration uses the existing protected stopped-writer redeploy path. Preserve
the actual selected store, original authorization/settlement/idempotency records,
verified backup, environment, custody, spending limits and private holds. A migration
attempt forbids automatic predecessor rollback. No new spend or schedule is authorized.

Web and API consume the optional native ports on the selected verified connection.
Remote MCP consumes the scoped API contract; stdio and CLI keep scoped HTTPS
access. Desktop opens the hosted authenticated page. Extension and chat research
adapters retain their account handoffs and original payment authority. Keep
enrolled Supabase unsupported; reuse valid ordinary-adapter parity evidence.

The incoming source-leaderboard dictionary changes a consumed shared input in
both accepted MCP and desktop payloads. Prepare stdio/npm/Registry **0.4.21**
and desktop **0.4.19** together with app **0.27.65**. Hosted MCP retains its
unchanged **0.3.18** protocol identity, verified with the new web deployment.
The extension retains **0.1.4.2** only with final equality of its accepted payload
and control inputs. Fresh client builds, installed checks and publication must
bind the accepted final main source. These candidate scalars do not establish
publication or installed-client equality.

Before delivery, accept the final source, required main CI and applicable surfaces;
then perform one combined deployment and verify actual owner-visible web, scoped
API and MCP behavior. Close original issues only when all their acceptance criteria
are fulfilled. Alert #257 remains open because enabled transport and synthetic QA
do not establish its target-window requirement.
