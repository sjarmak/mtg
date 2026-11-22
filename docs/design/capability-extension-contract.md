# Capability extension contract

Status: complete and verified 2026-08-22
Baseline: `c05d2034`
Measured: 2026-08-21
Tracking: `mtg-bc2.152.10`, measurement child `mtg-bc2.152.10.1`,
implementation children `mtg-fdfd`, `mtg-jh8b`, `mtg-bc2.152.10.2`,
`mtg-bc2.152.10.3`, `mtg-p8jt`, `mtg-rdgx`, `mtg-pt90`, and `mtg-4lkg`

This document is the build contract for the capability-authoring epic. It is
not an ADR: it does not change the engine strategy or the generator-containment
decision. It specifies how that decided architecture should make extensions
loud, local, and reviewable.

Since 2026-08-26, the seven completed M11/M13 artifacts are immutable anchors.
`npm run reference:refresh -- --check` now verifies their raw bytes and internal
content hashes; it no longer rewrites broad source-provenance digests. The
measurement below records the behavior of the earlier freshness gate and
remains useful evidence about extension touchpoints, not current refresh policy.

## Measurement method

Each probe added one deliberately invalid, temporary member and then ran:

```text
npm run typecheck
npm run vocabulary:refresh -- --check
npm run reference:refresh -- --check
```

The probes were hand-reverted. The three commands then passed again: 47
vocabulary enums with 393 members, and all seven reference artifacts unchanged.
The measurements count a file once even when the compiler reported more than
one site in it. A touchpoint is classified as:

- **semantic** — this package must make a concern-specific decision;
- **derivable** — structural data or traversal another declaration can project;
- **evidence** — tests, pinned design data, fixtures, or generated artifacts;
- **accidental** — a duplicate decision or walk with no independent owner.

File count is evidence, not a target. A new effect genuinely needs different
answers from the kernel, oracle renderer, Forge exporter, evaluator, and bot.
Collapsing those answers into one cross-package registry would hide semantics
and reverse dependency arrows. The useful reduction is in repeated structural
plumbing and silent omissions.

## Results

| Probe                  |     Typecheck result | Vocabulary result                         | Reference result                                      | Important finding                                                                                                                     |
| ---------------------- | -------------------: | ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| condition union member |   6 errors / 6 files | unchanged                                 | six source digests moved; claims unchanged            | Every current reader is exhaustive and package-owned.                                                                                 |
| priced effect member   | 13 errors / 13 files | refresh could not start                   | refresh could not start                               | The effect seam remains exhaustive, but its current consumer floor is 9 production and 4 test files, not the older 7 + 3 measurement. |
| evergreen keyword      |   6 errors / 5 files | `KEYWORDS` and `GRANTABLE_KEYWORDS` moved | color-pie document refused the missing subject        | The kernel produced no error; a keyword can enter the schema without a total mechanical classification.                               |
| target/referent kind   |   4 errors / 4 files | `TARGET_KINDS` moved                      | six source digests and general-semantics claims moved | Per-package adapters were loud, but DSL referent/context lists accepted the new kind silently.                                        |

### Condition

The temporary strict-object variant was added to `ConditionSchema` only.

| Touchpoint                           | Owner             | Classification          | Why it remains explicit                                                                                         |
| ------------------------------------ | ----------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `deckbuild/src/deck-context.ts`      | deck construction | semantic                | States what supply a condition asks a deck to contain.                                                          |
| `dsl/src/oracle.ts`                  | printed language  | semantic                | Chooses the Oracle phrase and its parameters.                                                                   |
| `dsl/src/validate/abilities.ts`      | DSL legality      | semantic                | Refuses structurally valid conditions in contexts where they have no meaning.                                   |
| `forge-export/src/ability-script.ts` | Forge translation | semantic                | Chooses Forge's distinct condition encoding or refuses export.                                                  |
| `kernel/src/characteristics.ts`      | rules execution   | semantic                | Evaluates the condition through the full characteristic/layer view.                                             |
| `kernel/src/combat.ts`               | combat hot path   | semantic specialization | Re-evaluates the supported subset against combat state; its duplication is intentional and compiler-exhaustive. |
| reference source digests             | audit provenance  | evidence                | A semantic source moved even though no audited conclusion did.                                                  |

