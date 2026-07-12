"use client";

/**
 * OpenAI-compatible playground — a zero-install showcase for /api/v1/chat/completions.
 *
 * Runs the SAME endpoint any OpenAI SDK would call (stream:true), rendering the agent's live
 * reasoning_content (buy/skip/trust) apart from the answer, plus the creators it paid. Doubles as a
 * copy-paste recipe: the curl/Python/JS snippets below mirror the exact call the Run button makes.
 *
 * No useEffect/auto-run — everything is driven by the Run button (keeps the treasury free tier gated
 * by the same IP rate-limit as the site's anonymous asker).
 */

import { useState } from "react";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { Copy, Play, Loader2 } from "lucide-react";

const BASE = "https://keryx.cc/api/v1";
const PRESETS = [
  "How do x402 and stablecoins enable autonomous AI agent commerce?",
  "What is Arc and why build payments on it?",
  "How does citation-weighted settlement pay creators?",
];

interface Paid {
  source: string;
  weight: number;
  reward: number;
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ").trim();
}

function snippets(q: string): Record<string, string> {
  const e = esc(q);
  return {
    curl: `curl ${BASE}/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"keryx","messages":[{"role":"user","content":"${e}"}]}'`,
    python: `from openai import OpenAI
# api_key can be any placeholder on the free tier; use a kx_live_ key for higher limits.
client = OpenAI(base_url="${BASE}", api_key="keryx")
r = client.chat.completions.create(
    model="keryx",
    messages=[{"role": "user", "content": "${e}"}],
)
print(r.choices[0].message.content)`,
    js: `import OpenAI from "openai";
const client = new OpenAI({ baseURL: "${BASE}", apiKey: "keryx" });
const r = await client.chat.completions.create({
  model: "keryx",
  messages: [{ role: "user", content: "${e}" }],
});
console.log(r.choices[0].message.content);`,
  };
}

export default function PlaygroundPage() {
  const [q, setQ] = useState(PRESETS[0]!);
  const [tab, setTab] = useState<"curl" | "python" | "js">("curl");
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState("");
  const [answer, setAnswer] = useState("");
  const [paid, setPaid] = useState<Paid[]>([]);
  const [error, setError] = useState("");

  async function run() {
    if (running || !q.trim()) return;
    setRunning(true);
    setThinking("");
    setAnswer("");
    setPaid([]);
    setError("");
    try {
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "keryx",
          messages: [{ role: "user", content: q.trim() }],
          stream: true,
        }),
      });
      // A rate-limit / error returns JSON (not an event-stream) BEFORE the stream opens.
      if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("event-stream")) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
        const msg =
          typeof j?.error === "string" ? j.error : j?.error?.message ?? `Request failed (${res.status})`;
        setError(msg);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let think = "";
      let ans = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.replace(/^data: /, "").trim();
          if (!line || line === "[DONE]") continue;
          let obj: {
            choices?: { delta?: { reasoning_content?: string; content?: string } }[];
            keryx?: { citations?: Paid[] };
          };
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          const delta = obj.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            think += delta.reasoning_content;
            setThinking(think);
          }
          if (delta?.content) {
            ans += delta.content;
            setAnswer(ans);
          }
          if (obj.keryx?.citations) setPaid(obj.keryx.citations);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const code = snippets(q);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[900px] px-4 py-10 sm:px-8">
        <div className="mb-8 border-b border-line pb-6">
          <h1 className="font-serif text-2xl text-ink">OpenAI-compatible playground</h1>
          <p className="mt-1 font-mono text-xs text-ink-3">
            The Run button calls <code className="text-seal">{BASE}/chat/completions</code> exactly as
            any OpenAI SDK would (model <code className="text-seal">keryx</code>, <code className="text-seal">stream:true</code>).
            Free — no key. Watch the agent decide, then pay the creators it cites.
          </p>
        </div>

        {/* Try it */}
        <div className="mb-8">
          <div className="mb-2 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setQ(p)}
                className="rounded-full border border-line px-3 py-1 font-mono text-[11px] text-ink-2 hover:border-seal hover:text-seal transition-colors"
              >
                {p.length > 42 ? p.slice(0, 42) + "…" : p}
              </button>
            ))}
          </div>
          <div className="flex items-stretch gap-2">
            <textarea
              value={q}
              onChange={(e) => setQ(e.target.value)}
              rows={2}
              className="flex-1 resize-none rounded border border-line bg-paper px-3 py-2 font-mono text-xs text-ink placeholder-ink-3 focus:border-seal focus:outline-none"
              placeholder="Ask anything…"
            />
            <button
              onClick={() => void run()}
              disabled={running}
              className="flex items-center gap-2 rounded border border-seal bg-seal/10 px-5 font-mono text-sm text-seal hover:bg-seal/20 disabled:opacity-50 transition-colors"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? "Running…" : "Run"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded border border-seal/40 bg-seal/5 px-4 py-3 font-mono text-xs text-seal">
            {error}
          </div>
        )}

        {/* Live output */}
        {(thinking || answer) && (
          <div className="mb-8 grid gap-4 md:grid-cols-[1fr_1fr]">
            <div>
              <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-ink-3">
                reasoning_content (live)
              </p>
              <pre className="h-64 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-paper-2 p-3 font-mono text-[11px] leading-relaxed text-ink-2">
                {thinking || "…"}
              </pre>
            </div>
            <div>
              <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-ink-3">answer</p>
              <div className="h-64 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-paper p-3 font-serif text-sm leading-relaxed text-ink">
                {answer || "…"}
              </div>
            </div>
          </div>
        )}

        {paid.length > 0 && (
          <div className="mb-8 rounded border border-seal/30 bg-paper p-4">
            <p className="mb-2 font-serif text-sm text-ink">Creators paid (USDC on Arc)</p>
            <ul className="space-y-1">
              {paid.map((c, i) => (
                <li key={i} className="flex justify-between font-mono text-xs text-ink-2">
                  <span>{c.source}</span>
                  <span className="text-seal">
                    ${c.reward.toFixed(4)} · w {c.weight.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Copy-paste recipe */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex gap-2">
              {(["curl", "python", "js"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded px-3 py-1 font-mono text-[11px] transition-colors ${
                    tab === t ? "bg-seal/15 text-seal" : "text-ink-3 hover:text-ink-2"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              onClick={() => void navigator.clipboard.writeText(code[tab]!).catch(() => null)}
              className="flex items-center gap-1 font-mono text-[11px] text-ink-3 hover:text-seal transition-colors"
            >
              <Copy size={12} /> copy
            </button>
          </div>
          <pre className="overflow-x-auto rounded border border-line bg-paper-2 p-4 font-mono text-[11px] leading-relaxed text-ink-2">
            {code[tab]}
          </pre>
          <p className="mt-2 font-mono text-[11px] text-ink-3">
            Pass a <code className="text-seal">kx_live_…</code> key (mint at{" "}
            <a href="/dev" className="underline underline-offset-2 hover:text-seal">
              /dev
            </a>
            ) as the Bearer token for higher limits. Full schema at{" "}
            <a href="/api/docs" className="underline underline-offset-2 hover:text-seal">
              /api/docs
            </a>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
