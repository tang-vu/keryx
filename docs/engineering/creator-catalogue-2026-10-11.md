# English creator management catalogue — issue272 area

This area moves 304 meaning-based English messages from 17 creator/profile and
portfolio presentation files into `locales/en/creator.ts`. It includes public
metrics, decision explanations, balance evidence, signed-content and offer desks,
listing controls, manuscript rights, notifications, preview depth, embeds,
leaderboard, social-card JSX and metadata. `lib/i18n/creator-preview.ts` projects
the existing six preview labels and hints without changing source truncation.
English is still selected explicitly. Glossary approval and locale activation
remain held.

Whole messages use named parameters, including React nodes for the existing links
and emphasized status/price elements. Count messages select one/other keys; their
English arms preserve the old wording, including `source(s)` and `1 payments`.
The original offer description's missing space after its interpolated price is
also preserved. Optional dates still render empty rather than `undefined`.
Signature schemas, nonces, hashes, HTTP bodies, wallet/registry checks, transaction
selectors, revision handling, rights gates and settlement interpretation are
unchanged. User/source descriptions, questions, rationale, rights summaries,
versions, addresses and URLs remain data.

The scoped audit retires exactly 263 original guard occurrences. Eighteen current
protocol/contact/currency/brand occurrences remain inline: transaction marker and
toast identities, Markdown/HTML identities, widget script, balance curl request,
price examples, contact examples, HMAC formula, raw `submitted` state and brand
marks. Other areas' allowances are preserved. The existing guard now includes a
creator-area regression asserting that distinction; its detection rules are
unchanged.

Local evidence is retained in the assigned issue272 worker's `creator/` folder:

- 436 exact before/after HTML, metadata, social-card JSX and preview-projection
  comparisons across both Arc profiles. Social JSX comparison does not claim a
  newly generated production Open Graph bitmap.
- 27 keyboard/action assertions per profile and viewport at 320px/1366px: exact
  alert/webhook bodies, clipboard snippets/refusal, preview optimistic rollback,
  portfolio cursor/feed actions, content bytes/hash/signature inputs and offer
  bounds/expiry/revocation. Every request and wallet signature is intercepted.
- Existing creator-listing fixture passes both Arc profiles and registry V1/V3,
  including stale revision/payout, malformed authority, wallet changes and revert
  handling. Existing scholarly-rights fixture passes at 320px/1440px with exact
  declaration signing, private evidence inputs and pending review state.
- TypeScript, scoped ESLint, 24 existing/scoped guard tests and 12 existing message
  and rich-message tests pass. The sampled retained CSS renders preserve dimensions:
  320px scroll width 320/height 4532; 1366px scroll width 1366/height 2910. Both
  screenshots were inspected. This reuses accepted CSS; it is not a fresh local
  production build. The blocked badge preview does not qualify its unchanged SVG
  endpoint.

The render/action bundles resolve the existing offer typed-data export through
the unchanged browser-safe `article-offer-proof.ts`. The app's original
`article-offer.ts` barrel also reaches Node-only source asset code. Root must
qualify that pre-existing import separately; this extraction does not change it.
Existing unlabeled price/content and notification controls retain their markup;
keyboard checks and existing title/alt/aria output pass, without claiming full
accessible-name coverage. The old source preview-label export and API-supplied
errors/instructions require root's helper qualification.

Standalone this branch has 2182 allowances in 148 files (2180 current findings).
Across the seven staged worker candidates, the retirement union is 1781 original
occurrences and 2017 keys, leaving 664 allowances in 73 files, including the
separately owned native119 area and deliberate data allowances. Creator/source/
registration/withdrawal has 311 allowances in 31 files left. These are guard
counts, not a complete non-JSX helper census or merged-source acceptance.

Root owns combined integration, independent review, the actual successful
`build-and-test` aggregate/domain/platform gates, build/version/distribution and
one serialized runtime delivery. Conflicting area PRs cannot substitute absent
hosted acceptance. Do not close original272 from this area, merge/deploy this
worker, activate locales, or release excluded helper/semantic changes implicitly.
