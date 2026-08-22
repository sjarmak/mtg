# Prior art: custom-set ecosystem tooling

Lane: what existing bundles can the MTG lab adopt wholesale or interop with, instead of building?
Researched 2026-08-09. All repo metadata (license, stars, last push, archive status) pulled from the
GitHub API on this date; licenses verified against the repos' own license files where stated.
Related lanes (rules engines, 17lands, LLM generation prior art, design canon) are out of scope here
except where a tool crosses into them.

---

## Executive summary

The custom-set ecosystem already has a working "trio" pattern that hobbyist set designers use today:
**design in MSE → draft on Draftmancer → play on Cockatrice**, with Forge as the play-with-real-rules
outlet (see e.g. [daatg/custom-magic](https://github.com/daatg/custom-magic), a repo whose entire
purpose is "Custom MTG set hosting for Draftmancer/Planesculptor/Cockatrice etc."). Every leg of that
trio has an open, documented file format. **Our set generator should emit those formats directly** —
that buys drafting vs bots, human multiplayer playtesting, and a full-rules engine before we write a
line of UI.

Key findings:

1. **Draftmancer is the standout adopt.** MIT, actively maintained TypeScript, self-hostable, and its
   custom-set format is the only open format found anywhere that couples custom card definitions with
   booster-collation rules (sheets, print runs, pack layouts). Its bot layer is pluggable and its
   fallback bot drafts custom sets using a per-card `rating` field we control.
2. **There is no reusable open-source card renderer that is both license-clean and batch-oriented.**
   CardConjurer's continuation forks carry no license and ship WotC-derived frame assets (the original
   was killed by a WotC cease-and-desist in Nov 2022); Proxyshop needs Photoshop; MSE is a GUI-first
   C++ app whose high-quality template packs are unlicensed WotC-derived art. The cleanest path is a
   small in-house HTML/CSS renderer over headless Chromium (Playwright is already in our stack) with
   original frame art — the mtgrender project proves the pattern works.
3. **Interop formats are cheap and well-documented**: Cockatrice `cockatrice_carddatabase` v4 XML,
   Forge `res/editions` + card-script folders, MTGA decklist text, Cockatrice `.cod`. Writers for all
   of these are days, not weeks.
4. **Novelty check: no existing open toolchain does generate → validate → simulate → draft for custom
   sets.** The closest things are hosted set-database sites (Planesculptors, dormant since a 2022
   storage crisis; Multiverse, a design-feedback DB) and a zero-star GPT skeleton-filler
   (netn10/MTG-Set-Generator, all-rights-reserved). The lab's core loop is genuinely unbuilt; the
   edges (draft, play, deck formats) are solved and should be inherited.

### Recommended interop surface (what we read/write natively)

| Direction | Format | Why |
|---|---|---|
| **Write** | Draftmancer custom-set text format (`[CustomCards]` JSON + sheet/layout sections) | Instant draft-vs-bots and multiplayer drafts of our sets; collation spec included |
| **Write** | Cockatrice card DB XML (v4) + card images | Human playtesting on a mature, actively maintained multiplayer client |
| **Write** | Forge edition `.txt` + card scripts (mappable subset) | Full-rules AI playtesting (pending engine-lane verdict on Forge itself) |
| **Read + write** | MTGA-style decklist text (`4 Name (SET) 123`, `Deck`/`Sideboard` sections) | De-facto universal deck exchange format; Draftmancer emits it too |
| **Read** | `.dec`/plain `.txt` decklists; Cockatrice `.cod`; CubeCobra CSV | Cheap importers; meets users where their decks live |
| **Write (optional, later)** | Cockatrice `.cod`; TTS custom-deck sheets + saved object | `.cod` is trivial XML; TTS gets physical-table feel for playtest groups |
| **Internal canon** | Scryfall-shaped JSON per card | Both Draftmancer custom cards and Cockatrice XML are near-mechanical projections of it; mtgrender renders straight from it |

Deliberately **not** speaking: MTGO `.dek` (card identity is MTGO's internal `CatID` — meaningless
for custom cards), XMage (custom cards are Java classes; no data-driven custom-set path).

---

## 1. Draft simulators

### 1.1 Draftmancer — **ADOPT**

