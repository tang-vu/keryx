# Explicit numeric references in evidence retrieval

The context selector now retains one-digit decimal tokens, such as `7`, when
matching questions and research targets against already-unlocked source text.
Previously its minimum token length discarded these references. In a long source
with many similar numbered statements, the requested statement could lose its
place in the bounded candidate pool even though its text had been read.

English and Vietnamese synthetic long-source controls reproduce that loss on the
previous selector and retain the requested fact with its restriction after the
change. Other controls cover `0` and `9`, compatible Unicode normalization and
matching Arabic-Indic digits, exact original UTF-16 offsets, two independent
numeric targets, existing multi-digit references, and the short-source path.
An absent `7` does not match `17`, `27`, or `37`. Single-letter filtering remains.

This uses the existing NFKC normalization and token boundaries. It does not
interpret quantities, units, signed values, fractions, or mathematical equivalence.
The 200,000-character source scan, 600-character windows, candidate and target
limits, nine-window maximum, and 2,000-character context budget remain unchanged.
More numeric tokens may change which passages win within those limits.

Sufficiency, reevaluation and synthesis receive the same selected source context.
Quote options retain their exact source spans. Selection supplies a retrieval
hint only: semantic review, evidence-ledger admission, confidence and citation
rewards retain their existing checks. The synthetic controls demonstrate this
selection behavior; they do not measure live answer quality or establish higher
confidence. No source purchase, provider call or production action is needed for
these controls.

The current offline paying-source study must be reproduced against the changed
runtime closure. Historical study artifacts stay immutable. This source change
does not allocate a release version or deploy the application.
