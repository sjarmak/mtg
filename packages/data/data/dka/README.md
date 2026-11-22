# Dark Ascension (DKA) printed Limited format

Registered, play-supported printed format, onboarded through the
`make-set-playable` skill (`mtg-j4ucd.8`) as one of the 19 sets of the batch.
Everything here was built by the shared printed-format tools; no DKA-specific
source file exists in the workspace and the Node adapter has never been edited
(the adapter hash below is the one every onboarded set carries), but the bridge
has: `play-admission-v2` re-binds `play-admission-v1` to the Phyrexian-mana
structural rule added to `ForgeBridge.java` (`mtg-t5ma0`), and `play-admission-v3` re-binds v2 to the six Kaladesh edits (`mtg-j4ucd.19`). The one shared tool
change from onboarding is `forgeScriptFileName` (see Rebuilding).

## Product and identity

Dark Ascension was drafted with Innistrad, so the format is a two-catalog
format: DKA (158 printings, 158 scripts) and ISD (264 printings, 254 scripts;
ISD prints each of the five basic lands three times, and those fifteen
printings share five scripts). No card name appears in both catalogs, so no card
has two candidate printings. The builder reads one pin directory, so this
format's Innistrad catalog was rebuilt from its own pin rather than copied from
`isd/`: its `contentSha256` differs from the standalone format's (`63879d48...`
against `95fe8d23...`), while all 264 cards are field-for-field identical and
only the source provenance differs.

Eight-seat draft is DKA, ISD, ISD (`rounds: [dka-draft, isd-draft, isd-draft]`,
the order the set was actually drafted in). Sealed is six boosters, two DKA and
four ISD, which keeps the draft's one-to-two weighting of DKA to ISD over six
packs instead of three. Basic lands are removed from the packs
(`basicLandPolicy: remove`). Innistrad's own single-set format (`isd`) is
untouched and stays registered beside this one. The `isd-draft` product here is
Innistrad's own `draft` booster, so a pack from either set is laid out exactly
as it is in the single-set format; AKH/HOU is the two-set precedent.

| artifact                    | sha256                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| format `contentSha256`      | `7ad14328b958d27e2bc1a1c7a436345a32e21809f519c47ef052ee8bf905c75e` |
| catalog DKA `contentSha256` | `76b2f918d69578928e0cfb8c328bebfba9c714ec1c51dc37cd499934681e3c5d` |
| catalog ISD `contentSha256` | `63879d480bd704b6428145523372eac6a7e8abf7fc6f5b71a7e8315ab9074604` |
| source pin (`sources.json`) | `22b8d5061fad9cb43fde7a376b08b68e2da0f490797bbe3333bb68f36b813659` |
| Forge script archive        | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| bridge (`bridgeSha256`)     | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`adapterSha256`)   | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file        | `2458b6b2e94ea7ec2a1551495c9a3be8e1f6b34024bf94d2cdd7b7a68338ad53` |
| display metadata file       | `bee6b9d72e9cc7d35cd714092ee8becbb0e424ca4f9462ac1d197e1e3cbc7e66` |

## Rebuilding

The source pin is `data/cache/dka-20260919-source-pin/` (the MTGJSON and
Scryfall snapshots for DKA and ISD fetched 2026-09-19). The writers emit
prettier-formatted JSON, so the copies below need no formatting pass. Each tool
refuses an existing output, so bump the version segment of every `out/dka/...`
path. Every tool that takes catalogs wants one `--catalog` flag per file, and
the display metadata and token printings of a multi-set format need **every**
catalog: a metadata file built from the DKA catalog alone describes no ISD card.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets DKA,ISD --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/dka/onboarding-format-v1.json --sources data/cache/dka-20260919-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/dka/build-v2
cp out/dka/build-v2/dka-printed-catalog-v1.json out/dka/build-v2/isd-printed-catalog-v1.json out/dka/build-v2/dka-limited-format-v1.json out/dka/build-v2/build-evidence.json packages/data/data/dka/
cp out/dka/build-v2/sources.json packages/data/data/dka/dka-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/dka-20260919-source-pin --catalog packages/data/data/dka/dka-printed-catalog-v1.json --catalog packages/data/data/dka/isd-printed-catalog-v1.json > packages/data/data/dka/dka-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/dka/dka-printed-catalog-v1.json --catalog packages/data/data/dka/isd-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

Two shared-tool fixes came out of this build. Forge names a script file by the
card name with diacritics folded and ligatures spelled out (`Séance` is
`seance.txt`, `Æther Vial` is `aether_vial.txt`); the script lookup dropped the
accented letter instead (`sance.txt`) and failed with `missing Forge script`.
`forgeScriptFileName` (`packages/data/src/printed-card/format-build-files.ts`)
is now the one place that derives the file name, with a table test. And
`fetch-token-printings --catalog` took a single file, which cannot cover a
two-catalog format, so the flag is now repeatable.

