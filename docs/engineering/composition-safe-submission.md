# Composition-safe keyboard submission

The follow-up question and feed-check forms must leave Enter to the input method
while `KeyboardEvent.isComposing` is true. Previously, the follow-up form accepted
Ctrl/Command+Enter and the feed form accepted Enter without this check. The first
could navigate to an automatic research handoff with an unfinished question; the
second could send an unfinished feed URL to `/api/wanted/match`.

All three submission handlers, including the primary question composer, now
check both `isComposing` and the IME key code `229`. The latter is needed at
composition boundaries: `compositionstart` can follow keydown, or
`compositionend` can precede it, leaving `isComposing` false for an IME event.
This narrow use of the deprecated key code follows the
[MDN keydown guidance](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event#keydown_events_with_ime).

A non-composing submission shortcut prevents its default action before
submitting. Plain Enter in the question textareas still inserts a newline. Text,
buttons, existing limits and completed submission payloads remain unchanged.

The follow-up still hands off `q`, `parent` and `run=1` to the main composer. Its
existing 500-character automatic-link limit, availability, publication identity,
session/budget admission, signing and settlement checks retain their authority.
The feed preview retains its existing request bounds and gap identity; it grants
no purchase or payout authority.

`lib/composition-safe-submission-browser.test.ts` mounts the real components and
uses native composing and IME-boundary keyboard events in Chromium and WebKit. It
proves that an active composition or IME boundary causes neither question
submission, navigation intent nor a feed request, then checks completed
shortcuts, Unicode text, default actions, plain newlines, blank guards, buttons,
retained payload identity and the primary composer's budget/publication context.
Navigation and HTTP are synthetic;
the tests start no research, model, signing or payment operation.

This changes web input handling only. API, desktop, CLI, MCP, extension and bot
contracts remain unchanged. Source acceptance does not authorize deployment or
release.
