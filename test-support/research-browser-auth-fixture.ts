import assert from "node:assert/strict";
import type { Metafile, Plugin } from "esbuild";

/** Wallet authentication is outside these hermetic selection/payer fixtures. Components stay real. */
export function signedOutResearchAuthFixture(): Plugin {
  return { name: "signed-out-research-auth", setup(api) {
    api.onResolve({ filter: /^@\/lib\/hooks\/use-siwe-auth$/ }, () => ({ path: "signed-out-auth", namespace: "research-auth-fixture" }));
    api.onLoad({ filter: /^signed-out-auth$/, namespace: "research-auth-fixture" }, () => ({
      loader: "js", contents: "export function useSiweAuth(){return {session:null}}",
    }));
  } };
}

export function assertResearchBrowserFixtureGraph(metafile: Metafile | undefined) {
  assertSignedOutBrowserFixtureGraph(metafile, ["components/keryx/research-turn.tsx", "components/keryx/decision-reviews.tsx", "lib/hooks/use-ask-stream.ts"]);
}

/** Each fixture names the real composition it exercises; wallet authentication stays separate. */
export function assertSignedOutBrowserFixtureGraph(metafile: Metafile | undefined, requiredModules: readonly string[]) {
  assert(metafile, "The actual browser fixture must retain its esbuild input graph");
  const paths = Object.keys(metafile.inputs).map(path => path.replaceAll("\\", "/"));
  for (const suffix of requiredModules)
    assert(paths.some(path => path.endsWith(suffix)), `Real research composition missing: ${suffix}`);
  assert(!paths.some(path => /(?:^|\/)node_modules\/(?:jsonwebtoken|jwa|jws)\//.test(path)), "Node JWT signing/verification must not enter the hermetic browser fixture");
  assert(paths.includes("research-auth-fixture:signed-out-auth"), "The synthetic signed-out wallet boundary must be explicit");
}