## Art

Every one of the 422 card printings has `art.status: available` (a Scryfall
`art_crop`), and since no card name is in both catalogs there is one printing to
choose from per card. The set's scripts create 12 tokens and
all 12 are bound in `dka-token-printings-v1.json`, each to the oldest Scryfall
token printing that states the same token (Scryfall `order=released`,
ascending), so the art does not always come from DKA's or ISD's own token
sheet:

| token (Forge name) | printing | note                                   |
| ------------------ | -------- | -------------------------------------- |
| Ooze Token         | TALA 8   | `*/*` green Ooze                       |
| Angel Token        | TCON 1   | 4/4 white Angel                        |
| Human Token        | TDKA 1   | 1/1 white Human, DKA's own token sheet |
| Vampire Token      | TDKA 2   | 1/1 black Vampire (lifelink)           |
| Homunculus Token   | TISD 3   | 2/2 blue Homunculus                    |
| Demon Token        | TISD 4   | 5/5 black Demon                        |
| Vampire Token      | TISD 5   | 2/2 black Vampire (flying)             |
| Wolf Token         | TISD 6   | 1/1 black Wolf                         |
| Wolf Token         | TLRW 10  | 2/2 green Wolf                         |
| Spirit Token       | TSHM 2   | 1/1 white Spirit                       |
| Spider Token       | TSHM 6   | 1/2 green Spider                       |
| Zombie Token       | TUGL 91  | 2/2 black Zombie                       |

No token is left unbound. One pair is still ambiguous on the play surface:
both Vampires are black and carry the same Forge name, and they are different
oracle ids, so `printingFor` in `packages/ui/src/routes/play/backend-position.ts`
cannot pick between them and fails closed to the labeled pending frame. The two
Wolves differ in color and are told apart. A Vampire's base power and toughness
are not in the projected object (a counter changes what the view shows), so
the fix is a design decision about what else the selector may read, not a data
change; it is pinned as a fact in `dka-printed-format.test.ts` rather than
worked around here. Each token oracle id appears once in the file, so no
`set-release-order.ts` entry is needed for it.

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins DKA at 158 of 158 scripts closed by the
shared review table (ISD stays at 254 of 254). Eight review entries were added
for this build (`forge-syntax-review-v1.json`, 770 -> 778 entries), each
citing the script lines it was read from: `ProtectionAll` is `mapped` to
naming-text-numbers (Faith's Shield's Fateful hour mode names a color), and
`NumLimitEachTurn`, `ForgetObjects`, `etbCounter:P1P1:4:CheckSVar`,
`Counters & Type`, the "must be blocked if able" keyword, `RemoveFromCombat`
and `CantTransform` are `non-choice`. Because the table is shared across every
printed set, this also raised closure counts for other editions that use these
tokens. The decision inventory (`decision-inventory-v2`) reports no unknown
root or dependency syntax and no missing generated dependency; the complete
coverage plan has all 412 scripts `complete`; qualification is 412 qualified,
residual 0.

`play-admission-v1/` was built with the contract bundle
`out/validation-pilot/printed-controller-contracts-protocol2-v6`, two scenario
witnesses in `observed-dka-contract-witness.integration.test.ts` (Tragic Slip
from DKA as the local seat's targeted removal, Voiceless Spirit from ISD as the
engine seat's attacker) and four match-probe test files (six tests) over
`test/support/dka-match-fixture.ts` (Forest and Avacyn's Pilgrim). The
starting-player seed is `dka-local-pregame-v2`: under `-v1` the probe "DKA
engine-controlled starting choice reaches its first turn without a local
starting move" failed with `expected { seat: +0, ...(4) } to match object {
kind: 'mulligan', seat: +0, ...(1) }`, meaning the seed did not hand the engine
seat the starting choice. That is a property of the seed, not of the bridge, so
the seed was bumped and the six probes then passed; the failed run's receipt
is kept (gitignored) under `out/dka/match-probes-v1-failed-seed-v1/`.

`play-admission-v2` re-binds v1 to the same bridge digest every set touched by
`mtg-t5ma0` now carries; the adapter, the format, both catalogs, the qualified
script count (412) and the residual (0) are unchanged, and the same
`observed-dka-contract-witness.integration.test.ts` and
`test/support/dka-match-fixture.ts` sources produced the receipts. Re-bind with
the six-step recipe in `packages/data/data/isd/README.md`.

`play-admission-v3/` re-binds v2 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `dka`.

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

`dka-printed-format.test.ts` re-verifies the admission, and the registry entry
is in `printed-formats-v1.json`.

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
