# ADR-0002: Two card renderers, one face specification

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-10 |
| **Amended** | 2026-08-10 (`mtg-bc2.45.2`): the mana pip artwork moved into the specification, closing §6.1. §2.1, §2.2 and §2.3 updated with it. |
| **Amended** | 2026-08-10 (`mtg-bc2.45.3`): the compact face width moved into the specification, closing §6.2. §2.1 and §2.2 updated with it. |
| **Amended** | 2026-08-10 (`mtg-z3p`): the frame treatment and the face root's vocabulary moved into the specification, after the artifact mark and the multicolor ring were found to have drifted under a green parity suite. §2.1, §2.2, §2.3 and §4 updated with them. |
| **Amended** | 2026-08-11 (`mtg-bc2.45.8`): the compact face width is now pinned in the test as well as measured off the cascade, which changes what §6.2's own mutation probe reports. §6.2 updated with it. |
| **Amended** | 2026-08-11 (`mtg-bc2.46`): the DOM face paints its identity as a 7px border rather than as a ground tint, so one of §2.2's four reasons for having no multicolor ring on screen is no longer true. §2.2 updated with what now decides it, and §3 with the play surface it was waiting on. |
| **Bead** | `mtg-bc2.45` |
| **Blocks** | Nothing. This header read `mtg-bc2.46` while the decision was pending; §4 has released it since, and the bead dependency was removed to match. |
| **Inputs** | `packages/ui/src/card/`, `packages/card-render/src/`, ADR-0001 §5, `the prior-project reuse audit` |

---

## 1. Context

The lab draws a Magic card twice.

`packages/ui/src/card/Card.ts` is the React face. The board, the hand, the battlefield, the sealed
builder and the card gallery all render it. It is a DOM component: it becomes a `<button>` when it
is selectable, it carries `aria-pressed`, it takes a footnote that `Hand.ts` sets to `unplayable`
when the kernel enumerated no move for the card underneath it, and it shrinks to a `compact`
battlefield thumbnail that drops the art window and the rules box.

`packages/card-render/` is the printed face. It emits one standalone SVG per card at a true
63 x 88 mm trim, in tenths of a millimeter, for proxies and set sheets. Every run of text is
measured against a committed advance-width table and emitted with a `textLength`, every region
reports whether its text fitted, and a set render can fail a build on a card whose rules box
overflowed.

Nothing in `packages/ui/src` imports `@mtg/card-render`. The dependency runs the other way:
`packages/card-render/src/palette.ts` imports `@mtg/ui` for the token sheet, `frame.ts` imports it
for color identity, and `art.ts` imports it for the pending-art label.

That arrangement had already produced drift, quietly, in exactly the way it was set up to:

* The art window was `4 / 3` on screen and `578 / 380` (about `1.52 / 1`) in print. The same
  illustration would have been cropped differently in the two places.
* Rarity was a letter in a rounded square on screen (`C`, `U`, `R`) and a disc, a diamond or a star
  in print. Two encodings of the same fact, neither aware of the other.
* The collector line read `TGR 1 · common` on screen and `TGR 001 · common · MV 1` in print.
* `costPips` in `card-render/src/pips.ts` reimplemented the pip run from `@mtg/ui`'s `ManaPips`,
  with a comment asserting that the two matched — an assertion no test held to.

None of it had bitten, because the DOM cards carry no art yet and the SVG renderer is not on a user
path. It was about to bite: `mtg-bc2.46` is a visual pass on the play surface, and a frame change
made there would have landed in one renderer and not the other.

## 2. Decision

**Keep both renderers. Extract the face specification to one module. Enforce it with a test that
fails when the two disagree.**

The stated reason for the split is that the two artifacts differ in the one thing a renderer is
mostly made of: what decides the layout.

The printed face has a fixed height. Every row is a rectangle in a 630 x 880 user-unit box, text is
measured rather than guessed, and a card that does not fit is a build failure — which is the whole
value of the package, because nobody proofreads ninety proxies. The on-screen face has no fixed
height. It reflows, its text box grows with its content, it inherits a font it did not choose, and
its failure mode for long text is a scrollbar rather than a ruined print run.

Those are not two implementations of one thing. They are two different problems that print the same
card. What they share is not layout code; it is a *description of the card face*, and that is what
now lives in one place.

