# OpenAI-compatible API — integration recipes

Keryx exposes a drop-in **OpenAI Chat Completions** surface. Any tool that speaks the OpenAI wire
format can ask Keryx a question; Keryx researches it over paid sources and settles a weighted USDC
citation reward to eligible creators it cites on the configured Arc network. Public production
uses mainnet; `/api/health` reports the selected network and settlement mode.
See [current deployment evidence](mainnet-status.md); sponsored research readiness
and the settlement state of each run remain separate from network selection.

- **Base URL:** `https://keryx.cc/api/v1`
- **Model:** `keryx` (default), or pick a reasoning model chat-app style with
  `keryx:<id>` — currently `keryx:deepseek-flash` (workhorse), `keryx:deepseek-v4-pro`,
  `keryx:mimo-v2.5` and `keryx:mimo-v2.5-pro` (Xiaomi MiMo, added 2026-07-26).
  Enabled Cloudflare installations also offer `keryx:cloudflare-llama-3.3` and,
  after a separate opt-in, the manually selected experimental
  `keryx:cloudflare-gpt-oss-120b`. See [Cloudflare configuration and gates](cloudflare-workers-ai.md).
  `GET /api/v1/models` lists what's live. Unknown ids run the default, and any pick that
  encounters a supplier failure crosses the other configured provider defaults,
  then the offline heuristic. Planning/selection contract refusals can still stop
  a request; model availability does not guarantee a completed useful answer.
  The open-weight options served through Ollama Cloud (`glm-5.2`, `qwen3.5-397b`, `gemma4`,
  `kimi-k2.7-code`, `minimax-m3`, `gpt-oss-120b`) were withdrawn on 2026-07-26; those ids still
  resolve — to the workhorse — so existing callers and saved embeds keep working.
  V4 Pro can take 2–3 minutes for the full research loop: use `stream: true` with it — a
  non-streaming call may hit proxy timeouts even though the run completes and settles
  server-side (the answer stays at its dispatch URL).