The condition family is the control for the “typed adapter” half of the
contract. Six files are not six copies of one answer. The correct extension
cost is one explicit answer per owner, all forced by the discriminated union.
The condition is engine-only, so the model schema and fixture keys do not move.

### Effect

The temporary member was added to the priced `EFFECT_KINDS` tuple and to the
effect schema. The effect seam built by `mtg-bc2.152.1` still worked: total
mapped types made every semantic consumer fail. The current repository has
grown beyond that bead's recorded 7 production + 3 test floor.

| Touchpoint                               | Classification               | Required decision                           |
| ---------------------------------------- | ---------------------------- | ------------------------------------------- |
| `deckbuild/src/evaluate.ts`              | semantic                     | magnitude and base/per-unit price           |
| `dsl-coverage/src/calibration.ts`        | evidence constructor         | one legal representative probe              |
| `dsl/src/oracle.ts`                      | semantic                     | printed clause                              |
| `dsl/src/validate/effects.ts`            | semantic declaration         | legal targets, scopes, and parameter checks |
| `forge-export/src/effect-script.ts`      | semantic                     | target and Forge API mapping                |
| `kernel/src/effects.ts`                  | semantic                     | resolution and target recheck               |
| `kernel/src/simple-agent.ts`             | semantic                     | choice and value policy                     |
| `setgen/src/prompts.ts`                  | semantic for a priced member | generator range text                        |
| `sim/src/policies/target.ts`             | semantic                     | target preference/value                     |
| `dsl/test/exhaustiveness.test.ts`        | evidence                     | shape/target classification sample          |
| `dsl/test/oracle.test.ts`                | evidence                     | rendered example                            |
| `setgen/test/helpers.ts`                 | evidence constructor         | model-effect fixture sample                 |
| `setgen/test/substitution-notes.test.ts` | evidence                     | prompt/substitution snapshot                |

`LEGAL_TARGETS` is currently projected at module load by iterating
`ALL_EFFECT_KINDS`. The omitted effect row therefore made both refresh commands
crash while importing `EFFECT_RULES`, before either could report a normal stale
artifact. That is loud enough to prevent drift but is poorer diagnostics than
the compile-time mapped-type errors; derived runtime tables should preserve the
total-table error rather than become a second failure mechanism.

A priced effect intentionally changes the model-visible schema and prompt, so
fixture keys can move. An engine-only effect belongs in
`UNPRICED_EFFECT_KINDS`; that boundary is the existing, explicit author choice
that preserves `ModelEffectSchema extends Effect` without making the two equal.

### Keyword/static behavior

The temporary member was appended to `KEYWORDS`.

| Touchpoint                             | Classification             | Required decision                                                                              |
| -------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `deckbuild/src/config.ts` (two tables) | semantic                   | limited and constructed keyword values are separate policies                                   |
| `dsl/src/vocabulary.ts`                | derivable DSL presentation | printable name can be part of a DSL-owned keyword declaration                                  |
| `dsl/src/reminder.ts`                  | semantic presentation      | reminder text is printed rules content, not a capitalization transform                         |
| `forge-export/src/vocabulary-map.ts`   | semantic                   | Forge spelling                                                                                 |
| `sim/src/config.ts`                    | semantic                   | gameplay policy value                                                                          |
| `design-data` color-pie row            | evidence/policy            | generator-visible vocabulary needs an explicit color-pie subject                               |
| vocabulary snapshot and fixtures       | evidence                   | `KEYWORDS` and `GRANTABLE_KEYWORDS` are model-visible, so widening is deliberate fixture churn |

