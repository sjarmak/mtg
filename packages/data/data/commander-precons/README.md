# Commander Preconstructed Decks (commander-precons) printed Commander precon format

Registered, browse-only printed format: the union of the existing Starter
Commander Decks format (`packages/data/data/scd/README.md`) with a new wave of
six Commander precons spanning six further products. Catalog-only: every deck
is built and closed for Forge syntax, but no play-admission chain has been run
against this format, so none of the eleven decks is seatable at a table under
it yet. The five Starter Commander decks stay playable under their own `scd`
format, which this directory leaves untouched. `build-evidence.json` carries `status: catalog-only-not-play-admitted`.
The Commander plan is `mtg-bc2.154.6.5`; this new wave is `mtg-6cbd4l.1`.

## Product and identity

Eleven 1v1 Commander precons (`rules: { variant: commander, startingLife: 40 }`),
each one commander over ninety-nine cards, every card an exact printing from
one of seven source sets:

| deck                   | commander                  | product                       |
| ---------------------- | -------------------------- | ----------------------------- |
| `chaos-incarnate`      | Kardur, Doomscourge        | SCD (Starter Commander Decks) |
| `draconic-destruction` | Atarka, World Render       | SCD                           |
| `first-flight`         | Isperia, Supreme Judge     | SCD                           |
| `grave-danger`         | Gisa and Geralf            | SCD                           |
| `token-triumph`        | Emmara, Soul of the Accord | SCD                           |
| `draconic-domination`  | The Ur-Dragon              | C17 (Commander 2017)          |
| `vampiric-bloodlust`   | Edgar Markov               | C17                           |
| `heavenly-inferno`     | Kaalia of the Vast         | CMA (Commander Anthology)     |
| `plunder-the-graves`   | Meren of Clan Nel Toth     | CMA                           |
| `invent-superiority`   | Breya, Etherium Shaper     | C16 (Commander 2016)          |
| `eldrazi-unbound`      | Zhulodok, Void Gorger      | CMM (Commander Masters)       |

`C13` (Commander 2013) and `ALA` (Shards of Alara) carry no deck of their own;
both are pinned because a card the new-wave deck lines name resolves, by the
same first-printing-in-catalog-order rule SCD's builder uses, to a printing
from that set rather than from the deck's own product. `vampiric-bloodlust`
draws one card from C13; `draconic-domination`'s Savage Lands draws its
earliest printing from ALA.

Current identity:

| artifact                                                          | sha256                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| merged format `contentSha256`                                     | `d0e2371284271b6b66963da70c3ed66ef13e4d7d05b6e41f9f68f1f8f3c4195a` |
| catalog SCD `contentSha256`                                       | `be47a0caa4d133d2bb924b2a77cf0699ff1dd1cf64f607e717e3c7b3f2cc7763` |
| catalog C17 `contentSha256`                                       | `f612772ab7fbfad49200803af69de916d1df2f6fbf4d211af3a6e446a6c91efe` |
| catalog ALA `contentSha256`                                       | `abe5935109de9d9ec7bcef2280de14d81259a817ab5b55dce5368b330a8aa442` |
| catalog C13 `contentSha256`                                       | `021c35fda0857ac542869b4d302c8706222b659103dd2ab57d77c4b6e0f1e742` |
| catalog CMA `contentSha256`                                       | `375e31a91e286611bd87b13839deca0e9fda434113a3da3077cbf66b1fea027c` |
| catalog C16 `contentSha256`                                       | `01366bcb864d48eb20d107803850b122395ba3a7e52485df1ca5e8e29f3d46c3` |
| catalog CMM `contentSha256`                                       | `ac3ef371a92e55b552841433c4bbd994fdd270a93b5457b221caa6d8a209cba0` |
| recipe (`onboarding-format-v1.json`)                              | `42552cdf368129fccf300de51ee8ba0fed59f085fa8aee3020efed85ae2b2579` |
| SCD source pin (`scd-printed-sources-v1.json`)                    | `c1694b761d3b0ffd3440be2ba14ea5514cb5cccf9f4c4dbd5ed13b325bbc36d6` |
| new-wave source pin (`commander-precons-printed-sources-v1.json`) | `564e567bd53812d7adeec53c246fcd2cadc5fc33b820eb3bc4746d0fa9ccde2c` |
| Forge script archive                                              | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |

## The new wave: which precons shipped

Nine Commander precons across six further products were candidates. Three
were dropped, each for a root cause unrelated to that deck's own cards (no
blocking card named below is referenced by the dropped deck's own `.dck`):

