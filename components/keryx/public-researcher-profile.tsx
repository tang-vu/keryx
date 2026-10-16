import Link from "next/link";
import { publicProfileCopy as copy } from "@/locales/en/public-profiles";
import type { PublicProfileSnapshot } from "@/lib/profiles/public-profile";
import { UiText } from "@/lib/i18n/ui-copy";


const money=(value:string|null)=>value===null?copy.amountUnavailable:`${BigInt(value)/BigInt(1000000)}.${(BigInt(value)%BigInt(1000000)).toString().padStart(6,"0")} USDC`;
const network=(value:string|null)=>value==="eip155:5042"?copy.network.mainnet:value==="eip155:5042002"?copy.network.testnet:copy.network.unknown;
const ownership=copy.ownership;
export function PublicResearcherProfile({profile}:{profile:PublicProfileSnapshot}){
  return <main className="mx-auto max-w-[900px] px-4 py-10 sm:px-8">
    <header className="min-w-0 space-y-3"><p className="font-mono text-sm break-all">@{profile.handle}</p>
      <h1 className="font-display text-3xl break-words">{profile.displayName||profile.handle}</h1>
      {profile.about&&<p className="font-serif break-words">{profile.about}</p>}
      {profile.purpose&&<p className="break-words"><strong><UiText source={copy.purposeLabel} namespaces={["public-profiles"]} /></strong> {profile.purpose}</p>}
      <p className="text-sm text-ink-3"><UiText source={copy.ownerAssertion} namespaces={["public-profiles"]} /></p>
      {profile.verifiedLinks&&<ul className="space-y-2">{profile.verifiedLinks.map(link=><li key={link.provider}><a className="break-all underline" href={link.url} rel="noopener noreferrer nofollow">{link.provider}: {link.label}</a> <span className="text-xs"><UiText source={copy.verifiedAccount} namespaces={["public-profiles"]} /></span></li>)}</ul>}
      <Link className="underline" href={`/api/u/${profile.handle}`}><UiText source={copy.json} namespaces={["public-profiles"]} /></Link>
    </header>
    {profile.ledgers&&<section className="mt-8 border-t border-line pt-5" aria-labelledby="profile-ledgers"><h2 id="profile-ledgers" className="font-serif text-xl"><UiText source={copy.ledgerTitle} namespaces={["public-profiles"]} /></h2>
      <p className="mt-2 text-sm text-ink-3"><UiText source={copy.ledgerBasis} namespaces={["public-profiles"]} /></p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">{profile.ledgers.map(row=><div key={row.network} className="min-w-0 border border-line p-4"><h3 className="font-semibold">{network(row.network)}</h3><dl className="mt-3 space-y-3">
        {([[copy.ledgerLabels.reader,row.readerPaidMicros],[copy.ledgerLabels.creator,row.creatorEarnedMicros],[copy.ledgerLabels.sponsored,row.sponsoredCreatorPaymentsMicros]] as const).map(([label,value])=><div key={label}><dt className="text-sm">{label}</dt><dd className="font-mono text-sm break-all">{money(value)}</dd></div>)}</dl></div>)}</div>
    </section>}
    <section className="mt-8 border-t border-line pt-5" aria-labelledby="profile-runs"><h2 id="profile-runs" className="font-serif text-xl"><UiText source={copy.selectedResearch} namespaces={["public-profiles"]} /></h2>
      <p className="mt-2 text-sm text-ink-3"><UiText source={copy.selectedBoundary} namespaces={["public-profiles"]} /></p>
      {!profile.runs.length&&<p className="mt-4"><UiText source={copy.emptyRuns} namespaces={["public-profiles"]} /></p>}
      <ol className="mt-4 space-y-6">{profile.runs.map(run=><li key={run.id} className="min-w-0 border border-line p-4"><article>
        <h3 className="font-serif text-lg break-words"><Link className="underline" href={run.reportPath}>{run.question}</Link></h3>
        <p className="mt-2 text-sm"><time dateTime={run.createdAt}>{run.createdAt}</time></p>
        <p className="text-sm break-words">{network(run.network)} · {run.surface} · <UiText source={run.funding==="sponsored"?copy.funding.sponsored:run.funding==="sponsorship-recorded"?copy.funding.recorded:run.funding==="simulation"?copy.funding.simulation:run.funding==="reader-funded"?copy.funding.reader:copy.funding.unknown} /></p>
        <p className="text-sm"><UiText source={copy.ownershipLabel} namespaces={["public-profiles"]} /> <UiText source={ownership[run.ownership]} /></p>
        <ul className="mt-3 text-sm space-y-1">{run.citations.map((citation,index)=><li key={`${citation.marker}-${index}`} className="break-words">{citation.marker} {citation.itemUrl?<a className="underline break-all" href={citation.itemUrl} rel="noopener noreferrer">{citation.sourceName}</a>:citation.sourceName}</li>)}</ul>
        <div className="mt-3 flex flex-wrap gap-4 text-sm"><Link className="underline" href={run.reportPath}><UiText source={copy.report} namespaces={["public-profiles"]} /></Link><Link className="underline" href={run.receiptsPath}><UiText source={copy.receipts} namespaces={["public-profiles"]} /></Link></div>
      </article></li>)}</ol>
    </section>
  </main>;
}