No kernel file failed. Existing mechanics ask direct questions such as
`hasKeyword(..., 'flying')`, `hasKeyword(..., 'menace')`, or
`hasKeyword(..., 'lifelink')`; they do not state a total contract over
`Keyword`. That is correct for execution—flying and lifelink do unrelated
things—but incorrect for extension safety. A new keyword needs a kernel-owned,
total classification declaring which subsystem implements it. The declaration
must not contain the implementation or be shared with Forge, deck building, or
simulation.

### Target/referent

The temporary member was appended to `TARGET_KINDS` and treated as a proposed
back-reference.

| Touchpoint                             | Classification                   | Required decision                                          |
| -------------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| `dsl/src/oracle.ts`                    | semantic                         | printed noun phrase                                        |
| `dsl/src/targets.ts` (`TARGET_SPACES`) | derivable structural declaration | choice/collision space                                     |
| `forge-export/src/vocabulary-map.ts`   | semantic                         | Forge selector or defined referent                         |
| `kernel/src/target-choices.ts`         | semantic adapter                 | live candidates or retained-reference placeholder          |
| vocabulary snapshot                    | evidence                         | target vocabulary changed                                  |
| reference artifacts                    | evidence                         | source provenance and general-semantic subject set changed |

The compiler did **not** report that the proposed back-reference was absent
from `REFERENT_TARGETS` or `referentSourceSpace`. The same silent omission is
possible for `ATTACK_TRIGGER_ONLY_TARGETS`, `SOURCE_BODY_ONLY_TARGETS`, and
`CARD_TYPE_FILTERABLE_TARGETS`. Those lists are different projections of one
DSL-owned structural fact: what kind of slot this is. They should derive from
one total target-kind traits table. Oracle phrasing, kernel enumeration, and
Forge syntax remain package-owned total adapters.

`MODEL_TARGET_KINDS` is a separately written, frozen subset. Appending an
engine target kind must not widen it or move fixture keys. That containment
boundary remains explicit rather than being inferred from the full target
declaration.

## Contract

The authoring seam has four layers, with one-way dependencies:

```text
family schema / vocabulary
        |
        +--> family-owned structural declaration --> mechanical projections
        |
        +--> package-owned total semantic adapters
        |
        +--> explicit model subset --> fixture-key change only by deliberate edit
        |
        +--> evidence (mutation tests, snapshots, reference ledgers)
```

1. **The family owns structure.** A target traits table may state choice
   space, contextual class, referent source space, and filter eligibility.
   An effect rules table may state structural target/scope legality. It may not
   state Forge syntax, bot value, kernel execution, or deck price.
2. **Mechanical projections derive.** Enumerations, predicates, and canonical
   card/ability/token walks are generated from the family declaration. A new
   member cannot be silently absent from one projection.
3. **Semantics stay with their package.** Every consumer whose answer can
   genuinely differ uses a mapped type or `switch`/`assertNever` over the
   family union. The compiler is the integration checklist.
4. **Generator containment is opt-in.** Engine vocabulary and model vocabulary
   remain separate declarations with compile-time containment proofs. Adding
   engine support never implicitly offers the feature to generation.
5. **Evidence is downstream, not authoritative.** Vocabulary snapshots,
   fixtures, probes, and reference ledgers prove or record the declaration;
   no production union is derived from a generated artifact.

This produces family-sized modules, not a capability god registry. It also
keeps browser packages on `@mtg/dsl` data only: no Node-only dependency or
reverse import is introduced.

## Implementation order

The current children of `mtg-bc2.152.10` should run in this dependency order:

1. **`mtg-fdfd`: canonical printed-surface walk.** This removes three copies of
   the card → ability → token descent first, so later census and coverage work
   reads one structural projection.
2. **`mtg-ms16`: coverage types derive from DSL types.** Once traversal is
   canonical, remove the silent vocabulary-name pins in coverage.
3. **`mtg-p8jt`: one census declaration.** Its six repeated numeric blocks can
   then consume canonical walks and DSL-owned types while retaining the drift
   guard.
