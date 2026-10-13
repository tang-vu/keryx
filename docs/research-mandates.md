# Research mandates / Ủy quyền nghiên cứu

Research Mandates is a local policy workbench and a separately staged USDC
contract candidate. It helps an owner inspect research purchasing authority.
It does **not** change Keryx's existing Gateway payment authority or activate
a funded contract. Availability in production follows the combined release.

## Start in the browser

Open `/mandates`, select EN or VI, then load a clearly labelled synthetic
scenario. Inspect budgets, unresolved purchases, source recipients and unpaid
obligations. Edit the amount or supplied balance and assess again. Every edit
invalidates the previous displayed result. Advanced users can replace the JSON.

Assessment runs locally. The workspace connects no wallet, submits no payment,
calls no model/RPC, and writes no browser storage. Downloads happen only when
requested. A synthetic `serving: "model"` or `evidenceReview: "approved"` label
is a demonstration input, not evidence of an actual model or reviewer.

Possible assessments:

| Assessment | Meaning |
| --- | --- |
| `within-supplied-policy` | The submitted proposal fits the supplied observations |
| `hold` | A cap, identity, freshness, liquidity or review condition failed |
| `skip` | The supplied recommendation is SKIP |
| `review` | The supplied recommendation requests owner review |

All results return `executionAuthorized: false`. Even a fitting proposal does
not prove the supplied books are true, the creator owns its recipient, or any
money has settled. Question, content, source, payee, amount, rationale, policy
and observed books enter the decision/purchase bindings. No decision hash proves
answer quality by itself.

The assessment requires complete books no older than 30 seconds, explicit task
and category counters, exact decimal amounts with at most six fractional digits,
and a source-to-recipient mapping. A missing counter is unknown, not zero.

Every open or unknown obligation contributes to the reserve regardless of due
date. The desired protected reserve is the larger of the supplied reserve floor
and unpaid obligations plus a 10% buffer, rounded up to one micro-USDC. Cash must
cover that reserve, unresolved exposure and the proposed purchase together.
An obligation becomes excluded only when its supplied state says `settled`;
the compiler does not independently verify that assertion.

## Use the same assessment with an agent

From a repository checkout:

```powershell
node --import tsx scripts/research-mandate.mts --example
node --import tsx scripts/research-mandate.mts --input policy.json
node --import tsx scripts/research-mandate.mts --mcp
```

`--example` prints synthetic JSON. Save it as a UTF-8 file, update all policy and
book observations, and use `--input`. CLI inputs must be regular JSON files up
to 64 KiB. Neither assessment nor stdio MCP loads `.env.local` or needs keys.
No outputs are saved automatically. The stdio command exposes only
`research_mandate_assess` and `research_mandate_example`.

On an accepted deployed release:

```bash
curl https://keryx.cc/api/research/mandates
curl -X POST https://keryx.cc/api/research/mandates \
  -H 'Content-Type: application/json' --data-binary @policy.json
```

GET returns discovery and a fresh synthetic template. POST is a stateless,
no-store, size-bounded assessment. It requires JSON and refuses a foreign Origin
when that header is present. It provides no authenticated wallet/book access.
Use a trusted deployment when sending private policy data; the browser workbench
can assess the same data without sending it to a server.

Remote MCP: `https://keryx.cc/api/research/mandates/mcp`. This dedicated, stateless,
JSON-only endpoint supports standard MCP initialize, tools/list and tools/call.
It has the same two tools as the local stdio command. It is separate from the
existing research `/mcp` server and the published Keryx MCP package. Do not assume
the new tools already exist in those distributions.

Suggested agent instruction:

> Generate or validate a Research Mandate input, then call
> `research_mandate_assess`. Treat the result as an assessment of supplied data,
> never a payment permission. Preserve open, overdue and unknown obligations.
> On hold/review, stop and explain the reason. Do not replace a pending original,
> sign calldata, send funds, or claim settlement from this result.

## Contract candidate and adoption boundary

`contracts/research-spending-mandate.sol` implements an optional authority for a
separately verified six-decimal USDC token. Only its immutable owner sets the
agent, limits, task/category caps and reviewed source/recipient rules. The owner
must set the actual contract reserve to reflect independently reviewed unpaid
obligations. The compiler does **not** apply or synchronize those rules on chain.
Its unsigned `prepareCalldata` is an inspection aid, not a complete deployment
or policy-installation transaction.

The candidate binds an original decision before payment. Preparation must be
mined in an earlier block. Direct ERC-20 transfer and the exact EIP3009/1271
authorization share one original allocation. Pending commitments count against
per-payment, daily, weekly, lifetime, task and category limits. Lifetime does
not reset when an owner changes rules. The weekly check uses eight UTC buckets
to conservatively cover the preceding 168 hours; it can refuse capacity for up
to an extra day instead of dropping a late-day purchase too early.

Policy changes and every pause/resume advance an epoch so old authorizations
cannot revive. Exact preparation replay retains its original nonce; changing
the tuple under that request ID refuses. Expiry/revocation can release a still
unconsumed original once, without rearming it. Settlement counters change only
after a successful direct transfer or reconciliation of token authorization
consumption. An externally settled authorization remains conservatively held
until `sync`. The owner retains an explicit withdrawal escape.

This candidate has only synthetic local-token acceptance. Actual Arc USDC domain,
EIP1271/EIP3009 behavior and vendor x402 support must be verified independently
before adoption. It does not authorize Circle Gateway deposit/signature flows,
arbitrary permits, cancellation signatures or native-gas spending. Gateway
ambiguity/timeout is never a mandate release proof. Existing journals, held
originals, private policies and co-signing limits remain authoritative.

Adoption requires independent financial review, full applicable CI, an explicit
owner-approved custody/funding/spend plan, real vendor/network compatibility
acceptance and coordinator-owned release. No new contract has been deployed or
funded as part of these source changes.

## Tiếng Việt

Vào `/mandates`, chọn VI rồi nạp tình huống giả lập. Bạn có thể sửa khoản mua,
số dư cung cấp hoặc toàn bộ JSON, kiểm tra lại và xuất chính sách/bản đánh giá
cho agent. Chỉnh sửa đầu vào sẽ xóa kết quả cũ. Việc kiểm tra chạy cục bộ trong
trình duyệt, không kết nối ví, gọi model hay gửi thanh toán.

Nghĩa vụ chưa trả và chưa rõ vẫn được giữ dự phòng, kể cả đã quá hạn. Dự phòng
bằng số lớn hơn giữa mức sàn và tổng nghĩa vụ chưa trả cộng 10%. Khoản đang
chờ phải tính vào cả tiền mặt và hạn mức. Thiếu sổ sách không được coi là không
có nghĩa vụ. Các nhãn model/đã duyệt trong ví dụ chỉ là dữ liệu giả lập.

Agent dùng API, MCP riêng hoặc các lệnh CLI ở trên. `executionAuthorized` luôn
là `false`: kết quả phù hợp với dữ liệu cung cấp chưa chứng minh số dư, quyền
nhận tiền, chất lượng câu trả lời hay thanh toán thực tế. Khi gặp `hold` hoặc
`review`, dừng và giải thích; không tự đổi tác vụ đang chờ, ký hay gửi tiền.

Hợp đồng hiện là mã ứng viên chưa triển khai. Chính sách on-chain phải do chủ
sở hữu cài đặt và đối chiếu độc lập; bộ đánh giá không tự đồng bộ nghĩa vụ lên
chuỗi. Chưa thay luồng Gateway hiện tại và chưa mở thêm quyền chi tiền.

See [engineering rationale and surface boundaries](engineering/research-mandates-2026-10-13.md).
