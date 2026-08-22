---
name: MTG Set Generation & Playing Lab
description: A laboratory for designing Magic sets, proving them out against simulated play, and playing the result.
colors:
  accent: "oklch(0.470 0.104 266)"
  accent-hover: "oklch(0.415 0.108 266)"
  accent-soft: "oklch(0.936 0.030 266)"
  accent-ink: "oklch(0.985 0.004 266)"
  surface-page: "oklch(0.973 0.006 85)"
  surface-raised: "oklch(0.995 0.003 85)"
  surface-sunken: "oklch(0.941 0.008 80)"
  surface-rail: "oklch(0.955 0.007 80)"
  surface-inset: "oklch(0.918 0.009 80)"
  ink: "oklch(0.24 0.014 60)"
  ink-muted: "oklch(0.460 0.013 65)"
  ink-faint: "oklch(0.66 0.010 70)"
  ink-inverse: "oklch(0.98 0.004 85)"
  line: "oklch(0.884 0.010 75)"
  line-strong: "oklch(0.795 0.013 72)"
  positive: "oklch(0.520 0.096 152)"
  negative: "oklch(0.540 0.150 27)"
  pending: "oklch(0.640 0.086 78)"
  color-w: "oklch(0.845 0.045 88)"
  color-u: "oklch(0.545 0.085 250)"
  color-b: "oklch(0.395 0.042 305)"
  color-r: "oklch(0.545 0.110 31)"
  color-g: "oklch(0.505 0.078 145)"
  color-c: "oklch(0.700 0.018 85)"
  color-m: "oklch(0.730 0.078 92)"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.01em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  card:
    fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.06em"
  figure:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tabular-nums"
rounded:
  sm: "3px"
  md: "6px"
  lg: "10px"
  card: "12px"
  pill: "999px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.5rem"
  "6": "2rem"
  "7": "3rem"
components:
  button:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.25rem 0.75rem"
    typography: "{typography.title}"
  button-hover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "0.25rem 0.75rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-ink}"
  button-pressed:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
  panel:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "1rem"
  empty:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.lg}"
    padding: "2rem 1.5rem"
  badge:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "1px 0.5rem"
    typography: "{typography.label}"
  code:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "1px 0.25rem"
  card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    typography: "{typography.card}"
  choice:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
  choice-hover:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
---

# Design System: MTG Set Generation & Playing Lab

## 1. Overview

**Creative North Star: "The Printer's Proof"**

A proof is a set laid out flat for inspection before anyone commits to printing
it. That is exactly what this lab is. Every surface here exists so a person can
look hard at something unfinished and decide whether it is right, which is why
the light palette is warm paper rather than white, why figures are set in mono
so columns align down the page, and why a card with no art draws a hatched frame
carrying its own id instead of a blank rectangle. Nothing pretends to be
finished before it is.

The system runs two vocabularies on purpose. Chrome recedes: single-pixel
outlines, five tonal surface steps doing the work that borders and shadows do
elsewhere, one accent reserved for focus, selection and the current mode. Cards
do not recede. They carry shadow, they lift on hover, and they behave like
physical objects, because on the Play and Cards routes the card *is* the thing
the person came for. On the Play route one other thing does: the mat they lie
on, which is a printed object with the zones debossed into it rather than a
container drawn around them.

This system rejects the generic SaaS dashboard, and specifically its hero-metric
tiles and gradient accents. It rejects neon-on-black gamer dark mode: the dark
palette is a soft cool gray at hue 265 and never glows. It rejects fan-site
clutter, which is the failure mode of most Magic tooling. It rejects any
resemblance to Wizards' own brand, which is IP hygiene as much as taste.

The normative source for every value below is
`packages/ui/src/styles/tokens.ts`, which declares both palettes and is guarded
by a test that fails the build on a raw hex anywhere under `src/`. Values here
are OKLCH because the project is OKLCH-only; the light palette is in the
frontmatter because it is the `:root` default, and the dark values are named
inline in Colors.

**Key Characteristics:**

- Warm paper in light, cool slate in dark. Never white, never black.
- One accent, under 10% of any screen.
- Depth from tone, not shadow, except on things that are objects.
- Figures in mono with tabular numerals; prose in the UI sans; card faces in a book serif.
- Every empty and unfinished state is labeled, never blank.

