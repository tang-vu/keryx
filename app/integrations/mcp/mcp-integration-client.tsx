"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CircleDot,
  Clipboard,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  TerminalSquare,
} from "lucide-react";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SiteHeader } from "@/components/keryx/site-header";
import { cn } from "@/lib/utils";

type ClientId = "codex" | "claude" | "cursor";
type Health = "checking" | "ready" | "unavailable";

interface ClientSetup {
  id: ClientId;
  name: string;
  detail: string;
  command: string;
  keyed?: string;
}

interface MetricsResponse {
  metrics?: {
    mcpClientQueries?: Array<{
      client: string;
      queries: number;
      payingQueries: number;
    }>;
  };
}

const ENDPOINT = "https://keryx.cc/mcp";
const SAMPLE_PROMPT =
  "Use Keryx research to explain how micropayments make citation rewards practical for AI agents. Include the paid sources and dispatch receipt.";

const CLIENTS: ClientSetup[] = [
  {
    id: "codex",
    name: "Codex",
    detail: "Add once from your terminal. Codex will discover both Keryx tools.",
    command: `codex mcp add keryx --url "${ENDPOINT}?client=codex"`,
    keyed:
      `codex mcp add keryx --url "${ENDPOINT}?client=codex" ` +
      "--bearer-token-env-var KERYX_API_KEY",
  },
  {
    id: "claude",
    name: "Claude Code",
    detail: "Register Keryx as a remote HTTP server in your current Claude scope.",
    command: `claude mcp add --transport http keryx "${ENDPOINT}?client=claude"`,
  },
  {
    id: "cursor",
    name: "Cursor",
    detail: "Paste this server entry into your Cursor MCP configuration.",
    command: `{
  "mcpServers": {
    "keryx": {
      "url": "${ENDPOINT}?client=cursor"
    }
  }
}`,
  },
];

