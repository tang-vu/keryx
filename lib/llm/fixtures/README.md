# Third-party evidence fixtures

The `text` and `missingOriginalSpan.text` fields in
`issue-238-mdn-button.json` reproduce an extracted Portuguese
[`<button>` page](https://developer.mozilla.org/pt-BR/docs/Web/HTML/Reference/Elements/button)
by **Mozilla Contributors**, under
[CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/).
The frozen fixture adapts HTML into plain text and preserves the captured
spelling, whitespace and outdated examples for a source-selection regression.
These MDN-derived fields are distributed under that license; they are not
relicensed under the repository's code license. Source identity, observation and
exact-byte hashes are recorded in the fixture and
[the regression record](../../../docs/issue-238-evidence.md).
The selection, enumeration and evidence-only presentation regressions import
this single frozen body; no independent copy or current compatibility claim is made.

MDN's [attribution and copyright guidance](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license)
was checked on October 8, 2026. This fixture is source-retrieval test data,
not a current browser-compatibility recommendation.
