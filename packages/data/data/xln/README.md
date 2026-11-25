# Ixalan (XLN) printed Limited format

Registered, play-supported printed format, built entirely by the shared
printed-format tools; no Ixalan-specific source file exists in the workspace and
neither `ForgeBridge.java` nor the bundled Node adapter was edited. The
repo-local `make-set-playable` skill describes the process this directory is
the worked example of; Khans of Tarkir's and Innistrad's READMEs are the fuller
single-set examples it follows.

## Product and identity

Eight-seat draft is XLN, XLN, XLN; sealed is six XLN boosters. Ixalan was a
standalone large set, so the draft booster's `sourceSetCodes` is `[XLN]` alone
and no dependency catalog ships beside it. Rivals of Ixalan is a separate set
and is not part of this format. Basic lands are removed from the packs
(`basicLandPolicy: remove`). The catalog holds the 289 exact Scryfall printings
of the set.

| artifact                             | sha256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`               | `8686e8b65c0b58a9bea91519f9ba7360acaf0ac02b71d77ed9555c145ba389c4` |
| catalog XLN `contentSha256`          | `6db0ad8e7743508c0d49d4e7365c55ea106f9bbc1e85425ad5c5ad25453605dc` |
| source pin (`sources.json`)          | `145bbd7db2eda22e38d2182d28e9f188ec55c50e712f66e545e727fb41ce8f70` |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| compiled bridge (`ForgeBridge.java`) | `53d03a0ca64abbdfeec64af6458d1523c6646004f3d2cc778727491fe8b8ee90` |
| adapter (`installed.ts` bundle)      | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file                 | `dd6df0e9f4c0803cd46094045ab09837d19157cc3dcc1959035fe1de52fa4972` |
| display metadata file                | `7fb21dc5c4fe0cc411e75d3c8e59b2d7383ec91655f6b63addbccd9ae54af87d` |

The display metadata is built from this directory's own catalog copy and from
no other format's. `validatePrintedDisplayMetadata` matches a row to a catalog
by `contentSha256` first, so a row built from another format's copy misses and
`npm run play` then refuses to start for every installed format.

## Rebuilding

The source pin is `data/cache/xln-20260920-source-pin/` (MTGJSON and Scryfall
snapshots fetched 2026-09-20; the raw snapshots are not vendored). Each tool
refuses an existing output, so bump the version segment of every `out/xln/...`
path on a rebuild.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets XLN --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/xln/onboarding-format-v1.json --sources data/cache/xln-20260920-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/xln/build-v1
cp out/xln/build-v1/xln-printed-catalog-v1.json out/xln/build-v1/xln-limited-format-v1.json out/xln/build-v1/build-evidence.json packages/data/data/xln/
cp out/xln/build-v1/sources.json packages/data/data/xln/xln-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/xln-20260920-source-pin --catalog packages/data/data/xln/xln-printed-catalog-v1.json > packages/data/data/xln/xln-display-metadata-v1.json
```

## Token printings

`xln-token-printings-v1.json` holds the seven token printings the set's scripts
create: Vampire, Pirate, Dinosaur, Plant and Treasure from `TXLN`, Illusion and
Merfolk from `TZEN`. Each token draws the **oldest** Scryfall printing that
states it, so two of them come from Zendikar's sheet. No token is left to the
pending frame.

