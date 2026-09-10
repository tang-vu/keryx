# Private buyer recovery

The recovery command reads an existing `keryx-private-buyer-intent-v1` journal on Arc
testnet. Private checkout is still unavailable. Public buyer journals use a different
format and cannot be recovered with this command.

The internal Node preparation helper validates independently chosen quote terms and
reserves a new journal directory before requesting a payment signature. It verifies
the returned signature and durably writes the intent before returning. It is not yet
a CLI or browser checkout command and does not submit payment. Keep any directory
left by a failed preparation: even an empty or partial journal denies another fresh
attempt there. Do not delete it to automatically retry signing. Existing recovery
requires a complete, valid signed journal; a partial file does not authorize payment.

The internal submission transport reads that signed journal and persists its exclusive
attempt marker before sending to the fixed private endpoint. It never follows redirects
or retries a submission. HTTP rejection, lost responses and invalid response data all
require read recovery; a server-reported settlement status is not independent proof.
Expired authorizations are not sent. These internal helpers do not yet enable the private
purchase endpoint or expose a purchase command.

Keep the original journal directory after a timeout. Recovery validates its signature,
owner, commitment and job identity. It does not refresh the authorization or resubmit
payment, and it leaves the original intent and attempt marker unchanged.

Store the owner's `KERYX_BUYER_PRIVATE_KEY` in a local ignored environment file. Do not
put a private key in command arguments. Pin the private and public merchant addresses
from trusted operator configuration; do not copy them blindly from an imported journal.

```sh
node --env-file=.env.buyer-private.local --import tsx scripts/private-buyer-recover.mts --state ./private-job --private-payee 0x... --public-payee 0x...
```

If the key is already in the environment:

```sh
npm run buyer:private:recover -- --state ./private-job --private-payee 0x... --public-payee 0x...
```

The command signs a SIWE login for `keryx.cc` on Arc testnet, reads the authenticated
result and confirms sign-out. It never requests a payment signature, wallet creation,
deposit, approval or transfer. An unconfirmed session revocation is reported as an
error. A lost login response can leave an unknown session until its 15-minute expiry.

Default stdout is a summary of state and integer micro-USDC amounts. It omits the job
ID, question, answer, signatures and cookies. Add `--output ./private-result.json` to
write the full view after sign-out. The destination must not exist and its parent must
already exist. Output is plaintext private research, not encrypted backup. Restricted
creation modes are not a Windows ACL guarantee.

The snapshot is labelled **server-reported**. Context and accounting checks do not
independently prove chain finality, source truth or a cryptographically bound result.
Uncommitted creator budget is not a refund. A missing result or expired session never
authorizes a new payment.
