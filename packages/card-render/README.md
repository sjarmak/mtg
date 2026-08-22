# `@mtg/card-render`

A DSL card to a printed face, as a deterministic SVG at true 63 x 88 mm.

```ts
import { renderCardSvg, renderSet, formatFitReport } from '@mtg/card-render';

const { svg, ok, failures } = renderCardSvg(card);
const { renders, report } = renderSet(cards, { art });
console.log(formatFitReport(report));
```

Run it over a set file:

```bash
npx tsx packages/card-render/tools/render-set.ts <set.json> <out-dir> [art.json]
python3 packages/card-render/tools/check-overflow.py <out-dir>
```

Add `--symbols original` to any run whose files leave this machine; see
[Fonts and symbols](#fonts-and-symbols-what-is-bundled-nothing).

The files it writes pin the light theme, because their next stop is usually a
printer and `auto` would hand that decision to whichever viewer opens them. Pass
`--theme auto` to get the renderer's own default back, or `--theme dark` to pin
the other one.

For files that will actually be printed and cut, add `--bleed` (bare for the
standard 3 mm, or `--bleed 5` to state one):

```bash
npx tsx packages/card-render/tools/render-set.ts set.json out --bleed
```

## Printing and cutting

Two measurements exist only because somebody has to cut the card out, and a hand
cut lands within about half a millimeter of where it was aimed.

**Bleed** answers a cut that falls _outside_ the trim. The ground is a rounded
rectangle drawn exactly on the trim, so the four corners of the sheet carry no
ink at all; without bleed, a drifting cut leaves a white nick at each corner and
a white hairline down one edge. With it, the document grows on every side, the
viewBox origin goes negative to pay for the extra room, and a square of the
card's own ground covers the whole thing behind everything else. Square is the
point: the rounded corner is something the knife makes, not something the
printer draws. Every region keeps the coordinates it had at zero bleed, so the
space a designer reasons in is still distance from the corner of the card.

Trim marks are hairlines running outward from each trim corner into the margin
the cut removes. They stop short of the corner itself, so no cut can leave one
on the finished card.

**The identity ring** answers a cut that falls _inside_ it. The ring used to sit
0.7 mm in at 0.5 mm wide, occupying the band 0.45–0.95 mm from the edge, which a
routine miss cut straight through — and a border thinner down one side than the
other is something the eye catches immediately on a rectangle. It now sits
1.8 mm in, where the same miss leaves it whole and only moves the margin around
it. `CARD_GEOMETRY.ringInset` and `ringWidth` hold the numbers, in the geometry
rather than in `frame.ts`, because they are a print decision and not a drawing
one.

## Why SVG

Diffable (a re-render of an unchanged set is a zero-line diff), testable (the
emitted file answers "does this text fit" with no rasterizer), printable at true
size, and free of any native dependency — which matters for something that runs
in CI on every set revision.

## The three things that are easy to get wrong

**Text is measured, not guessed.** SVG does not wrap text, so the renderer
breaks lines itself and picks the largest size at which the block fits its box.
`src/text/metrics-data.ts` is a generated per-character advance-width table, and
it is a per-character _maximum_ across two reference serif faces rather than an
average. On top of that sits `DEFAULT_WIDTH_SAFETY` (1.08) and, as the hard
guarantee, a committed `textLength` with `lengthAdjust="spacing"` on every run —
so a viewer whose font is wider than anything the table saw tightens the
tracking instead of spilling out of the box.

**Art is a registry, never an import.** `the prior-project reuse audit`
names the anti-pattern: a component with ~120 hand-written static asset imports,
one line per card. Here art arrives as a validated manifest keyed by card id and
the renderer takes a resolver function. Nothing in this package imports an
image, and adding art to a set changes a JSON file. A card with no entry renders
the pending frame with `@mtg/ui`'s exact `ART_PENDING_LABEL` and the card's own
id, so a contact sheet of a set in progress is self-describing.

**No color is chosen here.** `@mtg/ui`'s `styles/tokens.ts` is the lab's only
palette. This package embeds `TOKEN_CSS` verbatim and paints through
`var(--mtg-*)`, so a card in a print sheet and a card in the web board are the
same seven frames by construction.

## Fonts and symbols: what is bundled (nothing)

**No font file is bundled, and no symbol artwork is copied into this tree.**

Two different things draw a mana symbol here, and an earlier version of this
section conflated them.

**The cost line** is drawn as paths (`src/pips.ts`, from `@mtg/ui`'s
`card/anatomy.ts`): original shapes on the categories each color has always used
— a sun, a drop, a crescent, a flame, a leaf, a cut stone. Set symbols are drawn
too; the rarity seal is a circle, a diamond or a star.

**The rules box** resolves its brace tokens through a registry
(`@mtg/ui`'s `card/symbols.ts`) rather than through an import, and ships two
sets. `scryfall` **references** Scryfall's hosted SVG by URL — nothing is
downloaded, vendored, traced or redistributed — and is the default, because the
lab is a private non-commercial workbench. `original` is the drawing above plus
a lettered disc for `{T}`, `{X}` and a generic amount, and it is what
`tools/render-set.ts --symbols original` publishes: a file that references no
third-party artwork and names no other host.

That split is the correction. This section used to claim the symbols were
original paths _citing_ `docs/research/prior-art-data-sources.md` §5.2 and §5.4,
which is backwards: §5.4's own line is "mana/set symbols from Mana + Keyrune OFL
fonts" and §5.2's verdict is "adopt". Adopting the research does not reverse it.
What §5.2 actually records is the layering underneath the OFL: the font file is
SIL OFL 1.1 and the CSS is MIT, but `andrewgioia/mana`'s own README disclaims
the _glyph designs_ as Wizards' copyright, and Scryfall says the same of its
SVGs — a font license covers the file and grants nothing about what the glyph
depicts. §5.4 records the CardConjurer cease-and-desist (2022-11-03), whose
leading item was the mana symbols. So neither font is a route to shipping the
artwork, which is why the swap layer exists instead: reference it or draw our
own, and never hold a copy either way.

Text is set in the CSS font stacks `@mtg/ui` already declares
(`--mtg-font-card`, `--mtg-font-ui`), which name families and bundle nothing.
Beleren is deliberately absent: it is WotC-proprietary and the community norm of
shipping extracted copies is exactly what §5.3 tells us not to do.

The advance-width table is _measured from_ two locally installed free faces —
DejaVu Serif (Bitstream Vera License plus public-domain additions) and
Liberation Serif (SIL OFL 1.1). Numbers are copied, not glyphs; regenerate with:

```bash
python3 packages/card-render/tools/measure-font-metrics.py
python3 packages/card-render/tools/measure-font-metrics.py --bold-report
```

## Frame provenance

The frame geometry is original (`src/geometry.ts`, `src/frame.ts`). It borrows
the arrangement every trading card has used for ninety years — title bar, art
window, type bar, rules box, corner stat badge — and none of Wizards' artwork.
No frame asset is copied, traced, or measured off a scan (ADR-0001 §5.6).

Frames vary by color identity through `@mtg/ui`'s `cardColorIdentity`, so a
card is never blue in the browser and gold on paper. Multicolor is not just the
gold identity: the border ring carries a gradient across the card's actual
colors, so a UR card reads as blue-red in a draft pile. Artifacts overlay a
plate hatch, and an artifact creature carries its color identity _and_ the
hatch, which is the honest rendering of a card that is both.

## Known constraints

- **CSS custom properties are required.** Painting through `var(--mtg-*)` is
  what keeps the palette single-sourced; the cost is that a rasterizer without
  custom-property support paints the frame with the initial `fill`. Browsers
  (including headless Chromium for PDF and PNG) are fine. A duplicated palette
  would drift; a missing rasterizer feature is this paragraph.
- **The embedded token sheet is about 8 KB per file.** Pass
  `{ embedStyles: false }` when inlining into a page that already renders
  `GlobalStyles`.
- **The overflow guarantee is about the pieces a line is made of.**
  `checkSvgOverflow` re-derives every text run's rectangle from the emitted
  markup, and every drawn symbol's box from the `data-sym-*` the symbol itself
  declares, and compares both with the region boxes the file declares. It says
  nothing about decoration, which is drawn from fixed geometry.
- **A referenced symbol is a file this package does not hold.** Under the
  default set a rules box carries `<image href="https://svgs.scryfall.io/…">`,
  so a viewer with no network draws a card with empty symbol boxes.
  `--symbols original` is the answer, and is what a published file uses anyway.