### 2.1 The face specification

`packages/ui/src/card/anatomy.ts` is the single source of everything both renderers must agree on.
It sits in `@mtg/ui` rather than in a new package because `@mtg/card-render` already depends on
`@mtg/ui` and the reverse dependency would be a cycle — and because `@mtg/ui` is already the
design-source-of-record for the palette.

Declared there, and derived from there by both renderers:

| Shared | Where it lands |
|---|---|
| `FACE_REGIONS` — title, art, type, rules, footer, in printed order | `Card.ts` emits them as `data-region`; `regions.ts` already did |
| `COMPACT_REGIONS` — what a thumbnail keeps | `Card.ts` |
| `CARD_TRIM_MM` — 63 x 88 | `geometry.ts` declares the SVG size; `styles/card.ts` gives the full DOM face the same minimum silhouette |
| `ART_WINDOW` — the art window's ratio | `geometry.ts` computes the art box height from it; `styles/card.ts` hands the same pair to `aspect-ratio` |
| `RARITY_SEALS` + `raritySealPath` — one outline per rarity | `frame.ts` emits it as an SVG `<path>`; `Card.ts` mounts the same path in a 20-unit `<svg>` |
| `NEUTRAL_SEAL_RARITY` — the rarity toned in neutral ink | both stylesheets interpolate the selector |
| `costPips` — which pips, in what order | `ManaPips.ts` and `pips.ts` |
| `PIP_GLYPHS` + `pipArt` — what each pip is drawn as | `pips.ts` scales the outline into the printed disc; `ManaPips.ts` mounts the same authoring square in the DOM pip |
| `collectorLine` — the printed collector line | `Card.ts` and `regions.ts` (as `footerText`) |
| `frameTreatment` — the identity, the colors standing behind it, whether the card is a plate | `frame.ts` paints from it; `Card.ts` publishes it |
| `faceAttributes` — the vocabulary the face root publishes | `Card.ts` and `render.ts` write the same record |

`frameTreatment` is the derivation the two renderers were each doing for themselves, which is how they came to
disagree (§4, "Immediate"). Its `colors` list is WUBRG-sorted, and that order is load-bearing rather than
tidy: the printed ramp places its stops at `index / (length - 1)`, so a resorted list is a different picture.
The artifact predicate underneath it is `isArtifact` in `@mtg/dsl`, beside `isCreature` and `isLand` —
whether a card prints the word Artifact on its type line and whether it takes an artifact treatment are one
fact, and `oracle.ts` had the disjunction typed out already.

Publishing a fact is part of the contract, not a renderer's private business. A face root that knows the
card is an artifact and writes nothing about it gives the parity suite nothing to compare, which is exactly
the state this amendment found: the printed root carried `data-artifact` and the DOM root carried no such
attribute, so no assertion could have caught the missing treatment without inventing one first.
`faceAttributes` returns strings rather than the treatment's own types for a mechanical reason worth
recording: `svg.ts` drops a `false` attribute entirely while React writes it out, so a shared record carrying
`artifact: boolean` would have reintroduced the divergence it was written to close. A colorless card
publishes `data-colors=""` rather than omitting the attribute, because both serializers agree on an empty
string and only one of them can express omission. Rarity rides on the same record and stays a verbatim DSL
passthrough rather than part of the treatment, which is what let `RenderContext.style` go: `regions.ts` reads
`context.card.rarity` and the field had no other reader.

One declaration in the module is not shared, and is there for a different reason.
`COMPACT_FACE_WIDTH_REM` is how wide a thumbnail is drawn; the printed face has no thumbnail, so
there is nothing for it to agree with. It is in the specification because it is a decision about how
a card *reads* — the criterion this ADR was written around — and because it was previously typed
twice inside `@mtg/ui` itself: once as the face's own width in `styles/card.ts`, once as the width
of the slot a zone lays that face out in (`styles/board.ts`). Both interpolate it now. It is not
re-exported from the package index, so a DOM-only number is not advertised as part of the contract
`@mtg/card-render` builds against. `packages/ui/test/board.test.ts` measures it on a rendered hand.

Three shared sources predate this ADR and stay where they are: the palette and theme
(`styles/tokens.ts`, carried verbatim into every rendered SVG), color identity
(`card/identity.ts`), and the pending-art label (`card/ArtSlot.ts`). All printed *words* come from
`@mtg/dsl` — `renderTypeLine`, `renderOracleText`, `formatManaCost` — and neither renderer derives
them.

