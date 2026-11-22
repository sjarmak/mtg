# Journey into Nyx (JOU) printed Limited format

Registered, play-supported printed format, onboarded under the generalized
bridge the same way as Born of the Gods and Theros (`packages/data/data/ths/README.md`
is the worked example this directory follows, and `bng/` is its sibling in the
Theros block). Everything here was built by the shared printed-format tools;
neither `ForgeBridge.java` nor the Node adapter was edited. The repo-local
`make-set-playable` skill describes the process.

## Product and identity

Eight-seat draft is JOU, JOU, JOU; sealed is six JOU boosters. This is the one
registered format that keeps the printed basic land in its packs and sealed
pools (`basicLandPolicy: keep`); the others use `remove`. MTGJSON's Journey into
Nyx draft booster has two shapes: the regular pack (one `basic`, ten `common`,
three `uncommon` and one `rareMythic`, with a foil replacing a common in some)
and a god pack (weight 40 of 172,800) that is fifteen cards from the
`therosGods` sheet. `remove` drops the basic and leaves the regular pack at 14
cards against the god pack's 15, and `preparePrintedLimitedFormat` refuses a
draft whose rounds are not equal-sized (`printed draft requires equal-sized
booster configurations across rounds`), which `installed-printed-admissions`
hit when the recipe said `remove`. `keep` leaves every pack at 15, and the
prepared format reports `printedPackSizes [15]`. Dropping the god pack would
have made the sizes agree, but `import-printed-set` says to preserve bonus
sheets, so the policy changed instead; it is one field in
`onboarding-format-v1.json` and reversible. The booster's `sourceSetCodes` are
`[BNG, JOU, THS]`: the `therosGods` sheet draws Theros-block gods from all three
sets and the `basic` sheet is Theros's basics. The builder resolves every card
id through a catalog, so the recipe names all three codes, has one product, and
ships the BNG and THS catalogs as dependencies the way `dka/` ships
Innistrad's. The catalogs are BNG (165
printings, 165 scripts), JOU (165 printings, 165 scripts) and THS (249
printings, 234 scripts; THS prints each of its five basic lands four times and
those printings share one script per land), 579 printings and 564 scripts in
all. The cost of the dependencies is that qualification covers all three.

The BNG and THS catalogs here were rebuilt from JOU's pin rather than read from
`bng/` and `ths/`, and they stay copies on purpose (`make-set-playable` says
why). Every card is field-for-field identical to the other copies and only the
source provenance differs, so the hashes do: BNG `68c366f3...` against
`fab9bfa8...` in `bng/`, and THS `fac9b57d...` against `f5c36578...` in `bng/`
and `0b5518a3...` in `ths/`.

| artifact                    | sha256                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| format `contentSha256`      | `34c2b5b813a7ebd4903385a1c92538f4053d20896d31111f7ebb41307bcce746` |
| catalog BNG `contentSha256` | `68c366f3067f51da8029e9b0608028847a61baff8436e71ef0fc67afe74b2088` |
| catalog JOU `contentSha256` | `05e4813b34dc687ea1f615b0f73c2fb6f5e11d189686558900461c04250aa766` |
| catalog THS `contentSha256` | `fac9b57dfbd92961cbda727dfbbae869cc07567f86187abe335db142488c76cb` |
| sources file                | `cfba5ec5d5758fadeaa4ed2879ce33853043e9a82f63268c04d9c88f0f85dccd` |
| Forge script archive        | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| bridge (`bridgeSha256`)     | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`adapterSha256`)   | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file        | `e0d7178c4e9c98ec76413de17fd2625f417eb12e796251d7464ea3131c060391` |
| display metadata file       | `db3505c37a6e46ece65248d65a15970e468cd1d6e50ba24a219ad211ef4e4b18` |

The bridge digest is the Kaladesh bridge (`mtg-j4ucd.19`), which `play-admission-v2`
was re-bound to; `play-admission-v1` was built directly against the
Phyrexian-mana bridge (`mtg-t5ma0`) and needed no re-bind then. The adapter
digest is the pod board's (`mtg-bc2.154.6.5.4.1`), which `play-admission-v3` was
re-bound to; `play-admission-v1` and `play-admission-v2` bound `b5c63fa8...`.

## Rebuilding

