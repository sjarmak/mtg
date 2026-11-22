# Magic Origins (ORI) printed Limited format

Registered, play-supported printed format, built entirely by the shared
printed-format tools; no Origins-specific source file exists in the workspace and
neither `ForgeBridge.java` nor the bundled Node adapter was edited. The
repo-local `make-set-playable` skill describes the process this directory is
the worked example of; Khans of Tarkir's README is the closest single-set example.

## Product and identity

Eight-seat draft is ORI, ORI, ORI; sealed is six ORI boosters. Origins was a
standalone core set, so the draft booster's `sourceSetCodes` is `[ORI]` alone and
no dependency catalog ships beside it. Basic lands are removed from the packs
(`basicLandPolicy: remove`). The catalog holds the 288 exact Scryfall printings
of the set, mapped to 273 distinct Forge scripts.

| artifact                             | sha256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`               | `9c345483629ef4cbd011afdcaab83f12b2a2416d4ac8c092ab322436acc39fed` |
| catalog ORI `contentSha256`          | `3bdeb0af2b8d62beb626bbe266e24bf7e474d3bce3627bf896914cb9c34355c2` |
| source pin (`sources.json`)          | `9102c27d22b3c81acee8ae9ee297ebb43bc7dd57d504354b3a89dcf02472959e` |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| compiled bridge (`ForgeBridge.java`) | `53d03a0ca64abbdfeec64af6458d1523c6646004f3d2cc778727491fe8b8ee90` |
| adapter (`installed.ts` bundle)      | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file                 | `8478ea5716fcf0eba591dd212acacfb61036a0fc5aec5b67210a9e2ae4fe3209` |
| display metadata file                | `4315462bc6aadb8349e3541e838ec24a4ce52d04d464cc882ccea6e9dc60b13c` |

## Rebuilding

The source pin is `data/cache/ori-20260920-source-pin/` (MTGJSON and Scryfall
snapshots fetched 2026-09-20; the raw snapshots are not vendored). Each tool
refuses an existing output, so bump the version segment of every `out/ori/...`
path on a rebuild.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets ORI --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/ori/onboarding-format-v1.json --sources data/cache/ori-20260920-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/ori/build-v1
cp out/ori/build-v1/ori-printed-catalog-v1.json out/ori/build-v1/ori-limited-format-v1.json out/ori/build-v1/build-evidence.json packages/data/data/ori/
cp out/ori/build-v1/sources.json packages/data/data/ori/ori-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/ori-20260920-source-pin --catalog packages/data/data/ori/ori-printed-catalog-v1.json > packages/data/data/ori/ori-display-metadata-v1.json
```

## Token printings

`ori-token-printings-v1.json` holds the ten token printings the set's scripts
create. It is built from what the catalog's scripts create rather than from the
set's own token sheet, and each token draws the **oldest** Scryfall printing that
states it, so a token's art can come from another set's sheet. Card art is the
oldest printing too (`set-release-order.ts`).

All ten token scripts the set creates (`ashaya_the_awoken_world`, `b_2_2_zombie`,
`b_5_5_demon_flying`, `c_1_1_a_thopter_flying`, `g_1_1_elf_warrior`,
`g_2_2_elemental`, `r_1_1_goblin`, `w_1_1_soldier`, `w_2_2_knight_vigilance`,
`w_4_4_angel_flying`) are bound. **No token is left to the pending frame.**
Ashaya, the Awoken World is a token that bears a card's name: it is the 4/4 that
Nissa, Sage Animist makes, and the printing is matched by that name. Each of the
ten names is distinct, so the play surface never depends on the color fallback;
`ori-printed-format.test.ts` pins the ten name-and-color keys.

