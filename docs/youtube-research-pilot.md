# YouTube idea research pilot

The owner selected this niche on October 1, 2026. The intended outcome is an actionable
video production brief, not guaranteed virality. Channel topic, language, target audience,
Shorts/long-form format, production constraints and reference channels are still open.
Independent use, purchases and resulting video performance have not been demonstrated.

## Existing alternatives and hypothesis

This is not an empty category. [vidIQ Outliers](https://support.vidiq.com/en/articles/9660010-outliers)
already exposes outperforming videos and routes users to idea development. [TubeBuddy
Search Explorer](https://www.tubebuddy.com/tools/search-explorer/) supports keyword research.
Ask what the participant already uses and compare against that actual workflow; do not
assume a general AI agent or manual browsing is their only alternative.

The proposed differentiation is a source-backed, production-ready brief shaped to the
creator's constraints, potentially incorporating legitimately available specialist
information. This is an inference to test, not a demonstrated advantage over those
tools. More title generation or a fabricated trend score cannot validate it. If the
participant's unmet need is only keyword/outlier lookup, record that existing tools
may solve it better and reconsider the niche rather than building a clone.

## First deliverable

Ask the participant for a channel or planned channel, audience, one production decision,
available time/resources and three reference channels if possible. A first brief should
contain three candidate ideas and one participant-selected idea expanded into:

- Audience need and concrete viewer promise.
- Original angle and why it fits this creator's actual capabilities.
- Reference video URLs, channel names, format and publication dates when observed.
- Any observed public view counts with capture time, source and unknowns retained.
- Three honest title options, an opening hook and a thumbnail concept.
- Outline, primary sources for factual claims and assets/permissions needed.
- Production effort, unresolved questions and why the creator chose or rejected it.

Titles/hooks/thumbnail concepts are proposals, not observed performance. Do not copy a
competitor's script or imply permission to reuse their media. View counts alone cannot
establish causation or predict success on a different channel. Compare similar formats,
publication periods and channel context where evidence permits; otherwise state the
comparison's limit. A single capture cannot establish recent growth velocity.

## Data boundaries

Keryx's current registered corpus is not a demonstrated YouTube trend database. Browsing
its catalogue is a relevance check; search misses do not establish global absence. If
it cannot support the task, record that mismatch and do not sell a generic answer as
YouTube intelligence. External web research can help prepare an assisted reference brief,
but identify it separately from actual Keryx tool output.

An October 1 read-only public catalogue check returned 21 listed sources with no next
page. Names/descriptions/tags did not establish a dedicated YouTube research provider.
This is a point-in-time metadata observation, not a full-content audit or a conclusion
that every YouTube-related question is unanswerable. The first pilot needs to establish
an appropriate data source; generic existing corpus coverage is not sufficient evidence.

Public video metadata and available view counts can come from observed public pages or
the documented [YouTube Data API video resource](https://developers.google.com/youtube/v3/docs/videos).
No API credentials, connector, scraping pipeline or live research call is added by this
pilot document. An API-key setup or paid provider needs a separately reviewed scope.

Do not infer competitor CTR, retention, revenue or traffic sources from public views.
The participant may voluntarily supply their own authorized Studio analytics privately;
do not ask for their login or publish the export. [YouTube Analytics](https://support.google.com/youtube/answer/9002587)
provides creator performance measurements. YouTube explains why even strong CTR and
view duration do not guarantee wider reach in [its CTR guidance](https://support.google.com/youtube/answer/16767369).

## Acceptance and learning

The first success criterion is a creator choosing a supported brief for actual production.
Track manual assistance, time including verification, erroneous references, missing
evidence and rejected ideas. Ask if the creator returns with another production task.
Publishing and later performance are separate observations; record comparable age/format
and acquisition context where available. Never attribute a video's success to Keryx
without a defensible comparison. A useful brief is not proof of viral uplift.

The infrastructure experiment remains open. Potential specialized data/knowledge sellers
are hypotheses, not existing partners. YouTube creators using research are buyers; that
does not automatically make them publishers willing to sell information to agents.

## Prompt addition

After the [general pilot prompt](./pilot-agent-prompt.md), add:

```text
My task is to choose a YouTube video idea for a real channel. Ask for topic, language,
audience, format, production constraints and reference channels. Do not choose these
on my behalf if they are missing.

Propose three ideas, then expand my selected idea into a production brief: audience
promise, original angle, observed reference URLs/dates/public views with capture times,
three title options, hook, thumbnail concept, outline and factual sources. Separate
observations, calculations and creative suggestions. Do not promise virality or invent
competitor CTR, retention, revenue, growth rates or data you could not access.

If Keryx has no suitable evidence, report that. Do not substitute external research
while claiming Keryx provided it. Any separately authorized external research belongs
in a labeled assisted-reference section. Let me reject ideas and record the reason.
```
