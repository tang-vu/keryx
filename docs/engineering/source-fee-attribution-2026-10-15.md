# Owner fee attribution on the dashboard

The October 15 production API reported 0.015 USDC in six settled operating fee
transfers, while the source leaderboard reported incomplete public allocation
evidence and null per-source fee totals. The UI rendered "Owner fee Unknown"
on every source, obscuring the distinction between settlement and attribution.

The leaderboard now explains incomplete public attribution and labels affected
rows "Not publicly attributed". A ledger read failure remains "Unavailable".
Both states link directly to Payment proof, which retains the independently
verified settled operating fee amount and transfer count. Numeric source totals
and genuine zeroes retain their existing meaning when full evidence is available.

This presentation correction does not loosen the original allocation validator,
read private/unlisted originals for public attribution, publish question history,
infer zeroes, move funds, or alter settled totals. The existing privacy and
failure-path tests remain acceptance gates. Web and the desktop web handoff share
the component; API, CLI, remote/stdio MCP, extensions and bots keep their contracts.
The existing ROOT release owner batches delivery with the public question fix.