### 2.2 What is deliberately not shared

Recorded here so that "why is this in two places" has an answer next time somebody asks:

* **Row heights and font sizes.** Only meaningful against a fixed trim. The DOM face has none.
* **Text fitting.** The SVG measures, shrinks, wraps and reports a shortfall. The DOM face lets the
  browser wrap and the CSS ellipsize. A measured fit in a medium that reflows is a fiction. The
  generic pip is an instance rather than an exception: both faces print the same numeral, and only
  the printed one auto-fits it against the advance-width table and commits it to a `textLength`.
* **Interaction.** Button semantics, `aria-pressed`, focus rings, hover lift, selection outline and
  the footnote the play route substitutes for the collector line. A printed card has no opinion about
  any of it. The one thing that *is* shared here is what the face still says out loud: a footnote
  displaces the collector line, so it also displaces the only words spelling the rarity out, and the
  seal takes the name back when it does (`packages/ui/test/card.test.ts`).
* **The compact size.** A battlefield thumbnail is card-shaped shorthand, not a small card. What it
  keeps (`COMPACT_REGIONS`) and how wide it is (`COMPACT_FACE_WIDTH_REM`) are declared in the
  specification because both decide how the card reads; the rest of it — no minimum height, a
  tighter gap, a smaller corner radius, and the wider slot a tapped permanent rotates into — is the
  DOM face's own business and stays in the stylesheet.
* **How a treatment is painted.** Both faces mark an artifact; they mark it differently on purpose.
  Print tiles a plate hatch over the whole frame. The DOM drops every keyline on the face off the
  identity's edge channel and onto muted ink, roughly 0.28 of OKLCH lightness away from every one of
  the seven identity edges and moving in opposite directions in the two palettes (darker on paper,
  lighter in the dark), so a plate reads as a change of material rather than a change of weight.
  Lightness is the channel that has to move, and `card.test.ts` asserts the separation across every
  identity in both palettes: the first version of this rule chose a near-neutral within 0.005 of the
  colorless edge, and since cost validation forces every noncreature artifact colorless, it painted
  nothing visible on the artifacts a set can actually contain. The hatch is not
  available on screen: it already means pending art and face down there (DESIGN.md §4, PRODUCT.md
  principle 4), and with `mtg-bc2.17` unrun nearly every card is pending, so a DOM plate would draw
  one texture meaning two things. Shadow is not available either; The Object Shadow Rule spends the
  card's one shadow elsewhere. The rule is declared on the card face alone and not generated across
  the framed selectors, because the other framed element is a decklab deck tile with no artifact flag
  to read.
* **The multicolor ring, absent from the DOM deliberately.** The printed face paints its border ring
  with a ramp across the card's actual colors. The DOM face does not, and three things decide it.
  DESIGN.md bans gradient accents outright, and the gradients the sheet does declare are hard-stop
  textures on a neutral. The printed ring's own stated reason is print-specific: a 63 mm card in a
  draft pile, with no hover and no zoom. And the color is not lost
  on screen. `packages/dsl/src/validate/cost.ts` forbids a land any color and forces a spell's
  declared colors to equal its cost's, so identity `m` implies a cost whose colors are exactly the
  treatment's, and the pip run draws a glyph for each of them in the title bar — which
  `COMPACT_REGIONS` keeps, so the thumbnail carries it too.

  The difference is held by testing its *reason* rather than its absence: `carries a multicolor card
  colors in the DOM pip run rather than a ring`, in `packages/card-render/test/parity.test.ts`,
  requires the DOM pip run to cover every color in the treatment at both sizes. A redesign that
  drops the pips from the face fails there, which is precisely the moment the abstention would stop
  being safe. A second assertion in the same file fails if the DOM sheet ever grows a gradient whose
  stops are identity tokens, so copying the ring across becomes an amendment to this section rather
  than a quiet commit.

  A fourth reason stood here until `mtg-bc2.46` and no longer does: that the DOM face had nothing to
  run a ramp across, its identity ground surviving only in the gutter between region panels and its
  one border being 1px. The play surface made the identity a 7px printed border, which is exactly
  the element a ramp would want. The abstention survives on the three reasons above rather than on
  that one, and it is now a live choice instead of a consequence of the layout: the DOM face paints
  identity `m` in one gold, and what keeps a multicolor card's actual colors on screen is still the
  pip run, still asserted at both sizes. The gradient assertion did have to grow — the mat's weave
  put two gradients in one declaration, and the scan read only as far as the first semicolon — so it
  now walks each gradient's own stop list.

