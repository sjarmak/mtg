# AKH/HOU printed Limited sources

These are verified catalog and collation artifacts, **not play-admission evidence**. The Forge script named by each printing was found in the installed archive and its `Name:` lines checked. That establishes script identity, not that every human or bot decision is supported by the bridge.

## Product and identity

The format uses HOU → HOU → AKH for eight-seat drafts and four HOU plus two AKH boosters for individual sealed, as specified in the [July 2017 Tournament Rules, Appendix D](https://blogs.magicjudges.org/rscr/files/2017/07/MTG_MTR_14Jul17_RU.pdf). MP2 supplies Invocations to the products' foil sheets; it is an auxiliary source, not a draft round. The [HOU release notes](https://magic.wizards.com/en/news/feature/hour-devastation-release-notes-2017-06-30) describe their Limited legality.

The catalogs contain 287 AKH, 209 HOU, and 54 MP2 exact Scryfall printings. Galleries may show all of them; booster sheets, not gallery membership, determine which cards open. Multiple MTGJSON face UUIDs can identify one Scryfall printing. The builder resolves those aliases and verifies set, collector number, name, and Oracle identity without substituting a different printing.

Catalogs reuse `@mtg/printed-card`. The format recipe references their content hashes. `@mtg/draft-export` verifies them, opens products through `@mtg/deckbuild`, and gives every opened copy its own identity. Repeated printings across packs therefore remain distinct draft and deck objects. No card is converted to the generated-card DSL.

## Rebuilding

Acquisition uses the existing rate-limited HTTP client. Both commands require a new output directory and refuse replacement:

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets AKH,HOU,MP2 --out <new-source-directory>
npx tsx packages/data/tools/build-akh-hou-catalogs.ts --sources <source-directory> --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out <new-artifact-directory>
```

The committed source manifest pins MTGJSON 5.3.0+20260911, exact snapshot hashes, URLs, and acquisition time. Reacquiring mutable upstream data is not guaranteed to reproduce these bytes. The original local snapshots are in `data/cache/akh-hou-20260911-source-pin/`; raw snapshots and the Forge archive are not vendored here. The offline builder verifies source hashes before reading their contents. `build-evidence.json` records the archive and output identities.

The play admission is re-bound to a new bridge or adapter with the six-step
recipe in `packages/data/data/isd/README.md` (Play admission), run with format
id `akh-hou` and output `play-admission-v47`. akh-hou also needs the Hostile
Desert cost-card-selection obligation in its coverage plan, which v46 carries
forward from v45
(`out/akh-hou/complete-coverage-plan-v2` is built from
`akh-hou-script-coverage-plan-v1.json` as its prior, so the 21 scenario claims survive).
`play-admission-v45/` was a verified full-card and match admission for all 550
printings (509 exact scripts), rebuilt 2026-09-19 against Forge 2.0.14 for the
Phyrexian-mana structural rule (`mtg-t5ma0`): the bridge's Phyrexian-mana
allowlist of four reviewed cards was replaced with a structural check on the
cost itself, changing the bridge digest without touching the adapter. v45
re-admits the same 509 scripts and the same four match probes as v44 under the
new bridge; the qualification bundle reported `qualified: 509, residual: 0`.

`play-admission-v46/` re-binds v45 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `akh-hou`.

`play-admission-v47/` re-binds v46 (deleted) to the pod board's observed adapter
(`mtg-bc2.154.6.5.4.1`), which names the defender an attack is sent at: `PlayDefender` in
`packages/engine/src/play.ts`, read out of the move id by `forgeAttackDefender` in
`packages/forge-export/src/observed/backend.ts`. Both files are inside the adapter bundle every
printed admission pins, so the adapter digest changes (`b5c63fa8...` to `e5f289d1...`); the bridge,
the format, the catalog and the contracts do not, and the re-bound admission holds the same cards
and the same probe ids, differing only in the adapter it binds and the digests of the freshly
captured evidence. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v48`.

`play-admission-v48/` re-binds v47 (deleted) to the Emancipation Angel and Copter bridge fixes
(`e215264e8`, `ac338d39f`), on top of the Convoke fix admitting plain Convoke structurally
(`mtg-uz0mz`): `ForgeBridge.java` admits Emancipation Angel's bounce and names the refused
zone-choice shape, and folds Smuggler's Copter's Crew route into the Kaladesh Vehicle table. The
compiled bridge digest changes (`eb94daf2...`); the adapter (`e5f289d1...`), the format, the catalog
and the contracts do not. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v49`. This generation's rebind was left undone by mtg-4qga9's
closing workflow and completed here (`mtg-6qgu5`).

`play-admission-v49/` re-binds v48 (deleted) to the projected-keyword, soulbond-pairing and
player-counter changes (`mtg-pt9dp`, `mtg-in4k9`, `mtg-oin1f`, `mtg-vzxqq`):
`packages/engine/src/projection.ts` projects a permanent's current keywords and a soulbond pair's
badge on `ObjectView`, a same-named token printing is told apart by the keywords the token carries,
and a player's counters such as Energy are projected under the player's name;
`packages/forge-export/bridge/ForgeBridge.java` and `packages/forge-export/src/observed/protocol.ts`
carry the matching wire shape. Both the bridge and the adapter digests change (bridge `da5bcd66...`,
adapter `94b68b36...`); the format, the catalog and the contracts do not. Re-bound for every
registered format at once with `packages/data/tools/printed-admission-rebind-all.mjs`, which runs
the six-step recipe in `packages/data/data/isd/README.md` (Play admission); to re-bind after a
further adapter or bridge change, use output `play-admission-v50` (`mtg-ziwde`).

`play-admission-v50/` re-binds v49 (deleted) to the Improvise bridge fix
(`f18400713`, `ae3bb289e`): `ForgeBridge.java` distinguishes Improvise from Convoke and lets
reviewed artifact payments cover generic mana without choosing colors. The compiled bridge digest
changes (`d4880305...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); the next rebind is
`play-admission-v51/`.