```sh
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/xln/xln-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Closure and coverage

Five Forge syntax tokens were open after import and were added to the shared
review table (`packages/data/data/forge-syntax-review-v1.json`, 931 -> 936),
each checked against the Forge 2.0.14 jar's bytecode and all `non-choice`:
`Explores`, `CombatDamageToughness`, `PlayerMustAttack`, `NonLegendary` and
`RememberAmount`. `Explores` is the trigger condition of "whenever a creature
you control explores", distinct from the `Explore` effect that performs the
reveal and already mapped. `PlayerMustAttack` is implemented by
`StaticAbilityMustAttack`, not the token-derived name the audit tool predicts;
the review entry's evidence says so.

`packages/data/test/xln-printed-format.test.ts` rebuilds the decision inventory
and the complete coverage plan in-process and re-verifies the installed
admission against the staged format and catalog on every run. The qualification
bundle reports `qualified: 274, residual: 0` (the set's card scripts plus the
token scripts).

## Ixalan vocabulary witnessed on real Forge

`packages/forge-export/test/observed-xln-vocabulary.integration.test.ts`
(`MTG_REQUIRE_FORGE_BRIDGE=1`, not part of the probe population) checks the
three things the bridge could have refused, each from a scenario snapshot:

- **Transform into a land.** Thaumatic Compass with seven Forests is an
  artifact; passing priority to the end step transforms it, and the projection
  then names it Spires of Orazca with type line `Land`, no longer an Artifact,
  and counts it among the seat's eight lands.
- **Explore, both branches.** Merfolk Branchwalker over a land top card puts the
  land in hand and stays 2/1. Over a nonland top card the bridge asks
  `[Explore] Put <card> in your graveyard?` as a `confirm-explore-graveyard`
  decision, and the creature ends 3/2 with one `P1P1` counter.
- **Ascend.** Arch of Orazca with nine other permanents (ten) is offered its
  `Draw a card` ability; with five other permanents (six) it is not. Forge
  computes the city's blessing and the bridge exposes it only through the
  ability's legality: neither `ForgeBridge.java` nor the engine projection names
  the city's blessing, so a surface cannot draw "you have the city's blessing"
  and could only infer it.

Raid, Enrage, Treasure and Vehicles are covered through the reusable controller
contracts' decision families, not by a witness of their own.

## Scenario and match witnesses

`packages/forge-export/test/observed-xln-contract-witness.integration.test.ts`
carries the two `scope: "scenario"` witnesses: a local Contract Killing caster
killing the only legal target, and Forge attacking with Queen's Bay Soldier
while the local seat only answers its own decisions. The match config covers
starting-player, mulligan, priority and the local pregame over Mountain and
Rampaging Ferocidon (`packages/forge-export/test/support/xln-match-fixture.ts`).
The remaining scenario receipts are the reusable ones from earlier formats,
bound by script hash.

## Play admission

`play-admission-v1/` was a verified full-card and match admission for all 289
printings, built 2026-09-20 against Forge 2.0.14 and the generalized bridge
protocol 2, on the Phyrexian-mana bridge (`53d03a0c...`). A later edit to
`ForgeBridge.java` or the adapter strands it, and the six-step re-bind recipe in
`packages/data/data/isd/README.md` applies.

`play-admission-v2/` re-binds v1 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`53d03a0c...` to `702a7926...`); the
adapter, the format, the catalog and the contracts do not, and the re-bound admission holds the
same cards and the same probe ids, differing only in the bridge it binds and the digests of the
freshly captured evidence. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `xln`. Ixalan landed after the Kaladesh lane
branched, so nothing in that lane re-bound it; the merge that brought the bridge in owed this.

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

The first step of that recipe needed a fix before it would run here. Ixalan named its four match
receipts after the set (`xln-engine-starting-player`, `xln-native-mulligan`, `xln-local-pregame`,
`xln-native-priority`) rather than after the decision family, as Rise of the Eldrazi, Magic 2012,
Dark Ascension and Magic 2014 did before it, and `printed-admission-rebind-configs.mjs` recovers
the witness test file from that id. The four names are now in that tool's table. A format whose
match receipts are named after the family needs no entry.

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

`packages/data/data/printed-formats-v1.json` carries the `xln` entry with
`play.status: supported` and `admissionDirectory: play-admission`. The
launcher reads every supported entry at boot and `startBackendService` admits
all of them behind one Forge identity, so a launcher started before this entry
landed needs a restart to serve Ixalan. Card art is not staged: the catalog
carries each printing's Scryfall image URIs and
`packages/ui/src/card/printed-card-art.ts` renders the `art_crop` in the browser.
