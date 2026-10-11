# One display formatting module

Source increment for issue
[274](https://github.com/tang-vu/keryx/issues/274). English remains the sole
shipped interface locale; this change activates no translated interface,
switcher or locale preference. It moves every page and component onto the
formatting module so that a later locale activation changes one argument rather
than ninety call sites.

## What changed

`lib/i18n/format.ts` now exports `createFormatters(locale)`, bound once per
module in the same way as `createMessages(locale)`. Pages and components call
`uiFormat.number`, `decimal`, `percent`, `usdc`, `usdcTrimmed`, `usdcVerifiable`,
`date`, `dateTime`, `time` and `instant` instead of `toFixed`,
`toLocaleString`, `toLocaleDateString`, `toLocaleTimeString` or a private
`Intl` instance.

A guard in `lib/i18n/format.test.ts` reads every non-test `.ts`/`.tsx` file
under `app/` and `components/` and fails when one of those ad-hoc calls returns.
Two deliberate exclusions remain:

- `route.ts` handlers, because API responses, receipts and exports are
  machine-readable and keep one fixed format in every locale.
- `components/keryx/ink-bleed-cursor.tsx`, whose `toFixed` builds canvas colour
  channels rather than visible text.

Formatting inside `lib/` was not migrated. It mixes machine-readable output
(receipts, Markdown, BibTeX, RIS, CSV, JSON) with a smaller amount of display
text, and separating the two needs its own review.

## Amounts

Recorded rows reach the interface as decimal USDC numbers. Every amount helper
first converts the number to its integer micro-USDC value and formats from that
integer; display rounding is half-up on the integer and the text is never
parsed back into a stored, signed or compared amount.

- `usdc(value, digits)` shows a fixed number of places with the locale's
  grouping and decimal separators. The surrounding message supplies the
  currency.
- `usdcVerifiable(value)` is used where a user checks an amount before
  authorizing or signing: the research budget in the Ask form, the session
  budget card and the spending-grant dialog. It always uses a decimal point and
  no grouping, so `1.000` and `1,000` cannot be confused between locales, and
  those messages carry the `USDC` code.
- `usdcTrimmed(value)` replaces the trailing-zero stripping in `fmtUsdc`.

Invalid, non-finite or out-of-range inputs render `Unavailable` rather than a
repaired number.

## Visible differences in English

Output is unchanged except where the previous code depended on the viewer's
browser locale or on an ambiguous numeric date:

- Dates that used the bare `toLocaleString()` family rendered in the browser's
  own locale inside an English interface. They now render in the interface
  locale with a named month (`Oct 9, 2026, 12:30 AM`), still in the rendering
  runtime's time zone.
- The ledger "last observed" notice changed from an `en-GB` numeric date to
  `Oct 9, 2026, 12:30:05 AM UTC`. It is still UTC and now says so.
- Amounts of 1,000 USDC or more in non-verification displays gain grouping.
- Percentages are produced by the locale percent formatter.

## Still open on issue 274

- A viewer time zone is not negotiated. Server-rendered dates use the server
  zone and client-rendered dates use the browser zone, as before. Showing the
  UTC value on hover is implemented only where a `<time>` element already
  existed.
- English-count plural selection in components (`count === 1 ? ".one" :
  ".other"`) still needs to move to `plural`, together with catalogue keys for
  the other plural categories.
- Display formatting inside `lib/` is not migrated (see above).
- Byte-identical exports and API responses across locales are asserted only by
  the absence of locale input on those paths; no cross-locale export test
  exists because no second locale ships.
- Signing and confirmation screens have not been reviewed by a human in
  Vietnamese or Simplified Chinese. That review belongs with the translation
  gates in issues 273 and 275.
