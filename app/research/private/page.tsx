import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { ResearchChat } from "@/components/keryx/research-chat";
import { privateDocumentBootstrap } from "@/lib/run-claims/web-bootstrap";
import { verifyPrivateDocument } from "@/lib/run-claims/web-document";
import { config } from "@/lib/config";
import { privateResearchCopy as copy } from "@/locales/en/run-claim-research";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.metadataTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function PrivateResearchPage() {
  await connection();
  const request = await headers(), nonce = request.get("x-keryx-private-nonce"), ticket = request.get("x-keryx-private-bootstrap");
  const bound = ticket && nonce && verifyPrivateDocument(ticket, { origin: config.baseUrl, network: config.networkId }, config.jwtSecret);
  return <main className="min-h-screen bg-paper-2 text-ink">
    {bound && bound.nonce === nonce && <script nonce={nonce} dangerouslySetInnerHTML={{ __html: privateDocumentBootstrap(ticket!, nonce) }} />}
    <div className="mx-auto max-w-[960px] px-4 py-6 sm:px-[30px]">
      <h1 className="font-display text-3xl">{copy.title}</h1>
      <p className="mt-3 text-sm">{copy.introduction}</p>
      <p className="mt-3 text-sm">{copy.visibility}</p>
      <p className="mt-3 text-sm">{copy.limits}</p>
      {!bound && <p role="status" className="mt-3 text-seal">{copy.unavailable}</p>}
      <a className="mt-3 inline-block underline" href="/research">{copy.ordinary}</a>
    </div>
    <ResearchChat privateClaims />
  </main>;
}
