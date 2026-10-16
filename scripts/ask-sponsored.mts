import { pathToFileURL } from "node:url";
import {
  researchSponsored, SponsoredResearchError, SPONSORED_RESEARCH_NOTICE,
  sponsoredResearchOrigin, validateSponsoredResearchInput,
  type SponsoredResearchInput, type SponsoredResearchOptions,
} from "../shared/sponsored-research-client.ts";

export const SPONSORED_HELP = `Usage: npm run ask:sponsored -- --public "question" [--budget 0..0.08] [--mode quick|deep] [--base-url ORIGIN]

Examples:
  npm run ask:sponsored -- --public "How do citation rewards work?"
  npm run ask:sponsored -- --public "Compare public evidence" --budget 0 --mode quick

--public confirms that your question and report become public.
--budget sets source USDC only (default 0.05); zero is valid.
--mode defaults to deep. --base-url defaults to https://keryx.cc.
Only clean HTTPS origins or explicit loopback HTTP origins are accepted.
No API key, wallet, or environment file is needed.
${SPONSORED_RESEARCH_NOTICE}
`;

type CliDependencies = {
  client?: typeof researchSponsored;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  signal?: AbortSignal;
};

export function parseSponsoredArgs(args: string[]): { input: SponsoredResearchInput; baseUrl: string } {
  let publicReport = false, budget: number | undefined, mode: "quick" | "deep" | undefined, baseUrl: string | undefined;
  const question: string[] = [], seen = new Set<string>();
  let positional = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (positional) { question.push(arg); continue; }
    if (arg === "--") { positional = true; continue; }
    if (arg === "--public") { publicReport = true; continue; }
    if (["--budget", "--mode", "--base-url"].includes(arg)) {
      if (seen.has(arg)) throw new Error(`Duplicate ${arg}.`);
      seen.add(arg);
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      if (arg === "--budget") {
        if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("--budget requires a finite decimal from 0 to 0.08 USDC.");
        budget = Number(value);
      } else if (arg === "--mode") {
        if (value !== "quick" && value !== "deep") throw new Error("--mode requires quick or deep.");
        mode = value;
      } else baseUrl = value;
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else question.push(arg);
  }
  if (!publicReport) throw new Error("--public is required before any network request: your question and report become public.");
  return { input: validateSponsoredResearchInput({ question: question.join(" "), budget, mode, publicReport: true }),
    baseUrl: sponsoredResearchOrigin(baseUrl) };
}

/** Import-safe entrypoint. Tests supply a client; the real launcher only adds SIGINT handling. */
export async function runSponsoredCli(args: string[], dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout ?? (text => process.stdout.write(text));
  const stderr = dependencies.stderr ?? (text => process.stderr.write(text));
  if (args.includes("--help") || args.includes("-h")) { stdout(SPONSORED_HELP); return 0; }
  try {
    const { input, baseUrl } = parseSponsoredArgs(args);
    stderr(`${SPONSORED_RESEARCH_NOTICE}\n`);
    const options: SponsoredResearchOptions = { baseUrl, signal: dependencies.signal, onProgress: text => stderr(text) };
    const result = await (dependencies.client ?? researchSponsored)(input, options);
    stdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof SponsoredResearchError) {
      stderr(`${JSON.stringify({ error: error.message, code: error.code, status: error.status, retryAfter: error.retryAfter,
        uncertain: error.uncertain, queryId: error.queryId, dispatchUrl: error.dispatchUrl, selectionDiagnostic: error.selectionDiagnostic })}\n`);
    } else stderr(`${JSON.stringify({ error: error instanceof Error ? error.message : "Sponsored research failed.", retry: "none" })}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try { process.exitCode = await runSponsoredCli(process.argv.slice(2), { signal: controller.signal }); }
  finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