async function probeConnection() {
  const [mcpResponse, metricsResponse] = await Promise.all([
    fetch("/mcp?client=other", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "keryx-setup-page", version: "1.0.0" },
        },
      }),
    }),
    fetch("/api/metrics", { cache: "no-store" }),
  ]);
  if (!mcpResponse.ok) throw new Error("MCP endpoint unavailable");
  const mcp = (await mcpResponse.json()) as {
    result?: { serverInfo?: { name?: string; version?: string } };
  };
  if (mcp.result?.serverInfo?.name !== "keryx") throw new Error("Unexpected MCP response");
  const metrics = metricsResponse.ok
    ? ((await metricsResponse.json()) as MetricsResponse).metrics
    : undefined;
  return { version: mcp.result.serverInfo.version, metrics };
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center gap-1.5 border border-line bg-paper px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 transition-colors hover:border-seal hover:text-seal"
    >
      {copied ? <Check size={13} /> : <Clipboard size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function McpIntegrationClient() {
  const [selected, setSelected] = useState<ClientId>("codex");
  const [health, setHealth] = useState<Health>("checking");
  const [serverVersion, setServerVersion] = useState<string>();
  const [channelCounts, setChannelCounts] = useState<MetricsResponse["metrics"]>();
  const active = CLIENTS.find((client) => client.id === selected)!;

  async function checkConnection() {
    setHealth("checking");
    try {
      const result = await probeConnection();
      setServerVersion(result.version);
      setChannelCounts(result.metrics);
      setHealth("ready");
    } catch {
      setHealth("unavailable");
    }
  }

  useEffect(() => {
    void probeConnection()
      .then((result) => {
        setServerVersion(result.version);
        setChannelCounts(result.metrics);
        setHealth("ready");
      })
      .catch(() => setHealth("unavailable"));
  }, []);

  const totalMcpQueries =
    channelCounts?.mcpClientQueries?.reduce((sum, row) => sum + row.queries, 0) ?? 0;
  const totalPaying =
    channelCounts?.mcpClientQueries?.reduce((sum, row) => sum + row.payingQueries, 0) ?? 0;

  return (
    <>
      <SiteHeader />
      <main>
        <section className="border-b border-ink">
          <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-16 sm:px-[30px] lg:grid-cols-[1.35fr_0.65fr] lg:py-24">
            <div>
              <div className="mb-5 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-seal">
                <span className="border border-seal px-2.5 py-1">Remote MCP</span>
                <span>io.github.tang-vu/keryx</span>
              </div>
              <h1 className="max-w-[760px] font-display text-[42px] font-semibold leading-[0.98] tracking-[-0.035em] text-ink sm:text-[64px]">
                One URL. Every agent. Creators get paid.
              </h1>
              <p className="mt-7 max-w-[680px] font-serif text-[19px] leading-[1.6] text-ink-2">
                Give your MCP client a budgeted research tool. Keryx finds relevant writing,
                settles citation rewards in Arc USDC, and returns the answer with a public receipt.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#setup"
                  className="border border-ink bg-seal px-5 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-paper transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)]"
                >
                  Connect an agent
                </a>
                <a
                  href="https://registry.modelcontextprotocol.io/v0/servers?search=keryx"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-ink px-5 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink transition-colors hover:bg-panel"
                >
                  MCP Registry <ArrowUpRight size={14} />
                </a>
              </div>
            </div>

            <div className="self-end border border-ink bg-panel p-6 shadow-[5px_5px_0_var(--ink)]">
              <div className="flex items-center justify-between border-b border-line pb-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
                  Live endpoint
                </span>
                <button
                  type="button"
                  onClick={() => void checkConnection()}
                  aria-label="Check connection again"
                  className="text-ink-3 transition-colors hover:text-seal"
                >
                  <RefreshCw size={14} className={health === "checking" ? "animate-spin" : ""} />
                </button>
              </div>
              <div className="mt-5 flex items-center gap-3">
                {health === "checking" ? (
                  <LoaderCircle size={18} className="animate-spin text-ink-3" />
                ) : (
                  <CircleDot
                    size={18}
                    className={health === "ready" ? "text-emerald-700" : "text-seal"}
                  />
                )}
                <div>
                  <div className="font-serif text-[20px] text-ink">
                    {health === "checking"
                      ? "Checking connection..."
                      : health === "ready"
                        ? "Keryx is ready"
                        : "Connection unavailable"}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-ink-3">
                    {ENDPOINT}
                    {serverVersion ? ` · server ${serverVersion}` : ""}
                  </div>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 border-t border-line pt-5">
                <div>
                  <div className="font-display text-[28px] text-ink">{totalMcpQueries}</div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
                    MCP dispatches
                  </div>
                </div>
                <div className="border-l border-line pl-5">
                  <div className="font-display text-[28px] text-ink">{totalPaying}</div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
                    Paying dispatches
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="setup" className="mx-auto max-w-[980px] scroll-mt-24 px-4 py-16 sm:px-[30px]">
          <div className="mb-8">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal">
              01 / Setup
            </div>
            <h2 className="mt-2 font-serif text-[32px] text-ink">Choose your MCP client</h2>
            <p className="mt-2 font-serif text-[16px] text-ink-3">
              The client tag measures which setup path works. It does not identify or authorize
              you.
            </p>
          </div>

          <div className="grid border border-ink md:grid-cols-[210px_1fr]">
            <div className="border-b border-ink bg-panel p-3 md:border-b-0 md:border-r">
              {CLIENTS.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setSelected(client.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border-l-2 px-4 py-4 text-left font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
                    selected === client.id
                      ? "border-seal bg-paper text-ink"
                      : "border-transparent text-ink-3 hover:text-ink",
                  )}
                >
                  <TerminalSquare size={15} />
                  {client.name}
                </button>
              ))}
            </div>
            <div className="min-w-0 p-5 sm:p-8">
              <h3 className="font-serif text-[24px] text-ink">{active.name}</h3>
              <p className="mt-1 font-serif text-[15px] text-ink-3">{active.detail}</p>
              <div className="mt-5 overflow-x-auto border border-line bg-ink p-4 text-paper">
                <pre className="font-mono text-[12px] leading-[1.7]">
                  <code>{active.command}</code>
                </pre>
              </div>
              <div className="mt-3 flex justify-end">
                <CopyButton value={active.command} label="Copy setup" />
              </div>
              {active.keyed && (
                <details className="mt-5 border-t border-line pt-5">
                  <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-seal">
                    Setup with an API key
                  </summary>
                  <div className="mt-4 overflow-x-auto border border-line bg-ink p-4 text-paper">
                    <pre className="font-mono text-[12px] leading-[1.7]">
                      <code>{active.keyed}</code>
                    </pre>
                  </div>
                </details>
              )}
            </div>
          </div>
        </section>

        <section className="border-y border-ink bg-panel">
          <div className="mx-auto grid max-w-[980px] gap-10 px-4 py-16 sm:px-[30px] md:grid-cols-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal">
                02 / First dispatch
              </div>
              <h2 className="mt-2 font-serif text-[30px] text-ink">Ask for research, not a search</h2>
              <p className="mt-3 font-serif text-[16px] leading-[1.6] text-ink-3">
                Tell your agent to use Keryx. The response includes cited creators, reward amounts,
                confidence, settlement status, and a dispatch URL.
              </p>
            </div>
            <div>
              <blockquote className="border-l-2 border-seal bg-paper p-5 font-serif text-[17px] italic leading-[1.6] text-ink">
                “{SAMPLE_PROMPT}”
              </blockquote>
              <div className="mt-3 flex justify-end">
                <CopyButton value={SAMPLE_PROMPT} label="Copy prompt" />
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[980px] px-4 py-16 sm:px-[30px]">
          <div className="grid gap-8 border border-ink p-6 sm:p-9 md:grid-cols-[1fr_auto] md:items-center">
            <div className="flex gap-5">
              <KeyRound className="mt-1 shrink-0 text-seal" size={24} />
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal">
                  Anonymous first, verified when ready
                </div>
                <h2 className="mt-2 font-serif text-[27px] text-ink">Raise the research limit</h2>
                <p className="mt-2 max-w-[620px] font-serif text-[15px] leading-[1.6] text-ink-3">
                  Try Remote MCP without a key. For higher limits and wallet-level attribution,
                  create an ask-scoped API key in the developer portal. Keryx still funds creator
                  rewards; your key controls identity and rate limits only.
                </p>
              </div>
            </div>
            <Link
              href="/dev"
              className="inline-flex items-center justify-center gap-2 border border-ink bg-ink px-5 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-paper transition-colors hover:bg-seal"
            >
              Developer portal <ArrowUpRight size={14} />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
