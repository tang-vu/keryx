# Owner-operated browser pilot — September 9, 2026

The public v0.22.24 release (`5b1801e`) completed a fresh-wallet browser funding,
purchase and reload-recovery pilot. This was owner-operated on Arc testnet, with
first-party engineering sources. The signer was a constrained local EIP-1193 bridge,
not an independently operated wallet extension or an external customer.

Private keys stayed in ignored environment files and Node memory. The bridge allowed
only exact 0.05-USDC approval/deposit calls to the pinned Arc-testnet contracts and one
reviewed 0.05-USDC research authorization. Signed transaction/authorization records,
browser profile, original intents and receipts remain private; no bearer job ID is
published here.

## Observed journey

1. A new EOA received 0.1 testnet USDC from the existing owner-controlled buyer wallet.
   The older wallet's Gateway was not refilled while its earlier authorization remained
   unresolved. The top-up was journaled before broadcast and confirmed on chain.
2. The production UI separately approved and deposited 0.05 USDC into the new EOA's
   own Gateway balance. Both original transactions succeeded.
3. The bridge deliberately lost the deposit response after broadcast. After reload,
   the original hash recovered the saved deposit by matching its nonce and call. The
   successful recovery run issued zero additional funding requests; the UI displayed
   0.05 USDC available credit.
4. The browser downloaded the original intent, signed once and sent one signed POST.
   Its journal retained a validated seller-relayed payment acknowledgement with HTTP
   202. This acknowledgement is seller-relayed evidence, not independent verification.
5. Reload and saved-job recovery completed without another payment. The browser
   verified the receipt against the original question and downloaded it. The Node
   verifier and, after the entrypoint fix below, the actual CLI `resume` command also
   verified the original-request binding and receipt integrity.

Receipt digest retained separately:
`sha256:4ff5b7d8768dd13e438ce6a44cc0a0c9bd7bd4e673c4a78d7b1122b0197cc6e4`.

## Accounting and research evidence

| Observed field | Result |
| --- | --- |
| Package price | 0.05 testnet USDC |
| Service fee / creator budget | 0.02 / 0.03 USDC |
| Recorded settled creator spend | 0.015 USDC, one citation reward to a first-party creator |
| Recorded pending / simulated spend | 0 / 0 USDC |
| Recorded access spend | 0 USDC |
| Unused creator reserve | 0.015 USDC, retained under the fixed-price policy; not a refund |
| Source decisions | 2 CACHE, 19 SKIP |
| Claim coverage | 0.9 and 0.9; two grounded claims |
| Confidence | Moderate; limited independent corroboration |
| Evidence yield | 0.5; one selected read did not qualify as final evidence |

The receipt identifies a real-mode, complete Keryx ledger snapshot with Circle
settlement evidence for the creator reward. Circle transfer references are not
individual Arc transaction hashes. Receipt integrity and request binding do not
independently establish every ledger assertion. API/model, support and fixed costs
were not reconciled here; these numbers are not realized mainnet profit.

## Defects found and fixed in v0.22.25

- Credit lookup could appear enabled after the address appeared but before the wallet
  client was ready; clicking then silently returned. It now waits for the wallet
  client. The Chromium regression explicitly renders that intermediate state.
- The native `.mts` buyer CLI could not import `BuyerRefusal` through the `.ts` policy
  re-export. Importing from the defining protocol module fixes startup. CI now runs
  the real CLI `--help`, alongside bundled unit tests. Actual `resume` returned
  completed with verified integrity and original-request binding after the fix.
- The pilot harness itself needed reconnect-race handling, Ethereum address-case
  normalization and correction of a mistyped payee pin. Those unsigned attempts were
  refused before signing/POST and their original intents were retained. They are not
  extra paid jobs or product traction.

The portable intent currently excludes the later payment acknowledgement. Accordingly,
CLI recovery from that file reported payment acknowledgement as unconfirmed while
still verifying the completed job and creator receipt. The browser retained its own
HTTP-202 acknowledgement. A fuller portable recovery bundle remains product work;
do not silently invent missing acknowledgement evidence.

## Remaining acceptance

This advances B1's owner-operated browser runtime evidence. Independent wallet/mobile
handoff, replaced/cancelled transaction recovery, lost browser storage, authenticated
server history, external creator/customer cohorts and independent mainnet review
remain open. One paid internal-document question does not prove broad research quality,
customer demand or a complete ecosystem.