- **Auth:** send any token as the API key. On the **free tier** the token is ignored
  (treasury-funded, IP rate-limited). Send a **`kx_live_…`** key (mint at
  [keryx.cc/dev](https://keryx.cc/dev)) for wallet-based limits + usage metering.
  All keys for one wallet share 10 sponsored calls/minute across chat and remote MCP;
  direct calls also share 10/minute per IP and the global sponsored allowance.
  Creating another key adds no quota. [Full limits](engineering/mainnet-economic-recovery.md#sponsored-admission).
- **Streaming:** with `stream: true`, the agent's live buy/skip/trust reasoning arrives as
  `delta.reasoning_content` (o1-style), then the answer as `delta.content`. The terminal chunk
  carries a `keryx` extension (`queryId`, `citations`, `totalToCreators`, `dispatchUrl`).
- **Budget (optional):** pass a Keryx `budget` field (USDC, via `extra_body`) to cap creator
  payouts; it is clamped to the tier ceiling. Omit it for the default.
- Try it with no install at [keryx.cc/playground](https://keryx.cc/playground). Full schema at
  [keryx.cc/api/docs](https://keryx.cc/api/docs).

> Mainnet sponsored research uses Keryx treasury funds within its reviewed caps.
> Caller-funded A2A is a separate x402 route; an API key holds no prepaid balance.

---

## curl

```bash
curl https://keryx.cc/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"keryx","messages":[{"role":"user","content":"What is Arc?"}]}'
```

## OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(base_url="https://keryx.cc/api/v1", api_key="keryx")  # or a kx_live_ key
resp = client.chat.completions.create(
    model="keryx",
    messages=[{"role": "user", "content": "How does x402 enable agent commerce?"}],
)
print(resp.choices[0].message.content)
# Who got paid:
print(resp.model_extra["keryx"]["citations"])
```

Streaming (watch the agent reason):

```python
stream = client.chat.completions.create(
    model="keryx",
    messages=[{"role": "user", "content": "What is Arc?"}],
    stream=True,
)
for chunk in stream:
    d = chunk.choices[0].delta
    if getattr(d, "reasoning_content", None):
        print(d.reasoning_content, end="")   # live buy/skip/trust trace
    if d.content:
        print(d.content, end="")             # the answer
```

## OpenAI Node SDK

```ts
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "https://keryx.cc/api/v1", apiKey: "keryx" });
const r = await client.chat.completions.create({
  model: "keryx",
  messages: [{ role: "user", content: "What is Arc?" }],
});
console.log(r.choices[0].message.content);
```

## Vercel AI SDK

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const keryx = createOpenAI({ baseURL: "https://keryx.cc/api/v1", apiKey: "keryx" });
const { text } = await generateText({
  model: keryx("keryx"),
  prompt: "How are creators paid per citation?",
});
console.log(text);
```

## LangChain (Python)

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="keryx", base_url="https://keryx.cc/api/v1", api_key="keryx")
print(llm.invoke("What is Arc and why build payments on it?").content)
```

## LlamaIndex (Python)

```python
from llama_index.llms.openai_like import OpenAILike

llm = OpenAILike(model="keryx", api_base="https://keryx.cc/api/v1", api_key="keryx",
                 is_chat_model=True)
print(llm.complete("Explain citation-weighted settlement."))
```

## Open WebUI

Settings → **Connections** → add an **OpenAI-compatible** connection:

- **API Base URL:** `https://keryx.cc/api/v1`
- **API Key:** `keryx` (or a `kx_live_…` key)

Then pick the **keryx** model in a new chat. Reasoning shows in the collapsible "thinking" panel.

## LibreChat

In `librechat.yaml`:

```yaml
endpoints:
  custom:
    - name: "Keryx"
      apiKey: "keryx"            # or a kx_live_ key
      baseURL: "https://keryx.cc/api/v1"
      models:
        default: ["keryx"]
        fetch: true
      titleConvo: false
```

## Continue (VS Code / JetBrains)

In `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "Keryx",
      "provider": "openai",
      "model": "keryx",
      "apiBase": "https://keryx.cc/api/v1",
      "apiKey": "keryx"
    }
  ]
}
```

---

## Notes

- **Source-selection refusals.** Invalid model target/source mappings with no valid
  actionable selection return HTTP `422`, code `research_source_selection_invalid`
  and bounded `error.selectionDiagnostic`. This is an application contract failure,
  not evidence that the user's question was invalid. A started stream retains
  HTTP `200`, adds `keryx_error` diagnostic metadata to the error chunk and emits no
  successful completion metadata or `[DONE]`. Preserve the diagnostic when
  reporting the failure; no automatic extra model attempt is made for that output.
  Supplier calls can still have a cost. See [the contract](engineering/source-selection-2026-10-05.md).

- **Rate limits.** Free tier: 5 requests / 60s per IP. Keyed (`kx_live_…`): 10 / 60s. A `429`
  carries `Retry-After`.
- **Errors** use the OpenAI envelope: `{"error": {"message", "type", "code"}}`. A `kx_live_`-shaped
  but invalid token returns `401`; any other token drops to the free tier.
- **Citation and payment evidence.** The `keryx` extension (or the "Citations and planned creator rewards" footer in the
  message content) lists each cited source, its weight, and its USDC reward, plus a permalink to the
  full reasoning trace at `/dispatch/<queryId>`.
- **Not x402 on this path.** OpenAI clients can't sign an x402 header, so the treasury funds the free
  tier exactly as the site's anonymous asker does. For pay-per-call x402, use `POST /api/agent/ask`.

Pass `scholarly: true` and `mode: "quick" | "deep"` through `extra_body` to request bounded public paper discovery and research depth. Invalid types are refused. The `keryx` extension preserves article identity, public answer evidence and `researchExports`; public citations can earn no creator reward. `creatorsPaid` is nullable when distinct settled creators are unknown; allocation counts do not prove settlement.