- **Elven Empire** (needs KHC+KHM) — MTGJSON's KHM printing set is missing an
  exact printing for `KHM 333 Vorinclex, Monstrous Raider`, a genuine
  Scryfall/MTGJSON identity gap.
- **Explorers of the Deep** (needs LCC+LCI+PIP) — PIP ships no Forge script at
  all for "C.A.M.P."; LCI additionally files a double-faced card under its
  front-face-only slug while the catalog builder expects the combined name.
  Two separate per-card Forge-filing inconsistencies, not a systemic gap.
- **Undead Unleashed** (needs MIC+MID) — MID's own script spells "Corruptor"
  (-or) where the official printing reads "Corrupter" (-er); the exact-match
  name lookup does not tolerate the one-letter divergence.

No alias or correction mechanism exists for any of these three mismatches.
Fixing one means editing the shared catalog-building infrastructure
(`source-fetch.ts` and friends) for a single unrelated card, judged out of
scope for this wave.

Two of the six surviving decks needed a second source-code decision because
their stated product resolves ambiguously:

- **Heavenly Inferno** was printed in both Commander Anthology (COM, the
  bare product code) and Commander Anthology 2018, but MTGJSON's `COM` set
  returns HTTP 404 — unresolvable. CMA is forced, non-discretionary.
- **Plunder the Graves** was printed in both C15 (Commander 2015) and CMA.
  Both resolve cleanly; CMA was chosen deliberately over C15 to avoid adding
  a seventh source code when CMA was already required for Heavenly Inferno.

## Rebuilding

SCD's own rebuild recipe (`packages/data/data/scd/README.md`, "Rebuilding")
is unchanged and still produces `scd-constructed-format-v1.json`,
`scd-printed-catalog-v1.json` and `scd-printed-sources-v1.json` independently
of this directory. The new wave is a second, independent build over its own
six-code source pin, then the two are unioned. Each tool refuses an existing
output path, so bump the version segment of every `out/...` path on a
rebuild.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets C17,ALA,C13,CMA,C16,CMM --out <new-source-directory>
npx tsx packages/data/tools/import-forge-precons.ts --deck <path/to/draconic-domination.dck> --deck <path/to/vampiric-bloodlust.dck> --deck <path/to/heavenly-inferno.dck> --deck <path/to/plunder-the-graves.dck> --deck <path/to/invent-superiority.dck> --deck <path/to/eldrazi-unbound.dck> --id commander-precons --name "Commander Preconstructed Decks" --out out/commander-precons/recipe-v1.json
npx tsx packages/data/tools/build-printed-format.ts --config out/commander-precons/recipe-v1.json --sources <new-source-directory> --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/commander-precons/build-v1
npx tsx packages/data/tools/merge-printed-constructed-formats.ts --format packages/data/data/scd/scd-constructed-format-v1.json --format out/commander-precons/build-v1/commander-precons-constructed-format-v1.json --id commander-precons --name "Commander Preconstructed Decks" --out out/commander-precons/build-v1/commander-precons-constructed-format-merged-v1.json
cp out/commander-precons/build-v1/commander-precons-constructed-format-merged-v1.json packages/data/data/commander-precons/commander-precons-constructed-format-v1.json
cp out/commander-precons/build-v1/{c17,ala,c13,cma,c16,cmm}-printed-catalog-v1.json packages/data/data/commander-precons/
cp packages/data/data/scd/scd-printed-catalog-v1.json packages/data/data/commander-precons/
cp out/commander-precons/build-v1/recipe.json packages/data/data/commander-precons/onboarding-format-v1.json
cp <new-source-directory>/sources.json packages/data/data/commander-precons/commander-precons-printed-sources-v1.json
```

`build-evidence.json` is hand-assembled rather than copied from a single
build: it carries `builds: []`, one entry per independent build (SCD's own
source/archive hashes and the new six-code pin's), a `catalogs` array over
all seven installed catalogs, and an `artifactSha256` map over every file
this directory installs.

`commander-precons-display-metadata-v1.json` is the concatenation of two
separate `printed-display-metadata` runs, since the tool resolves each
catalog against exactly one source-pin directory and SCD and the new wave
pin different ones:

```sh
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/scd-20260915-source-pin --catalog packages/data/data/scd/scd-printed-catalog-v1.json > out/commander-precons/display-scd.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources <new-source-directory> --catalog packages/data/data/commander-precons/c17-printed-catalog-v1.json --catalog packages/data/data/commander-precons/ala-printed-catalog-v1.json --catalog packages/data/data/commander-precons/c13-printed-catalog-v1.json --catalog packages/data/data/commander-precons/cma-printed-catalog-v1.json --catalog packages/data/data/commander-precons/c16-printed-catalog-v1.json --catalog packages/data/data/commander-precons/cmm-printed-catalog-v1.json > out/commander-precons/display-new-wave.json
```

with the two `catalogs` arrays concatenated by hand into
`commander-precons-display-metadata-v1.json`.

`packages/data/test/commander-precons-printed-format.test.ts` binds the
installed artifacts to the evidence and re-derives every one of the eleven
decks from the shipped `.dck` files and the recipe, so a Forge bump that
changes a precon fails there rather than in a game.

## Token printings

`commander-precons-token-printings-v1.json` holds the token sheet for all
eleven decks: every token any of the seven catalogs' cards can create, bound
to the Scryfall token printing matching its Forge script facts, derived
straight from the installed catalogs rather than stated as a fixed set list
(a precon's token needs can span dozens of historical token sets, unlike a
single booster set's own sheet):

```sh
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/commander-precons/scd-printed-catalog-v1.json --catalog packages/data/data/commander-precons/c17-printed-catalog-v1.json --catalog packages/data/data/commander-precons/ala-printed-catalog-v1.json --catalog packages/data/data/commander-precons/c13-printed-catalog-v1.json --catalog packages/data/data/commander-precons/cma-printed-catalog-v1.json --catalog packages/data/data/commander-precons/c16-printed-catalog-v1.json --catalog packages/data/data/commander-precons/cmm-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