### 2.3 The criterion, and what holds it

The deciding criterion from the bead: **a change to how a card looks must be impossible to land in
one renderer and forget in the other.**

`packages/card-render/test/parity.test.ts` renders the same DSL card through both faces and compares
what came out — not what either renderer reports about itself. It asserts they agree on region
order, which regions the compact face drops, printed words, rules-text word sequence (whichever way
each medium breaks the lines), color identity, the whole face-root vocabulary, pip run, pip artwork
and the share of the pip it covers, rarity seal outline, pending-art announcement, art window ratio
and card silhouette. It also asserts the one difference §2.2 states, by the reason that makes it
safe rather than by its absence.

The treatment cases are built from the specification rather than from a committed fixture, and this
is not fastidiousness: no set in the repository contains a multicolor artifact, which is the card
the two faces were most free to disagree about. Sixteen shapes (five mono, colorless, two-color,
three-color, colorless artifact, mono artifact, multicolor artifact, and the five basic lands
that pin the land color fallback) cross with all three rarities for 48 rows, every one of them
through `parseCard`, so none is a card the generator could not emit. The expectations are written out
in letters rather than recomputed: asserting that a root carries `faceAttributes(card, treatment)` would
pass whatever `faceAttributes` returned. A totality guard fails if the matrix ever stops covering all
seven identities, color counts 0 through 3, both artifact values, or the artifact-and-multicolor
crossing.

Two rules the suite follows, because a parity test that breaks either is theater. It compares
*emitted markup*, never a constant the emitter was supposed to have used: asserting `CARD_WIDTH_MM`
equals `CARD_TRIM_MM.width` is true by definition, so the silhouette is read off the root element the
renderer actually wrote. And it draws every shape in the specification rather than every shape the
fixtures happen to contain — the committed sets have no rare in them, so the star outline would
otherwise never be rendered by either face.

The test was verified by mutation, not by passing: deliberate divergences were introduced one at a
time, each failed the assertion named beside it, and each was reverted.

| Mutation | Caught by |
|---|---|
| DOM art window back to `4 / 3` | `sizes the art window from one ratio` |
| SVG seal drawn with the wrong rarity's outline | `draws the same rarity seal outline` |
| DOM rules box moved above the type bar | `lays out the same regions in the same order` |
| Printed trim written as 64 mm wide | `gives the printed trim and the on-screen card the same silhouette` |
| Rare mapped to the common seal | `draws every seal in the specification, in both faces` |
| Seal hidden from assistive technology under a footnote | `keeps the rarity readable when a footnote displaces the collector line` (`@mtg/ui`) |
| DOM pip drawn with a stub outline | `draws the same pip artwork, not just the same run` and `draws every mana symbol in the specification, in both faces` |
| DOM generic pip printing a different numeral | `draws the same pip artwork, not just the same run` |
| Printed glyph scaled to half its disc | `gives a glyph the same share of its pip in both faces` |
| DOM glyph sized at 40% of its pip | `gives a glyph the same share of its pip in both faces` |
| DOM face stops publishing the artifact fact | `publishes the same vocabulary on both roots` |
| Shared record carries a boolean where a string was required | `publishes the same vocabulary on both roots` |
| `frameTreatment` forgets the artifact fact | `plates an artifact in print, and only an artifact` |
| `isArtifact` drops the artifact-creature route | `publishes the same vocabulary on both roots`, and the DSL's own type-line tests |
| Treatment colors reversed out of WUBRG order | `runs the printed ramp across the card colors, in order, and nowhere else` |
| `data-colors` read from the declared field, losing the land fallback | `publishes the same vocabulary on both roots` |
| `data-colors` dropped from the published record | `publishes the same vocabulary on both roots` |
| Printed ramp declared, or the ring stroked from it, on a single-color card | `runs the printed ramp across the card colors, in order, and nowhere else` |
| Printed plate painted on every card | `plates an artifact in print, and only an artifact` |
| DOM sheet grows an identity gradient | `declares no identity gradient in the DOM sheet` |
| DOM face drops the pip run | `carries a multicolor card colors in the DOM pip run rather than a ring` |
| Artifact rule declared before the identity block, or removed | `declares the artifact rule after the last identity rule` (`@mtg/ui`), and `gives an artifact face a keyline its identity does not supply` (`@mtg/ui`) |
| Printed seal reads a fixed rarity after `RenderContext.style` was removed | `draws the same rarity seal outline` |

