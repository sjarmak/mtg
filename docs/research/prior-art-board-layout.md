# Prior art: card viewing and board real estate

Lane: how do established Magic clients, and the wider digital-card-game field, buy card size on a
screen that has to show several zones at once? Researched 2026-08-11.

The prompt for this lane is a complaint with a number behind it. the playtester: "the cards need to be
much bigger on the screen." The number is that a battlefield permanent on our play route comes out
68.47 x 95.64 px at 1280x800 and its name resolves to 1 px of client width, so no character of it
renders (`mtg-bc2.129`, measured in chromium). The constraint that makes it hard is that the play
area must fit one screen with no page scrolling at 1280x800 and 1440x900, while showing the
opponent's battlefield, the stack, your battlefield, your hand, and a command bar listing every
legal move as a button. That is more simultaneous zones than any client surveyed here shows, and it
is why the cards got small.

**Provenance key.** `[MEASURED]` means somebody on this side read it off a primary artifact, source
file or running client, and the artifact is named. `[STATED by X]` means a source asserts it, with a
URL. `[SECONDARY]` marks a non-first-party source. `[DERIVED]` is arithmetic from cited numbers.
`[NOT FOUND]` means it was searched for and is absent, which is a result and not a gap to paper
over. Nothing in this document is an unlabeled estimate; where a number could not be obtained the
row says so.

---

## Executive summary

1. **Every client gives up something specific to get its card size, and the thing they give up is
   almost always the same thing: they do not have to show an enumerated list of legal moves.**
   MTGO, Forge, XMage and Cockatrice all spend a fifth of their window width on a rail; none of them
   spends any *height* on an action surface. Forge's own default layout gives 73.2% of window height
   to the two battlefields and puts its button dock, stack, log and prompt in a 20%-wide left rail.
   Our command bar takes up to 32% of the table's height. That single geometric difference is the
   largest lever we have, and it is a lever nobody else had to pull because nobody else has our
   requirement.

2. **Nobody scrolls a battlefield except Arena, and Arena scrolls only its land row.** Every other
   client either wraps to fixed rows, auto-fits the card size down until the row fits, or (outside
   Magic) hard-caps the zone. We scroll every well on the play route. Scrolling is the technique
   that hides game state, and it is the one we reached for first.

3. **Card size is a solved variable in three of the four MTG clients, not a setting.** Forge binary-
   searches card width in `[50, 300]` px until a row-wrapping template fits. XMage walks down from
   1.5x a user-set average in 10 px steps. Cockatrice derives it as viewport height divided by a
   fixed 406-unit scene. Only XMage and Draftmancer expose a real size control. The pattern to copy
   is fit-to-fill, not a constant with a floor, which is what we have.

4. **Text at board size has exactly three answers in the field and we picked a fourth that does not
   work.** MTGO holds the font and clips the sentence with an ellipsis. XMage steps the rules font
   down a five-value ladder `{24, 18, 15, 12, 9}`. Arena scrolls the text inside the card's text
   box. We drop the rules text and the art window entirely and keep three text bars, and then the
   mana pips price the name out of the title bar. The one channel every source agrees survives
   shrinking is **art**, and it is the one channel our compact face does not draw.

5. **Hover-zoom is universal and nearly free.** Every surface surveyed except Cockatrice has one,
   and Cockatrice is the one that gives up the most. It costs zero layout, which makes it the only
   technique in this report that is unconditionally compatible with our constraint. We already
   decided (`mtg-bc2.129`) that "any text the compact face clips is available in full on hover," so
   a hover-zoom showing the whole face is an extension of a mechanism already committed to, not a
   new one.

---

## 1. The comparison table

Battlefield card size at a stated viewport, and what the card shows at that size.