The committed sheet is exactly that command's output, each token at its
oldest printing. Until #311 it was not: it also carried SCD's whole token
sheet (all 25 TSCD rows), and the Zombie Army that seven SCD and CMM cards amass
was bound only through TSCD 14. Amass, Afterlife and Investigate create tokens
whose card scripts name none, so the scanner now reads them as well, and the
rebuild binds the Zombie Army at TWAR 8, the Sliver Army at TCMM 68, the Clue
at TSOI 11 and Afterlife's white-black Spirit at TEVE 4.

The registry entry names it as `tokenPrintingsFile`, the launcher stages it
beside the catalogs, and `packages/data/test/token-printings.test.ts`
re-derives every binding from the installed Forge token scripts.
`commander-precons-printed-format.test.ts` fails if any token the seven
catalogs create has no row matching its name and colors.

## Closure and coverage

`packages/data/test/forge-syntax-closure.test.ts` pins all seven catalogs at
`scripted === closed`: SCD at 337 of 337 (unchanged), ALA at 234 of 234, C13 at
340 of 340, C16 at 339 of 339, C17 at 299 of 299, CMA at 289 of 289 and CMM at
737 of 737. The six new editions needed 93 previously-unreviewed tokens
closed in the shared review table
(`packages/data/data/forge-syntax-review-v1.json`, 1038 entries before this
wave, 1131 after): 15 `ability-api`, 13 `keyword` and 65 `parameter-key`.
Each entry's evidence names the Forge class or bridge method it was checked
against, read with `javap` from the installed Forge 2.0.14 jar
(`tools/forge/dist/forge-gui-desktop-2.0.14-jar-with-dependencies.jar`).

Among the 93, sixteen ask the player something and are `mapped`: `ChangeCombatants`,
`ChooseDirection`, `OptionalCost`, `Phases` (ability-api), `Devour`, `Myriad`,
`Read ahead`, `Reinforce`, `Retrace`, `Storm` (keyword), `Bolster`,
`PlayerChoices`, `Redistribute`, `RepeatOptionalForEachPlayer`, `Upto` and
`WithDifferentNames` (parameter-key). The rest are non-choice: trigger and static-ability classes
with zero `PlayerController` calls, enum constants that share a dispatch
class with an already-reviewed token (`AttackersDeclaredOneTarget`,
`SpellAbilityCast` and `SpellCastOrCopy` all dispatch through classes the
plain `AttackersDeclared` and `SpellAbilityCastOrCopy` triggers already use),
and effect parameters that name a fixed literal rather than asking a player
to choose one.

## Registration

`packages/data/data/printed-formats-v1.json` carries the `commander-precons`
entry with `formatFile: commander-precons-constructed-format-v1.json`, browse
available, draft and sealed unavailable (there is no pack), and play
unavailable: `status: "unavailable"` with a reason a player reads beside the
disabled play button, no `admissionDirectory`. This is the first browse-only entry in
the registry. The launcher (`packages/ui/tools/play.ts`) stages it beside the
other constructed formats through `stage-printed-formats.ts`.

Card art is not staged: the catalogs carry each printing's Scryfall image
URIs, the same as every other printed format.
