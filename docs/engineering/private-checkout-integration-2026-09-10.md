# Private checkout integration evidence — September 10, 2026

This is a local integration drill with synthetic data and an unfunded ephemeral EOA.
It is not a live payment, customer pilot, production checkout or mainnet acceptance.

## Exercised implementation

The test connects the backend quote service, independently chosen buyer price and
reasoning limits, EOA signing, exclusive durable buyer journal, single-attempt buyer
transport, backend signature admission, treasury capacity reservation, private incoming
payment persistence, and owner-scoped result recovery. It closes and reopens the SQLite
adapter before recovery. Both the journal and database contain actual implementation
records; facilitator responses and the HTTP/authentication boundary are injected.

Two failure scenarios passed:

1. The synthetic facilitator returns success, the backend persists it, and the buyer
   loses the HTTP response. Recovery reports server-recorded settled payment and awaits
   execution after the database reopens.
2. The synthetic facilitator throws during settlement and the buyer also loses the
   response. Recovery retains pending payment and awaits payment; no failure, refund,
   expiry-based release or confirmed settlement is inferred.

In each case, repeating the buyer operation sends no second request. Replaying the
original signed submission directly against the backend also makes no additional
facilitator call: the complete call sequence remains one verify and one settle attempt.
The original buyer journal is unchanged. The private job is absent from public query
and A2A order reads, and a different owner cannot obtain its private result.

The quote is 50,000 micro-USDC, with a 30,000 creator budget and 20,000 service fee.
These are synthetic test values, not receipts or revenue. Creator commitments remain
zero in this empty-corpus drill and the uncommitted budget is not a refund.

The worker extension now runs the actual private executor after persisted synthetic
success. Global fetch throws before reaching a network, exercising the local reasoning
fallback against an empty corpus. The worker saves a private result, the owner view
becomes completed, and a second tick finds no candidate. No creator signature is
requested. This tests execution and persistence wiring, not answer quality or paid
content delivery.

## Reproduction and limits

Run `npm test -- --run lib/buyer/private-checkout-integration.test.ts`.
The test forbids global fetch, uses a temporary SQLite file and journal, and removes
its own files after closing the database. TypeScript checking also passed.

The drill does not exercise the real HTTP purchase route, SIWE middleware, Circle,
external provider requests, creator purchases, browser storage, network finality, PostgreSQL
restarts or process crashes during fsync. Those require separate evidence. Private
purchasing remains unavailable; this advances the recovery evidence without completing
the buyer journey or the mainnet settlement/recovery gate.