| Client | Basis | Battlefield card | % of viewport height | What the card shows at that size | Provenance |
|---|---|---|---|---|---|
| **MTGO** (1v1, opponent's permanent) | 1902x1122 official Duel Scene screenshot | **100 x 144 px** | **12.8%** | Composed frame: name, mana pips, art window, type line, rules text, P/T, counter badges, plus other permanents' continuous effects printed inline in blue italics. All legible. Rules text clipped with an ellipsis, font not reduced. | `[MEASURED]` from `assets-cdn.daybreakgames.com/uploads/dcsclient/000/000/330/068.png`, linked from [mtgo.com getting-started-gameplay](https://www.mtgo.com/getting-started/getting-started-gameplay) |
| **MTGO** (own hand) | same screenshot | **177 x ~250-262 px** | **22.3-23.4%** | Same frame, more of the rules text before the ellipsis | `[MEASURED]`, same artifact |
| **MTGO** (4-player, opponent) | 1918x1111 official screenshot | **96-114 px wide** | height not measured | Same frame, ~62-70% the linear size of your own hand card | `[MEASURED]` from `.../331/801.png` |
| **MTG Arena** | any | **`[NOT FOUND]`** | **`[NOT FOUND]`** | A "condensed form" of the card, with rules text present and scrollable inside the card when it overflows | See §2; no citable pixel figure exists |
| **Forge** desktop | any window | Card width binary-searched within **`cardWidthMin = 50` … `cardWidthMax = 300`** px until the row template fits | not fixed | Scanned card image, so every printed element at whatever size it lands | `[MEASURED]` from [`CardPanelContainer.java` L53-54](https://github.com/Card-Forge/forge/blob/22d3150aa7814ed5f9040d6b51022b501aa13033/forge-gui-desktop/src/main/java/forge/view/arcane/CardPanelContainer.java) and `PlayArea.doLayout` L471-495 |
| **XMage** (1920x1080 preset) | vendor preset, slider value 30 | **223 x 318 px nominal**, auto-fit band **111 x 159 … 334 x 477** | **29.4%** at nominal | Composed frame; rules font steps down `{24, 18, 15, 12, 9}` to fit | `[DERIVED]` from `GUISizeHelper` `312 * v / 42` x `445 * v / 42` and the preset table in [`PreferencesDialog.java` L383-399](https://github.com/magefree/mage/blob/69c6353d618900b040459a5e3d7c4183cb651c8e/Mage.Client/src/main/java/mage/client/dialog/PreferencesDialog.java) |
| **XMage** (1366x768 preset) | vendor preset, slider value 22 | **163 x 233 px nominal** | **30.3%** | same | `[DERIVED]`, same constants |
| **Cockatrice** | derived from window | Card is **72 x 102 scene units**; the table is a fixed **406-unit**, 3-row scene scaled with `fitInView`, so px size = (viewport height / scene height) x 102 | not fixed | Card image; no zoom, no board size control at all | `[MEASURED]` from [`card_dimensions.h` L16-26](https://github.com/Cockatrice/Cockatrice/blob/83fd65b34b4094094f052520e11ab2525442909b/cockatrice/src/game_graphics/card_dimensions.h), `table_zone.h`, `game_view.cpp` L105-108 |
| **untap.in** | board hard-capped at 1600x888 | **100.3 x 131.9 px** at the cap | **14.8% of the capped board** | Card image | `[DERIVED]` from `dims(){...cardWidth:this.width*.0627,cardHeight:this.height*.1485}` in `https://untap.in/assets/game-ui-05fb2bf2.js` |
| **Draftmancer** (pack grid, not a battlefield) | any | **200 x 282 px** at scale 1.0; slider **0.1x-2.0x** gives **20-400 px** wide | 26.1% at 1080 | Full card image | `[MEASURED]` from [`Card.vue` L183-186](https://github.com/Senryoku/Draftmancer/blob/be35473e5f02c29d22e7077ef364940845107067/client/src/components/Card.vue) and `ScaleSlider.vue` L22-26 |
| **ours, hand card** | 1440x900 | **125.3 x 175 px** | **19.4%** | Three bars: name + mana pips, type line + rarity seal, collector line + P/T. No art window, no rules text. | `[MEASURED]` in chromium, recorded in `packages/ui/src/styles/board.ts` |
| **ours, battlefield permanent** | 1280x800 | **68.47 x 95.64 px** | **12.0%** | Same three bars, except the name resolves to 1 px and no character of it renders | `[MEASURED]` in chromium, `mtg-bc2.129` |

Two notes on reading this table.

**Our battlefield card is not unusually small as a fraction of the viewport.** At 12.0% of viewport
height it sits within a pixel of MTGO's 12.8% opponent permanent. What differs is what fits inside
it: MTGO draws a complete, legible frame at 100 x 144, and we cannot render one character of a name
at 68 x 96. Part of "the cards need to be much bigger" is a size problem and part of it is an
information-per-pixel problem, and the two have different fixes.

**Our hand card is the one that is small against the reference.** 19.4% of viewport height against
the prior project's 22.7% and MTGO's 22.3-23.4% for the equivalent object. That gap is small. The gap
that is not small is the one between our battlefield permanent and XMage's, which at its own vendor
presets nominally draws a battlefield card at 29-30% of viewport height, more than twice ours,
before auto-fit shrinks it under crowding.

---

## 2. MTG Arena

Arena is the hardest client in this report to get numbers out of, and the honest finding is that
**there is no official Arena UI reference document.** The Gameplay FAQ contains no UI content, the
Steam listing publishes system requirements with no display or resolution line at all
([store.steampowered.com/app/2141910](https://store.steampowered.com/app/2141910/Magic_The_Gathering_Arena/)),
and every keybinding list in circulation is community-authored. WotC's own support articles 403
automated fetches; the patch notes below are quoted from mirrors, which is stated at each one.

### 2.1 What a card shows at board size

`[SECONDARY, GDKeys, Nicolas Kraj]`, verbatim:

> "Each card takes its condensed form when on the board, and identical cards will stack."

> "The game needs as much space as it can shave" because of the "huge number of cards that can end
> up on the board, on multiple lines."

> The "subtle camera perspective" makes "the player's side bigger than the opponent's (60% to 40%),
> which I believe helps feel in control and empowered."

[gdkeys.com/the-card-games-ui-design-of-fairtravel-battle](https://gdkeys.com/the-card-games-ui-design-of-fairtravel-battle/).
This is a practitioner writeup, not a WotC statement. It is the only published description of
Arena's condensed board form that could be located, and it contains no pixel figures.

Rules text **is** present on a board card and it **scrolls inside the card** when it overflows.
`[STATED by WotC, patch notes 1.13.00]`, verbatim from the mirror at
[mtgazone.com/1-13-00-patch-notes](https://mtgazone.com/1-13-00-patch-notes/):

> "We've tweaked the way we display text so cards are much less likely to overflow the type line, or
> require you to scroll."

> "Obviously if you add a ton of text via enchantments, mutate, etc. you'll scroll as normal."

That is a fourth answer to text-at-small-size, distinct from MTGO's clip and XMage's font ladder:
**scroll the text box inside the card**. It is worth noting because it preserves the font size, does
not truncate, and costs nothing in layout, but it puts information behind a gesture on the card
itself rather than behind a zoom.

### 2.2 Wide boards

The clearest first-party evidence is an incidental bug fix. `[STATED by WotC, patch notes
0.18.00.00]`, verbatim from the mirror at
[mtgazone.com/0-18-00-00-patch-notes](https://mtgazone.com/0-18-00-00-patch-notes/):

> "The player's avatar no longer blocks the navigational arrow when trying to scroll through lands
> currently on the battlefield."

So Arena's answer to a crowded land row is **a scrolling row with a navigational arrow**, not a
shrink. Combined with GDKeys' "multiple lines" and "identical cards will stack," Arena's stack of
techniques appears to be: condensed board representation, wrap to multiple rows, stack identical
cards, and scroll the land row with an explicit affordance. `[NOT FOUND]`: any stated threshold at
which any of those kicks in, and any statement of whether nonland permanents shrink.

Also `[STATED by WotC, 0.18.00.00]`: "When blocking, blockers are now stacked left-to-right. This
should make it consistent with the order in which combat damage is dealt."

### 2.3 Hover, examine, and the browsers

Hover and examine are **two different render paths with different semantics**. `[STATED by WotC,
patch notes 2021.11]`: hover shows current and modified state, examine shows printed state, quoted
as "on battlefield and mouse over it shows their power that way, but on examining, it shows it as
printed." Right-click was made global in 2021.08: "You can now right click cards anywhere, including
on the stack and in hand, and view the printed text," with a third mode for Alchemy perpetual
changes. On mobile the equivalent is long-press. "Examine view" is WotC's own term.

`[NOT FOUND]`, and this matters because it is the number the lane most wanted: **no published figure
for the zoomed card's size, its position on screen, or the hover delay in milliseconds.** The only
concrete numbers in this family anywhere are Magic Online's, and Daybreak states that MTGO's initial
values were taken from Arena's, which is a useful framing but not a measurement of Arena. See §3.3.

Zone counts are hover-summoned, not persistent badges, and hovering one zone reveals counts for
every zone on both sides. `[STATED by WotC, 1.13.00 mirror]`: "Mousing over either player's
hand/graveyard/exile to display zone counts now displays the counts for both players." The
0.18.00.00 note phrases the same feature as "Hovering any of the zones will now bring up a new UI
element that shows all of the zone counts."

Graveyard and exile open as modal overlays WotC calls **browsers**, which carry a "View Battlefield"
control so you can peek at the board they are covering
([patch notes 2024-39-2](https://mtgarena-support.wizards.com/hc/en-us/articles/29340673846676-Patch-Notes-2024-39-2)).
The stack has a compact collapsible rail on the right that escalates to a centered browser at a
stated threshold. `[STATED by WotC, 0.18.00.00 mirror]`, verbatim: "The browser is now available
whenever there are 4 or more targets on the stack," and "It will also automatically open when you
need to target something on the stack."

**Four is the only hard zone-density threshold any Magic client publishes.** It is worth carrying.

### 2.4 What Arena gives up

- **It does not enumerate legal moves.** Arena's entire action model is click-the-object plus a
  priority-stop system, so it spends no layout at all on an action surface. That is the whole of the
  space advantage it has over us.
- **It pays for that in hand-maintained content, not in code.** `[STATED by John Schork, WotC,
  2025-10-27]`: "Smart priority refers to a set of exceptions to those rules. This happens at times
  when you, as an experienced MTG Arena player, think 'Oh, I'd better go into full control or set a
  stop on a phase where I don't normally get a stop.' Except you don't, because smart priority does
  it for you."
  ([magic.wizards.com announcements-october-27-2025](https://magic.wizards.com/en/news/mtg-arena/announcements-october-27-2025)).
  Dozens of patch notes are per-card priority-stop fixes. That is a per-card exception table
  maintained forever, and it is the cost of not having a move list. Worth stating in a repo whose
  ZFC rule is that judgment goes to models and plumbing stays in code: Arena's answer is neither.
- **It puts two zones behind modal overlays** that cover the board, and then has to add a "View
  Battlefield" control to undo the occlusion it created.
- **It substitutes animation and time for space.** Objects move, resolve and leave; a state that
  another client would show statically, Arena shows sequentially.

---

## 3. Magic Online

MTGO is the client that most resembles our problem: many zones visible at once, dense information,
and a client that has to survive a **stated minimum resolution of 1280x1024**, which is 5:4 and
therefore harder than either of our target viewports on the width axis. `[MEASURED]` from the
system-requirements table image on
[mtgo.com/getting-started/getting-started-home](https://www.mtgo.com/getting-started/getting-started-home).

### 3.1 Geometry, measured

From the official 1v1 Duel Scene screenshot at 1902x1122, `[MEASURED]`:

| Region | px | share |
|---|---|---|
| Left rail (avatars, timers, life, zone buttons, prompt box) | 200 px wide | 10.5% of width |
| Center column (both battlefields, phase bar, hand) | 1446 px wide | 76.0% of width |
| Right Chat and Game Log dock | 226 px wide | 11.9% of width |
| Opponent battlefield | y 0-416 | 37.2% of height |
| Own battlefield | y 424-798 | 33.4% of height |
| Phase bar | ~y 800-846 | ~4% of height |
| Hand | y 850-1112 | ~23% of height |

**The two battlefields together take about 70% of window height.** Everything that is not a card
lives in the two side rails, costing width.

Zones are shown as **labeled collapsible button rows**, not piles and not counters: graveyard
(headstone icon, with a mini-graveyard shown when the main window is collapsed), exile (X icon,
except that cards exiled by a permanent are drawn underneath that permanent), revealed cards (eye),
effects (shield, for pending replacement effects and resolved emblems), command. Library is a count
near the avatar. `[STATED by mtgo.com getting-started-gameplay]`, corroborated `[MEASURED]` in the
4-player screenshot.

The stack is **a draggable, resizable floating window overlaid on the battlefield**, titled "The
Stack," showing the source card at roughly 200x230 plus a separate labeled panel spelling out the
triggered ability's text in full. `[MEASURED]` from `.../331/803.png`. It costs zero permanent
layout and appears only when there is a stack.

Layout is user-editable and persistable: `[STATED by mtgo.com]` "You can customize your Duel Scene
layout by dragging the grid splitter along some boundaries," zones can be popped out, and the
settings file can be exported and imported.

### 3.2 Density: resize, stack, or hide a player

`[STATED by mtgo.com getting-started-multiplayer]`, verbatim:

> "The game re-sizes opponents' permanents as needed to keep everything visible - use Hover Zoom
> liberally to ensure you can fully understand the game state."

> "The +/- button at the bottom-right of each opponent's section can be toggled to hide that opponent
> - this makes the remaining players' zones larger."

So MTGO's escape valve at extreme density is **hiding a player**, not shrinking further. Note also
that the sentence pairs auto-resize with hover zoom in the same breath: the small card is explicitly
sold as acceptable *because* zoom exists.

Identical permanents stack. `[MEASURED]` from the 4-player screenshot: two Kraken Tokens render as
an overlapping pile with the second offset **horizontally only**, about 14 px on a 139 px card, so
**about 10% of card width with zero vertical offset**. Non-identical permanents are not stacked;
overlap appears only when a row runs out of room. `[NOT FOUND]`: no official MTGO documentation
describes battlefield stacking at all. The behavior is real, the doc is not; cite the screenshot.

Tapped permanents rotate 90 degrees, desaturate, and **occupy a landscape footprint** (about 114 px
wide against about 100 px untapped in the same row). MTGO does **not** reserve a square slot for the
tapped case; the row absorbs it. `[MEASURED]`, same artifact.

### 3.3 Card rendering and the zoom

MTGO composes frames rather than blitting scaled card photos, which is what lets it hold text legible
at 100 px. `[STATED by Daybreak, mtgo.com/news/frame-refactor]`: "The new system lets us easily
control the different layers of assets used to compile individual versions of a frame, as well as
easily control the placement of the text on the frame."

`[MEASURED]` The rules-text cap height stays around 8 px whether the card is 177 px wide (hand) or
100 px wide (opponent battlefield). **MTGO's answer to text that does not fit is to hold the font and
clip the sentence with an ellipsis**, deferring the rest to zoom.

The zoom section of [mtgo.com/news/frame-refactor](https://www.mtgo.com/news/frame-refactor) is the
single most useful primary source in this entire report, and it is a designer stating the problem in
our exact terms. Verbatim:

> "Tuning a Hover Zoom feature comes down to three factors: where does it appear, how big is it, and
> how long does it take to appear?"

> "it has to be fast enough that people hovering on a card for information get it promptly, but slow
> enough that moving your cursor around the battlefield or collection doesn't constantly pepper you
> with unwanted zooms."

> "We will not, however, offer personal customization of those settings."

Large Zoom "appears in the upper left corner and takes up half the height of the window," moving to
the center and "most of the vertical space" as of Aetherdrift, and is dismissed "on the next click
the player makes—anywhere on the screen." Triggers are the center mouse button and `Q` + hover.
`[NOT FOUND]`: no millisecond delay is published.

There is **no persistent zoom pane** in MTGO. `[MEASURED]` across all three official screenshots:
hover zoom is transient and Large Zoom is a modal overlay; nothing fills a fixed side panel. That is
the biggest structural difference between MTGO and the three open-source clients, all of which have
a permanent detail rail.

The card-size setting exists and is essentially undocumented. `[STATED by mtgo.com]`, and this is the
entire official documentation of it: "The gear icon is Settings – this lets you adjust card sizes,
volume, and accesses many of the auto-yields available by right-clicking inside the battlefield."
`[NOT FOUND]`: its range, its granularity, and whether it is per-zone. Do not assert a range.

### 3.4 What MTGO gives up

- **Static readability.** A card's rules text on the board is a truncated sentence. You are expected
  to zoom, and Daybreak has said so in the multiplayer documentation.
- **User control of the zoom.** Explicitly refused, in writing.
- **About 22% of window width** to two rails that hold no cards.
- **Board visibility while reading the stack**, since the stack is a window drawn on top of the
  battlefield. Draggability is the mitigation.
- Daybreak has acknowledged occlusion as a live class of defect:
  `[STATED by mtgo.com/news/mtgo-imprvmts-8292023]` "we've relocated opponent play clocks to their
  respective player information bars, away from the battlefield… This refined placement resolves an
  issue where cards on the battlefield occasionally found themselves partially concealed by the
  clock."
- Also worth recording: `[STATED by Daybreak, mtgo.com/news/frame-refactor]` card zoom was "a
  difficult-to-discover feature that significantly impacts players' ability to get information." A
  detail channel that people do not find is not a detail channel.

---

## 4. Forge, XMage, Cockatrice

These three matter more than their user counts suggest, because their source is readable and their
layout decisions are therefore facts rather than inferences. All constants below were verified at
pinned SHAs.

### 4.1 Forge: the geometry we should probably copy

Pinned at `22d3150aa7814ed5f9040d6b51022b501aa13033`. Forge's default match layout ships as XML with
fractional coordinates, `forge-gui/res/defaults/match.xml`:

| Cell | x, y, w, h | Contents |
|---|---|---|
| Left rail | 0.0, 0.0, **0.2**, 0.617 | REPORT_STACK, REPORT_COMBAT, REPORT_LOG, REPORT_DEPENDENCIES |
| Left rail | 0.0, 0.617, 0.2, 0.115 | **BUTTON_DOCK** |
| Left rail | 0.0, 0.732, 0.2, 0.268 | REPORT_MESSAGE, DEV_MODE |
| Center | 0.2, 0.0, **0.6**, 0.364 | FIELD_1 (opponent) |
| Center | 0.2, 0.364, 0.6, 0.368 | FIELD_0 (you) |
| Center | 0.2, 0.732, 0.6, 0.268 | HAND_0 |
| Right rail | 0.8, 0.0, **0.2**, 0.466 | CARD_DETAIL |
| Right rail | 0.8, 0.466, 0.2, 0.534 | CARD_PICTURE |

**20 / 60 / 20 columns. Both battlefields take 73.2% of window height. The action surface, the stack
and the log are in a rail that costs width, not height. The always-visible card preview is a second
rail.** This is the answer to our constraint, drawn by somebody who had to solve the same layout for
a full-rules engine, and it is the closest published geometry to what we need.

Card size is computed, not configured. `[MEASURED]` `CardPanelContainer` declares
`cardWidthMin = 50` and `cardWidthMax = 300`, whose setters have zero call sites, and
`PlayArea.doLayout` binary-searches down from the max for the largest width whose row-wrapping
template fits. There is no `UI_CARD_SIZE` preference at all. Every other card dimension is a ratio
of the resolved width: `ASPECT_RATIO = 3.5f / 2.5f`, `BLACK_BORDER_SIZE = 0.03f`,
`ROUNDED_CORNER_SIZE = 0.1f`.

Forge **reserves the tapped footprint in the horizontal pitch**: `PlayArea` L1309-1317 sets
`cardSpacingX = (cardHeight - cardWidth) + extraCardSpacingX`, so the pitch is about 1.44x the card
width even for untapped permanents. That is why a Forge board reads sparse.

Forge is the only client in this report with a **documented, user-selectable grouping policy**.
Verbatim from `forge-gui/res/languages/en-US.properties` L266-277:

```
nlGroupDefault=Creatures are never grouped or stacked. Identical lands, tokens, artifacts, and enchantments are stacked. Stacking fans cards out so each copy is partially visible.
nlGroupStack=Same as Default, but creatures are also stacked.
nlGroupCreatures=Group identical creatures and tokens into a single compact pile with a count badge.
nlGroupAll=Group all identical permanents into a single compact pile with a count badge.
nlMaxStackDepth=Maximum cards per stack or group on the battlefield. In Default and Stack Creatures modes, extra identical cards form a new pile next to the original. In Group modes, extras are hidden behind the topmost card with the count badge.
```

Backed by `UI_GROUP_PERMANENTS ("default")` and `UI_MAX_STACK_DEPTH ("4")` in `ForgePreferences`.
Stacking is diagonal at `STACK_SPACING_X = 0.12f`, `STACK_SPACING_Y = 0.12f` of card size.

Zoom is explicit rather than hover-triggered: wheel-forward, middle-click, or `Z`
(`SHORTCUT_CARD_ZOOM("90")`), rendering a full-window overlay at `"w 80%!, h 80%!"`
(`CardZoomer.java` L223, L253-255). Plain mouseover instead fills the permanent right rail.

Forge's mobile build makes the height-bound tradeoff explicitly:
`forge-gui-mobile/.../VField.doLayout` L242-258 is `float cardSize = height / 2;`, exactly two equal
rows, cards square-slotted so a tapped card fits. That is our current battlefield slot rule, arrived
at independently, and Forge only applies it on the surface where height is scarce.

**What Forge gives up:** ~40% of window width to two rails, ~44% of horizontal pitch to the tap
reserve, and all user control of card size.

### 4.2 XMage: the elastic battlefield

Pinned at `69c6353d618900b040459a5e3d7c4183cb651c8e`. Every zone's card size is
`312 * slider / 42` x `445 * slider / 42` px (`GUISizeHelper.java` L22-27). Sliders run **7-99**,
default 14, set per zone: `guiCardBattlefieldSize`, `guiCardHandSize`, `guiCardOtherZonesSize`, plus
five more for fonts and panels.

The battlefield value is **an average, not a size**:

```java
int battlefieldCardAvgSize = PreferencesDialog.getCachedValue(PreferencesDialog.KEY_GUI_CARD_BATTLEFIELD_SIZE, 14);
int battlefieldMinSize = guiSizeScale(battlefieldCardAvgSize, 0.5f);
int battlefieldMaxSize = guiSizeScale(battlefieldCardAvgSize, 1.5f);
```

The layout then walks down from max in `CARD_WIDTH_AUTO_FIT_INCREMENT = 10` px steps until the rows
fit. The registration string says so out loud: "Average permanents size on battlefield (app will
auto-size it depends on free space".

XMage ships resolution presets, which is the closest thing in this field to a published opinion about
how big a card should be at a given screen size. Order is dialogFont, chatFont, editorCard, tooltip,
playerPanel, **battlefieldCard**, handCard, otherZonesCard:

```
"1366 x 768"  → 10, 15, 17, 15, 10, 22, 14, 13
"1920 x 1080" → 17, 18, 23, 20, 14, 30, 22, 21
"2560 x 1440" → 23, 25, 35, 31, 18, 42, 31, 28
"3840 x 2160" → 34, 37, 50, 55, 27, 64, 50, 44
```

Two things fall out. First, **the vendor's battlefield card is nominally larger than its hand card**
at every resolution (30 vs 22 at 1080p), which is the opposite of our arrangement. Second, at
1366x768 the nominal battlefield card is 163x233, or 30.3% of viewport height, against our 12.0%.

Stacking is narrower than Forge's: only lands and tokens pile, `cardStackMax = 5`, and two permanents
merge only if they match on token-ness, name, original P and T, rules list, counters list, and
summoning sickness (`CardPluginImpl.java` L152-198). Like Forge, XMage reserves the tapped footprint
in the pitch.

Rules text uses the font ladder `RULES_TEXT_FONT_SIZES = {24, 18, 15, 12, 9}`
(`ModernCardRenderer.java` L144-156). Note that the bottom of that ladder, 9 px, is below every
published legibility floor in §6.4.

Zoom: a docked `BigCard` at a 0.85 split, plus a wheel-triggered floating popup at
`30 * tooltipFontSize` tall by 0.64x that wide, which is **326 x 510 px** at the default tooltip size
of 17.

**What XMage gives up:** ~15% of width to the docked BigCard, internal consistency (four incompatible
card aspect ratios coexist: 1.4263, 1.4, 1.4752, 1.5625, none of which is the real card's 1.3968),
and legibility at the bottom of the font ladder.

### 4.3 Cockatrice: the cautionary case

Pinned at `83fd65b34b4094094f052520e11ab2525442909b`. Constants: `WIDTH = 72`, `HEIGHT = 102` scene
units; `TABLEROWS = 3`; the table is a **fixed 406 scene units tall** (`10 + 30 + 3x102 + 2x30`) and
only its width ever changes.

The three rows are fixed by type, always: `table_zone.h` L156-158 maps `0 = creatures,
1 = noncreatures, 2 = lands`, with instants and sorceries folded into the noncreatures row. There is
no sorted/unsorted mode.

**Cockatrice's board has no zoom and no card-size control.** `game_view.cpp` L105-108 is the whole
of it:

```cpp
void GameView::updateSceneRect(const QRectF &rect)
{
    fitInView(rect, Qt::KeepAspectRatio);
}
```

On-screen card size is therefore viewport height divided by scene height, times 102, and the player
cannot touch it. A `CardSizeWidget` slider with range 50-250 exists in the codebase and its only call
sites are the deck editor and the various database and storage widgets; none is in `game_graphics`.
Hover magnification is a hardcoded `1.1`. The detail channel is a 250x360 docked card-info widget on
the right with three tabs.

The codebase names its own tradeoff. `appearance_settings_page.cpp` L486:
`tr("Display hand horizontally (wastes space)")`.

**What Cockatrice gives up:** everything. No board zoom, no size control, a fixed row structure that
cannot adapt, and a scene whose height is a constant. It is the client that gives up the most and it
is also the one whose board card size the user has the least influence over. That correlation is the
argument for having a zoom.

### 4.4 Draftmancer and untap.in

Neither draws a battlefield, but both are card grids under a size constraint and both made a choice.

**Draftmancer** is the only surface in this report with a real, persisted card-size slider:
`ScaleSlider.vue` range **0.1x to 2.0x**, step 0.01, applied through a CSS custom property on a
200x282 base, so a booster card runs 20-400 px wide. Packs are `display: flex; flex-wrap: wrap`, so
a 45-card pool wraps to six rows and the page scrolls. Zoom is right-click, not hover, into a popup
sized `calc(min(70vh, 90vw * 1.4 * 0.5))`, roughly 756 px tall on a 1080p desktop, about 2.7x the
grid card. It also carries `--card-title-height-factor`, read from
`customCardList.settings.cardTitleHeightFactor`, which is the only knob found anywhere designed
specifically for custom sets whose title and type lines differ from real cards.

**untap.in** hard-caps its board at **1600 x 888** with the aspect ratio locked at 1.8, and derives a
card as `0.0627 x boardWidth` by `0.1485 x boardHeight`, which is 100.3 x 131.9 px at the cap. A 4K
monitor buys zero extra board. There is no board card-size control and no board zoom; the only size
setting is a three-step hover preview at fixed rem sizes against a hard-pinned 13 px root, so it does
not scale with the display either. Its draft pack is a non-wrapping fanned row with
`min-width: 49rem` on a container that wants 126rem, so the cards compress while `figure{min-width}`
holds the art size. **Draftmancer wraps; untap fans.**

---

## 5. Outside Magic: the field caps the zone

The non-Magic field is included because the prompt asked how a board that grows is handled, and the
answer is nearly unanimous and nearly unavailable to us.

| Game | Board cap | Hand cap | Source |
|---|---|---|---|
| Hearthstone | 7 minions and locations combined | 10 | `[SECONDARY]` [hearthstone.wiki.gg/wiki/Board_space](https://hearthstone.wiki.gg/wiki/Board_space), [/wiki/Hand](https://hearthstone.wiki.gg/wiki/Hand) |
| Legends of Runeterra | 6 on the bench | 10; **stack capped at 9 plus one reserved Burst slot** | `[SECONDARY]` [wiki.leagueoflegends.com/en-us/LoR:Board](https://wiki.leagueoflegends.com/en-us/LoR:Board), [LoR:Spell/Fast](https://wiki.leagueoflegends.com/en-us/LoR:Spell/Fast) |
| Eternal | 12 units (a site counts as 2) | 12, discard to 9 | `[STATED by Dire Wolf]` [EternalAdvancedRules.pdf](https://d19y2ttatozxjp.cloudfront.net/pdfs/EternalAdvancedRules.pdf) §6.1-6.2 |
| Shadowverse | 5 total (followers plus amulets) | - | `[STATED by Cygames]` [shadowverse.com/help](https://shadowverse.com/help/) |
| Gwent | 9 per row, 2 rows | - | `[STATED by CDPR]` [Midwinter Update notes](https://www.playgwent.com/en/news/12391/midwinter-update-is-now-available) |
| Marvel Snap | 4 per location, 3 locations | - | `[SECONDARY]` |
| Yu-Gi-Oh Master Duel | 5 monster + 5 spell/trap zones | - | inherited from paper |

**Magic has no board cap and we cannot invent one.** The technique the entire non-Magic genre uses is
structurally unavailable to this project. That is worth stating plainly, because it means the
"cap the zone" answers in any general UX writeup do not apply here.

Three findings from that lane do transfer.

**Gwent deleted a row to make its cards bigger, and said so.** This is the only first-party statement
found anywhere that connects on-screen zone count to card size. `[STATED by CD Projekt, "GWENT
Homecoming", 2018-04-13]`, verbatim:

> "Currently, rows don't have direct impact on gameplay. If we count the hands of both players, we
> are looking at 8 rows in total. Our greatest visual assets — card art and premium versions of cards
> — are too small to shine in the current view. What we're aiming for is a complete overhaul of the
> visual experience. The redesign will leave no stone unturned. We are even considering cutting one
> of the rows and leaving only melee and range."

[cdprojekt.com/en/media/news/gwent-homecoming-see-whats-next-gwent](https://www.cdprojekt.com/en/media/news/gwent-homecoming-see-whats-next-gwent/).
They shipped it: the released game has two rows.

**Hearthstone substitutes the representation rather than scaling it.** A minion on the board is a
different object from a card in hand: portrait, attack, health, no rules text, detail on hover.
`[SECONDARY, GDKeys]`: "Cards placed on the board take a completely different shape, reducing their
information to the bare minimum." That is the most aggressive version of the technique our compact
face is a mild version of. It is only available to a game whose board objects have little text;
Magic's do not, which is exactly why MTGO prints other permanents' continuous effects inline on the
affected card in blue italics.

**The counter-example is Legends of Runeterra**, which kept the full rectangular card shape on the
board and paid in size. Two independent contemporaneous reviewers reported the result as unreadable:
`[SECONDARY]` "Card art is very small in comparison to the rest of the board… I have no clue what
cards are in my hand without mousing over"
([potwasher, 2019-10-18](https://potwasher.hatenablog.com/entry/2019/10/18/054422)) and
"on mobile, the central design slash size of the screen means you run out of screen real estate, and
don't have enough space to be able to see the cards in your hand properly… even zoomed in cards are
extremely hard to read"
([Zvi Mowshowitz, 2020-05-13](https://thezvi.substack.com/p/legends-of-runeterra-early-review)).

**A negative result worth recording, because it will otherwise be repeated:** the widely-cited claim
that Blizzard chose the 7-minion cap for UI reasons traces to an uncited 2016 HearthPwn forum post
by a non-employee, hedged with "IIRC"
([hearthpwn thread](https://www.hearthpwn.com/forums/hearthstone-general/general-discussion/170529-if-number-of-max-minions-on-board-is-reduced)).
Do not cite it. What Blizzard did say, via a dev interview quoted on the wiki, is that early card
designs were "too ornate and distracting from the base stats and casting costs of the minions, as
well as taking up too much space on the battlefield," and the fix was reducing the board object to
three core elements.

---

## 6. The recurring techniques

Consolidated, with who uses it, what it costs, and whether it is compatible with our constraint.
Section 7 works through the incompatible half.

| Technique | Who | What it buys | What it costs | Compatible with us? |
|---|---|---|---|---|
| **Action surface in a side rail, not a bottom bar** | MTGO (10.5% width), Forge (20% width) | Up to a third of the height budget | Rail width, which on a card row means fewer cards before overflow | **Yes**, and it is the biggest single lever |
| **Fit-to-fill card sizing** | Forge (binary search 50-300 px), XMage (walk down in 10 px steps within [0.5x, 1.5x]), Cockatrice (`fitInView`) | Large cards on empty boards, graceful degradation on full ones | Card size is no longer predictable, so nothing can assert a pixel figure in a test | **Yes** |
| **Stack identical permanents** | Forge (4 modes, depth 1-10), XMage (lands and tokens, max 5), MTGO (~10% horizontal offset), Arena | Pure density with no size loss | A pile hides the copies behind the top card | **Yes** |
| **Hover-zoom as the detail channel** | MTGO, Forge, XMage, Draftmancer, untap.in, Arena. Not Cockatrice. | Permission to draw a small board card | Discovery, which Daybreak names as a real defect | **Yes**, unconditionally: zero layout cost |
| **A permanent inspector rail** | Forge (20% width), XMage (0.85 split), Cockatrice (250x360 dock) | Detail with no gesture at all | The same width the action rail wants | **Yes, but competes with the action rail** |
| **Lands as something other than cards** | Nobody surveyed. Cockatrice gives lands their own row; XMage stacks them. | Half the battlefield back | Lands stop being readable as cards | **Yes, and we already do it** (more aggressively than anyone) |
| **Opponent's hand as a compact token** | MTGO (a count), Arena (hover-summoned counts) | A whole row | You cannot see the shape of their hand | **Yes, and we already do it** |
| **Stack as a transient overlay** | MTGO (draggable window), Arena (rail escalating to a browser at 4+ targets) | A permanent rail's worth of space | Occlusion of the board while you read it | **Yes**, and it would return 16rem of our width |
| **Text: hold the font and clip** | MTGO | Legible name and type at 100 px | Rules text is a truncated sentence | Yes |
| **Text: step the font down a ladder** | XMage `{24, 18, 15, 12, 9}` | Complete text | The bottom rungs are below every legibility floor | Partly |
| **Text: scroll inside the card** | Arena | Complete text at full size | Information behind a gesture on a small object | Partly |
| **Cap the zone** | Hearthstone, LoR, Eternal, Shadowverse, Gwent, Snap | Layout never has to degrade | Game rules | **No.** Magic has no board cap |
| **Delete a zone** | Gwent (8 rows to 4) | Card size, explicitly | A zone | **Mostly no.** See §7 |
| **Representation substitution** | Hearthstone (board minion is not a card) | Most of the space | Text-carrying permanents stop working | **Partly.** Magic permanents carry live text |
| **Overlap/fan a crowded row** | untap.in draft pack, MTGO under pressure | Density without shrinking | Card faces are partly hidden | Yes, for the hand |
| **Scroll a crowded row** | Arena (lands only, with an arrow) | Everything fits | State is hidden off the edge | **Yes, and it is what we currently do everywhere** |

### 6.1 A note on the tapped-footprint reserve

Three of three MTG clients that draw a rotatable permanent pay for rotation somewhere:

- Forge: `cardSpacingX = (cardHeight - cardWidth) + extraCardSpacingX`, so pitch is ~1.44x card width.
- XMage: the same expression, `cardSpacingX = cardHeight - cardWidth + 0.04 * cardWidth`.
- **MTGO: does not reserve.** A tapped permanent takes a landscape footprint and the row absorbs it.
- Ours: the slot is `aspect-ratio: 1` and the face is fitted inside at `height: 100%`, so the face is
  **0.716x the slot on the width axis**.

The difference that matters is *which axis is binding*. Forge and XMage are width-bound: the reserve
costs them horizontal room, and their card height comes from the window. We are height-bound: our
well's height sets the slot side, and the square slot then makes each permanent occupy 1.40x its own
width. So the reserve costs us **horizontal density**, and under a fit-to-fill scheme where size is
set by "N cards must fit in W," horizontal density converts directly into card size. Dropping the
square is worth up to 1.40x on the width axis at unchanged height.

### 6.2 What our compact face draws, and why the name vanished

`packages/ui/src/card/anatomy.ts` declares `COMPACT_REGIONS = ['title', 'type', 'footer']`. The
battlefield face therefore drops **the art window and the rules box** and keeps three text bars. The
comment says why: "A battlefield thumbnail is card-shaped shorthand, not a small card."

Every source in this report points the other way. MTGO keeps the art window at 100 px. Hearthstone's
board object is art plus two numbers. A working game-UI designer observing Master Duel on a phone:
`[SECONDARY]` "Even though I play on a smartphone and the card display is quite small, I can
surprisingly identify the cards by their illustrations"
([note.com](https://note.com/togetogedesign/n/nd49bef3af6da?hl=en)). **Art is the identification
channel that survives shrinking. Text is not.** We kept only the channel that does not survive.

And then the text channel failed too, for a mechanical reason worth writing down because it is a
general trap. `[DERIVED]` from the stylesheets, taking the measured 68.47 px face width as input:

```
face width                                     68.47 px
  - compact identity border, 5px x 2            10.00
  - card padding, --mtg-space-2 x 2             16.00
  = bar outer width                             42.47
  - bar border 1px x 2                           2.00
  - bar padding, --mtg-space-1 x 2 (small step)  8.00
  = bar inner width                             32.47
  - flex gap, --mtg-space-1                      4.00
  - two 0.8rem pips plus a 2px gap              27.60
  = width left for the name                      0.87 px
```

`.mtg-card__name` does everything right: `flex: 1`, `min-width: 0`, `overflow: hidden`,
`text-overflow: ellipsis`. It is not a truncation bug. **The mana pips are fixed-size and the name is
the only flexible sibling, so at three pips the name's share goes negative.** A one-pip cost leaves
15.67 px, which is why some permanents show a name and some do not. `mtg-bc2.129` already reached
this conclusion independently and its decided design moves the cost out of the title row; this
report is corroboration, not a new finding.

---

## 7. Our constraint, zone by zone

We must show at once, with no page scroll at 1280x800 and 1440x900: opponent's battlefield, the
stack, your battlefield, your hand, and a command bar enumerating every legal move. Our current
surface additionally shows two status lines, the opponent's hand as face-down chips, two graveyards,
the page head and the tab strip.

### 7.1 The height budget, measured

Three chromium measurements of our hand slot are recorded in `packages/ui/src/styles/board.ts`:
122 px at 1280x800, 175 px at 1440x900, 271 px at 1920x1080. `[DERIVED]` A linear fit across those
three points gives a slope of **0.532 px of card per px of viewport height** and an x-intercept at
**570 px**. Read plainly: about 570 px of viewport height is consumed by fixed chrome before the hand
row gets its first pixel, which at 1280x800 is **71% of the viewport**, and each additional pixel of
window height is worth about half a pixel of card.

That is the whole problem in one number, and it points at the fixed costs rather than at the card
rules. The largest single fixed cost is the command bar, which is `flex: none` with
`max-height: 32%` of the table and a floor of `5rem`.

### 7.2 The width budget, measured against the field

`[DERIVED]` at 1440 wide: the shell pays `--mtg-space-4` of padding each side, leaving 1408 px; the
mat is `grid-template-columns: minmax(0, 1fr) 16rem` with a `--mtg-space-2` gap, so the lanes column
gets 1144 px, or **81% of content width**, and the stack-and-graveyard rail gets 256 px, or 18.2%.

Against the field: MTGO gives its center column 76%, Forge gives its center 60%. **We are already
spending width more aggressively on cards than either of them, and height less aggressively.** We are
optimizing the axis that is not binding.

### 7.3 Which zones could change, and which could not

- **Both battlefields: cannot be removed, can be resized.** Our opponent's side already grows at
  `flex-grow: 1` against your side's `4`. Arena does the same thing with camera perspective at
  roughly 60/40 `[SECONDARY, GDKeys]`. This lever is already pulled.
- **Your hand: cannot be removed.** It is already a horizontal rail that scrolls rather than wraps.
  Fanning with overlap (untap.in's approach) would let it hold more cards at the same size, which is
  the only remaining move here.
- **The stack: can move from a permanent rail to a transient overlay.** MTGO's stack is a draggable
  floating window; Arena's is a collapsible rail that escalates to a centered browser at 4 or more
  targets. Ours is a permanent 16rem column that is empty most of the time. Moving it returns 18.2%
  of content width at the cost of occluding the board exactly when you want to read it, which is why
  MTGO made theirs draggable.
- **The graveyards: can become counters.** MTGO shows library as a count near the avatar and
  graveyard as a collapsible labeled row; Arena hover-summons all zone counts and opens graveyard and
  exile as modal browsers. Ours are two permanent panels in the rail.
- **The opponent's hand: already compressed** to a 14rem side track of 2rem face-down chips. MTGO
  shows it as a number. This is nearly fully spent.
- **The command bar: is the one zone nobody else has, and it is where the height went.** It is also
  the one zone that could move to the width axis, because it is a list and a list is happy in a
  column. Forge puts exactly this (BUTTON_DOCK plus the prompt) in a 20% left rail.
- **The status lines: cannot be removed** (life totals) but are already compressed to a single row
  on this route.

### 7.4 The either/or nobody escapes

At 1280 px wide, a 20% rail is 256 px. Forge affords **two** such rails because its action surface is
already inside one of them, so the second is pure profit; it then spends the remaining 60% of a wide
desktop window on cards. Cockatrice affords one and gives up zoom entirely. **We can afford one rail
at 1280 px**, because our action surface is a list of every legal move and it is larger than Forge's
button dock.
So the sharpest decision in this whole report is: the rail holds either the enumerated move list or
the card inspector, not both. Whichever loses the rail has to be served by an overlay: a hover-zoom
if the inspector loses, a bottom bar if the move list loses.

---

## 8. Recommended options

Four options. They are not exclusive except where stated. Costs are stated plainly, and the
reversibility of each is named, because this is a surface the playtester will judge by looking at it and
we should expect at least one of these to be reverted.

### Option A: Fit-to-fill the battlefield slot and stop reserving the square

Replace the play route's `aspect-ratio: 1` battlefield slot plus `MIN_SLOT_REM` floor with a 63:88
slot whose size is computed from the well's box and the permanent count, the way Forge's binary
search and XMage's step-down do, and let a tapped permanent take a landscape footprint the way MTGO
does rather than reserving a square for it.

- **Buys:** up to **1.40x on the width axis** at unchanged height, which under fit-to-fill converts
  to up to 1.40x on card size whenever the row is the binding constraint. Also makes a board of three
  permanents draw them large instead of at the same size as a board of twelve, which is the single
  most visible difference between our surface and every client in this report.
- **Costs:** tapping now reflows the row, which is exactly the property the direction-B decision
  bought with the square slot ("a tapped creature rotates inside its own slot rather than reflowing
  the row"). That decision is recorded in `docs/mockups/README.md` and would be partly reversed.
  Card size stops being a constant, so nothing can assert a pixel figure.
- **Reversibility: highest of the four.** It is confined to `packages/ui/src/styles/board.ts`, plus a
  small measured-layout hook if we want a true fit rather than a flex approximation. No component,
  no markup, no kernel.

### Option B: Move the command bar into a side rail and give the mat the vertical axis

Adopt Forge's `match.xml` geometry. A left rail carries the command bar and the stack; the center
column carries opponent battlefield, your battlefield, your hand and nothing else.

- **Buys:** up to **32% of the table's height**, which is the largest number available anywhere in
  this report. Given the 0.532 px-per-px slope measured in §7.1, that is the difference between our
  cards and the reference's.
- **Costs:** it reverses the direction-B decision recorded in `packages/ui/src/styles/views.ts`
  ("the move list is the thing you act with, so it sits where your hand is rather than off to the
  right in a side rail"), which was deliberate and argued. The mat loses about 20% of its width, so
  under Option A's fit-to-fill a crowded board gets a smaller card than it otherwise would. And
  `docs/mockups/README.md` already flags the unresolved case: a declare-blockers step can produce
  thirty or more options, and a 20%-wide rail holding thirty buttons scrolls. Forge's own rail gives
  the button dock only 11.5% of its height and puts the log above and the prompt below, so it is not
  obvious that a rail is more comfortable than a bar for a long enumeration.
- **Reversibility: medium.** It is `views.ts`, `board.ts` and the element order in
  `routes/play/PlayView.ts`. No component internals change. But it is the option most likely to be
  judged on feel rather than on measurement, and reverting it means re-tuning the height shares that
  were set against the bar.

### Option C: Put the art back on the compact face and make hover the real detail channel

Draw the art window on the battlefield face, move the mana cost out of the title row (already decided
in `mtg-bc2.129`), and replace the current 1.03 hover scale with a real hover-zoom: the existing
`size: 'full'` face, at its natural 244 x 341 px, in a fixed position, after a delay.

- **Buys:** the card at its current size starts saying which card it is, which is the half of "the
  cards need to be much bigger" that is not actually about size. Every source in §6.2 says art is the
  channel that survives. And the full face component already exists, so the zoom is a mount, not a
  render path.
- **Costs:** an art window on a set with no art is a hatched pending frame on every permanent in
  play, which is precisely the reason `docs/mockups/README.md` gave for not drawing it. 12 of the
  staged set's 90 cards now carry rasters, so the ground has moved but not all the way, and both that
  record and `mtg-bc2.70`'s scoping need updating rather than being quietly contradicted. The zoom
  also inherits MTGO's named problem: a detail channel people do not discover is not a detail
  channel.
- **Reversibility: high.** The region list is one array in `anatomy.ts`; the hover-zoom is additive
  and removable. Note that changing `COMPACT_REGIONS` touches the ADR-0002 parity surface, so read
  `packages/card-render/test/parity.test.ts` before assuming it is free.

### Option D: A persistent inspector rail instead of a hover-zoom

Direction C's left-column inspector, which is Forge's `CARD_DETAIL` + `CARD_PICTURE` rail, XMage's
docked BigCard, and Cockatrice's card-info dock. It fills from whatever you hover and never
disappears.

- **Buys:** the detail channel with no gesture, no delay to tune, and nothing to discover. Three of
  four open-source clients chose this over a pure zoom, and Daybreak's own writeup says why.
- **Costs:** **it is mutually exclusive with Option B at 1280 px wide** (§7.4). It also permanently
  spends width on a panel that shows one card, on a surface whose complaint is that cards are too
  small.
- **Reversibility: medium-high.** Purely additive markup and CSS, but it forecloses Option B until
  removed.

### Ordering

**A, then C, then B, then D as the alternative to C's zoom half.**

A and C compose, are the two most reversible, and between them address both halves of the complaint:
A makes the card bigger when there is room, C makes it legible when there is not. Neither touches the
zone layout, so neither can break the no-scroll requirement. Do those first and re-measure before
committing to B, because the 0.532 px-per-px slope means the measurement after A and C is the only
honest input to whether B's cost is worth paying.

B is the option that moves the number the most and is also the one that reverses a considered
decision, so it should be taken deliberately and with the thirty-option declare-blockers case
prototyped first, not assumed.

D should be taken only if we conclude the rail is better spent on reading than on acting, which would
be an argument that Forge's two-rail geometry cannot be compressed to one and that our command bar
belongs at the bottom after all. That is a coherent position; it is just the opposite of B.

---

## 9. Where hover-zoom fits

It is not a new mechanism for us. `mtg-bc2.129`'s decided design already states that "any text the
compact face clips is available in full on hover." Extending that from oracle text to the whole face
is a change of what the hover panel contains, not a change of whether there is one.

The design parameters are settled by prior art rather than open. Daybreak names the three variables
and refuses to make any of them a user setting: "where does it appear, how big is it, and how long
does it take to appear?" The published sizes, for calibration:

| Surface | Zoomed size | Placement | Trigger |
|---|---|---|---|
| MTGO Large Zoom | half the window height, later "most of the vertical space" | upper left, later centered | middle-click or `Q` + hover; dismissed on the next click anywhere |
| Forge `CardZoomer` | `w 80%!, h 80%!` of the window | full-window overlay | wheel forward, middle-click, or `Z` |
| XMage popup | **326 x 510 px** at default tooltip size | floating | mouse wheel; hover alone opens a text hint after 300 ms |
| Draftmancer | `min(70vh, 90vw * 1.4 * 0.5)`, ~756 px tall at 1080p | `position: fixed; top: 15vh` | right-click |
| untap.in | 312 x 416 px default, 390 x 520 px large | fixed preview box | hover |
| Cockatrice | none | - | - |

Our natural size is already declared: `.mtg-card` defaults to `--card-w: 15.25rem` with
`min-height: calc(var(--card-w) * 88 / 63)`, which is **244 x 341 px**. That sits between XMage's
326x510 and untap's 312x416 on the small side and is a reasonable starting point at 1280x800, where
341 px is 43% of viewport height.

Three things the sources say to get right:

1. **A delay is mandatory.** Daybreak: fast enough to be prompt, "slow enough that moving your cursor
   around the battlefield or collection doesn't constantly pepper you with unwanted zooms." No
   published millisecond figure exists in this field; XMage's 300 ms tooltip delay is the only number
   available and it is for a text hint, not a card.
2. **Fixed placement beats following the cursor.** Every client above pins the zoom to a corner, the
   center, or a fixed `top`. A zoom that tracks the pointer over a board is a zoom that covers what
   you were comparing it against.
3. **Discovery is a real defect, not a nitpick.** Daybreak calls their old zoom "a difficult-to-
   discover feature that significantly impacts players' ability to get information." If we ship
   hover-zoom as the reason it is acceptable for the board card to be small, it needs to be the
   default gesture and not a modifier key.

One thing prior art suggests we should differ on: Arena splits **hover** (current, modified state)
from **examine** (printed state), and given that our kernel owns all state and our cards are DSL
cards, the hover face showing live modified state is the more useful default. That is a two-mode
design, and there is no need to build the second mode first.

---

## 10. What this report does not settle

- **No pixel figure for an MTG Arena battlefield card exists in public writing.** Getting one means
  running the client and measuring it, and labeling it as measured by us. Everything else in the
  table has a source.
- **No published shrink factor, fan angle, or overlap coefficient for any of the non-Magic games.**
  Everyone does it; nobody has written it down.
- **MTGO's card-size slider range** is undocumented. The one official sentence about it is quoted in
  §3.3 and it is the whole of the record.
- **MTGO's stacking rules.** The behavior is measured from a screenshot; what qualifies for a stack
  (tapped vs untapped, counters, enchanted) is not documented and was not controlled for.
- **The one number that would close the legibility question analytically is a property of our own
  card frame and has never been measured for any card game.** The equation is
  `minimum card height = required x-height / (rules-text x-height as a fraction of card height)`. The
  numerator is settled by the literature: 0.2 degrees of visual angle for fluent reading and about
  0.083 degrees for bare identifiability (Legge & Bigelow 2011, *Does print size matter for reading?*,
  Journal of Vision 11(5):8, [doi 10.1167/11.5.8](https://jov.arvojournals.org/article.aspx?articleid=2191906)),
  which at arm's length works out to roughly 18 CSS px of font size for fluent reading. That figure
  converges with WCAG's large-text pixel equivalent of 18.5 px
  ([Understanding 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)) and with
  Microsoft's Xbox Accessibility Guidelines minimum of 18 px at 1080p for PC
  ([XAG 101](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/101)),
  which also publishes a screenshot-measurement procedure we could reuse directly. The denominator is
  ours to measure. Note in passing that our small-face step drops the name to
  `--mtg-text-xs: 0.6875rem`, which is 11 px, and that XMage's font ladder bottoms out at 9 px; both
  are below every floor named above.
- **Whether a 20%-wide rail is actually comfortable for a thirty-option declare-blockers prompt.**
  `docs/mockups/README.md` already flags this as untested for all three mockup directions. Option B
  depends on it and it should be prototyped before Option B is chosen.
- **WCAG 2.5.8 Target Size (Minimum)** requires an interactive element to be at least
  **24 x 24 CSS px**. Every card on our board is a `<button>`, so this binds independently of
  readability and no fit-to-fill floor may go below it.

---

## Addendum: Arena's official patch-note record

Added 2026-08-11 after a sweep of all 153 archived MTG Arena patch notes (2019 to 2026), read through
the Wayback Machine because the live support domain returns 403. Everything in this section is stated
by Wizards in a patch note rather than inferred from a screenshot, which makes it the strongest
evidence in this report about a client nobody outside Wizards can measure directly. The corpus is
retained outside the repo and is re-queryable.

Two findings change what is available to us.

**Arena spends no board space on the graveyard or exile.** Both open into an examinable browser on
click, and the browser is a whole subsystem rather than a popup: it scrolls, its sort order is a
defined contract, cards that are valid targets are hoisted to the front, and it can show both
players' zones at once. Patch Notes 2022.13 documents the ordering fix ("Sometimes the order of a
Graveyard or Exile zone would, when examined, go old to new, then in another browser it might go new
to old, and then in a third type of browser it might be random. They are now consistent, with the
caveat that if only certain cards are valid, they'll still be shifted to the front"), and 2021.04v2
confirms the library is click-to-open the same way. At least five browser types are named across the
corpus.

We draw both graveyards as always-visible lists in a fixed right column. Measured on our own surface
at 1440x900, that column is 257 px wide and everything below y=450 in it is empty. It is the largest
remaining reclamation after the move list, and the client with the most players does not spend it.

**Arena lets the stack occlude the battlefield rather than reflowing around it.** Patch Notes 2021.07:
"The handheld battlefield no longer adjusts itself each time the stack is up. Instead, to target
permanents behind the stack, users need to move the card out of the way (like on PC)." The direction
of that change is the useful part. Wizards had reflow on mobile and deliberately replaced it with
occlusion to match PC, rather than bringing reflow to PC. The phase ladder behaves the same way: it is
a right-edge overlay drawn on top of the artifact and enchantment area, and when it blocked targeting
on unsupported aspect ratios the fix was to move the overlay further right rather than to reflow the
board (Patch Notes 2025.47.00).

We give the stack its own row in the vertical budget. An overlay costs nothing when the stack is
empty, which is most of the game.

Three smaller corrections to what the community sources say:

- Right-click examine does not simply show flavor text. Flavor text is conditional on the card having
  no rules text: "Cards that have no rule text now display their flavor text, if any" (Patch Notes
  2021.07). Arena treats the text box as a functional surface first and a flavor surface second,
  which is the opposite of paper and is worth knowing before we decide what our own hover carries.
- The examine view is a named control set, not a single render: the default localized view, a
  **Printed Card** toggle, a perpetual-card view, and a "hanger" for attached tokens or dungeons that
  right-click cycles through (Patch Notes 2021.04, 2021.05.00, 2022.15.0).
- Hover is functional as well as informational. Mousing over a spell previews which mana sources Auto
  Tap will use (Patch Notes 2025.53.0). Wizards calls the hover render a "mouse over preview".

The opponent's hand is individually rendered card objects abutting the avatar, close enough that an
oversized avatar bust clipped them (Patch Notes 2026.57.50). It is not one aggregate pile.

**What the 153-article sweep could not settle, which is worth recording so nobody searches again.**
Zero official evidence exists for hover delay duration, the zoomed card's screen position, the zoom
size ratio, opponent-hand fanning or card-back styling, hand overlap thresholds, or a card-detail side
panel. These are not gaps in the search. They are gaps in the published record, and settling any of
them requires direct observation of a running client rather than documentation.
