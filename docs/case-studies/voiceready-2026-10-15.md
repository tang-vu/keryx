# A builder returned: Keryx in the VoiceReady workflow

[Watch the 2:23 English recording](https://github.com/tang-vu/keryx/releases/download/v0.27.63/0xacee-voiceready-keryx-return-20261015.mp4)
· [Recording scope and SHA-256](https://github.com/tang-vu/keryx/releases/download/v0.27.63/0xacee-voiceready-keryx-return-20261015.txt)

0xacee returned to Keryx for another software task on October 15, after the
[October 12 storage and backup session](../tameion-submission.md#recorded-outside-user-workflow-0xacee).
The owner confirmed both the participant and the additional VoiceTake/VoiceReady
project. This is another task by an existing outside user; the documented minimum
remains four people.

## The problem and the useful result

VoiceReady is a local companion for VoiceTake narration exports. It normalizes
audio and lets someone compare the original and processed files in a browser.
The documentation questions concerned FFmpeg's loudness-normalization contract
and the browser's handling of temporary audio-preview URLs.

| Step | What happened | Inspect |
| --- | --- | --- |
| Ask about normalization | The retained FFmpeg run produced no supported answer: its original read was unavailable. | [Original report](https://keryx.cc/dispatch/b48df208-76ac-4f42-94c3-beb36c2dc730) |
| Ask a narrower browser question | With the original MDN URL supplied, Keryx retained passages explaining URL revocation and when to release a reference. The report keeps its Moderate source-grounding label. | [Original report](https://keryx.cc/dispatch/c2febd88-a367-432a-8b90-4214f1f82e44) |
| Apply the evidence | The MDN passages informed review of the audio-preview lifecycle. Detaching the player and releasing URLs on replacement/clear were implemented and checked separately by an assistant. | [Retained application and measurement scope](../tameion-submission.md#return-task-from-0xacee-on-october-15) |

The companion's retained measurements show **−29.07 to −16.41 LUFS**, with the
same **153.667-second**, 48 kHz mono PCM16 duration and format. These describe
VoiceReady's processed audio, not an improvement caused or measured by Keryx.
Keryx supplied research for the browser-lifecycle review; it did not implement or
validate the companion. Human listening review and use in a finished customer
deliverable remain unconfirmed.

## What the return task establishes

This gives Keryx a concrete return-use story: an identified builder brought
another documentation problem, obtained useful passages for one part of it,
and used those passages in an implementation review. The failed FFmpeg research
stays visible alongside that useful result.

The questions used a zero-USDC source cap and sponsored model/search usage.
Their retained settlement projections record zero spend and no payment rows.
This task adds no paying customer, creator payment, testimonial or independently
accepted complete business workflow. No audio was uploaded to Keryx.

The published 2:23 English recording contains actual browser captures, shortened
waits, held views, AI narration and burned captions. It keeps both failed and
useful research outcomes. The unchanged video was published on October 15 after
owner approval; its downloaded SHA-256 matches the retained original. The
complete project/audio package remains local. The existing
[October 12 user recording](https://github.com/tang-vu/keryx/releases/download/v0.27.63/0xacee-keryx-user-workflow-20261012.mp4)
is separate supporting footage.

## Reader follow-up on October 15

A later local read at source `262fe131` fetched the FFmpeg original but returned
`html-extraction-unavailable`. Separately, extraction of the retained
1,726,689-byte original hit the reader's existing 20,000-element limit. These
observations do not establish the cause of the earlier report's
`transport-unavailable` result. The supplied `#loudnorm` fragment does not select
a section in the current reader. No limit was raised and no new research,
provider purchase or payment was started for these checks.

Fresh terminal reads of the two report URLs timed out during this follow-up.
Their current public availability is therefore unverified here; the retained
[submission record](../tameion-submission.md#return-task-from-0xacee-on-october-15)
keeps its original observation and scope.
