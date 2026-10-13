import Link from "next/link";
import { createMessages } from "@/lib/i18n/messages";
import { archiveLanguagePath } from "@/lib/answers-language";

const copy = createMessages("en");
const names = new Intl.DisplayNames("en", { type: "language" });

export function ArchiveLanguageFilter({ languages, selected }: {
  languages: Array<{ language: string; count: number }>; selected: string | null;
}) {
  return <div className="mt-6">
    <nav aria-label={copy("archiveLanguage.label")} className="flex flex-wrap gap-2 text-sm">
      <Link href="/answers" aria-current={selected === null ? "page" : undefined} className="text-seal underline underline-offset-4">
        {copy("archiveLanguage.all")}
      </Link>
      {languages.map(({ language, count }) => <Link key={language} href={archiveLanguagePath(1, language)}
        hrefLang="en" aria-current={selected === language ? "page" : undefined} className="text-seal underline underline-offset-4">
        {copy("archiveLanguage.option", { language: language === "und" ? copy("archiveLanguage.undetermined") : names.of(language) ?? language, count })}
      </Link>)}
    </nav>
    <p className="mt-2 text-xs text-ink-3">{copy("archiveLanguage.notice")}</p>
  </div>;
}
