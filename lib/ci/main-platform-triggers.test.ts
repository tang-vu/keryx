import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const workflows = ["native-inspection-adapter.yml", "rust-engine.yml", "desktop.yml", "windows-payment-fixtures.yml"];

function eventBlock(source: string, event: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const start = lines.indexOf(`  ${event}:`);
  expect(start, `Existing ${event} event is declared`).toBeGreaterThanOrEqual(0);
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || lines[end].startsWith("    ") || lines[end].startsWith("  #"))) end++;
  return lines.slice(start + 1, end).join("\n");
}

it.each(workflows)("%s validates every main push while retaining selective PR validation", name => {
  const source = readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8");
  const push = eventBlock(source, "push");
  // Main package/source identity changes even when runtime paths did not. No
  // changed-file, tag or other event filter may omit that exact-source check.
  const keys = [...push.matchAll(/^    ([a-z][a-z-]*):/gm)].map(match => match[1]);
  expect(keys).toEqual(["branches"]);
  expect(push).toMatch(/^    branches: \[main\]\s*$/m);

  const pr = eventBlock(source, "pull_request");
  expect(pr).toMatch(/^    branches: \[main\]\s*$/m);
  expect(pr).toMatch(/^    paths:\s*$/m);
  expect(pr).toContain(`".github/workflows/${name}"`);
});
