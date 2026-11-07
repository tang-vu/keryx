# Evidence follow-up drafts and report visibility

Evidence-target follow-ups from private and unlisted reports use an editable
in-memory composer. The report question and target are not placed in a draft URL,
browser history or browser storage. Preparing a draft makes no research or payment
request. The user still reviews the question and budget and presses Ask.

The live conversation reuses its existing restoration and visibility controls.
It retains the selected report as the parent, including when that report is an
older turn, and preserves the captured owner/revision. Preparation is disabled
during streaming. An owner boundary clears a hidden draft, and even a retained
queued restoration callback must pass the existing current-owner checks.

Saved reports open the existing recovery composer with the selected target in
memory, the original budget, report parent, visibility and verified viewer wallet.
Changing the displayed report cannot reuse the prior report's prepared draft.
Server parent access, visibility inheritance and spending checks remain the
authority when the user submits; this UI does not grant access or spending.

Only an explicitly public report context enables the existing shareable draft
link. Stream metadata can restrict that decision, and an unknown context does
not produce such a URL. Public URLs retain their bounds and editable, non-running
behavior. Original answers, evidence, confidence, receipts and payments are not
modified by preparation.

The regression fixture uses the actual saved/live report, target and composer
components with synthetic transport and no funds. It checks private/unlisted
URLs and storage, deliberate submission, parent/visibility/owner binding,
streaming, older turns, queued callbacks, report changes and public compatibility.
No production research, wallet signing or deployment is part of this check.