## 2. Colors

Restrained. Tinted neutrals carry the surface, one accent marks state, three
semantic hues report verdicts, and seven identity hues belong to the game rather
than to the interface.

### Primary

- **Proof Ink** (`oklch(0.470 0.104 266)`, dark `oklch(0.760 0.108 266)`): the
  only accent. Focus rings, the current mode in the segmented control, primary
  buttons, selected cards, and hover borders on controls. Nothing decorative
  ever uses it. **Proof Ink Deep** (`oklch(0.415 0.108 266)`) is the primary
  button hover; **Proof Ink Wash** (`oklch(0.936 0.030 266)`, dark
  `oklch(0.320 0.052 266)`) fills pressed toggles and hovered choices.

### Secondary

The three verdict hues. These report a measurement, never a mood, and they only
appear on badges, gate rows, and chart marks.

- **Pass Green** (`oklch(0.520 0.096 152)`, dark `oklch(0.740 0.104 152)`): a gate inside its band.
- **Fail Red** (`oklch(0.540 0.150 27)`, dark `oklch(0.712 0.140 27)`): a gate outside its band, and the concede action.
- **Withheld Amber** (`oklch(0.640 0.086 78)`, dark `oklch(0.782 0.088 78)`): under-sampled, pending, or not yet known. Explicitly not a warning.

### Tertiary

The seven color identities: W, U, B, R, G, C, M. Each declares six channels
(`--mtg-color-*`, `--mtg-color-*-on`, `--mtg-frame-*`, `--mtg-frame-*-panel`,
`--mtg-frame-*-well`, `--mtg-frame-*-edge`), and a card learns its identity from
a `data-identity` attribute. These are domain constants, not palette choices.
They are the game's colors, and no component file is permitted to name one
directly.

They are also muted, which is a domain constant too: nothing on a printed Magic
card is vivid. White is a warm bone, blue a grayed slate, black a near-neutral
purple-gray, red a brick, green a deep olive, gold a dulled ocher, colorless a
warm stone. Chroma on a light band runs 0.018 to 0.092.

A card face publishes more than its identity, because identity alone lost a
distinction the printed face was already drawing: `m` says a card is gold, not
which colors it is made of, and nothing at all said whether it was an artifact.
The face root carries the whole vocabulary (`data-identity`, `data-colors`,
`data-artifact`, `data-rarity`, `data-card-id`), written by both renderers from
one record in `card/anatomy.ts` (ADR-0002 §2.1). The letters in `data-colors`
are an encoding produced there, not a color named in a component.

### Neutral

- **Warm Paper** (`oklch(0.973 0.006 85)`, dark **Cool Slate** `oklch(0.192 0.010 265)`): the page ground.
- **Fresh Stock** (`oklch(0.995 0.003 85)`, dark `oklch(0.238 0.011 265)`): panels, cards, controls at rest. The only surface that sits above the page.
- **Trimmed Edge** (`oklch(0.941 0.008 80)`, dark `oklch(0.162 0.010 265)`): recessed ground for empty states and pressed buttons.
- **Gutter** (`oklch(0.955 0.007 80)`, dark `oklch(0.216 0.011 265)`): the sticky top bar, the one piece of chrome that is neither page nor panel.
- **Impression** (`oklch(0.918 0.009 80)`, dark `oklch(0.278 0.012 265)`): the deepest inset. Badges, code spans, the trough behind the segmented control.
- **Warm Black** (`oklch(0.24 0.014 60)`, dark `oklch(0.938 0.006 265)`): body text. Muted (`oklch(0.52 0.012 65)`) for secondary text, faint (`oklch(0.66 0.010 70)`) for labels and notes.
- **Rule** (`oklch(0.884 0.010 75)`) and **Rule Strong** (`oklch(0.795 0.013 72)`): every border in the system is one of these two, at 1px, with one exception named below.
- **Mat** (`oklch(0.906 0.012 78)`, dark `oklch(0.262 0.012 265)`), **Weave** (`oklch(0.884 0.013 78)`, dark `oklch(0.292 0.013 265)`), **Well** (`oklch(0.868 0.013 78)`, dark `oklch(0.224 0.011 265)`) and **Mat Edge** (`oklch(0.760 0.016 76)`, dark `oklch(0.380 0.014 265)`): the playmat, the thread woven through it, the zones debossed into it, and its keyline. The weave inverts between themes — a darker thread on paper, a lighter one in the dark — because a weave is read from the contrast between thread and ground. These four are declared apart from the palette above and shipped outside `TOKEN_CSS`, because `@mtg/card-render` embeds that block verbatim into every printed card file and a table means nothing inside a 63 x 88 mm card.

