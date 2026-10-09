import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkRepositoryGlossaries, glossaryDigest, validateGlossaries } from "./check-payment-glossaries.mjs";

const fixtures = () => ["en", "vi", "zh-Hans"].map(locale =>
  JSON.parse(readFileSync(new URL(`../locales/glossary/${locale}.json`, import.meta.url), "utf8")));

// Synthetic metadata tests only; no real reviewer or translation approval is claimed.
function reviewedFixture() {
  const bundle = fixtures();
  const englishSha256 = glossaryDigest(bundle[0]);
  for (const glossary of bundle) {
    glossary.status = "reviewed";
    glossary.review = {
      kind: "human", reviewer: "fixture-reviewer", reviewedAt: "2026-10-09T00:00:00.000Z",
      evidence: "https://github.com/tang-vu/keryx/pull/1#pullrequestreview-1", scope: "entire-glossary",
      contentSha256: glossaryDigest(glossary), englishSha256,
    };
  }
  return bundle;
}

test("real assets are complete drafts and cannot pass release validation", () => {
  assert.deepEqual(checkRepositoryGlossaries().map(({ locale, status }) => [locale, status]),
    [["en", "draft"], ["vi", "draft"], ["zh-Hans", "draft"]]);
  for (const releaseLocale of ["en", "vi", "zh-Hans"]) {
    assert.throws(() => validateGlossaries(fixtures(), { releaseLocale }), /draft glossary cannot be released/);
  }
});

test("missing, unknown, malformed and duplicate locale data fail closed", () => {
  const bundle = fixtures();
  assert.throws(() => validateGlossaries([]), /No glossaries/);
  assert.throws(() => validateGlossaries(bundle.slice(1)), /English source/);
  assert.throws(() => validateGlossaries([...bundle, bundle[0]]), /Duplicate locale/);
  delete bundle[1].terms.pending;
  assert.throws(() => validateGlossaries(bundle), /unexpected or missing fields/);
  const extra = fixtures(); extra[1].terms.confirmed = extra[1].terms.settled;
  assert.throws(() => validateGlossaries(extra), /unexpected or missing fields/);
  const invalid = fixtures(); invalid[1].schemaVersion = 2;
  assert.throws(() => validateGlossaries(invalid), /Unsupported glossary schema/);
});

test("state labels remain distinct and English labels stay canonical", () => {
  for (const term of ["pending", "uncertain", "simulated"]) {
    const bundle = fixtures(); bundle[1].terms[term].text = bundle[1].terms.settled.text;
    assert.throws(() => validateGlossaries(bundle), /distinct labels/);
  }
  const bundle = fixtures(); bundle[0].terms.pending.text = "Complete";
  assert.throws(() => validateGlossaries(bundle), /noncanonical state label/);
});

test("critical labels cannot override or switch their glossary term", () => {
  const switched = fixtures(); switched[1].messages["payment.pending"].term = "settled";
  assert.throws(() => validateGlossaries(switched), /must reference pending/);
  const override = fixtures(); override[1].messages["payment.pending"].text = "Đã thanh toán";
  assert.throws(() => validateGlossaries(override), /unexpected or missing fields/);
  const unreviewed = fixtures(); unreviewed[1].messages["consent.cap"].requiresHumanReview = false;
  assert.throws(() => validateGlossaries(unreviewed), /requires human review/);
});

test("protocol names and action labels are never translated", () => {
  for (const term of ["usdc", "arc", "x402", "buy", "skip", "cache"]) {
    const bundle = fixtures(); bundle[2].terms[term].text += "译";
    assert.throws(() => validateGlossaries(bundle), /must stay/);
  }
});

test("legal notices retain English authority and mandatory human review", () => {
  const bundle = fixtures(); bundle[2].messages["legal.english-authoritative"].authority = "zh-Hans";
  assert.throws(() => validateGlossaries(bundle), /English authority and human review/);
  const missing = fixtures(); delete missing[2].messages["legal.english-authoritative"];
  assert.throws(() => validateGlossaries(missing), /unexpected or missing fields/);
});

test("blank, multiline and invisible-control glossary text is refused", () => {
  for (const text of ["", " Pending", "pending\nsettled", "pending\u202esettled", "pending\u2028settled"]) {
    const bundle = fixtures(); bundle[1].terms.pending.text = text;
    assert.throws(() => validateGlossaries(bundle), /invalid single-line text/);
  }
});

test("reviewed fixtures bind all content and the English source", () => {
  const bundle = reviewedFixture();
  assert.doesNotThrow(() => validateGlossaries(bundle, { releaseLocale: "vi" }));
  bundle[1].terms.receipt.definition += " Changed.";
  assert.throws(() => validateGlossaries(bundle), /review does not cover current content/);
  const englishChanged = reviewedFixture(); englishChanged[0].terms.receipt.definition += " Changed.";
  englishChanged[0].review.contentSha256 = glossaryDigest(englishChanged[0]);
  englishChanged[0].review.englishSha256 = glossaryDigest(englishChanged[0]);
  assert.throws(() => validateGlossaries(englishChanged), /review does not cover current English source/);
});

test("legal text and critical-message metadata changes invalidate review", () => {
  const bundle = reviewedFixture(); bundle[2].messages["legal.english-authoritative"].text += " 变更。";
  assert.throws(() => validateGlossaries(bundle), /review does not cover current content/);
  const rekeyed = fixtures();
  rekeyed[0].terms = Object.fromEntries(Object.entries(rekeyed[0].terms).reverse());
  assert.equal(glossaryDigest(rekeyed[0]), glossaryDigest(fixtures()[0]));
});

test("machine review, incomplete evidence and invalid timestamps cannot approve drafts", () => {
  for (const [field, value] of [["kind", "machine"], ["scope", "payment-only"], ["reviewer", ""],
    ["evidence", "https://example.test/review"], ["reviewedAt", "2026-02-30T00:00:00.000Z"]]) {
    const bundle = reviewedFixture(); bundle[1].review[field] = value;
    assert.throws(() => validateGlossaries(bundle), /human|permalink|timestamp/);
  }
  const draft = reviewedFixture(); draft[0].status = "draft"; draft[0].review = null;
  assert.throws(() => validateGlossaries(draft), /English source needs human review/);
  const misleading = fixtures(); misleading[0].review = {};
  assert.throws(() => validateGlossaries(misleading), /draft cannot claim/);
  const unknown = reviewedFixture();
  assert.throws(() => validateGlossaries(unknown, { releaseLocale: "fr" }), /locale is missing/);
});

test("CLI is cwd-independent and refuses draft release and unknown options", () => {
  const script = new URL("./check-payment-glossaries.mjs", import.meta.url);
  const cwd = new URL("../locales", import.meta.url);
  const run = args => execFileSync(process.execPath, [fileURLToPath(script), ...args],
    { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  assert.match(run([]), /vi: draft/);
  assert.throws(() => run(["--release", "vi"]), error => error.status === 1 && /cannot be released/.test(error.stderr));
  assert.throws(() => run(["--ignore-review"]), error => error.status === 1 && /Usage:/.test(error.stderr));
});
