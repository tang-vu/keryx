# Retained-evidence draft language boundaries

The draft editor and its two entry pages need explicit authored-copy boundaries.
The renderer looks up complete display templates before inserting original React
nodes. Paper titles, quoted passages, version/report identifiers and user edits
never become translation lookup inputs. Native select options retain text children
and fixed option values.

The styled browser fixture exposed overflow in excerpt/version flex rows at 200%
text size on a 320 px viewport. Text can now shrink and wrap within those rows.
Each native select also shows its complete selected value in a wrapping caption:
native option text cannot wrap. The visible duplicate is hidden from the accessible
label, while the native control keeps its original name, options and stored value.
Original paper titles in those captions retain their own direction and translation
boundary. No text-size cap or clipped/hidden content substitutes for readability.
The unchanged English model evidence notice has its own English/LTR block, so
Arabic guidance cannot move its final punctuation into the surrounding RTL text.
Reading-observation labels start on their own line below the separate prepare-read
action, including desktop and RTL layouts.

The English model copy stays distinct from display copy. Initial/new theme titles,
record identifiers, assessment verdicts, statement kinds, snapshots, imports and
exports retain their source contracts. Controlled status messages stay in authored
English state and translate when displayed, so a preview change does not rewrite
draft inputs. Original fields use explicit direction and translation boundaries.

The existing conservative critical/consent filter and human-review gate remain.
Popular-language draft catalogues must be claimed, source-bound, validated and
visually reviewed before this outcome is complete. This work does not activate a
language or change payment, access, distribution or production authority.

Acceptance requires focused real-editor/import/export/locale-switch tests,
responsive browser originals, the applicable full PR/domain/platform workflows,
exact-main publication acceptance and verified owned cleanup. Earlier accepted
comparison work is a base, not acceptance of this changed editor.

The browser fixture preserves every actual JSON/Markdown/LaTeX/BibTeX/RIS
download and its byte comparison. Chromium silently drops requests after ten
downloads inside one second (`LocalFrame::ShouldThrottleDownload`), so the fixture
paces successive ten-download bursts past that interval. Its clock starts after
the first delivered file to account for action/scroll latency. This does not retry
a failed download, extend the download-event timeout, mock the exporter, or change
production download behavior. See the [Chromium implementation](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/frame/local_frame.cc).
