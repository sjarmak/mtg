# Kaladesh / Aether Revolt (kld-aer) printed Limited format

Registered, play-supported printed format, part of the 19-set batch
(`mtg-j4ucd`) built by the shared printed-format tools (`make-set-playable`).
Aether Revolt (`mtg-j4ucd.20`) merges into the standalone Kaladesh format
(`mtg-j4ucd.19`) rather than sitting beside it, the same block-merge precedent
`akh-hou` set: one format id, one directory, one draft recipe spanning both
sets. The format draws on one auxiliary source beyond the two base sets:
Kaladesh Inventions (MPS), the masterpiece series printed alongside both, is
pulled in for card-pool and closure purposes even though it is not one of the
format's own boosters.

## Product and identity

Eight-seat draft is `aer-draft, aer-draft, kld-draft`: two Aether Revolt packs
then one Kaladesh pack per seat per round, the same shape a real Aether Revolt
draft used. Sealed is four Aether Revolt boosters plus two Kaladesh boosters.
Basic lands are removed from the packs (`basicLandPolicy: remove`). The AER
catalog holds 197 exact Scryfall printings, KLD holds 278, and the auxiliary
MPS catalog holds 54 — 529 physical cards across the three, resolving to 504
distinct Forge scripts.

| artifact                             | sha256                                                              |
| ------------------------------------ | -------------------------------------------------------------------- |
| format `contentSha256`               | `4f37aa27144d3ad5808703d243be88e093f8ac62bdcb1b2a025a7b595f1dbae7`   |
| catalog AER `contentSha256`          | `fdfe0274608a88d828b369745fc4342feed20a9d4635e6b4a4b362954d586a3e`   |
| catalog KLD `contentSha256`          | `26a4ddefd9ebe42387b8e84f4448129f1161fdebe15fcd47fdff3b8fca3515cb`   |
| catalog MPS `contentSha256`          | `30478120f37b1f0bd21f9db0fcee6bf0d003dfbf6f672bb15cae2505addfbe7f`   |
| source pin (`sources.json`)          | `def80a9bd5d50c6ead4db47e0d98a91aa5a56901a6b6f3fff0f9c542d10ef6c2`   |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173`   |
| compiled bridge (`ForgeBridge.java`) | `d4880305a9c7bcac86aa9a0624995944cac62b28e74bd97e70ce58eb0f797d74`   |
| adapter (`installed.ts` bundle)      | `94b68b361826a73a44a816c2b5bef530b0141a66fec9fbcbe99acb4a61e14a73`   |

## Rebuilding

The source pin is `data/cache/kld-aer-20260922-source-pin/` (MTGJSON
5.3.0+20260921, fetched 2026-09-22). The writers emit prettier-formatted JSON,
so the copies below need no formatting pass. Each tool refuses an existing
output, so bump the version segment of every `out/kld-aer/...` path.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets AER,KLD,MPS --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/kld-aer/onboarding-format-v1.json --sources data/cache/kld-aer-20260922-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/kld-aer/build-v2
cp out/kld-aer/build-v2/aer-printed-catalog-v1.json out/kld-aer/build-v2/kld-printed-catalog-v1.json out/kld-aer/build-v2/mps-printed-catalog-v1.json out/kld-aer/build-v2/kld-aer-limited-format-v1.json out/kld-aer/build-v2/build-evidence.json packages/data/data/kld-aer/
cp out/kld-aer/build-v2/sources.json packages/data/data/kld-aer/kld-aer-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/kld-aer-20260922-source-pin --catalog packages/data/data/kld-aer/aer-printed-catalog-v1.json --catalog packages/data/data/kld-aer/kld-printed-catalog-v1.json --catalog packages/data/data/kld-aer/mps-printed-catalog-v1.json > packages/data/data/kld-aer/kld-aer-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/kld-aer/aer-printed-catalog-v1.json --catalog packages/data/data/kld-aer/kld-printed-catalog-v1.json --catalog packages/data/data/kld-aer/mps-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

The play admission is re-bound to a new bridge or adapter with the six-step
recipe in `packages/data/data/isd/README.md` (Play admission), run with format
id `kld-aer` and output `play-admission-v2`.

## Art

Every one of the 529 printings across all three catalogs has `art.status:
available` (a Scryfall `art_crop`). Where several Scryfall printings of a card
exist, the oldest by set release order is chosen
(`packages/printed-card/src/set-release-order.ts`).

Of the ten token scripts the merged catalogs' cards create, eight are bound to
real token printings: Kaladesh's own five (Servo, Beast, Construct, Thopter,
Wolf) plus three Aether Revolt adds (Gremlin, Etherium Cell, and the Ragavan
copy token). The remaining two, both created by Wurmcoil Engine (reprinted as
a Kaladesh Inventions masterpiece), are the same pair SOM leaves unbound
(`mtg-j4ucd.22`): Scryfall prints the two Phyrexian Wurm tokens as TSOM 8 and
9, named "Wurm" with type "Wurm", while Forge's two scripts are both
`Phyrexian Wurm Token`, type `Phyrexian Wurm`. The binder needs the name and
type to agree, so both are left unbound and draw the labeled pending frame.
Binding them would not help a viewer tell them apart either: the two scripts
(deathtouch, lifelink) share name, colors and power/toughness, and the play
surface has no keyword-level detail to distinguish them.

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins AER at 184 of 184 scripts closed, KLD at
254 of 254, and Kaladesh Inventions (edition `MPS_KLD`, not the informal
"MPS" this format's catalogs and onboarding config use) at 54 of 54, all by
the shared review table. Beyond the 17 entries the Kaladesh lane
(`mtg-j4ucd.19`) already added, this lane added two more for Aether Revolt's
residual: Improvise (mapped to mana-x and zone-card-selection, the same
families Convoke already carries) and the non-choice `NoMoveRevealed`
parameter key; Revolt itself and its two `etbCounter:...:Revolt` variants
needed review entries too, all landing as non-choice trigger-condition
bookkeeping the engine evaluates before offering anything to a player.
Qualification over the merged 504 scripts: 504 qualified, residual 0.

`play-admission-v1/` was built on the Improvise-carrying bridge (see
"Mechanics checked against the bridge" below), with the contract bundle
`packages/data/data/printed-controller-contracts-v1.json`, witnessed in
`observed-kld-aer-contract-witness.integration.test.ts` (a local Tidy
Conclusion destroying the only legal creature; Forge attacking with Terrain
Elemental while the local seat only answers its own decisions) and four match
probes over `test/support/kld-aer-match-fixture.ts` (Forest x60 plus Avacyn's
Pilgrim as the audited one-drop). Every one of the 504 scripts' obligations is
a reusable contract obligation, so the qualification bundle reports
`qualified: 504, residual: 0`. `kld-aer-printed-format.test.ts` re-verifies
the installed admission and replaces the retired `kld-printed-format.test.ts`.
The registry entry is in `printed-formats-v1.json`.

## Mechanics checked against the bridge

Kaladesh introduces Energy, Vehicles with Crew and Fabricate; Aether Revolt
adds Improvise and Revolt. The first four were checked and fixed in the
Kaladesh lane (`mtg-j4ucd.19`; see that lane's history below, carried forward
into this merged format's admission). This lane's own work was Improvise and
Revolt.

- **Improvise needed a bridge change: artifacts pay the generic cost, never a
  color, and the bridge could not tell that shape from Convoke.** Forge routes
  both keywords through one shared `InputSelectCardsForConvokeOrImprovise`
  callback, distinguished only by which of `artifacts`/`creatures` its
  constructor sets. The bridge's existing Convoke handler
  (`chooseCardsForConvokeOrImprovise`, admitted structurally by `mtg-uz0mz`)
  reviewed only the creatures shape and refused everything else, so casting an
  Improvise spell aborted the match. `isReviewedImproviseAbility` narrows to
  the plain-Improvise shape (no Convoke/Delve/Assist stacked on it) and
  `chooseImprovisePayments` taps artifacts one at a time, always paying the
  colorless shard unconditionally — Improvise, unlike Convoke, never offers a
  color choice. The callback now dispatches to either handler by the shape
  Forge passes, and refuses anything else (a stacked Convoke+Improvise spell,
  Forge's "Waterbend" shape, both) the same way it always refused an
  unreviewed Convoke shape. `observed-kld-aer-improvise.integration.test.ts`
  taps three Ornithopters to pay all of Reverse Engineer's `{3}` and leaves
  only `{U}{U}` for real mana in installed Forge; `bridge-improvise.test.ts`
  and the updated `bridge-convoke.test.ts` pin both guards.

  The doc comment immediately above that shared callback is also a controller
  contract source-region marker (`zone-card-selection-v1`'s second region,
  keyed on its exact text) — an earlier pass in this branch edited it while
  adding the Improvise narrative and broke it, throwing "Controller contract
  markers must occur exactly once" on every qualify run. Fixed by reverting
  the comment to its original text and moving the Improvise explanation into
  a separate, non-marker-bound comment inside the method body. Nothing in the
  `make-set-playable` skill text documents that a doc comment can double as a
  binding marker, or that the marker's boundary sits at the edge of the
  region it's meant to be commenting on; see the skill-text friction list for
  this lane.

- **Revolt needed no bridge change.** `Revolt$ True` (and its two
  `etbCounter:P1P1:N:Revolt` siblings) is a boolean trigger-condition
  parameter — a permanent its controller controlled left the battlefield this
  turn — that the engine evaluates itself before offering the trigger or
  applying the ETB replacement; it gates eligibility and never itself asks a
  `PlayerController` question. Reviewed against all eleven `Revolt$ True`
  trigger occurrences and both `etbCounter:...:Revolt` occurrences in AER; no
  scenario or match probe aborted on it, so no bridge fix was needed, only the
  review-table entries recorded above.

Both edits (well, the one edit — Revolt added no code) change the compiled
bridge digest that every committed admission binds, which strands all of them
at once (`printed-admission-binding.test.ts` reports `runtime-mismatch`). The
branch that carries the Improvise edit re-bound every other registered
format's admission; see "Re-bound" below.

## Re-bound

`kld-aer` is a new format identity, not a continuation of the old standalone
`kld`'s admission lineage (`packages/data/data/kld/` and its `play-admission-v1`
through `v4` are deleted along with the standalone format). `play-admission-v1/`
here is the format's first build, made fresh against the Improvise-carrying
bridge above (`bridgeSha256` `d4880305a9c7bcac86aa9a0624995944cac62b28e74bd97e70ce58eb0f797d74`,
`adapterSha256` `94b68b361826a73a44a816c2b5bef530b0141a66fec9fbcbe99acb4a61e14a73`) rather
than re-bound from a prior generation.

Because that bridge edit moves the digest every other registered format's
admission binds, this branch also re-admitted the other 20 formats with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the
six-step recipe in `packages/data/data/isd/README.md` (Play admission) per
format; each of those formats' own READMEs records which admission directory
it moved to.

`play-admission-v2/` re-binds v1 (deleted) to the reviewed split-mana bridge fix
(`285b00486`, `mtg-uz0mz.1.1`, `mtg-tho5a9`): the exact Coalition Relic route now also covers
Altar of the Lost, Cascading Cataracts, Molten Slagheap, Plasm Capture and Axebane Guardian, and Market
Festival, returning the color split the local seat chose for each produced mana. The compiled bridge digest
changes
(`ac89d54f...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v3/`.
