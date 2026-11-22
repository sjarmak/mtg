# Khans of Tarkir (KTK) printed Limited format

Registered, play-supported printed format, built entirely by the shared
printed-format tools; no Khans-specific source file exists in the workspace and
neither `ForgeBridge.java` nor the bundled Node adapter was edited. The
repo-local `make-set-playable` skill describes the process this directory is
the worked example of; Magic 2015's and Innistrad's READMEs are the fuller
single-set examples it follows.

## Product and identity

Eight-seat draft is KTK, KTK, KTK; sealed is six KTK boosters. Khans was a
standalone large set, so the draft booster's `sourceSetCodes` is `[KTK]` alone
and no dependency catalog ships beside it. Basic lands are removed from the packs
(`basicLandPolicy: remove`). The catalog holds the 293 exact Scryfall printings
of the set, mapped to 254 distinct Forge scripts.

| artifact                             | sha256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`               | `fe4e7bcdcb42abecf44a07ecb2cdda7bc5991290e1863530784725d8d604c0e5` |
| catalog KTK `contentSha256`          | `1d3991ff0440b1e55e1f63b8069fce8ff185ca08ee3276197b5df67ed3235713` |
| source pin (`sources.json`)          | `deeecd4c2d91946a70384a8ec668c302ccdb30448e796ae27592d4cf7d0e7e0c` |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| compiled bridge (`ForgeBridge.java`) | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`installed.ts` bundle)      | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file                 | `5eb11e9918e141cf9f8631ce587a7e35a5ffe4b69a70d7424cfec018c1243874` |

## Rebuilding

The source pin is `data/cache/ktk-20260920-source-pin/` (MTGJSON and Scryfall
snapshots fetched 2026-09-20; the raw snapshots are not vendored). Each tool
refuses an existing output, so bump the version segment of every `out/ktk/...`
path on a rebuild.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets KTK --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/ktk/onboarding-format-v1.json --sources data/cache/ktk-20260920-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/ktk/build-v1
cp out/ktk/build-v1/ktk-printed-catalog-v1.json out/ktk/build-v1/ktk-limited-format-v1.json out/ktk/build-v1/build-evidence.json packages/data/data/ktk/
cp out/ktk/build-v1/sources.json packages/data/data/ktk/ktk-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/ktk-20260920-source-pin --catalog packages/data/data/ktk/ktk-printed-catalog-v1.json > packages/data/data/ktk/ktk-display-metadata-v1.json
```

## Token printings

`ktk-token-printings-v1.json` holds the nine token printings the set's scripts
create. It is built from what the catalog's scripts create rather than from the
set's own token sheet (`TKTK`), and each token draws the **oldest** Scryfall
printing that states it, so a token's art can come from another set's sheet:
Zombie and Goblin from `TUGL`, Snake from `TZEN`, Spirit from `TSHM`, the
flying Vampire from `TISD`, and Bear, Bird, Warrior and Spirit Warrior from
`TKTK`. Card art is the oldest printing too (`set-release-order.ts`).

All ten token scripts the set creates (`b_2_2_vampire_flying`, `b_2_2_zombie`,
`bg_x_x_spirit_warrior`, `g_1_1_snake`, `g_4_4_bear`, `r_1_1_goblin`,
`r_1_1_goblin_haste`, `w_1_1_spirit_flying`, `w_1_1_warrior`,
`w_3_4_bird_flying`) are bound; the two Goblin scripts share the one
`Goblin Token` printing. **No token is left to the pending frame.** Three rows of
`TKTK` are deliberately unbound because no script creates them: the `Morph`
token (the face-down 2/2 is a game state, not a created token), and the Sarkhan
and Sorin emblems.

