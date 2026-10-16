import Link from "next/link";
import { aboutStory as story, aboutStoryLinks as links } from "@/locales/en/about-story";

const textLink = "inline-flex min-h-11 items-center gap-2 text-sm text-paid underline underline-offset-4 transition-colors hover:text-seal focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paid";

export function AboutResearchStory() {
  return <div lang="en">
    <section aria-labelledby="two-tolls-title" className="mx-auto max-w-[960px] px-4 py-14 sm:px-[30px] sm:py-20">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-seal">{story.distinctionLabel}</p>
      <h2 id="two-tolls-title" className="mt-3 max-w-[22ch] font-display text-3xl leading-tight sm:text-4xl">{story.distinctionTitle}</h2>
      <p className="mt-4 max-w-[65ch] font-serif text-lg leading-relaxed text-ink-2">{story.distinctionBody}</p>
      <div className="mt-8 grid border border-ink bg-paper sm:grid-cols-2">
        {[story.access, story.reward].map((step, index) => <div key={step.number} className={`p-6 sm:p-8 ${index ? "border-t border-ink sm:border-l sm:border-t-0" : ""}`}>
          <div className="flex items-center justify-between gap-4">
            <span className="font-mono text-[11px] tracking-widest text-paid">{step.label}</span>
            <span aria-hidden="true" className="font-display text-4xl italic text-seal/65">{step.number}</span>
          </div>
          <h3 className="mt-4 font-display text-2xl">{step.title}</h3>
          <p className="mt-3 font-serif leading-relaxed text-ink-2">{step.body}</p>
        </div>)}
      </div>
      <p className="mt-4 max-w-[78ch] font-serif text-sm leading-relaxed text-ink-3">{story.budgetNote}</p>
    </section>

    <section id="in-practice" aria-labelledby="practice-title" className="scroll-mt-24 border-y border-ink bg-panel">
      <div className="mx-auto max-w-[960px] px-4 py-12 sm:px-[30px] sm:py-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-seal">{story.practiceLabel}</p>
        <h2 id="practice-title" className="mt-3 max-w-[24ch] font-display text-3xl leading-tight sm:text-4xl">{story.practiceTitle}</h2>
        <p className="mt-4 max-w-[68ch] font-serif text-lg leading-relaxed text-ink-2">{story.practiceIntroduction}</p>
        <div className="mt-8 grid gap-8 md:grid-cols-[1.1fr_1fr]">
          <figure className="min-w-0">
            <a href={links.returnVideo} aria-label={story.videoLabel} className="group relative flex aspect-video w-full flex-col justify-between overflow-hidden border border-ink bg-ink p-6 text-paper transition-colors hover:bg-paid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paid sm:p-8">
              <span className="font-mono text-[10px] tracking-[0.16em] text-paper/70">{story.videoSeries}</span>
              <span aria-hidden="true" className="absolute right-6 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full border border-paper/50 transition-transform group-hover:scale-110">
                <svg viewBox="0 0 24 24" className="ml-1 size-5 fill-current"><path d="m8 5 11 7-11 7z" /></svg>
              </span>
              <span className="pr-14">
                <span className="block font-display text-4xl leading-tight">{story.videoProject}</span>
                <span className="mt-3 block font-mono text-[10px] tracking-[0.16em] text-paper/70">{story.videoDuration}</span>
              </span>
            </a>
            <figcaption className="mt-3 font-serif text-sm leading-relaxed text-ink-3">{story.videoCaption}</figcaption>
            <a href={links.returnVideo} className={textLink}>{story.videoLabel}<span aria-hidden="true">↗</span></a>
          </figure>
          <ol className="min-w-0 space-y-6">
            {story.storySteps.map(step => <li key={step.label}>
              <h3 className="font-mono text-[11px] tracking-widest text-paid">{step.label}</h3>
              <p className="mt-2 font-serif leading-relaxed text-ink-2">{step.body}</p>
            </li>)}
          </ol>
        </div>
        <div className="mt-5 flex flex-wrap gap-x-6">
          <Link href={links.report} prefetch={false} className={textLink}>{story.report}<span aria-hidden="true">→</span></Link>
          <a href={links.caseStudy} className={textLink}>{story.caseStudy}<span aria-hidden="true">↗</span></a>
        </div>
        <p className="mt-4 border-t border-line pt-4 font-serif text-sm leading-relaxed text-ink-3">{story.storyScope}</p>
      </div>
    </section>

    <section aria-labelledby="inspect-story-title" className="mx-auto max-w-[960px] px-4 py-14 sm:px-[30px] sm:py-20">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-seal">{story.inspectLabel}</p>
      <h2 id="inspect-story-title" className="mt-3 font-display text-3xl leading-tight sm:text-4xl">{story.inspectTitle}</h2>
      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        {story.inspect.map(item => <div key={item.href} className="flex min-w-0 flex-col border-t-2 border-paid pt-5">
          <h3 className="font-display text-xl">{item.title}</h3>
          <p className="mb-4 mt-3 font-serif leading-relaxed text-ink-2">{item.body}</p>
          <Link href={item.href} prefetch={false} className={`${textLink} mt-auto`}>{item.action}<span aria-hidden="true">→</span></Link>
        </div>)}
      </div>
    </section>
  </div>;
}