**The one border above 1px.** A card face carries its color identity as a 7px
printed border (5px on a battlefield thumbnail), which is the whole of how a
hand of six reads as six colors at a glance: the tint it replaces survived only
in the gutter between the face's regions, because every child repaints Fresh
Stock over it. It is a four-sided edge and never a stripe — the ban on a colored
`border-left` or `border-right` above 1px stands, and `test/polish.test.ts`
still fails the build on one. Every other border in the system is 1px.

### Named Rules

**The Tinted Neutral Rule.** No neutral is achromatic. Light neutrals sit at hue
60 to 88 with chroma 0.003 to 0.014; dark neutrals sit at hue 265. `#fff` and
`#000` are forbidden, and so is any gray with chroma 0.

**The Two-Palette Rule.** Light and dark declare identical token names. A
component that references a token only one palette defines fails
`test/tokens.test.ts`. Never add a color to one block without adding it to the
other.

**The Identity Firewall Rule.** Only `tokens.ts` and the seven generated
identity rules in `styles/card.ts` may name a Magic color. Component files carry
the face vocabulary the specification hands them and name no color themselves:
the letters in `data-identity` and `data-colors` are produced by
`card/anatomy.ts`, so no component ever types one. The permitted color-naming
sites are unchanged by that.

**The Color Is Never Alone Rule.** The five Magic colors are the primary
encoding across the card face, the identity filters, the mana base table and the
archetype charts. Every one of those must also carry a glyph, a label or a
position. A hue by itself never carries meaning.

## 3. Typography

**Display Font:** none. The system has no display face and does not want one.
**Body Font:** UI sans (`ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif`)
**Card Font:** Iowan Old Style (with Palatino, Book Antiqua, Georgia)
**Figure Font:** mono (`ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`)

**Character:** The interface speaks in the operating system's own sans, which is
how it stays out of the way. The card face speaks in a book serif, which is how
a card reads as printed matter rather than as a div. Numbers speak in mono with
tabular figures, which is how a column of rates can be scanned down rather than
read across. Three voices, each with a job, and none of them decorative.

### Hierarchy

- **Headline** (600, 1.3125rem / `--mtg-text-lg`, 1.2, -0.01em): the page title. One per route.
- **Title** (600, 0.8125rem / `--mtg-text-sm`, 0.01em): panel titles and the shell mark. Deliberately small; a panel title is a signpost, not a headline.
- **Body** (400, 0.9375rem / `--mtg-text-base`, 1.45): prose, empty-state bodies, narration. Capped at 68ch (`--mtg-measure`).
- **Card** (700 name / 600 type / 400 rules text, 0.8125rem, 1.2 to 1.45): the card face only. Never used in chrome.
- **Label** (600, 0.6875rem / `--mtg-text-xs`, 0.06em, uppercase): table headers and the shell subtitle. Uppercase only here.
- **Figure** (400, 0.8125rem, tabular-nums): every number the interface reports. Definition values, table cells, choice details, code spans.

The scale runs 0.6875 / 0.8125 / 0.9375 / 1.0625 / 1.3125 / 1.625rem, a ratio
near 1.15 to 1.24. Fixed rem, never fluid: this is read at a consistent desktop
DPI beside a terminal, and a heading that shrinks in a narrow panel looks worse,
not better.

### Named Rules

**The Tabular Figure Rule.** Any number a person might compare against another
number is set in mono with `font-variant-numeric: tabular-nums`. Rates, counts,
seeds, deltas, mana values. A number set in the sans is a number nobody intends
to be compared.