```sh
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/ktk/ktk-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Closure and coverage

`packages/data/test/forge-syntax-closure.test.ts` pins KTK at 254 of 254 scripts
closed by the shared review table (`packages/data/data/forge-syntax-review-v1.json`).
Eight tokens were added to that table for this set (883 -> 891): Outlast is
`mapped` to the families of the PutCounter ability Forge expands it into
(`zone-card-selection`, `replacement-trigger-choices`, `naming-text-numbers`),
and the rest (`ChangesZoneAll`, `LookAt`, `FaceDown`, `RememberCountered`,
`ExtraTurn`, `Skip`, and the one-counter Raid `etbCounter`) are `non-choice`.
`forge-effect-controller-calls-v1.json` gained one mode row (`ChangesZoneAll`).
Morph, Megamorph, Delve and Prowess were already reviewed and needed nothing.

`packages/data/test/ktk-printed-format.test.ts` rebuilds the decision inventory
and the complete coverage plan in-process and proves every one of the 254
scripts' decision families is covered by the reusable controller contracts. Every
obligation carries `claims: []`: the reusable
`printed-controller-contracts-protocol2-v6` bundle already covers every family
the set uses, so KTK needs no card-specific evidence beyond the "one local, one
engine" minimum the probe runner requires.

```sh
npx tsx packages/data/tools/inventory-printed-decisions.ts --catalog packages/data/data/ktk/ktk-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --token-scripts tools/forge/dist/res/tokenscripts --output out/ktk/decision-inventory-v2/inventory.json
npx tsx packages/data/tools/build-printed-script-coverage-plan.ts --catalog packages/data/data/ktk/ktk-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --reviews <(echo '{"schemaVersion":1,"kind":"printed-script-coverage-plan","scripts":[]}') > out/ktk/coverage-plan-prior-v1.json
npx tsx packages/data/tools/build-printed-complete-coverage-plan.ts --inventory out/ktk/decision-inventory-v2/inventory.json --prior out/ktk/coverage-plan-prior-v1.json --contracts out/validation-pilot/printed-controller-contracts-protocol2-v6/manifest.json --output out/ktk/complete-coverage-plan-v1/coverage-plan.json
```

## Morph

Morph is the mechanic a face-down permanent forces on a bridge, so it was
checked against real Forge before the rest was built, and it needed nothing new.
`packages/forge-export/test/observed-ktk-morph.integration.test.ts` casts Canyon
Lurkers with seven Mountains available and shows:

- the priority decision offers both the normal cast (`{4}{R}`) and a separate
  `You may cast this card face down as a 2/2 creature for {3}` option;
- choosing the face-down option asks for `{3}`, not `{4}{R}`;
- the resulting permanent is projected to its own controller as a nameless,
  colorless 2/2 `Creature`, so the hidden state is honest in the public view;
- once it resolves, priority offers `Morph {3}{R} (Turn this face up any time for
its morph cost.)`, and paying it turns the card up as Canyon Lurkers 5/2.

That test uses a scenario snapshot and sits in its own file so it is not part of
the probe population; the coverage plan already covers Morph through the
`optional-costs` family. What it does not prove is how the play surface draws a
nameless permanent; `npm run verify:live` is the browser check for that.

## Scenario and match witnesses

`packages/forge-export/test/observed-ktk-contract-witness.integration.test.ts`
carries the two `scope: "scenario"` witnesses and only those two: a local Throttle
caster killing the only legal creature, and Forge attacking with Monastery
Swiftspear while the local seat only answers its own decisions. Swiftspear is a
1/2, so the attack leaves the local seat at 19 life. Throttle (`{4}{B}`, target
creature gets -4/-4) is the shortest single-target removal in the catalog;
Reach of Shadows, the obvious unconditional kill spell, is Fate Reforged's.

The match config covers starting-player, mulligan, priority and the local pregame
over Mountain and the shared `AUDITED_FORGE_CARD_NAMES` card Monastery
Swiftspear (`packages/forge-export/test/support/ktk-match-fixture.ts`).
Avacyn's Pilgrim, the one-drop the earlier sets use, is not a Khans card, so the
fixture takes the audited one-drop the catalog does hold. The portable
`engineStarts` seed is `ktk-local-pregame-v1`; `localToss` (`1514`) was portable
as-is.

```sh
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/ktk/probes/ktk-scenario-probes-v1-config.json --out out/ktk/scenario-probes-v1 --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualification-bundle.ts --evidence out/ktk/scenario-probes-v1 --inventory out/ktk/decision-inventory-v2/inventory.json --out out/ktk/script-qualifications-v1
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/ktk/probes/ktk-match-probes-v1-config.json --out out/ktk/match-probes-v1 --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualified-admission.ts --format packages/data/data/ktk/ktk-limited-format-v1.json --catalog packages/data/data/ktk/ktk-printed-catalog-v1.json --qualifications out/ktk/script-qualifications-v1 --match-probes out/ktk/match-probes-v1 --out packages/data/data/ktk/play-admission-v1
```

The qualification bundle reports `qualified: 254, residual: 0`.

## Constructed pilot decks

`ktk-constructed-format-v1.json` contains the Abzan Outlast, Jeskai Prowess,
Sultai Delve, Mardu Raid and Temur Ferocious decks that passed structural
validation and a complete game against the Forge bot.

Build or rebuild one archetype with an explicit model ceiling. `<claude-config>`
is the selected account home's `.claude` directory, resolved fresh at dispatch
time so capacity routing holds, never a
`~/.claude-leases/*` path (mayor, 2026-09-28: those are one-time copies that go
permanently dead the moment the real account home's own login next refreshes,
since that rotates the refresh token the copy still holds) and never copied
into a worker's own home:

```sh
CLAUDE_CONFIG_DIR=<claude-config> npx tsx packages/decklab/src/cli.ts --printed-format ktk --archetype 'Abzan Outlast' --colors W,B,G --prompt 'Build around Abzan Charm: Develop creatures early, outlast when combat pauses, and turn the accumulated counters into shared keywords.' --lands 28 --max-usd 20 --output out/ktk-constructed/abzan-outlast.json
```

After every archetype artifact exists, assemble the candidate, run the serial
Forge proof through the same table builder and HTTP gateway as the Constructed
page, then emit only completed decks:

```sh
npx tsx packages/data/tools/build-printed-constructed.ts --format ktk --artifacts out/ktk-constructed --candidate --out out/ktk-constructed/candidate.json
MTG_TEST_WORKERS=1 npx tsx packages/ui/tools/verify-printed-constructed.ts --format ktk --candidate out/ktk-constructed/candidate.json --out out/ktk-constructed/forge-receipt.json
npx tsx packages/data/tools/build-printed-constructed.ts --format ktk --artifacts out/ktk-constructed --receipt out/ktk-constructed/forge-receipt.json --out packages/data/data/ktk/ktk-constructed-format-v1.json
```

## Play admission

`play-admission-v1/` was a verified full-card and match admission for all 293
printings (254 exact scripts), built 2026-09-20 against Forge 2.0.14 and the
generalized bridge protocol 2, on the Phyrexian-mana bridge (`53d03a0c...`). It
was built on that bridge and stranded by the next edit to `ForgeBridge.java`, which is
the Kaladesh re-bind below.
`packages/data/test/ktk-printed-format.test.ts` re-verifies the installed
admission against the staged format and catalog on every run.

`play-admission-v2/` re-binds v1 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `ktk`.

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
change, use output `play-admission-v9/`.

`play-admission-v9/` re-binds v8 (deleted) to the targeted-opponent trigger discard bridge fix
(`mtg-9vjbg0`). Its scenario population adds `skullhunter-raid-human-discard-v1`, which attacks
before casting Mardu Skullhunter, reaches the raid trigger with the local seat as the targeted
opponent, and records that seat choosing the discarded card. The compiled bridge digest changes
(`7df7bfba...`); the adapter, format, catalog and controller contracts do not. Every other
registered printed format was re-bound to the same bridge with
`packages/data/tools/printed-admission-rebind-all.mjs`.

## Registration

`packages/data/data/printed-formats-v1.json` carries the `ktk` entry with
`play.status: supported`, `admissionDirectory: play-admission-v9` and the
constructed sidecar. The
launcher reads every supported entry at boot and `startBackendService` admits
all of them behind one Forge identity, so a launcher started before this entry
landed needs a restart to serve Khans. Card art is not staged: the catalog
carries each printing's Scryfall image URIs and
`packages/ui/src/card/printed-card-art.ts` renders the `art_crop` in the browser.
