# Gatecrash (GTC) printed Limited format

Registered, play-supported printed format, onboarded through the
`make-set-playable` skill (`mtg-j4ucd.10`) as one of the 19 sets of the batch.
Everything here was built by the shared printed-format tools; no GTC-specific
source file exists in the workspace and neither `ForgeBridge.java` nor the Node
adapter was edited (the adapter hash below is the one the other installed
admissions carry). The bridge digest moved once after the build, see
`play-admission-v2` under Closure, coverage, admission, and again for
Kaladesh (`play-admission-v3`, `mtg-j4ucd.19`).

## Product and identity

Gatecrash was drafted as three packs of itself: eight seats, rounds
`[gtc-draft, gtc-draft, gtc-draft]`, sealed is six `gtc-draft` boosters, basic
lands removed from the packs (`basicLandPolicy: remove`). Return to Ravnica is
not a format here and is not registered. It is in this directory only because
MTGJSON's Gatecrash draft booster lists `sourceSetCodes: [GTC, RTR]`: its
25-entry basic-land sheet is Return to Ravnica's Ravnica basics, and the
builder resolves every basic id through a catalog. With `sourceCodes: [GTC]` the
build fails with `missing source or duplicate source: RTR`, so the recipe names
both codes, has one product, and ships the RTR catalog as a dependency exactly as
`dka/` ships Innistrad's. The catalogs are GTC (249 printings, 249 scripts) and
RTR (274 printings, 254 scripts; RTR prints each of its five basic lands five times,
and those 25 printings share five scripts), 523 printings and 503 scripts in all. The
cost of the dependency is that qualification covers RTR's scripts too.

`dgm/` carries its own GTC and RTR catalogs, rebuilt from its pin, and they stay
copies on purpose (`make-set-playable` says why). All 249 GTC and 274 RTR cards
are field-for-field identical and only the source provenance differs, so the
hashes do: GTC `515aaffb...` there against `bf7b418c...` here, RTR `b26f7250...`
there against `b0c21d81...` here.

| artifact                    | sha256                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| format `contentSha256`      | `2eb1e51b5ac35ca09c73c7391bdc978c02340e91bc2a9ab391287c8be7d85c6f` |
| catalog GTC `contentSha256` | `bf7b418c9e0de05b4b7c21b53ef8631d1f02f8b9b61905a077850bc02a2204d3` |
| catalog RTR `contentSha256` | `b0c21d818619151dbaf1ca6493f91216ea8aa9efb270640c3607c12dece6392c` |
| source pin (`sources.json`) | `aa0a36bde9d5a434819d80f6d9859458f2b85e7a22dc274ca407de088141526f` |
| Forge script archive        | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| bridge (`bridgeSha256`)     | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`adapterSha256`)   | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file        | `2d37ac8adbaf3088f48d114bbde5f2c227327b8436f244efbfc56235d185e9fa` |
| display metadata file       | `99726bd1e7e2ebb55b6438d382a5e38d18bd821d58cb7b2c3861eb20c5758ee4` |

## Rebuilding

The source pin is `data/cache/gtc-rtr-20260919-source-pin/` (the MTGJSON and
Scryfall snapshots for GTC and RTR fetched 2026-09-19). The writers emit
prettier-formatted JSON, so the copies below need no formatting pass. Each tool
refuses an existing output, so bump the version segment of every `out/gtc/...`
path. Every tool that takes catalogs wants one `--catalog` flag per file.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets GTC,RTR --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/gtc/onboarding-format-v1.json --sources data/cache/gtc-rtr-20260919-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/gtc/build-v2
cp out/gtc/build-v2/gtc-printed-catalog-v1.json out/gtc/build-v2/rtr-printed-catalog-v1.json out/gtc/build-v2/gtc-limited-format-v1.json out/gtc/build-v2/build-evidence.json packages/data/data/gtc/
cp out/gtc/build-v2/sources.json packages/data/data/gtc/gtc-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/gtc-rtr-20260919-source-pin --catalog packages/data/data/gtc/gtc-printed-catalog-v1.json --catalog packages/data/data/gtc/rtr-printed-catalog-v1.json > packages/data/data/gtc/gtc-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/gtc/gtc-printed-catalog-v1.json --catalog packages/data/data/gtc/rtr-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Art