**The Serif Is The Card Rule.** `--mtg-font-card` appears on the card face and
nowhere else. A serif in the chrome would make the chrome look like a card,
which is the one confusion this system cannot afford.

**The Micro-Label Rule.** Uppercase is reserved for one role: the small
all-caps label that names a region or a column. Table headers, the shell
subtitle, zone labels, section titles, filter labels, the art-pending label and
the turn owner all qualify. It is always 0.6875rem at 600 weight in faint or
muted ink, and the tracking is **0.06em**. One label is exempt on the ink axis,
and only that one: the art-pending pill is `--mtg-pending` amber, because amber
is this system's semantic for withheld and unfinished everywhere else and the
pending slot exists to say the art is not there yet. It also sits on
`--mtg-surface-raised` inside a hatched frame, which is the one place faint ink
would disappear. Uppercase buttons, uppercase headings, uppercase body text and
uppercase card text are prohibited.

Ten selectors carry this role and all ten now track at 0.06em. Five of them
sat at 0.08em or 0.10em until `mtg-90x.3` converged them; the art-pending
label, the one case where tighter tracking might have cost legibility inside
the hatched frame, was rendered both ways before it moved. `test/polish.test.ts`
sweeps every uppercase rule in the emitted sheet, so a new selector cannot
reintroduce the drift.

All three axes have now converged, the other two under `mtg-90x.4`. On weight
the sheet said three things for one role: the art-pending pill, the zone label
and the deck section title declared 700; the turn owner, the choice-group
title, the status count label and the shell subtitle declared nothing at all
and inherited roughly 400. The replay screen showed both, drawing its zone
label at 700 beside its own turn owner at 400. All ten say 600 now, which does
quiet the three loud ones, and that is the point: a micro-label names a region,
it does not compete with it. The ink axis converged the other way, by writing
the amber down rather than deleting it, because a semantic the lab already uses
in badges, marks and tags is not a divergence to be tidied. The same sweep
asserts 600 weight and faint-or-muted ink on every uppercase rule and pins the
amber to exactly one selector, so the exception cannot spread by copy-paste.

## 4. Elevation

Tonal by default. Depth comes from five surface steps (page, rail, sunken,
raised, inset) rather than from shadow, which is what lets a dense analysis
screen hold six panels without any of them appearing to float. Panels are flat:
a 1px rule and a raised ground, nothing more.

Shadow is reserved for objects. Three things in the system are objects: a card,
which is a piece of cardboard; the playmat, which is a printed mat the cards lie
on; and the current item in the segmented control, which is a physically
depressed key. Everything else is paper printed on paper.

### Shadow Vocabulary

- **Card** (`0 1px 2px oklch(0.24 0.014 60 / 0.10), 0 6px 18px oklch(0.24 0.014 60 / 0.08)`): the card face and the deck tile. Two layers, a tight contact shadow plus a wide ambient one, which is what makes it read as sitting on a surface rather than hovering over it. In dark the same shape at 0.55 and 0.42 opacity against `oklch(0.10 0.010 265)`.
- **Table** (`0 1px 1px oklch(0.24 0.014 60 / 0.10), 0 10px 22px oklch(0.24 0.014 60 / 0.13)`, plus a 1px inset highlight along the top edge): the playmat, and nothing else. Wider and softer than the card's, because it is a larger object further from the page. In dark, 0.55 and 0.50 against `oklch(0.10 0.010 265)`.
- **Raised** (`0 1px 2px oklch(0.24 0.014 60 / 0.09)`): the active mode pill only.

### Named Rules

**The Object Shadow Rule.** If it is not a card, not the mat, and not the
current mode, it gets no shadow. Panels, empty states, badges, toolbars and
tables of numbers are flat forever. The mat joined the list under `mtg-bc2.46`,
when the play surface became one printed object with wells cut into it; the
wells themselves are tonal, one step down from the mat and keylined in Mat Edge,
because a debossed inset shadow would have been a fourth vocabulary for depth
the surface steps already carry.

**The Audit Test.** If a screen has more than one kind of shadow *at the same
level* visible at once, one of them is wrong. Cards on the mat are two levels,
not two opinions: the card sits on the mat and the mat sits on the page, and
that is the whole hierarchy the play surface has.

## 5. Components