`play-admission-v51/` re-binds v50 (deleted) to the reviewed split-mana bridge fix
(`285b00486`, `mtg-uz0mz.1.1`, `mtg-tho5a9`): the exact Coalition Relic route now also covers
Altar of the Lost, Cascading Cataracts, Molten Slagheap, Plasm Capture and Axebane Guardian, and Market
Festival, returning the color split the local seat chose for each produced mana. The compiled bridge digest
changes
(`ac89d54f...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v52/`.

## Token printings

`akh-hou-token-printings-v1.json` holds the 12 token printings (Amonkhet's and Hour of Devastation's token sheets): each row
is one Scryfall token printing bound to the Forge token script whose facts
(name, colors, power and toughness, types) it matches, so the board draws a
token the engine created from the set's own token art rather than the labeled
pending frame. The registry entry names it as `tokenPrintingsFile`, the launcher
stages it beside the catalogs, and `packages/data/test/token-printings.test.ts`
re-derives every binding from the installed Forge token scripts. A token the
engine creates that no row witnesses still fails closed to the pending frame,
and the battlefield piles those by observed identity. Rebuild it with a new
output path; the tool refuses an existing one:

```sh
npx tsx packages/data/tools/fetch-token-printings.ts --sets TAKH,THOU --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Display metadata

`akh-hou-display-metadata-v1.json` attaches printing rarity to the existing
physical catalog IDs. It binds each catalog hash and pinned Scryfall snapshot
hash and must cover every printing exactly. It is a presentation-only companion:
catalogs, format recipes, resume fingerprints, and Forge evidence are unchanged.
The browser bundle index names its content-addressed resource; no card-data
service is called while browsing or drafting. Older bundles without it retain
their original gallery controls.

Reproduce the JSON on stdout from the verified local snapshots:

```sh
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/akh-hou-20260911-source-pin --catalog packages/data/data/akh-hou/akh-printed-catalog-v1.json --catalog packages/data/data/akh-hou/hou-printed-catalog-v1.json --catalog packages/data/data/akh-hou/mp2-printed-catalog-v1.json
```

Rarity sorting uses common, uncommon, rare, mythic, special, bonus, then name
and physical ID for ties. These are printing rarities, not draft frequencies or
power ratings. Rarity filtering also includes cards outside booster sheets.

## Sampling boundary

The runtime retains MTGJSON's weighted configurations, rarity sheets, foil flags, and cross-set entries. Its explicit no-basics policy removes basic land positions and reweights foil basic entries, producing 14-card packs. This is a Limited simulation product, not an exact retail pack reconstruction.

MTGJSON's [sheet model](https://mtgjson.com/data-models/booster/booster-sheet/) requests color balancing but does not supply factory sheet order. The seeded sampler reserves one common of each mono color and compensates the colorless/multicolor quota using stochastic rounding. It avoids within-sheet duplicates and preserves the expected other-card quota; it does not claim exact factory correlations or individual weighted-card marginal probabilities. Ordinary unbalanced sheets keep the prior sampler. Replay fingerprints include the sampler version, so changing this behavior invalidates old transcripts explicitly.

The actual-artifact regression opens draft and sealed products and replays three full pods pick by pick. Its mechanical scoring policy tests replay correctness, not strategic bot quality or Forge interactions.

## Script review inventory

The offline inventory command accounts for every catalog printing, checks its catalog and script hashes, and emits literal Forge keyword/API/trigger identifiers for navigating the review workload:

```sh
npx tsx packages/data/tools/inventory-printed-scripts.ts --catalog packages/data/data/akh-hou/akh-printed-catalog-v1.json --catalog packages/data/data/akh-hou/hou-printed-catalog-v1.json --catalog packages/data/data/akh-hou/mp2-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip
```

It writes JSON to stdout, reads only local files, and does not vendor Forge scripts. The pinned catalogs resolve to 550 printing rows and 509 distinct script paths. Reprints remain separate rows. Every row starts `review: pending`: this is a regenerated review input, not a mutable review ledger or play-admission artifact. Existing probe results must be qualified separately against the runtime and the interactions actually exercised.

Literal identifiers are not inferred decision families. Keyword expansion, referenced tokens, conditional branches, and combinations between cards can introduce decisions absent from these top-level hints. An empty hint list does not establish that a card is supported. The inventory does not narrow qualification to cards sampled in one draft, or distinguish booster eligibility from gallery membership.
