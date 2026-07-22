# OpenAI-compatible API — integration recipes

Keryx exposes a drop-in **OpenAI Chat Completions** surface. Any tool that speaks the OpenAI wire
format can ask Keryx a question; Keryx researches it over paid sources and settles a weighted USDC
citation reward to every creator it cites, on Arc testnet.

- **Base URL:** `https://keryx.cc/api/v1`
- **Model:** `keryx` (default), or pick a reasoning model chat-app style with
  `keryx:<id>` — e.g. `keryx:glm-5.2`, `keryx:deepseek-v4-pro`, `keryx:qwen3.5-397b`.
  `GET /api/v1/models` lists what's live. Unknown ids run the default, and any pick that
  errors mid-run falls back to DeepSeek (then the offline heuristic) — an ask always answers.
  Heavy picks (DeepSeek V4 Pro, Qwen 3.5 397B) can take 2–3 minutes for the full research
  loop: use `stream: true` with them — a non-streaming call may hit proxy timeouts even
  though the run completes and settles server-side (the answer stays at its dispatch URL).
- **Auth:** send any token as the API key. On the **free tier** the token is ignored
  (treasury-funded, IP rate-limited). Send a **`kx_live_…`** key (mint at
  [keryx.cc/dev](https://keryx.cc/dev)) for higher limits + usage metering.
- **Streaming:** with `stream: true`, the agent's live buy/skip/trust reasoning arrives as
  `delta.reasoning_content` (o1-style), then the answer as `delta.content`. The terminal chunk
  carries a `keryx` extension (`queryId`, `citations`, `totalToCreators`, `dispatchUrl`).
- **Budget (optional):** pass a Keryx `budget` field (USDC, via `extra_body`) to cap creator
  payouts; it is clamped to the tier ceiling. Omit it for the default.
- Try it with no install at [keryx.cc/playground](https://keryx.cc/playground). Full schema at
  [keryx.cc/api/docs](https://keryx.cc/api/docs).

> Testnet only — settlements are real but in testnet USDC. No real money moves.

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

- **Rate limits.** Free tier: 5 requests / 60s per IP. Keyed (`kx_live_…`): 10 / 60s. A `429`
  carries `Retry-After`.
- **Errors** use the OpenAI envelope: `{"error": {"message", "type", "code"}}`. A `kx_live_`-shaped
  but invalid token returns `401`; any other token drops to the free tier.
- **Every answer pays creators.** The `keryx` extension (or the "Creators paid" footer in the
  message content) lists each cited source, its weight, and its USDC reward, plus a permalink to the
  full reasoning trace at `/dispatch/<queryId>`.
- **Not x402 on this path.** OpenAI clients can't sign an x402 header, so the treasury funds the free
  tier exactly as the site's anonymous asker does. For pay-per-call x402, use `POST /api/agent/ask`.