The doctrine is **quiet controls, physical cards**. Two vocabularies, and which
one applies is decided by whether the element is chrome or content.

### Buttons

- **Shape:** gently rounded (6px, `--mtg-radius-md`).
- **Default:** a 1px `line-strong` outline on `surface-raised`, ink text, 0.25rem by 0.75rem padding, 500 weight at 0.8125rem. Quiet enough to sit in a toolbar without competing.
- **Hover:** border shifts to Proof Ink. The background does not change. 120ms, ease-out-quart (`cubic-bezier(0.22, 1, 0.36, 1)`).
- **Active:** background drops to `surface-sunken`.
- **Primary:** Proof Ink fill, `accent-ink` text, no outline change. Hover deepens to Proof Ink Deep.
- **Pressed toggle** (`aria-pressed="true"`): Proof Ink Wash fill with a Proof Ink border and normal ink text. Used by the identity filters.
- **Disabled:** faint ink on `surface-sunken`, `cursor: not-allowed`. Never a reduced-opacity clone of the enabled state.

### Chips

- **Badge:** pill (999px), `surface-inset` ground, muted ink, 0.6875rem at 600 with 0.02em tracking. Tone variants recolor the *text* only, never the ground: positive, negative, pending.
- **Code span:** 3px radius, `surface-inset` ground, mono at 0.9em. Wraps any command or path a person is expected to type. Produced by `renderCopy`, never hand-built.

### Cards / Containers

- **Panel corner:** 10px (`--mtg-radius-lg`). **Card corner:** 12px (`--mtg-radius-card`), dropping to 6px at compact size.
- **Panel:** `surface-raised` on a 1px `line` rule, with a head separated by a second rule. Body padding 1rem. Flat, always.
- **Empty state:** `surface-sunken` behind a 1px **dashed** `line-strong` rule, 2rem by 1.5rem padding, capped at 68ch. The dash is the signal: this container is waiting for something.
- **Card face:** the identity's band (`--mtg-frame-*`) as the ground, inside a 7px border in the identity's own color (5px at compact size), with the identity's edge channel on every keyline within it, the Card shadow, and a 2px lift on hover when interactive. Selection is a 2px Proof Ink outline at 2px offset, never a fill. Everything printed on the ground is a box in `--mtg-frame-*-panel` — title bar, type bar, rules box, P/T badge, collector bar — except the art window, which is `--mtg-frame-*-well`. The band sits at least 0.12 in OKLCH lightness under the box, which is what makes a frame read as a frame rather than as one flat wash, and it is the reason **no text is set on the band**: body ink clears 7:1 only above lightness 0.735 on paper and the box has to stay above 0.848 for muted ink to clear AA, so a band 0.12 below it cannot carry a word. `card-surfaces.test.ts` holds the box and the window to those ratios and asserts the collector line is on a box.
- **Card slot:** a permanent sits in a square slot the height of the card, so a tapped permanent rotates inside its own footprint and nothing else in the row moves. A hand slot keeps the card's portrait shape. Both are drawn when empty — a 1px dashed Mat Edge on the mat, `surface-sunken` on a hand's paper — because a hand of two in a rail of seven is a hand of two, not a broken layout. The face inside a slot is card-shaped and carries three regions and no art window, so those regions divide the height between them, growing equally: spread to the ends of the face instead, they leave a hole in the middle of every card where a full face has its art, and one region grown into that hole would be a panel standing in for art the face does not have. The hand is the one zone laid out as a rail — a single row that scrolls rather than wrapping — because seven slots are wider than the mat.
- **Artifact keyline:** an artifact face takes `ink-muted` as its edge channel in place of the identity's, so every keyline on it (bars, rules box, P/T badge, art window, seal stroke) moves to muted ink at the same 1px. The printed border is not one of them and keeps the identity: an artifact still has one, and cost validation already forces most of them colorless. A plate is a change of material, not of weight. The channel that has to move is lightness: `ink-muted` sits at least 0.08 from every identity edge — over the blue, black, red and green edges on paper and under the bone, stone and gold ones, over all seven in the dark — so the keyline gains definition against the card ground in both palettes. That separation is asserted in `card.test.ts`, because the first version of this rule reached for `line-strong`, which sat within 0.005 of the colorless edge of the day and painted nothing visible on the only artifacts a set can contain. It is not the hatch: the hatch already means pending art and face down, and one texture meaning two things is not a signal. Declared after the identity rules, where source order is what makes it win.
- **Nested cards are prohibited.**