Card art is each printing's Scryfall `art_crop`. No card name is in both catalogs, so
each card has one printing to choose from. The set's scripts create 19 tokens and all 19 are bound in
`gtc-token-printings-v1.json`, each to the oldest Scryfall token printing that
states the same token, so the art does not always come from GTC's or RTR's own
token sheet:

| token (Forge name) | printing | note              |
| ------------------ | -------- | ----------------- |
| Saproling Token    | T10E 5   | 1/1 G Saproling   |
| Ooze Token         | TALA 8   | `*/*` G Ooze      |
| Angel Token        | TCON 1   | 4/4 W Angel       |
| Spirit Token       | TEVE 4   | 1/1 WB Spirit     |
| Frog Lizard Token  | TGTC 3   | 3/3 G Frog Lizard |
| Cleric Token       | TGTC 4   | 1/1 WB Cleric     |
| Horror Token       | TGTC 5   | 1/1 UB Horror     |
| Soldier Token      | TGTC 6   | 1/1 WR Soldier    |
| Knight Token       | TRTR 2   | 2/2 W Knight      |
| Assassin Token     | TRTR 4   | 1/1 B Assassin    |
| Dragon Token       | TRTR 5   | 6/6 R Dragon      |
| Centaur Token      | TRTR 7   | 3/3 G Centaur     |
| Rhino Token        | TRTR 9   | 4/4 G Rhino       |
| Wurm Token         | TRTR 11  | 5/5 G Wurm        |
| Elemental Token    | TRTR 12  | 8/8 WG Elemental  |
| Rat Token          | TSHM 3   | 1/1 B Rat         |
| Soldier Token      | TUGL 90  | 1/1 W Soldier     |
| Goblin Token       | TUGL 92  | 1/1 R Goblin      |
| Bird Token         | TZEN 2   | 1/1 W Bird        |

No token is left unbound. The one repeated name is the Soldier, and its two
printings differ in color (red-white and white), so `printingFor` in
`packages/ui/src/routes/play/backend-position.ts` tells them apart; no same-named
pair shares its colors, and no token oracle id repeats under one name, so no
`set-release-order.ts` entry is needed. `gtc-printed-format.test.ts` pins both
facts. Scryfall's Domri Rade emblem (TGTC 8) is left out of the token file
because its layout is `emblem`, and Forge creates it through an Effect rather
than a token script.

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins GTC at 249 of 249 scripts closed and RTR at
254 of 254. Thirty-three review entries were added for this build
(`forge-syntax-review-v1.json`), each citing the script lines it was read from.
`Extort` is mapped to optional-costs and replacement-trigger-choices, `Unleash`
to replacement-trigger-choices, `Scavenge` to priority and targets, `Cipher` to
priority, replacement-trigger-choices and zone-card-selection (the union of the
`Encode` and `Play` effect classes CardFactoryUtil expands it into), `MoveCounter`
to zone-card-selection and naming-text-numbers, `Reveal` to zone-card-selection,
`RevealValid` to replacement-trigger-choices and `TwoColors` to
naming-text-numbers. `Evolve`, `Detain`, the two "can't attack or block alone" and
"all creatures able to block do so" keywords, and the remaining trigger, static
and bookkeeping tokens are `non-choice`. The five new `Mode$` tokens were added
to `forge-effect-controller-calls-v1.json` (25 lines). The decision inventory
(`decision-inventory-v2`) reports no unknown syntax and no missing generated
dependency; the complete coverage plan has all 503 scripts `complete`;
qualification is 503 qualified, residual 0.

