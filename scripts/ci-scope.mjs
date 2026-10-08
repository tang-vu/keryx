import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDocuments = new Set(["README.md", "PLAN.md", "DECISIONS.md", "AGENTS.md"]);

export function classifyChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return "full";
  return changes.every(({ path: filename, beforeMode, afterMode }) =>
    typeof filename === "string" && !filename.includes("\\") &&
    !filename.split("/").some(part => part === "." || part === ".." || !part) &&
    (rootDocuments.has(filename) || /^docs\/.+\.md$/.test(filename)) &&
    [beforeMode, afterMode].every(mode => ["000000", "100644"].includes(mode)) &&
    [beforeMode, afterMode].includes("100644")
  ) ? "docs" : "full";
}

export function parseRawDiff(raw) {
  const fields = raw.split("\0");
  if (fields.pop() !== "" || fields.length % 2) throw new Error("Incomplete Git diff");
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const match = /^:(\d{6}) (\d{6}) [a-f0-9]{40,64} [a-f0-9]{40,64} ([AMDT])$/.exec(fields[index]);
    if (!match || !fields[index + 1]) throw new Error("Unrecognized Git diff");
    changes.push({ path: fields[index + 1], beforeMode: match[1], afterMode: match[2] });
  }
  return changes;
}

export function determineScope(base, head, pullRequest, runGit = args =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true })
) {
  // Publishers use successful main CI as exact-source runtime acceptance.
  // Keep that contract intact; the prose fast path reduces PR merge latency only.
  if (!pullRequest) return "full";
  if (![base, head].every(sha => typeof sha === "string" && /^[a-f0-9]{40,64}$/.test(sha) && !/^0+$/.test(sha))) return "full";
  try {
    // PR checkout is the synthetic merged tree; include all changes since its merge base.
    const range = `${base}...${head}`;
    return classifyChanges(parseRawDiff(runGit(["diff", "--raw", "--no-abbrev", "--no-renames", "-z", range])));
  } catch {
    return "full";
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scope = determineScope(process.env.CI_BASE_SHA, process.env.GITHUB_SHA, process.env.GITHUB_EVENT_NAME === "pull_request");
  console.log(`CI scope: ${scope}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`);
}