The source pin is `data/cache/jou-bng-ths-20260920-source-pin/` (the MTGJSON and
Scryfall snapshots for JOU, BNG and THS). The writers emit prettier-formatted
JSON, so the copies below need no formatting pass. Each tool refuses an
existing output, so bump the version segment of every `out/jou/...` path. Every
tool that takes catalogs wants one `--catalog` flag per file.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets JOU,BNG,THS --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/jou/onboarding-format-v1.json --sources data/cache/jou-bng-ths-20260920-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/jou/build-v2
cp out/jou/build-v2/bng-printed-catalog-v1.json out/jou/build-v2/jou-printed-catalog-v1.json out/jou/build-v2/ths-printed-catalog-v1.json out/jou/build-v2/jou-limited-format-v1.json out/jou/build-v2/build-evidence.json packages/data/data/jou/
cp out/jou/build-v2/sources.json packages/data/data/jou/jou-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/jou-bng-ths-20260920-source-pin --catalog packages/data/data/jou/bng-printed-catalog-v1.json --catalog packages/data/data/jou/jou-printed-catalog-v1.json --catalog packages/data/data/jou/ths-printed-catalog-v1.json > packages/data/data/jou/jou-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/jou/bng-printed-catalog-v1.json --catalog packages/data/data/jou/jou-printed-catalog-v1.json --catalog packages/data/data/jou/ths-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Art

Card art is not staged: the catalog carries each printing's Scryfall image
URIs and `packages/ui/src/card/printed-card-art.ts` renders the `art_crop`
straight from `cards.scryfall.io` in the browser. Card and token art is the
oldest printing (`packages/printed-card/src/set-release-order.ts`). The set's
scripts create 25 tokens and all 25 are bound in `jou-token-printings-v1.json`,
each to the oldest Scryfall token printing that states the same token, so the
art does not always come from JOU's own token sheet:

| token (Forge name) | printing | note                                     |
| ------------------ | -------- | ---------------------------------------- |
| Cat Soldier Token  | TBNG     | 1/1 W Cat Soldier                        |
| Soldier Token      | TBNG     | 1/1 W Enchantment Soldier                |
| Bird Token         | TBNG     | 2/2 U Enchantment Bird                   |
| Kraken Token       | TBNG     | 9/9 U Kraken                             |
| Zombie Token       | TBNG     | 2/2 B Enchantment Zombie                 |
| Elemental Token    | TBNG     | 3/1 R Enchantment Elemental              |
| Centaur Token      | TBNG     | 3/3 G Enchantment Centaur                |
| Gold Token         | TBNG     | colorless Artifact Gold                  |
| Sphinx Token       | TJOU     | 4/4 U Sphinx                             |
| Zombie Token       | TJOU     | \*/\* B Zombie                           |
| Minotaur Token     | TJOU     | 2/3 R Minotaur                           |
| Hydra Token        | TJOU     | \*/\* G Hydra                            |
| Spider Token       | TJOU     | 1/3 G Enchantment Spider                 |
| Snake Token        | TJOU     | 1/1 BG Enchantment Snake                 |
| Wolf Token         | TLRW     | 2/2 G Wolf                               |
| Cleric Token       | TTHS     | 2/1 W Enchantment Cleric                 |
| Bird Token         | TTHS     | 2/2 U Bird                               |
| Elemental Token    | TTHS     | 1/0 U Elemental                          |
| Harpy Token        | TTHS     | 1/1 B Harpy                              |
| Soldier Token      | TTHS     | 1/1 R Soldier                            |
| Boar Token         | TTHS     | 2/2 G Boar                               |
| Satyr Token        | TTHS     | 2/2 RG Satyr                             |
| Golem Token        | TTHS     | 3/3 colorless Enchantment Artifact Golem |
| Soldier Token      | TUGL     | 1/1 W Soldier                            |
| Bird Token         | TZEN     | 1/1 W Bird                               |

No token is left unbound. Three names repeat across the catalogs and all three
fail closed rather than resolving to one printing: a white 1/1 Soldier (TBNG and
TUGL), a blue 2/2 Bird (TBNG and TTHS) and a black Zombie (TBNG's 2/2 and TJOU's
\*/\*). Each pair shares its colors across two different token oracle ids, so
`printingFor` in `packages/ui/src/routes/play/backend-position.ts` cannot
disambiguate by color or by age within one oracle id and draws the labeled
pending frame instead of guessing. `jou-printed-format.test.ts` pins the three
pairs by name. The tokens are bound; only the live surface's selection between
the two printings is unresolved, and that selector is not changed here.

## Closure, coverage, admission