## 3. Alternatives considered

### 3.1 The board renders the SVG and the DOM component is retired

The option that makes on-screen and printed cards the same artifact by construction, which is a real
prize. Rejected on four counts, in descending order of weight.

**It does not actually remove a renderer.** Every card in the hand and on the battlefield is
clickable, so each SVG needs a wrapping `<button>` with the right accessible name, `aria-pressed`,
focus handling and a hit target. `packages/ui/test/play/play.test.ts` queries the legal-move surface
by role and drives a whole game through it. The DOM component would come back as a wrapper, and the
lab would have a wrapper plus an SVG instead of one component.

**The compact size has no SVG.** The battlefield draws thumbnails at 9.5 rem. Rendering the 63 x 88
face into that box sets rules text at roughly 3 pt. A second geometry for the small case is the
obvious answer, and a second geometry is the thing this ADR exists to avoid.

**The cost is per render, not per card.** The SVG renderer measures and fits every text run each
time it runs. React re-renders the board on every kernel decision. Forty faces re-fitted per click
is work the DOM does not do at all, and it buys nothing on a surface that is not being printed.

**The pending-art marker is louder in the DOM.** The governance rule ported from the prior project
(its `docs/art-governance.md`, reuse item 9 in `the prior-project reuse audit`) is that an
unfinished surface announces itself, carrying the id of what it is unfinished *for*. Both renderers honor
it, but the DOM version is a real `role="img"` with a label, which is what makes it survive a
screenshot *and* a screen reader.

Revisit if any of those changes: if the art pipeline (`mtg-bc2.17`) lands and the frames need to be
identical down to the crop, if a print-preview route appears that wants real 63 x 88 faces on
screen, or if the DOM face starts needing measured text.

### 3.2 Retire the SVG renderer instead

Not viable. The printed face is the proxy and set-sheet path, and its fit report is a build gate the
DOM cannot supply: a browser silently ellipsizing a rules box is not an error anybody sees.

### 3.3 Leave them separate and write the reason down without extracting anything

The bead's own words: a stated reason is an acceptable answer, an unstated split is not. But a
reason with no enforcement is a comment, and the four drifts in §1 all happened *under* comments
asserting the two renderers matched. `pips.ts` said so in its docstring while diverging in its
collector line two files away.

### 3.4 Generate the DOM face from the SVG geometry

Compute the CSS from the 630 x 880 boxes, so one set of numbers drives both. Rejected: it forces the
DOM face to a fixed height and therefore to clip or shrink text, which is the SVG's problem being
imported into a medium that does not have it. It would also make a browser zoom or a longer card
name a layout failure rather than a reflow.

## 4. Consequences

**Immediate, in this change.**

* The DOM face is now card-shaped: a full face is at least 63:88, so a hand of cards reads as cards.
* Rarity on screen is a seal shape rather than a letter, from the same outline the printed face uses.
* The on-screen collector line gained the padded collector number and the mana value, because there
  is now one collector line.
* The art window narrowed on screen from `4 / 3` to the printed ratio.
* `costPips` and `footerText` in `@mtg/card-render` are now re-exports. The package's public API is
  unchanged.

**Immediate, in the `mtg-z3p` amendment.**

* An artifact creature was hatched in print and unmarked on screen; it now carries a treatment in
  both, by different means and for the reason §2.2 records.
* A blue-red card read blue-red in print and flat gold on screen. It still does, and now that is a
  decision with a test holding its reason rather than an omission nobody had noticed.
* The DOM face root gained `data-colors`, `data-artifact` and `data-rarity`, which is what gives the
  stylesheet — and `mtg-bc2.46` — something to key a frame or rarity treatment off.