4. **`mtg-rdgx`: re-audit regex refusals.** Run after the representations above
   stop making every banked capability a coordinated literal edit.
5. **`mtg-pt90` and `mtg-4lkg`: lifecycle/provenance follow-ups.** They improve
   removals and renames but do not reduce first-order capability fan-out.

`mtg-j2bd` is already implemented at this baseline: `EffectKindsCovered` in
`packages/dsl/src/exhaustive.ts` is mutually assignable between
`Effect['kind']` and `ALL_EFFECT_KINDS[number]`, and
`packages/dsl/test/exhaustiveness.test.ts` spends that proof during typecheck.
It should be closed after a hand-reverted mutation confirms the promised error.

The first production increment for the epic is therefore:

- promote the one-layer printed-surface walk into `@mtg/dsl` and migrate all
  known readers (`mtg-fdfd`);
- consolidate target structural classifications into one total DSL-owned
  traits declaration while leaving oracle, kernel, and Forge as separate total
  adapters;
- add the missing kernel keyword implementation classification as a follow-up,
  after the target increment proves the seam shape without combining two
  families in one registry.

## Success measurement

The after-state is better when:

- omitting a structural projection produces a named typecheck error;
- one structural walk replaces multiple hand-maintained descents;
- a new engine-only member leaves model schemas and fixture keys unchanged;
- semantic package decisions remain explicit and independently testable;
- a repeated mutation touches fewer handwritten branches, even if the number
  of packages with legitimate semantic answers stays the same.

No acceptance criterion uses an arbitrary maximum file count. The semantic
floor is a feature of the architecture; accidental duplication is the cost to
remove.

## Implemented increment

The first increment now demonstrates both halves of the contract.

| Repeated structural work                                          |                                     Before |                                        After |
| ----------------------------------------------------------------- | -----------------------------------------: | -------------------------------------------: |
| complete card → token → token-ability descents owned by consumers | 4 consumer paths, including one blind path | 1 DSL-owned walk plus mechanical projections |
| separately maintained target structural classifications           |                    6 declarations/branches |                  1 total traits row per kind |
| silent target-role omissions in the mutation probe                |        referent/context omissions compiled |           missing traits row fails typecheck |

The semantic floor did not shrink, and should not: the target mutation still
requires an Oracle phrase, kernel behavior, and a Forge mapping. The reduction
is from repeated structural edits to one row and from multiple descents to one
walk, leaving the three genuinely different semantic answers explicit.

`printedCardSurface` in `@mtg/dsl` owns the complete card → token → token
ability descent. The depth is schema-proven: `TokenEffectSchema` excludes
`createToken`, so one token layer is exhaustive. `setTokens`, set-generation
mechanic censuses, deck-context supply, and deck repricing now consume its
projections. The setgen and deckbuild copies of the descent were removed. The
regression that motivated `mtg-jh8b` is part of the proof: a card whose minted
token is its only counter-restricted surface now returns `true` from
`readsTheDeck`.

`TARGET_KIND_TRAITS` is the target family's total structural declaration. It
owns collision spaces, context class, prior-target source space, and card-type
filter eligibility. The attack-only, source-body, referent, and
card-type-filterable lists and all space predicates derive from it. Oracle
phrasing, kernel candidate enumeration, and Forge syntax remain separate
exhaustive adapters.

The target mutation was then repeated and hand-reverted. Before this increment,
typecheck reported four files but said nothing about the proposed referent
missing `REFERENT_TARGETS` or `referentSourceSpace`. After it, the same omission
reports exactly four package-owned obligations and names each one:

- `dsl/src/target-traits.ts`: missing `TARGET_KIND_TRAITS` row;
- `dsl/src/oracle.ts`: missing printed phrase;
- `kernel/src/target-choices.ts`: missing candidate/referent behavior;
- `forge-export/src/vocabulary-map.ts`: missing Forge mapping.

