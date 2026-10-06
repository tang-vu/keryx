# Inspect a report without one source

In a completed web answer or saved public dispatch, open **What if a source were
missing?** and choose a source under **Inspect without**. Keryx shows which
research targets still have recorded excerpts in that report. **Restore source**
returns to the original view. This is a local inspection: it makes no new research
request and leaves the answer, confidence, receipts and payments unchanged.

Targets are requested topics, not verified assertions. A missing excerpt is a
gap in this stored record, not proof that an answer is false. Several excerpts or
source names do not establish independent corroboration. The view cannot predict
what the agent would have written if it had never read that source.

## What is included

The view uses the evidence matrix's existing claim/marker/source/article/version
matching and bounded, answer-qualified excerpts. It excludes explicitly synthetic
content and known seed fingerprints, including records sharing a synthetic marker.
Identical excerpts from the same source/article/version count once for each target.
Removing a source removes all its recorded versions in this view.

The report distinguishes a target that loses its last excerpt after omission from
a target that had no inspectable excerpt in the original. An old report without an
excerpt ledger is unavailable, rather than an empty or failed factual record. Sources
without qualifying recorded evidence cannot be selected. Payment evidence remains
in the existing citation drawer and portable receipt.

## Supported roles

| Surface | Role |
| --- | --- |
| Web ask/chat, history and public saved dispatch | The same answer component provides the interactive view from data already authorized for that page. |
| Hosted API/SSE, OpenAI-compatible API and remote MCP | Existing answer/evidence/receipt contracts are unchanged. The interaction is presentation only; no new tool or request parameter. |
| Caller-funded web recovery and private workspace | Their current minimal result contracts lack complete source/marker/article identities. Keep their existing excerpt presentation; do not infer source identity from a publication name. |
| Repository CLI, stdio MCP and Windows desktop | Existing saved results, original recovery and exports retain their roles. No source-lens command, custody change, package or installer release is claimed. |
| Extension and bots | Existing hosted research adapters and accessible report links retain their roles. No new bot command or distribution is required. |

The app release changes web presentation only. Native/stdio artifact source pins
and published versions remain separate; a new hosted commit is not evidence that
installed clients upgraded. Tameion usefulness, independent participation, creator
rights and a real complete paid workflow remain separate acceptance gates.