* `frameStyle` and `FrameStyle` left `@mtg/card-render` entirely, including its package index.
  Nothing outside the package referenced either. `RenderContext.style` went with them.

**Standing.**

* Adding a region to the face is a three-file change — `anatomy.ts`, both renderers — and the parity
  test names the one you forgot.
* `@mtg/card-render` cannot stop depending on `@mtg/ui` without duplicating the specification, so
  the dependency direction is now load-bearing rather than incidental. It is more so since `mtg-z3p`:
  the printed face no longer imports two color-identity functions and assembles a treatment from
  them, it takes the treatment itself, so the specification decides what varies and the package
  decides only how it is drawn. A `@mtg/card-face` package holding `anatomy.ts` + `tokens.ts` would
  be the right shape if a third consumer ever appears; two consumers do not justify it.
* `mtg-bc2.46` may change the play surface freely. Any card-face change it makes lands in
  `anatomy.ts` or fails the parity test. It has since run: the play surface became a playmat with
  the zones as wells and the identity as a printed border, and the two changes that reached the
  shared contract went where this says they would — the slot's footprint is derived from
  `COMPACT_FACE_WIDTH_REM` and `CARD_TRIM_MM`, and the mat's own four surfaces are declared outside
  `TOKEN_CSS` so a card file does not carry a table it can never draw.

**Costs accepted.**

* Two implementations of the same face still exist and both must be edited for a shared change. The
  test makes that a red build rather than a silent divergence; it does not make it one edit.
* The parity test parses markup with regular expressions. It is checking the output of two known
  serializers, the same argument `overflow.ts` makes, and it breaks loudly if either changes shape.

## 5. License and IP hygiene

Unchanged from ADR-0001 §5.6, and worth restating because this ADR moves frame geometry between
packages. The frame anatomy is the generic arrangement every trading card has used for ninety years,
drawn by us. No Wizards frame asset is copied, traced or measured off a scan; the rarity seals are
plain geometry (a disc, a diamond, a five-pointed star) and the mana symbols are original shapes on
the category each color has always used, not traces of the printed symbols.

## 6. Open questions

1. **The mana pip drawing.** *Closed by `mtg-bc2.45.2`.* The artwork is now shared: the glyph
   outlines, the fraction of the pip they cover and the choice of a symbol over a numeral all live
   in `anatomy.ts`, and the DOM pip mounts the same paths the printed pip scales.

   The reason recorded above for leaving it — the DOM pip is 1.05 rem and the glyphs were authored
   for a 15.5-unit disc — did not survive being checked. The glyphs are authored in a
   resolution-independent -50..50 square, and the printed pip is a 3.1 mm disc against 1.05 rem's
   roughly 4.4 mm: the screen pip is the *larger* of the two, so a symbol legible in print is
   legible on the board. What the DOM needed was the mount, not a redraw.

   Two details worth having written down. `pipArt` is total over `PipSpec`, so the case this
   question was really about — a symbol the two faces could disagree on, a hybrid pip being the
   obvious one — now stops compiling in the specification rather than reaching two renderers that
   would each invent a drawing for it. `@mtg/dsl`'s `ManaCost` is a generic count plus five color
   counters and cannot state a hybrid cost today, so that guard is for the vocabulary growing, not
   for a divergence that exists. And `@mtg/card-render`'s glyph exports took the specification's
   names (`PIP_GLYPHS`, `PIP_GLYPH_FOR_COLOR`, `PIP_GLYPH_UNITS`, `PipGlyph`) rather than keeping
   the old ones as aliases: the package is private with one in-repo consumer, and a second name for
   one constant is the thing this ADR exists to prevent.