`packages/data/test/forge-syntax-closure.test.ts` pins JOU and BNG at 165 of 165
scripts closed and THS at 234 of 234. Twenty-five review entries were added on
this branch for the three catalogs (`forge-syntax-review-v1.json`): `Strive`
mapped to targets and mana-x; `Tribute`, `Exchange` and `ControlSpell` to
replacement-trigger-choices; `MultiplePiles` to zone-card-selection and
piles-votes; `ReplaceMana` to naming-text-numbers, because its class calls
`chooseColor` when `ReplaceMana$` or `ReplaceType$` is `Any` (Kruphix's own
script fixes `ReplaceType$ C`, so the token names no choice for it); the other
nineteen, `Untaps` among them, are `non-choice`. `Exchange` and `Untaps` also
gained rows in `forge-effect-controller-calls-v1.json`, which `--check` still
matches against the Forge jar.

`packages/data/test/jou-printed-format.test.ts` rebuilds the decision inventory
and the complete coverage plan in-process and re-verifies the installed
admission against the staged format and catalogs on every run. The same plan on
disk, for the probe runner, reports 579 physical cards, 564 root scripts, 25
generated dependencies (the tokens) and no unknown syntax; all 564 scripts are
`complete`, with no scenario claims of their own, against
`out/validation-pilot/printed-controller-contracts-protocol2-v7`, the thirteen
contracts of the reusable bundle (the twelve of `v6` plus `pregame-actions`).

```sh
npx tsx packages/data/tools/inventory-printed-decisions.ts --catalog packages/data/data/jou/bng-printed-catalog-v1.json --catalog packages/data/data/jou/jou-printed-catalog-v1.json --catalog packages/data/data/jou/ths-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --token-scripts tools/forge/dist/res/tokenscripts --output out/jou/decision-inventory-v2/inventory.json
npx tsx packages/data/tools/build-printed-script-coverage-plan.ts --catalog packages/data/data/jou/bng-printed-catalog-v1.json --catalog packages/data/data/jou/jou-printed-catalog-v1.json --catalog packages/data/data/jou/ths-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --reviews <(echo '{"schemaVersion":1,"kind":"printed-script-coverage-plan","scripts":[]}') > out/jou/coverage-plan-prior-v1.json
npx tsx packages/data/tools/build-printed-complete-coverage-plan.ts --inventory out/jou/decision-inventory-v2/inventory.json --prior out/jou/coverage-plan-prior-v1.json --contracts out/validation-pilot/printed-controller-contracts-protocol2-v7/manifest.json --output out/jou/complete-coverage-plan-v2/coverage-plan.json
```

## Play admission

`play-admission-v1/` was a verified full-card and match admission for all 579
printings (564 exact scripts: 564 qualification files, none partial, none
missing a review), built against Forge 2.0.14 and the generalized bridge
protocol 2. The commands that built it:

```sh
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/jou/probes/jou-scenario-probes-v2-config.json --out out/jou/scenario-probes-v2 --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualification-bundle.ts --evidence out/jou/scenario-probes-v2 --inventory out/jou/decision-inventory-v2/inventory.json --out out/jou/script-qualifications-v2
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/jou/probes/jou-match-probes-v2-config.json --out out/jou/match-probes-v2 --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualified-admission.ts --format packages/data/data/jou/jou-limited-format-v1.json --catalog packages/data/data/jou/bng-printed-catalog-v1.json --catalog packages/data/data/jou/jou-printed-catalog-v1.json --catalog packages/data/data/jou/ths-printed-catalog-v1.json --qualifications out/jou/script-qualifications-v2 --match-probes out/jou/match-probes-v2 --out packages/data/data/jou/play-admission-v1
```

`play-admission-v2/` re-binds v1 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `jou`.

`play-admission-v3/` re-binds v2 (deleted) to the pod board's observed adapter
(`mtg-bc2.154.6.5.4.1`), which names the defender an attack is sent at: `PlayDefender` in
`packages/engine/src/play.ts`, read out of the move id by `forgeAttackDefender` in
`packages/forge-export/src/observed/backend.ts`. Both files are inside the adapter bundle every
printed admission pins, so the adapter digest changes (`b5c63fa8...` to `e5f289d1...`); the bridge,
the format, the catalog and the contracts do not, and the re-bound admission holds the same cards
and the same probe ids, differing only in the adapter it binds and the digests of the freshly
captured evidence. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v4`.

`play-admission-v4/` re-binds v3 (deleted) to the Emancipation Angel and Copter bridge fixes
(`e215264e8`, `ac338d39f`), on top of the Convoke fix admitting plain Convoke structurally
(`mtg-uz0mz`): `ForgeBridge.java` admits Emancipation Angel's bounce and names the refused
zone-choice shape, and folds Smuggler's Copter's Crew route into the Kaladesh Vehicle table. The
compiled bridge digest changes (`eb94daf2...`); the adapter (`e5f289d1...`), the format, the catalog
and the contracts do not. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v5`. This generation's rebind was left undone by mtg-4qga9's
closing workflow and completed here (`mtg-6qgu5`).

