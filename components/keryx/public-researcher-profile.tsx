import Link from "next/link";
import type { PublicProfileSnapshot } from "@/lib/profiles/public-profile";
const money=(value:string|null)=>value===null?"Unavailable":`${BigInt(value)/BigInt(1000000)}.${(BigInt(value)%BigInt(1000000)).toString().padStart(6,"0")} USDC`;
const network=(value:string|null)=>value==="eip155:5042"?"Arc mainnet":value==="eip155:5042002"?"Arc testnet":"Network unrecorded or conflicting";
const ownership={session:"Signed in", "api-key":"Verified API key", "verified-payer":"Verified original payer", claimed:"Claimed through the original receipt", "recorded-unknown":"Recorded owner; original method unrecorded"};
export function PublicResearcherProfile({profile}:{profile:PublicProfileSnapshot}){
  return <main className="mx-auto max-w-[900px] px-4 py-10 sm:px-8">
    <header className="min-w-0 space-y-3"><p className="font-mono text-sm break-all">@{profile.handle}</p>
      <h1 className="font-display text-3xl break-words">{profile.displayName||profile.handle}</h1>
      {profile.about&&<p className="font-serif break-words">{profile.about}</p>}
      {profile.purpose&&<p className="break-words"><strong>Research purpose:</strong> {profile.purpose}</p>}
      <p className="text-sm text-ink-3">Published by the signed wallet that controls this handle. Profile text is an owner assertion, not verified affiliation.</p>
      {profile.verifiedLinks&&<ul className="space-y-2">{profile.verifiedLinks.map(link=><li key={link.provider}><a className="break-all underline" href={link.url} rel="noopener noreferrer nofollow">{link.provider}: {link.label}</a> <span className="text-xs">Verified account link</span></li>)}</ul>}
      <Link className="underline" href={`/api/u/${profile.handle}`}>Profile JSON</Link>
    </header>
    {profile.ledgers&&<section className="mt-8 border-t border-line pt-5" aria-labelledby="profile-ledgers"><h2 id="profile-ledgers" className="font-serif text-xl">Recorded settled creator payments</h2>
      <p className="mt-2 text-sm text-ink-3">Wallet-wide totals, explicitly published by this owner. Includes amounts without exposing private run identifiers. Pending and simulated payments are excluded. These are stored settlement records, not a new chain reconciliation.</p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">{profile.ledgers.map(row=><div key={row.network} className="min-w-0 border border-line p-4"><h3 className="font-semibold">{network(row.network)}</h3><dl className="mt-3 space-y-3">
        {([["Paid to creators as reader",row.readerPaidMicros],["Earned as creator (recorded payee)",row.creatorEarnedMicros],["Treasury-sponsored creator payments",row.sponsoredCreatorPaymentsMicros]] as const).map(([label,value])=><div key={label}><dt className="text-sm">{label}</dt><dd className="font-mono text-sm break-all">{money(value)}</dd></div>)}</dl></div>)}</div>
    </section>}
    <section className="mt-8 border-t border-line pt-5" aria-labelledby="profile-runs"><h2 id="profile-runs" className="font-serif text-xl">Selected public research</h2>
      <p className="mt-2 text-sm text-ink-3">Only selected, currently PUBLIC runs with an existing ownership proof appear. Private, unlisted and erased runs are omitted.</p>
      {!profile.runs.length&&<p className="mt-4">No selected public runs.</p>}
      <ol className="mt-4 space-y-6">{profile.runs.map(run=><li key={run.id} className="min-w-0 border border-line p-4"><article>
        <h3 className="font-serif text-lg break-words"><Link className="underline" href={run.reportPath}>{run.question}</Link></h3>
        <p className="mt-2 text-sm"><time dateTime={run.createdAt}>{run.createdAt}</time></p>
        <p className="text-sm break-words">{network(run.network)} · {run.surface} · {run.funding==="sponsored"?"Treasury sponsored":run.funding==="sponsorship-recorded"?"Recorded sponsorship; treasury payer unproved":run.funding==="simulation"?"Offline simulation":run.funding==="reader-funded"?"Recorded reader funding":"Funding unrecorded"}</p>
        <p className="text-sm">Ownership: {ownership[run.ownership]}</p>
        <ul className="mt-3 text-sm space-y-1">{run.citations.map((citation,index)=><li key={`${citation.marker}-${index}`} className="break-words">{citation.marker} {citation.itemUrl?<a className="underline break-all" href={citation.itemUrl} rel="noopener noreferrer">{citation.sourceName}</a>:citation.sourceName}</li>)}</ul>
        <div className="mt-3 flex flex-wrap gap-4 text-sm"><Link className="underline" href={run.reportPath}>Report</Link><Link className="underline" href={run.receiptsPath}>Stored receipts</Link></div>
      </article></li>)}</ol>
    </section>
  </main>;
}