```sh
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/ori/ori-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Closure and coverage

`packages/data/test/forge-syntax-closure.test.ts` pins ORI at 257 of 257 scripted
cards closed by the shared review table
(`packages/data/data/forge-syntax-review-v1.json`); the format's catalog maps to
273 distinct scripts, and the format test closes all 273 through the same table. Nine tokens were added to that table for this set, and
`forge-effect-controller-calls-v1.json` gained one mode row (`BecomeRenowned`).

`packages/data/test/ori-printed-format.test.ts` rebuilds the decision inventory
and the complete coverage plan in-process and proves every one of the 273
scripts' decision families is covered by the reusable controller contracts. Every
obligation carries `claims: []`: the reusable
`printed-controller-contracts-protocol2-v7` bundle already covers every family
the set uses, so Origins needs no card-specific evidence beyond the "one local,
one engine" minimum the probe runner requires.

```sh
npx tsx packages/data/tools/inventory-printed-decisions.ts --catalog packages/data/data/ori/ori-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --token-scripts tools/forge/dist/res/tokenscripts --output out/ori/decision-inventory-v2/inventory.json
npx tsx packages/data/tools/build-printed-script-coverage-plan.ts --catalog packages/data/data/ori/ori-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --reviews <(echo '{"schemaVersion":1,"kind":"printed-script-coverage-plan","scripts":[]}') > out/ori/coverage-plan-prior-v1.json
npx tsx packages/data/tools/build-printed-complete-coverage-plan.ts --inventory out/ori/decision-inventory-v2/inventory.json --prior out/ori/coverage-plan-prior-v1.json --contracts out/validation-pilot/printed-controller-contracts-protocol2-v7/manifest.json --output out/ori/complete-coverage-plan-v1/coverage-plan.json
```

## Flip planeswalkers

Origins' five flip planeswalkers (Kytheon, Jace, Chandra, Liliana and Nissa) are
double-faced creatures that exile themselves and return transformed. Their scripts
do it with `ChangeZone | Transformed$ True`, and Forge registers the transform
script under the front-face name. They were checked before the rest was built.
`packages/forge-export/test/observed-ori-flip-witness.integration.test.ts` runs two
of them on real Forge: Jace, Vryn's Prodigy flips through an activated ability
(loot with five cards in the graveyard) and Nissa, Vastwood Seer flips through a
land trigger (the seventh land enters). In both, the front face leaves the
battlefield and a permanent whose type line contains `Planeswalker` takes its
place. The bridge needed nothing new.

Kytheon (end of combat, needs three attackers), Chandra (three damage this turn)
and Liliana (another nontoken creature you control dies) are not witnessed on real
Forge. Their scripts use the same `ChangeZone | Transformed$ True` step as the two
that are, and the bridge has no branch on the trigger or the ability that reaches
it. That is an inference from the scripts, not a run.

## Scenario and match witnesses

`packages/forge-export/test/observed-ori-contract-witness.integration.test.ts`
carries the two `scope: "scenario"` witnesses and only those two: a local Reave
Soul caster killing the only legal creature, and Forge attacking with Goblin Glory
Chaser while the local seat only answers its own decisions.

The match config covers starting-player, mulligan, priority and the local pregame
over Plains and Kytheon, Hero of Akros, the audited one-drop the catalog holds
(`packages/forge-export/test/support/ori-match-fixture.ts`). The portable
`engineStarts` seed is `ori-local-pregame-v1` and `localToss` (`1514`) was portable
as-is. Abbot of Keral Keep, the first audited two-drop tried, failed the native
priority probe (`expected true to be false` on its check that the creature left
the stack after the pass); its enters trigger is the likely cause, which was not
confirmed, and Kytheon passes.

```sh
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/ori/probes/ori-scenario-probes-v1-config.json --out out/ori/scenario-probes-v1 --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualification-bundle.ts --evidence out/ori/scenario-probes-v1 --inventory out/ori/decision-inventory-v2/inventory.json --out out/ori/script-qualifications-v1
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/ori/probes/ori-match-probes-v1-config.json --out out/ori/match-probes-v1 --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualified-admission.ts --format packages/data/data/ori/ori-limited-format-v1.json --catalog packages/data/data/ori/ori-printed-catalog-v1.json --qualifications out/ori/script-qualifications-v1 --match-probes out/ori/match-probes-v1 --out packages/data/data/ori/play-admission-v1
```

The qualification bundle reports `qualified: 273, residual: 0`.

## Play admission

`play-admission-v1/` was a verified full-card and match admission for all 288
printings (273 exact scripts), built 2026-09-20 against Forge 2.0.14 and the
generalized bridge protocol 2. A later edit to `ForgeBridge.java` or the adapter
strands it, and the six-step re-bind recipe in `packages/data/data/isd/README.md`
applies. `packages/data/test/ori-printed-format.test.ts` re-verifies the
installed admission against the staged format and catalog on every run.

`play-admission-v2/` re-binds v1 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`53d03a0c...` to `702a7926...`); the
adapter, the format, the catalog and the contracts do not, and the re-bound admission holds the
same cards and the same probe ids, differing only in the bridge it binds and the digests of the
freshly captured evidence. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `ori`. Origins landed after the Kaladesh lane
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

`packages/data/data/printed-formats-v1.json` carries the `ori` entry with
`play.status: supported` and `admissionDirectory: play-admission-v7`. The
launcher reads every supported entry at boot, so a launcher started before this
entry landed needs a restart to serve Origins. Card art is not staged: the catalog
carries each printing's Scryfall image URIs and
`packages/ui/src/card/printed-card-art.ts` renders the `art_crop` in the browser.
