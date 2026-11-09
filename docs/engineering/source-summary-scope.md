# Requested-source summary scope

The supplied-original status report distinguishes a source-supplied summary from
an observed scholarly abstract page. A `publicDeliveryKind: "abstract"` alone
describes delivery scope; it does not establish that a paper's abstract page was
read. Generic reference documents can also provide a summary.

An explicit `scholarly.evidenceScope: "abstract-page"` retains the existing
abstract-page notice, including when delivery kind is an excerpt. Otherwise an
abstract delivery says the source supplied an abstract or summary and that
full-text reading has not been established. Ordinary excerpts add neither notice;
withheld originals retain their unread status. This follows the distinction
already used by `researchFollowUp`.

The formatter still reports bounded extraction, truncation, qualification and
heading-section limitations separately. Original URLs remain literal code. No
source bytes, evidence admission, confidence, citation, settlement or reward
authority changes. Canonical English financial/retry copy remains authoritative
under the existing language gate. Spanish retains its existing English operational
fallback; this change does not admit another UI language.

Regression coverage uses synthetic retained reads for all 13 existing presentation
language selections. It checks both scholarly delivery kinds, withheld and ordinary
excerpt controls, exact URLs and immutable inputs. A minified native Chromium
fixture renders the actual formatter through `AnswerMarkdown` with external
requests blocked. These checks establish presentation behavior, not independent
translation approval, live provider reading quality or a confidence improvement.