### Inputs / Fields

- **Field:** an inline label in muted ink beside its control. Labels are always real text, never a placeholder standing in for one.
- **Focus:** a 2px Proof Ink outline at 2px offset, applied globally through `:focus-visible`. Never removed, never replaced per-component.

### Navigation

- **Segmented control** for the modes: a `surface-inset` trough, 2px padding, items at 0.8125rem / 500 in muted ink.
- **Current** (`aria-current="page"`): raised to `surface-raised`, ink text, 600 weight, plus the Raised shadow. It reads as the one key that is pressed.
- **Hover:** ink darkens. No background change.
- **Mobile:** the bar wraps at 720px and padding tightens; the control does not collapse into a menu.

### The Art Slot (signature)

The one component that exists for a governance reason rather than a visual one.
Art is either present or explicitly pending: when there is none, or when a
remote image fails to load, it draws a hatched frame (`--mtg-hatch`) labeled
"Art pending" carrying the card's own id. A screenshot of a set in progress is
therefore self-describing, and a missing render can never pass for a design
choice.

### Named Rules

**The One Affordance Rule.** The same action looks the same on every route. If
the save-shaped button looks different in two places, one of them is wrong.

**The Chrome Recedes Rule.** Toolbars, panels, badges and tables use 1px rules
and tonal grounds only. Any chrome element that grows a shadow, a fill, or a
second accent has broken the vocabulary.

## 6. Do's and Don'ts

### Do:

- **Do** put every number a person might compare into mono with `tabular-nums`, at 0.8125rem.
- **Do** print a rate beside the sample it came from, and say "not enough evidence" rather than reporting a confident value off four games.
- **Do** give every empty state a title, a body, and the exact command to type, wrapped in a code span via `renderCopy`.
- **Do** tint every neutral: hue 60 to 88 in light, hue 265 in dark, chroma between 0.003 and 0.014.
- **Do** pair every color-identity cue with a glyph, a label or a position, so hue is never the only carrier.
- **Do** keep the accent under 10% of any screen, on focus, selection, current mode and primary actions only.
- **Do** let depth come from the five surface steps, and reserve shadow for cards and the current mode.
- **Do** hold prose to 68ch (`--mtg-measure`); tables may run denser.
- **Do** transition at 120ms for controls and 180ms for cards, on `cubic-bezier(0.22, 1, 0.36, 1)`.

### Don't:

- **Don't** build the generic SaaS dashboard: no hero-metric tiles, no gradient accents, no identical card grids, no icon beside every heading.
- **Don't** reach for neon-on-black gamer dark mode. The dark ground is `oklch(0.192 0.010 265)` and never glows.
- **Don't** produce fan-site clutter: competing panels, ad-shaped chrome, five type sizes on one screen.
- **Don't** resemble Wizards' official brand. This is IP hygiene, not preference.
- **Don't** write `#fff`, `#000`, or any raw hex. A test fails the build on it.
- **Don't** use a colored `border-left` or `border-right` above 1px as an accent stripe on panels, rows or callouts.
- **Don't** apply `background-clip: text` to a gradient. Emphasis comes from weight and size.
- **Don't** put a shadow on a panel, an empty state, a badge or a table.
- **Don't** nest a card inside a card.
- **Don't** use the card serif anywhere except the card face.
- **Don't** uppercase anything outside the micro-label role, and don't track it at anything other than 0.06em.
- **Don't** use `--mtg-pending` as a colored left border. The two callouts that did are fixed; `test/polish.test.ts` fails the build on a border-left or border-right above 1px anywhere in the sheet.
- **Don't** ship a control without its hover, focus, active and disabled states.
- **Don't** animate layout properties, and don't add bounce or elastic easing.
- **Don't** print an em dash as prose punctuation. `—` is reserved as the no-value glyph in table cells; separators are `·`.
- **Don't** let a markdown backtick reach a text node. `test/copy.test.ts` fails on it.
