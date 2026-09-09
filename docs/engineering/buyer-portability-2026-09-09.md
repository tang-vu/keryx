# Buyer verification portability — September 9, 2026

The browser checkout design requires the same payment refusals and original-request
verification as the CLI. This internal foundation separates runtime-specific work
from shared policy without enabling a browser purchase flow.

## Boundaries

- `buyer/protocol.ts`: request/challenge/authorization schemas, checked requirements,
  typed data and the structural intent envelope. Header decoding is bounded and uses
  UTF-8/base64 primitives. Invalid request and authorization-time inputs fail closed.
- `a2a/order-identity.ts`: the exact existing v2 order hash preimage. Node hashes it
  synchronously; the browser uses Web Crypto. Payer/payee/nonce casing rules stay intact.
- `a2a/research-package-definition.ts`: package definitions and existing fingerprint
  serialization. Server computation and the synchronous fingerprint API remain available
  through their original module. Result checks resolve the journal's recorded version.
- `buyer/result-binding.ts`: matching the job, package, price, question, answer and
  creator cap. Hash verification is separate and mandatory in each complete verifier.
- `buyer/browser-policy.ts` and `buyer/browser-result.ts`: Web Crypto adapters,
  payment-header encoding and journal/full-result verification. They contain no signer
  callback, network request, filesystem journal or Keryx server configuration.

Existing CLI imports and journal formats remain supported. The browser module's ability
to validate an imported intent does not authorize a payment: the upcoming storage and
orchestration layer must keep imports recovery-only and commit the submission boundary
before a signed POST. No automatic funding or replay is added by this change.

## Verification

79 tests passed across buyer, package, order-ID and receipt suites. Tests preserve
pre-refactor ID and Quick/Deep fingerprint vectors, EIP-712 domain/validity/value,
UTF-8 header bytes and Node/browser results. Changed job economics, package contracts,
rehashed receipts for another request, simulated/out-of-cap settlement, malformed
headers and signature-bearing imported intents are refused. TypeScript and focused
ESLint passed.

Registry lookup also rejects inherited object property names such as `constructor`
and `__proto__`, which are not registered package versions. The former lookup used
object-property truthiness; the shared definition now checks own registered keys.

An esbuild browser bundle compiled with 24 source modules and no server config,
filesystem journal or Node polyfills. Chromium validated an archived owner-operated
pilot-7 journal and full receipt with the same result as Node. Changing the original
question was refused. The browser test ran in an intercepted HTTPS context and sent
neither the private receipt nor a payment to an external service. This is compatibility
evidence, not an independent buyer, a new paid pilot or a completed checkout journey.

Next: transactional browser journals, one-shot submission and GET-only recovery,
then wallet funding/signing UI and complete interruption/concurrency acceptance.
