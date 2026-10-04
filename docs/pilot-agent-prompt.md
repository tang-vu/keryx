# Independent research pilot prompt

This prompt is for an actual task in the participant's own project. It does not
authorize paid research, wallet funding, source publication, recording or public posts.
Start with the existing sponsored remote MCP trial. Sponsorship and the actual selected network must
remain explicit. Source availability may make the task unsuitable.
Verify deployed broad web research capabilities before using them; local implementation
and an API key do not establish production availability.

Paste into the participant's agent:

```text
Help me evaluate Keryx on a real research task in this project.

Read the local README and relevant permitted files. Ask what decision or deliverable
I need. Suggest at most three research questions if needed. Let me select one before
using any external service. Do not send private code, paths, credentials, customer
information or proprietary business context. Show me the sanitized question first.

Before research, record privately my current way of doing this task and what a useful
result must contain. Open https://keryx.cc/research and inspect the available source
list and free previews, using /sources if needed. Check whether the deployed tools
offer broad web discovery; a run that reports unconfigured search uses the catalog
only. Public research questions may be sent to the configured external search provider.
Metadata and search snippets are relevance hints, not document evidence. If neither
the catalog nor available discovery appears suitable, explain the mismatch and
let me decide whether a sponsored exploratory trial is still worthwhile. Do not
purchase a package or manufacture a Keryx-related question to fit the corpus.

Use the remote MCP endpoint https://keryx.cc/mcp. For Codex CLI the setup command is:
codex mcp add keryx --url "https://keryx.cc/mcp?client=codex"
For Claude Code:
claude mcp add --transport http keryx "https://keryx.cc/mcp?client=claude"
Use the relevant client only. If tools are unavailable after setup, help me reconnect;
do not claim a tool was called. Discover the actual research tool schema and use the
existing sponsored trial limit. Never create a paid fallback, fund a wallet, switch
to mainnet, retry indefinitely or silently use another service as if it were Keryx.

Evaluate the answer against my intended deliverable. Identify supported conclusions,
missing/conflicting evidence and factual or source problems. Do not infer factual
correctness from a model confidence or coverage score. Preserve unsupported results.
Check that important citations refer to actually extracted original text. Record
unavailable pages, PDF/text truncation, duplicate publishers and unsupported video
claims. Do not claim viral potential from titles, descriptions or publication dates.

Draft a decision note or implementation checklist in my private workspace with source
links and limitations. Show me what I must verify. Do not modify application code
without my instruction. Ask me which parts I will actually use and what needs fixing.

Produce a private pilot note: task and baseline method; source suitability; actual tool
calls; useful output; corrections; assistance and review time; failures; and my feedback.
Keep any provided run/receipt reference private. Distinguish completed delivery,
seller-reported payment and independently verified settlement. Missing evidence stays
unknown; a digest is not a transaction hash. Label sponsorship and the recorded original network clearly; production is Arc mainnet and historical testnet receipts stay testnet.

Ask whether I have another genuine task, without creating one just to count repeat
use. Do not upload the note, disclose my identity, record my screen, post on X or submit
a bounty form. Those require my separate consent.
```

Owner/operator readback: validate any payment evidence separately; the participant's
agent need not have access to Circle or private Keryx operations. A useful sponsored
task is product-use evidence, not customer-paid revenue. A failed or unsupported task
is valid feedback and must not be omitted from the pilot outcome.
