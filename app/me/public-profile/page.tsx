import type { Metadata } from "next";
import Link from "next/link";
import { publicProfileCopy as copy } from "@/locales/en/public-profiles";
import { SiteHeader } from "@/components/keryx/site-header";
import { PublicProfileEditor } from "./public-profile-editor";
import { UiText } from "@/lib/i18n/ui-copy";


export const metadata:Metadata={title:copy.title,robots:{index:false,follow:false}};
export default function Page(){return <><SiteHeader/><main className="mx-auto max-w-[820px] px-4 py-10 sm:px-8">
  <h1 className="font-serif text-2xl"><UiText source={copy.title} namespaces={["public-profiles"]} /></h1>
  <p className="mt-3"><UiText source={copy.introduction} namespaces={["public-profiles"]} /></p>
  <p className="mt-3"><Link className="underline" href="/me/profile"><UiText source={copy.editPrivate} namespaces={["public-profiles"]} /></Link> · <Link className="underline" href="/me/run-privacy"><UiText source={copy.manageVisibility} namespaces={["public-profiles"]} /></Link></p>
  <PublicProfileEditor/>
</main></>;}