2. **Where the compact face gets its proportions.** *Closed by `mtg-bc2.45.3`.* The width is
   `COMPACT_FACE_WIDTH_REM` in `anatomy.ts`, interpolated into the compact face's `--card-w` and
   into the `.mtg-slot` the hand and the battlefield lay a thumbnail out in — the two places
   the same `9.5rem` used to be typed independently. `mtg-bc2.46` moved one number and got both;
   it also derived the slot's *height* there, from that width and `CARD_TRIM_MM`, so a slot is
   card-shaped by the same arithmetic the printed trim uses.

   The check is empirical rather than structural, because the structural version is worthless here:
   asserting that the stylesheet contains the constant it interpolated is true by construction, and
   asserting the constant equals itself is truer still. `packages/ui/test/board.test.ts` renders a
   hand under the real sheet and reads the width back off the elements the cascade produced, against
   a pinned `152px` and `9.5rem`. `mtg-bc2.45.8` pinned the specification beside them, against a
   literal `9.5` typed in the test rather than against itself: the two rendered values cannot see a
   sheet typed back to its own literal while `COMPACT_FACE_WIDTH_REM` drifts away from it, because
   the hand still lays out at 152px. Three pins, and moving any one of them alone is red.

   Verified by mutation four ways, each reverted. The old `card.ts` literal moved to 12 rem failed
   the face assertion; the old `board.ts` literal moved to 12 rem failed the slot assertion;
   `COMPACT_FACE_WIDTH_REM = 11` fails the specification pin, which sits before `render()` and so
   stops the test before the slot is ever measured at the `176px` this probe used to report; and
   `COMPACT_FACE_WIDTH_REM = 11` with both sheets holding a literal `9.5rem` fails the specification
   pin and nothing else in the unit project, which is the gap the third pin exists for.

   A fifth mutation answers the question the third one raises. Running the specification pin before
   `render()` shadows neither assertion it joins: the slot sheet decoupled to a literal `12rem`
   while the constant holds reaches the slot assertion and fails it at `192px`. Reverted like the
   rest.

3. **What happens when art arrives.** `mtg-bc2.17` has not run. A frame designed against hatched
   placeholders may not survive real illustration, and the two renderers crop art differently today
   only because they now agree on the window ratio — they still differ on `object-fit: cover` versus
   `preserveAspectRatio="xMidYMid slice"`, which are equivalent in intent and untested against a
   real image.

4. **One printed pattern, two meanings.** `frame.ts` declares a single `plateHatch` and `art.ts`
   fills the pending art window with it, so an artifact creature with no art draws one texture that
   means "artifact" in the frame and "unfinished" in the window. It also made the old assertion on
   the plate vacuous: nineteen of the twenty-one non-artifact cards this package renders in tests
   contain the pattern id somewhere, so a document-wide search passed on cards with no plate at all.
   `mtg-z3p` scoped both the parity assertion and `render.test.ts` to the frame group, which stops
   the conflation hiding a defect; splitting the two patterns is separate work and would touch the
   parity fixtures. The DOM face does not have the problem, because it does not use a hatch for
   artifacts.

5. **Whether the DOM face wants a visible multicolor treatment after all.** `mtg-bc2.46` did not take
   it: identity `m` is painted in one gold on the new printed border, and the card's actual colors
   stay in the pip run. The question is more live than it was, not less, because the border the pass
   added is the element a treatment would key off. The three things settled in advance still hold. It
   has to be hard-stop rather than a blend, because DESIGN.md bans gradient accents and the sheet's
   existing gradients are hard-stop textures. It belongs in `styles/card.ts` beside the generated
   identity rules, not in a component. And the three-or-more-color fallback has to be declared in the
   specification rather than discovered as a red test, since a two-stop treatment says nothing about
   a WUB card. §2.2 is the record of what was rejected and why, not a closed door.

6. **Whether the parity test should render the whole generated set.** *Closed by `mtg-bc2.45.1`.*
   It should, and it does. `packages/card-render/test/parity.test.ts` sweeps all 111 cards the
   repository commits — the 16 DSL examples, the 5 basic lands and the 90-card fixture — and pins
   that count, so narrowing the corpus fails a test instead of quietly turning every other
   assertion green. Nothing diverged when it widened, which is a weaker result than it sounds:
   the reason to sweep is that a length or a type line trips one face and not the other, and a
   handful of hand-written cards is exactly the sample that misses it.

   The fixture is `packages/setgen/fixtures/sets/tideglass-reach.set.json`, as this item said. That
   citation was briefly wrong through no fault of its own — the test read a second committed copy
   of the same 90 cards under `packages/metrics/test/balance/fixtures/`, reformatted and
   byte-different — and `mtg-bc2.86` collapsed the three copies onto the setgen file, which is the
   only one with provenance. There is now one file the name can mean.

   The closing note stands unchanged and is still load-bearing: that fixture adds no rarity
   coverage. It is 68 common and 22 uncommon with no rare in it, which is why the seals are
   rendered from the specification rather than from a set.
