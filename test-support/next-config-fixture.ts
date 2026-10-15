import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Exact config-evaluation graph, shared by built isolated server fixtures.
 * Do not duplicate CSP literals or import the application renderer to load it. */
export const nextConfigFixtureFiles = [
  "package.json", "next.config.ts", "lib/security-headers.ts", "lib/arc-network-profile.ts", "lib/circle-wallet-config.ts",
  "lib/profiles/identity-return-policy.ts", "lib/run-claims/landing-assets.cjs", "lib/run-claims/landing-client.cjs", "lib/run-claims/private-headers.cjs", "locales/en/run-claims.cjs",
] as const;
export async function copyNextConfigFixture(source: string, fixture: string) {
  for (const file of nextConfigFixtureFiles) {
    const target = join(fixture, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(source, file)), { flag: "wx" });
  }
}