Cipher is the mechanic closest to a decision no contract covers, since the
encoded spell is recast from exile on combat damage. The inventory and the
Encode/Play audit put it entirely in families the reusable bundle already covers,
so it is admitted, but no witness here casts a cipher spell: the two scenario
witnesses are Grisly Spectacle (local, targeted removal, four Swamps) and Gutter
Skulk (engine, attack), and four match probes over `gtc-match-fixture.ts` (Forest
and Avacyn's Pilgrim). The starting-player seed is `gtc-local-pregame-v2`; under
`-v1` the probe failed with `expected { seat: +0, ...(4) } to match object {
kind: 'mulligan', seat: +0, ...(1) }`, the seed not handing the engine seat the
starting choice.

`gtc-printed-format.test.ts` re-verifies the admission, and the registry entry
is in `printed-formats-v1.json`.

`play-admission-v2` re-binds v1 to the bridge digest `mtg-t5ma0` produced
(`ForgeBridge.java` admits Phyrexian-mana costs by a structural cost rule
instead of a four-card name list): bridge `a2f01d19...` to `53d03a0c...`. The
adapter (`b5c63fa8...`), the format, the catalogs, the qualified script count
(503) and the residual (0) are unchanged, and the same scenario witnesses and
`gtc-match-fixture.ts` match probes produced the receipts. Re-bound with the
six-step recipe in `packages/data/data/isd/README.md`, with two `--catalog`
flags (GTC and RTR) on the inventory and admission steps; v1 was removed.

`play-admission-v3/` re-binds v2 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalogs and the contracts do not. The coverage plan changes for one script,
`s/sphere_of_safety.txt`: v2 covered it with the priority and mana-X contracts only, but its
attack tax reads as `CantAttackUnless`, which `mtg-j4ucd.5` (New Phyrexia) later mapped to the
optional-costs and combat decision families, so the re-bind stopped at qualification (`local
controller evidence does not cover combat`) until the plan was rebuilt against the current
inventory. v3 carries `controller-contract-optional-costs` and `controller-contract-combat` for that
script; the 502 other plans are unchanged. Qualification reports 503 qualified, residual 0.
The scenario and match probes were rerun on the new bridge. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `gtc`.

`play-admission-v4/` re-binds v3 (deleted) to the pod board's observed adapter
(`mtg-bc2.154.6.5.4.1`), which names the defender an attack is sent at: `PlayDefender` in
`packages/engine/src/play.ts`, read out of the move id by `forgeAttackDefender` in
`packages/forge-export/src/observed/backend.ts`. Both files are inside the adapter bundle every
printed admission pins, so the adapter digest changes (`b5c63fa8...` to `e5f289d1...`); the bridge,
the format, the catalog and the contracts do not, and the re-bound admission holds the same cards
and the same probe ids, differing only in the adapter it binds and the digests of the freshly
captured evidence. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v5`.

`play-admission-v5/` re-binds v4 (deleted) to the Emancipation Angel and Copter bridge fixes
(`e215264e8`, `ac338d39f`), on top of the Convoke fix admitting plain Convoke structurally
(`mtg-uz0mz`): `ForgeBridge.java` admits Emancipation Angel's bounce and names the refused
zone-choice shape, and folds Smuggler's Copter's Crew route into the Kaladesh Vehicle table. The
compiled bridge digest changes (`eb94daf2...`); the adapter (`e5f289d1...`), the format, the catalog
and the contracts do not. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v6`. This generation's rebind was left undone by mtg-4qga9's
closing workflow and completed here (`mtg-6qgu5`).

`play-admission-v6/` re-binds v5 (deleted) to the projected-keyword, soulbond-pairing and
player-counter changes (`mtg-pt9dp`, `mtg-in4k9`, `mtg-oin1f`, `mtg-vzxqq`):
`packages/engine/src/projection.ts` projects a permanent's current keywords and a soulbond pair's
badge on `ObjectView`, a same-named token printing is told apart by the keywords the token carries,
and a player's counters such as Energy are projected under the player's name;
`packages/forge-export/bridge/ForgeBridge.java` and `packages/forge-export/src/observed/protocol.ts`
carry the matching wire shape. Both the bridge and the adapter digests change (bridge `da5bcd66...`,
adapter `94b68b36...`); the format, the catalog and the contracts do not. Re-bound for every
registered format at once with `packages/data/tools/printed-admission-rebind-all.mjs`, which runs
the six-step recipe in `packages/data/data/isd/README.md` (Play admission); to re-bind after a
further adapter or bridge change, use output `play-admission-v7` (`mtg-ziwde`).

`play-admission-v7/` re-binds v6 (deleted) to the Improvise bridge fix
(`f18400713`, `ae3bb289e`): `ForgeBridge.java` distinguishes Improvise from Convoke and lets
reviewed artifact payments cover generic mana without choosing colors. The compiled bridge digest
changes (`d4880305...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); the next rebind is
`play-admission-v8/`.

`play-admission-v8/` re-binds v7 (deleted) to the reviewed split-mana bridge fix
(`285b00486`, `mtg-uz0mz.1.1`, `mtg-tho5a9`): the exact Coalition Relic route now also covers
Altar of the Lost, Cascading Cataracts, Molten Slagheap, Plasm Capture and Axebane Guardian, and Market
Festival, returning the color split the local seat chose for each produced mana. The compiled bridge digest
changes
(`ac89d54f...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v9/`.
