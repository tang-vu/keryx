import Link from "next/link";
import { createMessages } from "@/lib/i18n/messages";
import { archiveLanguagePath } from "@/lib/answers-language";
import { UiElement, UiMessage } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");
const names = new Intl.DisplayNames("en", { type: "language" });

export function ArchiveLanguageFilter({ languages, selected }: {
  languages: Array<{ language: string; count: number }>; selected: string | null;
}) {
  return <div className="mt-6">
    <UiElement as="nav" names={["aria-label"]} attributes={{ "aria-label": copy("archiveLanguage.label"), "className": "flex flex-wrap gap-2 text-sm" }}>
      <Link href="/answers" aria-current={selected === null ? "page" : undefined}
        className={`inline-flex min-h-11 items-center border px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal ${selected === null ? "border-paid bg-paid/10 text-paid" : "border-line bg-paper text-ink-2 hover:border-seal hover:text-seal"}`}>
        <UiMessage messageKey={"archiveLanguage.all"} />
      </Link>
      {languages.map(({ language, count }) => <Link key={language} href={archiveLanguagePath(1, language)}
        hrefLang="en" aria-current={selected === language ? "page" : undefined}
        className={`inline-flex min-h-11 items-center border px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal ${selected === language ? "border-paid bg-paid/10 text-paid" : "border-line bg-paper text-ink-2 hover:border-seal hover:text-seal"}`}>
        <UiMessage messageKey={"archiveLanguage.option"} values={{ language: language === "und" ? copy("archiveLanguage.undetermined") : names.of(language) ?? language, count }} />
      </Link>)}
    </UiElement>
    <p className="mt-2 text-xs text-ink-3"><UiMessage messageKey={"archiveLanguage.notice"} /></p>
  </div>;
}
