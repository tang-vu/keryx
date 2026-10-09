# Payment and trust translation instructions

Issue [273](https://github.com/tang-vu/keryx/issues/273) has a preparatory glossary
and review gate. English, Vietnamese and Simplified Chinese assets are all
**drafts written by an agent, with no human translation approval**. They are not
imported by the application or any distributed client. Existing English screens
have not been migrated to these messages or retrospectively marked reviewed.

The source glossary is [en.json](../locales/glossary/en.json). Proposed translations
are [vi.json](../locales/glossary/vi.json) and
[zh-Hans.json](../locales/glossary/zh-Hans.json). Each has the same 26 terms,
one-line definitions and ten critical message entries. Future locale additions
must supply every term and message; missing entries fail validation.

## Authoring rules

Preserve `USDC`, `Arc`, `x402` and `BUY`/`SKIP`/`CACHE` exactly. Translate their
definitions, keeping network, funding and authority distinctions explicit.
Machine-readable payment states, protocol fields, signatures, receipts and
amounts retain their existing contracts. These glossary keys are presentation
identifiers, not new payment enums or proof that a listed operation is supported.

Payment labels reference a glossary term instead of storing a second free-form
translation. For example, `payment.pending` must reference `pending`; a raw
`text` override or a reference to `settled` is refused. Consent and legal entries
also require human review. Keep existing enum-to-display mapping with its owning
adapter; a transport failure must not automatically be translated as `failed`.

Treat pending, uncertain and simulated results separately from settled payments.
A signature, reservation, receipt or sponsorship does not establish settlement.
Expiry does not reverse a payment; a refund request does not prove a refund.
If a message combines concepts, explain each status and obligation separately.
Never replace a financial state with a more reassuring synonym.

The legal notice says the English terms and privacy policy are authoritative.
Any future translated legal page must visibly render the human-reviewed notice
and link to the English policy. The draft notice's presence in JSON does not
establish that any translated legal page exists or displays it.

## Human review and content binding

Run the offline checks from any working directory:

```sh
node scripts/check-payment-glossaries.mjs
node --test scripts/check-payment-glossaries.test.mjs
```

The CLI prints each glossary's content SHA256. A qualified human reviews the
entire English source first, then each target locale, including definitions,
rendered labels and legal notice. The actual reviewer must leave a PR review
that explicitly confirms this scope and both displayed digests. Record their
GitHub handle, exact UTC timestamp and `#pullrequestreview-...` permalink.
Set `status` to `reviewed` only after that review; replace `review: null` with:

```json
{
  "kind": "human",
  "reviewer": "<actual GitHub handle>",
  "reviewedAt": "<actual UTC ISO timestamp with milliseconds>",
  "evidence": "https://github.com/tang-vu/keryx/pull/<number>#pullrequestreview-<id>",
  "scope": "entire-glossary",
  "contentSha256": "<digest printed for this locale>",
  "englishSha256": "<digest printed for the English source>"
}
```

Changing any definition, label, legal notice or critical-message content
invalidates its recorded review. Changing the English source also invalidates
target-locale reviews. Formatting and object key order do not change the digest.
Review metadata is excluded from the digest to avoid a circular binding.

CI checks structure, term references, distinct state labels, invariant names and
content/review bindings. It cannot establish a person's identity, the truth of
a supplied review permalink, or semantic accuracy. A repository reviewer must
verify the linked human approval and its exact content. Synthetic metadata in
tests proves validator behavior only. Agent review cannot substitute for this
human approval. Free-form consent, legal and payment prose still needs its own
recorded human review when catalogues are introduced.

Before an adapter can use a locale, this additional check must pass:

```sh
node scripts/check-payment-glossaries.mjs --release vi
```

It currently fails for every locale, as intended. Ordinary CI permits explicitly
labelled draft preparation; passing ordinary CI is not translation release
authority. Runtime integration must make release validation a required build
gate for every enabled locale, including English. There is no runtime adapter in
this increment, so the check is not claimed as an active application release gate.

## Acceptance and surface boundaries

This development-only increment supplies consistent draft glossaries, exact-term
critical label entries, offline failure regressions and a main-CI check. Web,
API, desktop, CLI, remote/stdio MCP, extensions and chat bots retain their existing
runtime contracts and versions. No payment, deployment or custody operation is
performed by the validator. No runtime version or product announcement is needed.

Issue 273 remains open for actual human approvals, catalogue-wide payment/prose
coverage, runtime integration and visibly rendered English-authoritative notices.
Issues [271](https://github.com/tang-vu/keryx/issues/271) and
[272](https://github.com/tang-vu/keryx/issues/272) own locale negotiation and
catalogue migration; [275](https://github.com/tang-vu/keryx/issues/275) owns
language delivery. The foundation should consume these reviewed term identifiers
without changing the existing financial authority or URL contracts.