`play-admission-v5/` re-binds v4 (deleted) to the projected-keyword, soulbond-pairing and
player-counter changes (`mtg-pt9dp`, `mtg-in4k9`, `mtg-oin1f`, `mtg-vzxqq`):
`packages/engine/src/projection.ts` projects a permanent's current keywords and a soulbond pair's
badge on `ObjectView`, a same-named token printing is told apart by the keywords the token carries,
and a player's counters such as Energy are projected under the player's name;
`packages/forge-export/bridge/ForgeBridge.java` and `packages/forge-export/src/observed/protocol.ts`
carry the matching wire shape. Both the bridge and the adapter digests change (bridge `da5bcd66...`,
adapter `94b68b36...`); the format, the catalog and the contracts do not. Re-bound for every
registered format at once with `packages/data/tools/printed-admission-rebind-all.mjs`, which runs
the six-step recipe in `packages/data/data/isd/README.md` (Play admission); to re-bind after a
further adapter or bridge change, use output `play-admission-v6` (`mtg-ziwde`).

The two `printed-probe-cli.ts` runs boot Forge and take the host Forge lock
themselves, so they queue behind any other Forge-required run on the machine
and need no `flock` or `MTG_TEST_WORKERS` prefix.

The scenario run carries two Journey into Nyx witnesses
(`packages/forge-export/test/observed-jou-contract-witness.integration.test.ts`:
a local Reprisal caster choosing and destroying the only legal creature, a
Hydra Broodmaster, and Forge attacking with Oreskos Swiftclaw while the local
seat only answers its own decisions). Every one of the 564 scripts' obligations
is a reusable contract obligation, so the qualification bundle reports
`qualified: 564, residual: 0`. The match run is the four whole-game probes on
Forest x60 plus Plains x60 (`packages/forge-export/test/observed-jou-*.integration.test.ts`,
with the fixture in `test/support/jou-match-fixture.ts`; the fixture reuses
Avacyn's Pilgrim, as Innistrad, Scars of Mirrodin and Theros do, since a set's
own cards are usually outside `AUDITED_FORGE_CARD_NAMES`).

The seeds are fixed in those files: `jou-reprisal-local-contract-v1` and
`jou-oreskos-swiftclaw-engine-contract-v1` for the two witnesses,
`jou-local-pregame-v2` for the engine starting-player probe, `1514` for the
local toss and `jou-native-priority-v1` for the native-priority probe. The
first seed tried for the starting-player probe, `jou-local-pregame-v1`, did not
open on the seat-0 `mulligan` decision that probe asserts, so the seed was
searched forward to the first one that did.

`play-admission-v6/` re-binds v5 (deleted) to the Improvise bridge fix
(`f18400713`, `ae3bb289e`): `ForgeBridge.java` distinguishes Improvise from Convoke and lets
reviewed artifact payments cover generic mana without choosing colors. The compiled bridge digest
changes (`d4880305...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); the next rebind is
`play-admission-v7/`.

`play-admission-v7/` re-binds v6 (deleted) to the reviewed split-mana bridge fix
(`285b00486`, `mtg-uz0mz.1.1`, `mtg-tho5a9`): the exact Coalition Relic route now also covers
Altar of the Lost, Cascading Cataracts, Molten Slagheap, Plasm Capture and Axebane Guardian, and Market
Festival, returning the color split the local seat chose for each produced mana. The compiled bridge digest
changes
(`ac89d54f...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v8/`.

## Registration

`packages/data/data/printed-formats-v1.json` carries the `jou` entry with
`play.status: supported` and `admissionDirectory: play-admission-v7`. The
launcher (`packages/ui/tools/play.ts`) reads every supported entry at boot and
`startBackendService` admits all of them behind one Forge identity. The entry
lists the BNG, JOU and THS catalogs, so the token printings file and both
registry tests (`printed-format-registry.test.ts`, `token-printings.test.ts`)
name it.

Born of the Gods (`bng/`) is a registered format of its own with its own copies
of the BNG and THS catalogs. Their `contentSha256` values differ from the ones
above (BNG `fab9bfa8...` there, `68c366f3...` here), so the two admissions are
bound to different catalogs and neither one reuses the other's receipts.