The kernel now uses an explicit `assertNever` for the fourth error rather than
surfacing an indirect `undefined` return type. `MODEL_TARGET_KINDS` and all
model schemas stayed unchanged.

## Completed epic

The remaining children apply the same contract to kernel ownership, audit
lifecycle, and coverage banking.

### Kernel keyword ownership

`KERNEL_KEYWORD_IMPLEMENTATIONS` is a kernel-owned total map from `Keyword` to
the rule subsystem or subsystems that implement it. It contains no execution
logic and is not imported by the DSL, Forge, simulation, or generation. A
temporary keyword appended to `KEYWORDS` without a row now fails typecheck at
that named kernel guard; the mutation was hand-reverted. The earlier silent
kernel omission is therefore gone without creating a cross-package registry.

### Audit census and lifecycle

The general semantic population and disposition census now have one
hand-maintained declaration each. Schema literals, exported types, builders,
runtime drift guards, tests, and the six-ledger ownership check derive from
those declarations. `CENSUS_LITERALS_AGREE` remains in place, and the runtime
builder still refuses a computed census that disagrees. A temporary banked
position required one general-census edit, failed the drift guard when omitted,
and was hand-reverted. The distinct six-ledger checkpoint union has one reviewed
aggregate census rather than restated values in its builder and tests.

`RETIRED_VOCABULARY` now distinguishes a rename from a removal in its type:
the replacement is a live string for a rename and `null` for a removal.
Unrecorded removal remains a hard narrowing failure; a recorded removal is
reported as removed rather than falsely pointing at a surviving neighbor.

Reference refreshes now emit exact JSON-pointer claim changes with before and
after values, separately from source-digest movement. A vocabulary rename and
a real capability widening can therefore appear in the same refresh without
one hiding behind the other. Pure provenance refreshes continue to say that
claims are unchanged.

### Regex-refusal re-audit

The full audit record is
`docs/audits/general-regex-refusal-audit-2026-08-22.md`. All 101 identities that
had at least one regex-assigned residual were reconsidered against the current
DSL and kernel. Sixteen identities across eighteen collector positions were
banked with exact translations and hostile probes; eighty-five retain a named
current blocker. The general ledger moved from 193 identities / 247 positions
exact to 209 / 265, and the playable six-ledger union moved from 249 / 310 to
265 / 328. `REGEX_BUCKET_PROMOTIONS` pins the promoted set so a future refresh
cannot silently return one to a bucket refusal.

### Final measured reduction

| Authoring or maintenance action            |                                                      Before |                                                     After |
| ------------------------------------------ | ----------------------------------------------------------: | --------------------------------------------------------: |
| Add one printed-surface traversal consumer | Reimplement card, ability, token, and token-ability descent |                            Project the one DSL-owned walk |
| Declare one target kind's structural roles |                      Up to 6 lists, predicates, or branches |                                   1 exhaustive traits row |
| Add one keyword's kernel ownership         |                                  No total kernel obligation |                                   1 exhaustive kernel row |
| Move the general semantic census           |                     6 coordinated literal blocks plus tests | 1 reviewed declaration; schema/type/runtime guards derive |
| Record a true vocabulary removal           |                          False rename plus corrective prose |                              1 typed `null` removal entry |
| Review reference claim movement            |                  Silent rewrite plus manual whole-file diff | Exact scalar changes; separate string-set additions/removals |
| Re-bank a regex-bucket identity            |                                Discovery one card at a time |    Complete 101-identity audit, with 16 promotions pinned |

The model containment declarations were not widened. Browser packages gained no
Node-only import, package dependency arrows did not reverse, and semantic
adapters remain with their owning packages.

## Final verification

Formatting, lint, strict typecheck, vocabulary freshness, reference freshness,
and `git diff --check` passed. The full Vitest gate passed 9,120 tests in 803
files with one skipped test, including the browser and balance projects. Its
completeness-aware reporter recognized the documented `onTaskUpdate`
reporting-channel timeout after every collected result settled and returned
exit 0.
