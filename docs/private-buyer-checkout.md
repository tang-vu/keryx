# Private buyer checkout CLI

The client command composes temporary SIWE sign-in, independent quote validation,
exclusive durable payment journaling, one submission attempt and confirmed sign-out.
Production private purchasing is still unavailable. The client requires the quote
response to explicitly report availability. The route only reports true for a configured pilot
payer when the private purchase bootstrap's worker and backing checks pass; production flags
remain disabled. The purchase route independently repeats those checks when submitting.
No payment signature or journal is created in that case. This command does not enable
the server, provision a merchant or prove worker readiness.

Store the buyer key in an ignored environment file. Pin merchant addresses from
trusted operator configuration, not from an unverified quote. Choose the research
and reasoning policy independently in a private JSON file, for example:

```json
{
  "question": "Synthetic example: compare the evidence for two proposed designs.",
  "budget": 0.03,
  "researchMode": "quick",
  "packageVersion": "1.0.0",
  "responseMode": "async",
  "access": "payer-private-v1",
  "model": "deepseek-flash",
  "reasoning": {
    "modelId": "deepseek-flash",
    "provider": "deepseek",
    "wireModel": "deepseek-v4-flash",
    "endpoint": "https://synthetic.example/v1/chat/completions",
    "fallback": "local-heuristic",
    "redirects": "prohibited"
  }
}
```

The endpoint above is a synthetic example, not a configured service. The selected
endpoint/model must match the operator's disclosed policy. The request file is bounded
to 16 KiB; it and the journal contain private plaintext. Secure their directory and
keep them outside source control. No command auto-loads an environment file.

```sh
node --env-file=.env.buyer-private.local --import tsx --no-warnings scripts/private-buyer-checkout.mts --request ./private-request.json --state ./new-private-job --private-payee 0x... --public-payee 0x... --max-total-micros 50000 --max-fee-micros 20000
```

Amounts in the limits are integer micro-USDC: 50,000 is 0.05 USDC, including the
creator budget and service fee. The buyer enforces a maximum total of 1 USDC on Arc
testnet. Unused creator budget is retained, not refunded, and answer quality is best
effort. These terms are checked in the quote before any payment signature.

The state directory must not exist and its parent must exist. It is reserved
exclusively before signing. Once created, preserve it even after failure. A repeated
checkout with that directory fails before login or payment signing. The immutable
attempt marker is written before submission; a lost response never permits resending.
Use `buyer:private:recover` with the same wallet, state and merchant policy after an
attempt. Do not create another directory to retry the same uncertain payment.

Output contains redacted status only and does not poll for a completed answer.
`response-received` describes a validated server response, not confirmed chain finality
or a completed job. Other returned states exit nonzero, including unavailable checkout
and recovery-required. A sign-out error can occur after a submission: preserve the
journal and recover, rather than interpreting the command error as no payment.

Tests use actual unfunded EOA signatures and local journals with injected HTTP
responses. They cover unavailable checkout, changed policy, one pending response,
response loss, sign-out and refusal to reuse a state directory. They do not prove a
live purchase or complete private buyer acceptance.
