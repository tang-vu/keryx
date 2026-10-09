import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requiredTerms = [
  "pending", "settled", "failed", "uncertain", "refunded", "expired", "simulated",
  "sponsored", "budget", "cap", "reserved", "source-toll", "citation-reward",
  "creator-payout", "withdrawal", "authorization", "session", "receipt", "testnet",
  "mainnet", "buy", "skip", "cache", "usdc", "arc", "x402",
];
const fixedTerms = { buy: "BUY", skip: "SKIP", cache: "CACHE", usdc: "USDC", arc: "Arc", x402: "x402" };
const englishStates = {
  pending: "Pending confirmation", settled: "Settled", failed: "Failed",
  uncertain: "Outcome uncertain", refunded: "Refunded", expired: "Expired", simulated: "Simulated",
};
const termMessages = Object.fromEntries([
  ...Object.keys(englishStates).map(term => [`payment.${term}`, term]),
  ["consent.authorization", "authorization"], ["consent.cap", "cap"],
]);
const legalKey = "legal.english-authoritative";
const messageKeys = [...Object.keys(termMessages), legalKey];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, context) {
  requireCondition(value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
  `${context}: unexpected or missing fields`);
}

function singleLine(value, context) {
  requireCondition(typeof value === "string" && value.length > 0 && value.length <= 1000 &&
    value === value.trim() && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), `${context}: invalid single-line text`);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

// Bind every definition and rendered critical message, not review metadata or key order.
export function glossaryDigest(glossary) {
  const { schemaVersion, locale, terms, messages } = glossary;
  return createHash("sha256").update(JSON.stringify(canonical({ schemaVersion, locale, terms, messages }))).digest("hex");
}

function validateShape(glossary) {
  exactKeys(glossary, ["schemaVersion", "locale", "status", "review", "terms", "messages"], "glossary");
  const { locale, terms, messages } = glossary;
  requireCondition(glossary.schemaVersion === 1, "Unsupported glossary schema");
  requireCondition(typeof locale === "string" && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale), "Invalid locale");
  requireCondition(["draft", "reviewed"].includes(glossary.status), `${locale}: invalid review status`);
  exactKeys(terms, requiredTerms, `${locale} terms`);
  for (const [term, entry] of Object.entries(terms)) {
    exactKeys(entry, ["text", "definition"], `${locale} ${term}`);
    singleLine(entry.text, `${locale} ${term} label`);
    singleLine(entry.definition, `${locale} ${term} definition`);
    if (Object.hasOwn(fixedTerms, term)) {
      requireCondition(entry.text === fixedTerms[term], `${locale}: ${term} must stay ${fixedTerms[term]}`);
    }
    if (locale === "en" && Object.hasOwn(englishStates, term)) {
      requireCondition(entry.text === englishStates[term], `en: ${term} has a noncanonical state label`);
    }
  }
  const stateLabels = Object.keys(englishStates).map(term => terms[term].text.normalize("NFKC").toLowerCase());
  requireCondition(new Set(stateLabels).size === stateLabels.length, `${locale}: payment states must have distinct labels`);
  exactKeys(messages, messageKeys, `${locale} critical messages`);
  for (const [key, term] of Object.entries(termMessages)) {
    exactKeys(messages[key], ["term", "requiresHumanReview"], `${locale} ${key}`);
    requireCondition(messages[key].term === term, `${locale}: ${key} must reference ${term}`);
    requireCondition(messages[key].requiresHumanReview === true, `${locale}: ${key} requires human review`);
  }
  exactKeys(messages[legalKey], ["text", "authority", "requiresHumanReview"], `${locale} ${legalKey}`);
  singleLine(messages[legalKey].text, `${locale} legal notice`);
  requireCondition(messages[legalKey].authority === "en" && messages[legalKey].requiresHumanReview === true,
    `${locale}: legal notice requires English authority and human review`);
}

function validateReview(glossary, english) {
  const { locale, review } = glossary;
  if (glossary.status === "draft") {
    requireCondition(review === null, `${locale}: a draft cannot claim a completed review`);
    return;
  }
  exactKeys(review, ["kind", "reviewer", "reviewedAt", "evidence", "scope", "contentSha256", "englishSha256"], `${locale} review`);
  requireCondition(review.kind === "human" && review.scope === "entire-glossary", `${locale}: complete human review is required`);
  requireCondition(typeof review.reviewer === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(review.reviewer),
    `${locale}: human reviewer handle is required`);
  requireCondition(typeof review.reviewedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(review.reviewedAt) &&
    Number.isFinite(Date.parse(review.reviewedAt)) && new Date(review.reviewedAt).toISOString() === review.reviewedAt,
  `${locale}: review timestamp must be an exact UTC ISO date`);
  requireCondition(typeof review.evidence === "string" &&
    /^https:\/\/github\.com\/tang-vu\/keryx\/pull\/[1-9]\d*#pullrequestreview-[1-9]\d*$/.test(review.evidence),
  `${locale}: a human PR review permalink is required`);
  requireCondition(review.contentSha256 === glossaryDigest(glossary), `${locale}: review does not cover current content`);
  requireCondition(review.englishSha256 === glossaryDigest(english), `${locale}: review does not cover current English source`);
  requireCondition(english.status === "reviewed", `${locale}: English source needs human review first`);
}

export function validateGlossaries(glossaries, { releaseLocale } = {}) {
  requireCondition(Array.isArray(glossaries) && glossaries.length > 0, "No glossaries found");
  glossaries.forEach(validateShape);
  const locales = glossaries.map(glossary => glossary.locale);
  requireCondition(new Set(locales).size === locales.length, "Duplicate locale");
  const english = glossaries.find(glossary => glossary.locale === "en");
  requireCondition(english !== undefined, "English source glossary is required");
  glossaries.forEach(glossary => validateReview(glossary, english));
  if (releaseLocale !== undefined) {
    const candidate = glossaries.find(glossary => glossary.locale === releaseLocale);
    requireCondition(candidate !== undefined, "Requested release locale is missing");
    requireCondition(candidate.status === "reviewed", `${releaseLocale}: draft glossary cannot be released`);
  }
  return glossaries.map(glossary => ({ locale: glossary.locale, status: glossary.status, contentSha256: glossaryDigest(glossary) }));
}

export function checkRepositoryGlossaries(root = repoRoot, options = {}) {
  const directory = path.join(root, "locales", "glossary");
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  requireCondition(entries.every(entry => entry.isFile() && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\.json$/.test(entry.name)),
    "Glossary directory must contain only locale JSON files");
  const glossaries = entries.map(entry => {
    const glossary = JSON.parse(readFileSync(path.join(directory, entry.name), "utf8"));
    requireCondition(glossary.locale === entry.name.slice(0, -5), "Glossary filename/locale mismatch");
    return glossary;
  });
  return validateGlossaries(glossaries, options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireCondition(args.length === 0 || (args.length === 2 && args[0] === "--release"), "Usage: node scripts/check-payment-glossaries.mjs [--release locale]");
    const result = checkRepositoryGlossaries(repoRoot, args.length ? { releaseLocale: args[1] } : {});
    for (const row of result) console.log(`${row.locale}: ${row.status}; content SHA256 ${row.contentSha256}`);
    console.log("Glossary structure and review bindings passed. Runtime locale activation is a separate gate.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Glossary validation failed");
    process.exitCode = 1;
  }
}
