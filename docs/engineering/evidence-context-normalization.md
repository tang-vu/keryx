# Canonically equivalent source-context terms

Bounded retrieval must keep combining marks with the letters or numbers they
modify. The query and passage ranker already used NFKC, but the original-source
anchor scanner split decomposed words before normalizing them. A short paragraph
between fixed bucket starts could therefore be retained for `résumé` and missed
for the canonically equivalent `résumé` spelling.
Scripts whose marks cannot compose also lost parts of words in query terms.

Both term scanners now recognize a letter or number followed by letters, numbers
or attached marks, then retain the existing NFKC/lowercase matching. They do not
strip accents or equate unrelated words. The raw source is never normalized:
anchor positions, passage slices and quote offsets use the original UTF-16 text.

`lib/llm/evidence-context-normalization.test.ts` reproduces the actual missing
paragraph in long synthetic text. It checks NFC/NFD source/query combinations
for French, Vietnamese, German and Greek, attached Hindi marks, negative words,
existing compatibility matching, exact quotes after an astral character and
unchanged inputs. A capture engine verifies identical source context in
sufficiency, re-evaluation and synthesis; an empty model response still admits
no claim or citation. Eleven of the 24 cases fail on the unchanged scanner.

The 200,000-character scan, 400-character stride, 600-character nomination,
16-candidate pools, nine passages and 2,000-character context budget stay intact.
Heading/layout capabilities, complete-span admission, confidence, creator reward
and payment authority stay unchanged. This repairs lexical retrieval; a matching
word does not establish factual support, translation or complete coverage.