- Repo: [Senryoku/Draftmancer](https://github.com/Senryoku/Draftmancer) · hosted at [draftmancer.com](https://draftmancer.com)
- License: **MIT** (GitHub API license detection, 2026-08-09)
- Stack: TypeScript — Node backend, Vue client
- Activity: pushed **2026-08-06**; 116 stars, 49 forks, 4,377 commits; not archived
- Self-hosting: documented (`npm install && npm run build && npm start`), Dockerfile included

**Custom set support** is first-class and documented at
[draftmancer.com/cubeformat.html](https://draftmancer.com/cubeformat.html). The format is a text file:
one card per line (`[Count] CardName [(Set) [CollectorNumber]]`), with optional bracketed sections:

- `[CustomCards]` — a JSON array defining fully custom cards. Required: `name`, `type`, `mana_cost`
  (Scryfall symbology, e.g. `{5}{G}{G}`). Optional: `oracle_text`, `power`/`toughness`/`loyalty`,
  `rarity`, `subtypes`, `colors`, `image`/`image_uris` (URL, per-language), `back` (double-faced),
  `layout` (`split`, `flip`, `split-left`), `related_cards`, `printed_names`, `draft_effects`
  (conspiracy-style: `FaceUp`, `Reveal`, `CanalDredger`, `CogworkLibrarian`, `AddCards`…), and
  **`rating`** (see bots below).
- Sheet sections `[SheetName {collation}]` with collation modes `random` (default), `printRun`
  (+`groupSize`), `striped` (+`length`, `weights`) — enough to emulate real print-sheet collation.
- `[Settings]` with `layouts`: named pack layouts with `weight` and per-slot sheet counts, including
  weighted multi-sheet slots. Simple form: `[SlotName(CardsPerBooster)]`.
- Documented limitation: custom card lists disable Restrict-to-Collection, Maximum rarity, Maximum
  duplicates, and Foil options.

This is the only open format found in this research that specifies **both** custom cards and booster
collation. Our set generator should treat it as a primary compile target: set skeleton → sheets +
layouts, card DSL → `[CustomCards]` entries.

**Bot quality** (verified in source,
[`src/Bot.ts`](https://github.com/Senryoku/Draftmancer/blob/master/src/Bot.ts) and
[`src/bots/`](https://github.com/Senryoku/Draftmancer/tree/master/src/bots)):

- Draftmancer prefers **external bot services**, in order: MTGDraftBots set-specific model →
  DraftmancerAI set model → CubeCobra bots → MTGDraftBots prod model → fallback `SimpleBot`
  (comment in `fallbackToSimpleBots()`).
- `fallbackToSimpleBots()` states: *"No external bot handles custom cards, unless they all have
  associated oracle IDs"* — **custom sets always get `SimpleBot`**.
- `SimpleBot.getScores()` = card `rating` + `0.35 ×` count of already-picked cards per color. So for
  custom sets, bot pick quality is exactly as good as the `rating` values in the cube file — which
  **we** emit. An LLM pass assigning Limited ratings per card directly upgrades draft bots with zero
  Draftmancer changes.
- The external-bot request shape
  ([`src/bots/ExternalBotInterface.ts`](https://github.com/Senryoku/Draftmancer/blob/master/src/bots/ExternalBotInterface.ts))
  is small: `{pack, picked, seen[], packNum, numPacks, pickNum, numPicks}` over card identifiers.
  On a self-hosted instance we can stand up our own bot service (trained on our self-play data)
  behind this interface — the draft-lab pick-model slot is already plumbed.

**Interop**: exports decks to MTGA and MTGO formats (verified:
[`client/src/exportToMTGA.ts`](https://github.com/Senryoku/Draftmancer/blob/master/client/src/exportToMTGA.ts),
`exportToMTGO.ts`). Card data via Scryfall. Draft logs are recorded (`src/DraftLog.ts`) — a
machine-readable record of every pick, useful as training/eval data for our own bots.

Verdict: **adopt** — self-host it as the lab's human-facing draft surface; emit its format; later,
plug our own bot service into its external-bot interface.

### 1.2 dr4ft — **SKIP** (in favor of Draftmancer)

- Repo: [dr4fters/dr4ft](https://github.com/dr4fters/dr4ft) (lineage: dr4ft-info / arxanas' original)
- License: **MIT** (README: "The project is unaffiliated with Wizards of the Coast, and is licensed
  under the MIT license.")
- Stack: Node/ES6, React, SocketIO; self-hostable incl. Docker
- Activity: pushed 2026-05-22; 118 stars, 67 forks, 1,206 commits; not archived

Supports custom set import and cube/chaos formats, but its custom-set support, collation control, and
bot story are all shallower than Draftmancer's, and there is no external-bot interface. Two live MIT
draft sims is one more than we need. Documented reason: strictly dominated by Draftmancer for our use
case. Keep as a reference implementation of a second draft-server architecture.

### 1.3 CubeCobra — **INTEROP**

- Repo: [dekkerglen/CubeCobra](https://github.com/dekkerglen/CubeCobra) · [cubecobra.com](https://cubecobra.com)
- License: **Apache-2.0**
- Activity: pushed **2026-08-09** (same-day); 263 stars, 146 forks; not archived

The de-facto cube management platform (lists, playtest drafts, analytics). Draftmancer already
imports CubeCobra cubes and can use CubeCobra's bots for real-card pools. Its CSV cube format is a
name-keyed spreadsheet (quoting rules per
[issue #2499](https://github.com/dekkerglen/CubeCobra/issues/2499)); a read-importer is cheap and
lets users bring existing cubes into the deck/cube lab. Not an adopt: it is a site-scale web app
oriented at real cards, not a library. The associated draft-bot ML lives in
[CubeArtisan/mtgdraftbots](https://github.com/CubeArtisan/mtgdraftbots) — **AGPL-3.0**, dormant
(pushed 2023-04) — treat as **inspire** only (architecture/features), and note the AGPL boundary:
do not vendor its code into our stack.

---

## 2. Card rendering (data → image at set scale)

### 2.1 CardConjurer and its forks — **SKIP** (license + IP), inspire for frame anatomy

History (the cautionary tale for this whole project):

- CardConjurer, by then-student Kyle Burton, went live 2020 as a free web-based MTG card composer and
  became the most popular custom-card renderer
  ([Cal Poly CIE profile](https://cie.calpoly.edu/hatchery-spotlight-card-conjurer/)).
- WotC (via Reynolds Law) served a **cease-and-desist on 2022-11-03**, citing reproduction of Magic
  trademarks and logos and copying of card text and artwork; Burton took the site down
  **2022-11-18** ([TechRaptor](https://techraptor.net/tabletop/news/wizards-cds-card-conjurer-causing-closure),
  [TheGamer](https://www.thegamer.com/wizards-of-the-coast-shuts-down-popular-custom-mtg-card-site/)).

Current state of the code:

- The pre-rewrite 2018 codebase survives at
  [shopglobal/cardconjurer](https://github.com/shopglobal/cardconjurer) — **GPL-3.0**, but frozen at
  2018-10 (275 forks of historical interest only).
- The widely used continuation is [joshbirnholz/cardconjurer](https://github.com/joshbirnholz/cardconjurer)
  — **no license file** (repo root has only `README.md`; verified via API contents listing
  2026-08-09), 134 stars, actively pushed (2026-08-09), Docker `make start` → `localhost:4242`,
  `local_art` directory support. Stated purpose: keep the app usable locally and "maintain templates
  in perpetuity."
- [Investigamer/cardconjurer](https://github.com/MrTeferi/cardconjurer) — no license, 237 stars,
  dormant since 2024-08. Assorted small forks
  ([ayan4m1/cardconjurer](https://github.com/ayan4m1/cardconjurer) — 2 commits, Docker wrapper;
  [patmol25/Card-Conjurer-Reborn](https://github.com/patmol25/Card-Conjurer-Reborn) — 2 stars,
  dormant) add nothing.

Verdict: **skip** as a dependency. Unlicensed code (default all-rights-reserved) plus bundled
WotC-derived frames, borders, and symbols — exactly the assets the C&D named. Fine as a local manual
tool for a designer's one-off mockups; unusable as the lab's render pipeline. Its layered frame
anatomy (frame/legendary crown/pinline/textbox layer stack, per-layer masks) is worth reading once
before designing our own frame kit.

### 2.2 Proxyshop — **SKIP** (Photoshop dependency)

[Investigamer/Proxyshop](https://github.com/Investigamer/Proxyshop) — **MPL-2.0**, 147 stars, pushed
2025-12-16. Photoshop automation producing the highest-quality renders in the hobby, template
ecosystem included. Requires Adobe Photoshop — a GUI, licensed, Windows/mac dependency that cannot run
in our headless Linux batch pipeline. Documented reason: hard dependency mismatch. MPL-2.0 makes its
template/layout *data* a legitimate reference if we ever want print-quality output.

### 2.3 Magic Set Editor 2 — **INTEROP** (import source), not our renderer

- Upstream repo: [twanvl/MagicSetEditor2](https://github.com/twanvl/MagicSetEditor2) — license
  **GPL-2.0** (verified verbatim from
  [COPYING](https://raw.githubusercontent.com/twanvl/MagicSetEditor2/master/COPYING): "GNU GENERAL
  PUBLIC LICENSE Version 2, June 1991"). C++/wxWidgets, 131 stars.
- Upstream activity: last code push **2023-01-19**; last GitHub release
  [v2.1.2, 2020-09-28](https://github.com/twanvl/MagicSetEditor2/releases). Upstream is dormant.
- The living distribution is community-run: [magicseteditor.boards.net downloads](https://magicseteditor.boards.net/page/downloads)
  currently offers **v2.5.8** (Standard/Lite/Advanced/Non-Magic variants), with installers and
  template packs on the [MagicSetEditorPacks](https://github.com/MagicSetEditorPacks) GitHub account —
  `Full-Magic-Pack` (144 stars) and `Installer-Pack` both pushed **2026-08-08**. The template packs
  carry **no license** and are WotC-derived frame art.
- Function: desktop GUI card/set designer; renders card images; set statistics; exports to HTML,
  Apprentice, CCG Lackey ([README](https://github.com/twanvl/MagicSetEditor2)); community exporters
  bridge to the rest of the ecosystem: MSE→Cockatrice XML (with
  [mse-export-fixer](https://pypi.org/project/mse-export-fixer/1.1.0/) to clean it up),
  MSE→Draftmancer ([Tvpattack/MSE-Draftmancer-Exporter](https://github.com/Tvpattack/MSE-Draftmancer-Exporter)),
  MSE→Forge (community card-script DB
  [FLAREdirector-mse/MSE-Forge-Database](https://github.com/FLAREdirector-mse/MSE-Forge-Database), no license, dormant 2022).

Verdict: **interop, one direction**. MSE is where existing human custom-set designers live (the MSEM
community standard), so a "import from MSE set file" path future-proofs collaboration — but as a
renderer it is wrong for us: GUI-first C++ automation-hostile at set scale, dormant upstream, and its
best templates are IP-encumbered. Do not build on it; accept its files later if collaborators ask.

### 2.4 mtgrender — **INSPIRE**

[Senryoku/mtgrender](https://github.com/Senryoku/mtgrender) (same author as Draftmancer) — no
license, 5 stars, pushed 2025-11-23, self-described "a mess" and "not actively maintained". Renders
high-quality M15-style cards (incl. planeswalkers, DFCs, sagas, extended/full-art frames) in the
browser from Scryfall-shaped card JSON, with quick Scryfall import. Verdict: **inspire** — it is the
proof-of-pattern for our chosen path (Scryfall-shaped JSON → HTML/CSS → image), and its handling of
mana-symbol substitution and text auto-sizing is worth reading. Cannot adopt: unlicensed and unmaintained.

### 2.5 Other renderers surveyed

- [mtg.design](https://mtg.design/) — hosted web renderer; a GitHub repo exists
  ([CypherpunkArmory/mtg.design](https://github.com/CypherpunkArmory/mtg.design), not a fork, no
  license, 1 star). **Skip**: unlicensed, hosted-first.
- [MTGCardBuilder](https://mtgcardbuilder.com/) and [CardSpire](https://cardspire.app/) — closed
  hosted tools. **Skip**: no source, no license, no API.
- "HighspireCards" (seed name from the lane brief) — **no such tool found** under that name after
  dedicated searches; nearest matches are the hosted builders above. Treated as unverifiable.
- [andymeneely/squib](https://github.com/andymeneely/squib) — **MIT**, 954 stars, pushed 2026-04-07,
  active. A Ruby DSL for prototyping card games: CSV/spreadsheet in, Cairo-rendered PNG/PDF sheets
  out, fully headless. Wrong language for our TS stack and not MTG-framed, but the best open example
  of "data-driven deck rendering as code" and of print-and-play sheet output. **Inspire** (and a
  plausible stopgap for ugly-but-functional playtest proxies if we ever need them pre-renderer).

### 2.6 Symbol fonts — **ADOPT** (with an IP caveat)

- [andrewgioia/mana](https://github.com/andrewgioia/mana) (mana/tap/card-type symbols): README
  license section, verbatim: font under **SIL OFL 1.1**; CSS/LESS/Sass under **MIT**; and "All mana,
  tap, and card type symbol images are copyright Wizards of the Coast". 405 stars, pushed 2026-03-25.
- [andrewgioia/keyrune](https://github.com/andrewgioia/keyrune) (set symbols): same split per its
  README/LICENSE.md; set symbols are WotC trademarks. 545 stars, pushed 2026-05-02.

Verdict: **adopt** for lab-internal rendering (the entire ecosystem uses them). Caveat, per the
files' own terms: the glyph *designs* are WotC's — consistent with our theme-indirection/IP-safety
principle, publicly shipped bundles should be able to swap to redrawn original symbols; custom sets
generate their own set symbol regardless.

### 2.7 Recommended render path

Build a small in-house renderer: **card DSL/Scryfall-shaped JSON → HTML/CSS templates → headless
Chromium (Playwright, already in the inherited stack) → PNG**, with original frame art generated via
the the prior project art pipeline (LoRA style-lock works for frames as well as illustrations). Rationale:
every existing high-quality renderer is either unlicensed + WotC-IP-encumbered (CardConjurer forks,
MSE template packs) or dependency-hostile (Proxyshop). The pattern is proven (mtgrender), the fonts
are adoptable (OFL/MIT), batch rendering 250+ cards headlessly is exactly what Playwright is for, and
original frames are what keeps the flagship set publishable under the
[WotC Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy) given the
CardConjurer precedent.

---

## 3. Play surfaces for interop

### 3.1 Cockatrice — **INTEROP** (write its XML)

- Repo: [Cockatrice/Cockatrice](https://github.com/Cockatrice/Cockatrice) — **GPL-2.0**, 1,815
  stars, pushed **2026-08-09**; very active. Cross-platform Qt virtual tabletop (rules-free: players
  enforce rules themselves).
- Custom set format ([wiki: Custom Cards & Sets](https://github.com/Cockatrice/Cockatrice/wiki/Custom-Cards-&-Sets)):
  `<cockatrice_carddatabase version="4">` containing `<sets>` (code, longname,
  `settype`=Custom, releasedate) and `<cards>`; per card: `<name>`, `<text>`, `<prop>` with
  `layout`, `type`, `maintype`, `manacost`, `cmc`, `colors`, `pt`, `loyalty`, per-format legality;
  `<set rarity=".." uuid=".." num=".." picurl="..">CODE</set>`; `<token>`, `<cipt>`,
  `<upsidedown>`, `<related>`/`<reverse-related>`, `<tablerow>`.
- Deployment: numbered XMLs in the `customsets` folder (max **25** extra databases, first occurrence
  wins); images in `pics/CUSTOM` named `CardName.png` / `CardName_SET.png` /
  `CardName_SET_num.png`.

Verdict: **interop**. A Cockatrice XML + image-folder emitter is a small mechanical projection of our
card records and instantly gives generated sets a mature multiplayer client for human playtests. This
is also the export target the one existing AI set generator chose (§5.3) and what MSE's community
exporter targets — it is the play-surface lingua franca for custom cards.

### 3.2 Forge — **INTEROP** (custom-set folders); engine verdict belongs to the engine lane

- Repo: [Card-Forge/forge](https://github.com/Card-Forge/forge) — **GPL-3.0**, 2,587 stars, pushed
  **2026-08-09**; very active. Rules-enforcing engine with AI opponents, drafting, sealed, quest modes.
- Custom set path ([wiki: Creating a custom set](https://github.com/Card-Forge/forge/wiki/Creating-a-custom-set),
  [Creating a custom Card](https://github.com/Card-Forge/forge/wiki/Creating-a-custom-Card)): each
  card = a `.txt` script in `res/cardsfolder/...` (`Name:`, `ManaCost:` (symbols space-separated),
  `Types:`, ability script lines; `#` comments; lowercase_underscore filenames); each set = a `.txt`
  in `res/editions/` listing `collector-number rarity Card Name @Artist` lines (e.g.
  `81 R Goblin Card Guide @Forge Team`); images in `cache/pics/[set code]`.
- The MSE community already runs an MSE→Forge pipeline
  ([MSE-Forge-Database](https://github.com/FLAREdirector-mse/MSE-Forge-Database)), evidence that
  "custom set as Forge folder" is a practiced workflow, not a theory.

Verdict: **interop**. Whatever the engine-lane decision, a Forge-folder exporter for the mappable
subset of our DSL gives us a second, fully rules-enforced opinion on playability plus decent built-in
AI — valuable as a cross-check for our own sim. The card-*script* translation (our DSL → Forge
ability scripts) is the only non-mechanical part; scope it to the vertical-slice mechanic subset first.

### 3.3 XMage — **SKIP** for set interop

[magefree/mage](https://github.com/magefree/mage) — **MIT**, 2,328 stars, pushed 2026-08-09. Very
active engine, but each card is a hand-written Java class; there is no data-driven custom-set folder
comparable to Forge's. Adding a generated set means generating and compiling Java. Documented reason:
interop-hostile for generated content. (Engine lane may still evaluate it as an engine.)

### 3.4 Tabletop Simulator — **INTEROP (optional, later)**

- Import model ([TTS KB: Custom Deck](https://kb.tabletopsimulator.com/custom-content/custom-deck/)):
  decks are "card sheet" grid images cut up by the engine; grid width/height configurable; the final
  image on a sheet is the hidden/back face; imported via Objects → Components → Custom → Deck (face
  URL, back URL, width, height, number, unique-backs flag). Trivially generatable from our rendered
  card PNGs with an image compositor.
- Existing tooling: [jeandeaual/tts-deckconverter](https://github.com/jeandeaual/tts-deckconverter)
  — **MIT**, 42 stars, dormant (pushed 2023-03) — generates TTS decks from deck sites/Scryfall;
  [Frogtown](https://www.frogtown.me/) is the hosted equivalent. Both are real-card-oriented; for
  custom cards we'd composite our own sheets anyway.

Verdict: **interop, optional**. TTS is proprietary paid software, so it is never the primary surface,
but a sheet-compositor + saved-object JSON writer is ~a day of work and gives playtest groups a
physical-table feel. Do after Cockatrice, not before.

---

## 4. Deck & collection file formats

| Format | Shape | Source | Our verdict |
|---|---|---|---|
| **MTGA decklist text** | `4 Aurelia, Exemplar of Justice (GRN) 153` per line; sections separated by blank line or labeled `Deck` / `Sideboard` / `Commander` / `Companion`; names case-insensitive | [MagicArena wiki: Deck Import](https://magicarena.fandom.com/wiki/Deck_Import), [Draftsim export guide](https://draftsim.com/mtg-arena-export-deck/) | **Adopt** as our canonical human-readable deck format (works unchanged with custom set codes; Draftmancer emits it) |
| **Plain `.txt` / `.dec` (Apprentice lineage)** | `4 Card Name`; sideboard via `SB:` prefix or `Sideboard` separator | [Cockatrice deck docs](https://cockatrice.github.io/docs/d0/d51/exporting_decks.html), [MTGSalvation on .dec](https://www.mtgsalvation.com/forums/the-game/other-formats/772372-import-old-dec-files-now) | **Interop (read)** — legacy but still everywhere |
| **Cockatrice `.cod`** | XML `<cockatrice_deck>` → `<deckname>`, `<comments>`, `<zone name="main">`/`"side"` with `<card number=".." name=".."/>` | [Cockatrice deck docs](https://cockatrice.github.io/docs/d0/d51/exporting_decks.html), [example file](https://github.com/Cocatrix/mtg-cockatrice-decks/blob/master/Z%20-%20Liste.cod) | **Interop (read + write)** — trivial, pairs with our Cockatrice set export |
| **MTGO `.dek`** | XML; `<Cards CatID=".." Quantity=".." Sideboard=".." Name=".." />`; `CatID` is MTGO's internal card id, distinct from Multiverse IDs | [docs.fileformat.com/game/dek](https://docs.fileformat.com/game/dek/), [Cockatrice issue #4247](https://github.com/Cockatrice/Cockatrice/issues/4247) | **Skip** — card identity is a proprietary id we can't mint for custom cards; read-only import is possible but low value |
| **Draftmancer cube/custom-set format** | See §1.1 — card lines + `[CustomCards]` JSON + sheets/layouts | [cubeformat.html](https://draftmancer.com/cubeformat.html) | **Adopt (write)** — doubles as our custom-set + collation bundle |
| **CubeCobra CSV** | Name-keyed spreadsheet of a cube list (quote names containing commas) | [CubeCobra issue #2499](https://github.com/dekkerglen/CubeCobra/issues/2499), [export UI](https://printacube.com/cube-cobra-export-how-to-export-a-list-for-mtg-cube-printing/) | **Interop (read)** — cube import for the deck/cube lab |

---

## 5. Set generation / set management toolchains (the novelty check)

Searched GitHub (`mtg custom set`, `mtg set generator`, `magic the gathering card generator`,
`planesculptors`, `mtgdraftbots`, `draftmancer`, `magic set editor` and variants) plus web searches.
Findings:

### 5.1 Planesculptors.net — **SKIP** (dormant hosted service), inspire for hosting UX

[planesculptors.net](https://www.planesculptors.net/) hosted ~a thousand custom sets (MSE-file
uploads, rendered spoilers, draft support). As of April 2022 it ran out of server space; historical
set versions are no longer preserved and PNG uploads were disabled; the creator has said the code is
public and offered DB migration to anyone who would host it. No canonical source repo surfaced in
GitHub search. Evidence of demand for set hosting; not a component.

### 5.2 Multiverse (magicmultiverse.net) — **INSPIRE**

[Multiverse](https://www.magicmultiverse.net/about), by Alex Churchill: a database for custom set
*design work* — store designs, collect feedback, track skeleton/task state, export to useful formats
(a community [Multiverse→MSE2 export script](https://www.mtgsalvation.com/forums/magic-fundamentals/custom-card-creation/653342-magic-multiverse-mse2-export-script)
exists). Hosted Rails-era service; no confirmed public source repo. **Inspire**: its
skeleton-tracking + feedback-loop workflow is the closest existing thing to our "set under
construction" state model.

### 5.3 netn10/MTG-Set-Generator — **SKIP** (license), but confirms the pipeline shape

[netn10/MTG-Set-Generator](https://github.com/netn10/MTG-Set-Generator) — 0 stars, README: "All
rights reserved. This project is made for education porpuse only." GPT-based generation over Mark
Rosewater's design-skeleton slots; exports JSON, CSV, and **Cockatrice XML** for playtesting.
Unusable (no license grant) and shallow (no validation, no simulation, no draft integration), but it
independently converges on our conclusions: skeleton-slot-driven generation and Cockatrice as the
playtest export.

### 5.4 mtgencode — **INSPIRE**

[billzorn/mtgencode](https://github.com/billzorn/mtgencode) — **MIT**, 167 stars, dormant (pushed
2023-10). Data-management utilities for neural-net card generation (the RoboRosewater lineage):
canonical compact card encoding, field ordering, symbol normalization, corpus round-tripping.
Pre-LLM, but its careful card-text encoding decisions (what to normalize, how to delimit fields,
reserved-word handling) are directly relevant to our card DSL and to prompt/corpus design.

### 5.5 Glue tools found (evidence of the ecosystem's seams)

- [fenhl/magic-set-generator](https://github.com/fenhl/magic-set-generator) — MIT, dormant 2023:
  card names → MSE set files ("json-to-mse"). Confirms MSE-file emission is automatable if we ever
  need it.
- [Tvpattack/MSE-Draftmancer-Exporter](https://github.com/Tvpattack/MSE-Draftmancer-Exporter) — MSE →
  Draftmancer bridge (community, dormant).
- [mse-export-fixer](https://pypi.org/project/mse-export-fixer/1.1.0/) — fixes MSE's Cockatrice XML
  exports.
- [daatg/custom-magic](https://github.com/daatg/custom-magic) — a set hosted simultaneously for
  "Draftmancer/Planesculptor/Cockatrice etc.", i.e. the interop surface we propose is exactly how
  practitioners already distribute custom sets.
- [ZacharyRSmith/dreamborn_to_draftmancer](https://github.com/ZacharyRSmith/dreamborn_to_draftmancer)
  — MIT; even non-MTG games (Lorcana) compile into Draftmancer's format, evidence of its generality.

**Conclusion of the novelty check**: nothing on GitHub or the open web combines set generation with
validation, simulation, and draft/play export. The lab's core (generator + enforceable DSL + sim +
playability CI) is net-new; everything downstream of "the set exists as data" is inheritable via the
formats above.

---

## 6. Verdict table (one line each)

| Artifact | License (verified) | Status (last push) | Verdict |
|---|---|---|---|
| [Draftmancer](https://github.com/Senryoku/Draftmancer) | MIT | Active (2026-08-06) | **Adopt** — self-host as draft surface; emit its custom-set format; plug our bots into its external-bot API |
| [dr4ft](https://github.com/dr4fters/dr4ft) | MIT | Active (2026-05-22) | **Skip** — strictly dominated by Draftmancer for custom sets |
| [CubeCobra](https://github.com/dekkerglen/CubeCobra) | Apache-2.0 | Active (2026-08-09) | **Interop** — read its cube CSV; reference its bot/analytics features |
| [mtgdraftbots](https://github.com/CubeArtisan/mtgdraftbots) | AGPL-3.0 | Dormant (2023-04) | **Inspire** — bot architecture only; AGPL, do not vendor |
| CardConjurer forks ([joshbirnholz](https://github.com/joshbirnholz/cardconjurer), [Investigamer](https://github.com/MrTeferi/cardconjurer)) | None (all rights reserved) | Fork active (2026-08-09) / dormant | **Skip** — unlicensed + WotC-IP assets (C&D precedent); read frame anatomy once |
| [Proxyshop](https://github.com/Investigamer/Proxyshop) | MPL-2.0 | Semi-active (2025-12) | **Skip** — Photoshop dependency kills headless batch; template data referenceable |
| [Magic Set Editor 2](https://github.com/twanvl/MagicSetEditor2) (+ [2.5.8 community line](https://magicseteditor.boards.net/page/downloads)) | GPL-2.0 (code); template packs unlicensed | Upstream dormant (2023-01); community packs active (2026-08-08) | **Interop** — accept MSE set imports later; not our renderer |
| [mtgrender](https://github.com/Senryoku/mtgrender) | None | Unmaintained (self-described) | **Inspire** — proof of Scryfall-JSON → HTML/CSS render path |
| [mtg.design source](https://github.com/CypherpunkArmory/mtg.design), MTGCardBuilder, CardSpire | None / closed | Various | **Skip** — unlicensed or closed hosted tools |
| [Squib](https://github.com/andymeneely/squib) | MIT | Active (2026-04) | **Inspire** — headless data→card rendering DSL pattern (Ruby) |
| [mana font](https://github.com/andrewgioia/mana) / [keyrune](https://github.com/andrewgioia/keyrune) | OFL 1.1 (fonts) + MIT (code); glyph designs WotC | Active (2026) | **Adopt** — lab-internal rendering; swap to original symbols for public bundles |
| [Cockatrice](https://github.com/Cockatrice/Cockatrice) | GPL-2.0 | Active (2026-08-09) | **Interop** — write carddatabase v4 XML + images |
| [Forge](https://github.com/Card-Forge/forge) (custom-set folders) | GPL-3.0 | Active (2026-08-09) | **Interop** — write editions + card scripts for the mappable subset |
| [XMage](https://github.com/magefree/mage) | MIT | Active (2026-08-09) | **Skip** (this lane) — custom cards are compiled Java, no data-driven set path |
| Tabletop Simulator ([custom deck](https://kb.tabletopsimulator.com/custom-content/custom-deck/)) + [tts-deckconverter](https://github.com/jeandeaual/tts-deckconverter) | Proprietary / MIT | — / dormant (2023-03) | **Interop (optional)** — sheet compositor + saved object, after Cockatrice |
| MTGA decklist text format | n/a (format) | de-facto standard | **Adopt** — canonical deck exchange format |
| Cockatrice `.cod` / `.dec` / plain txt | n/a (formats) | de-facto standards | **Interop** — read all; write `.cod` |
| MTGO `.dek` | n/a (format) | proprietary ids | **Skip** — `CatID` unmintable for custom cards |
| [Planesculptors](https://www.planesculptors.net/) | Hosted; code "public" (unverified) | Dormant since 2022 storage crisis | **Skip** — service, not a component; hosting-demand evidence |
| [Multiverse](https://www.magicmultiverse.net/about) | Hosted, source unconfirmed | Live | **Inspire** — skeleton/feedback workflow model |
| [netn10/MTG-Set-Generator](https://github.com/netn10/MTG-Set-Generator) | All rights reserved | Fresh but 0-star | **Skip** — no license grant; confirms Cockatrice-export instinct |
| [mtgencode](https://github.com/billzorn/mtgencode) | MIT | Dormant (2023-10) | **Inspire** — card-text encoding decisions for our DSL/corpus |
| [fenhl/magic-set-generator](https://github.com/fenhl/magic-set-generator), [MSE-Draftmancer-Exporter](https://github.com/Tvpattack/MSE-Draftmancer-Exporter), [mse-export-fixer](https://pypi.org/project/mse-export-fixer/1.1.0/) | MIT / none / n/a | Dormant | **Inspire** — glue-tool evidence of ecosystem seams |

---

## 7. Licensing & IP risk notes

- **The CardConjurer C&D is the governing precedent**: WotC acted against a free, non-commercial tool
  because it reproduced trademarks, logos, frames, and card text
  ([TechRaptor](https://techraptor.net/tabletop/news/wizards-cds-card-conjurer-causing-closure)).
  Anything we publish (flagship set included) must use original frame art and original set symbols;
  mana-symbol glyphs are flagged by their own font's README as WotC-copyright designs. This aligns
  with the already-locked theme-indirection principle in the design brief.
- **GPL boundaries**: Cockatrice (GPL-2.0) and Forge (GPL-3.0) are consumed as *external programs* we
  write files for — no linking, no license contamination. MSE code is GPL-2.0 but we do not plan to
  embed it. mtgdraftbots is AGPL-3.0 — reference only.
- **Unlicensed repos** (CardConjurer continuation forks, MSE template packs, mtgrender, mtg.design,
  MSE-Forge-Database): default all-rights-reserved; read for patterns, never vendor code or assets.
- **Adoptable licenses confirmed verbatim or via GitHub API**: Draftmancer MIT, dr4ft MIT (README
  sentence quoted above), CubeCobra Apache-2.0, Squib MIT, tts-deckconverter MIT, mtgencode MIT,
  XMage MIT, mana/keyrune OFL 1.1 + MIT split (README license sections read directly).

## 8. Open questions for later phases

1. **Draftmancer rating calibration** — SimpleBot uses our emitted `rating` linearly; what rating
   scale correlates best with sane bot drafts (and can our 17lands-lane work supply the mapping)?
2. **Own-bot service** — the ExternalBotInterface request shape is verified, but the server-side
   registration/config for a self-hosted Draftmancer instance (env vars, model naming) needs a spike.
3. **Forge script coverage** — what fraction of our vertical-slice mechanic subset maps cleanly onto
   Forge's ability-script vocabulary? (Joint question with the engine lane.)
4. **MSE import demand** — only worth building if human co-designers actually arrive with `.mse-set`
   files; revisit when the first external designer shows up.
5. **Planesculptors dataset** — ~a thousand community sets would be a unique corpus for calibrating
   "what do human custom sets look like" (design-canon lane); is the public DB dump the creator
   mentioned actually obtainable?
