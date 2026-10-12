import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { PublicProfileEditor } from "./public-profile-editor";
export const metadata:Metadata={title:"Publish your research profile",robots:{index:false,follow:false}};
export default function Page(){return <><SiteHeader/><main className="mx-auto max-w-[820px] px-4 py-10 sm:px-8">
  <h1 className="font-serif text-2xl">Publish your research profile</h1>
  <p className="mt-3">Your profile stays invisible until you publish. Choose fields and run IDs; only currently PUBLIC runs with your existing ownership proof appear.</p>
  <p className="mt-3"><Link className="underline" href="/me/profile">Edit your private profile and verified accounts</Link> · <Link className="underline" href="/me/run-privacy">Manage run visibility</Link></p>
  <PublicProfileEditor/>
</main></>;}
