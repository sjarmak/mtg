# DSL v1: the ability model

**Bead:** `mtg-bc2.132` (epic), children `mtg-bc2.132.1` (DSL), `mtg-bc2.132.2` (kernel),
`mtg-bc2.132.3` (setgen).
**Status:** slice A (static abilities) is implemented and merged; slices B, C and D are still design.
Section 0's account of the ceiling is the ceiling this document was written against, before slice A
moved it, and the sections below have not been renumbered against the code that landed. Read a
`file:line` here as a claim about the tree at 2026-08-11, not about HEAD. `mtg-49e` tracks the pass.
**Date:** 2026-08-11.

Two kinds of claim appear below and they are kept apart on purpose.

* **Verified** — read out of this checkout at the cited `file:line`. If it is wrong, the file moved.
* **CR** — asserted from Magic's Comprehensive Rules, with the rule number. No CR text is in this
  tree; these are claims about what the rules say, not about what the code does.

---

## 0. Where the ceiling actually is

`packages/dsl/src/card.ts` stated it in the source, before slice A:

> Noncreature artifact permanent. DSL v0 has no activated, triggered or static abilities, so this
> variant is a vanilla permanent by construction; the validators enforce that.

That comment is gone. The same schema now reads "It may carry static abilities and nothing else: the
DSL has no triggered or activated abilities yet", which is the ceiling after slice A and the reason
the rest of this section is history rather than description.

The validator it names is `packages/dsl/src/validate/effects.ts:220-231`, which fires
`EFFECT_ILLEGAL_ON_CARD_TYPE` for any non-instant, non-sorcery carrying an effect list. The whole
expressible mechanical vocabulary is two tuples: `KEYWORDS` (9) at
`packages/dsl/src/vocabulary.ts:26-36` and `EFFECT_KINDS` (10) at `vocabulary.ts:53-64`. A
`DesiredMechanic` (`packages/setgen/src/brief.ts:18-28`) is a subset of exactly those two, and
`brief.ts:54-56` refuses a mechanic that names neither. So a generated set's "own mechanic" is a
re-labeling of nine evergreen keywords, and no amount of prompt work changes that.

The kernel is ahead of the DSL, which is why this is an extension rather than a rewrite. CR 613
layers 1 through 7e with dependency ordering and the CDA sublayer are implemented
(`packages/kernel/src/continuous.ts`, `layers.ts`, `dependency.ts`), and so is the CR 614/615/616
replacement pipeline (`replacement.ts`, `replacement-effects.ts`). The test harness even says what
this document is for, at `packages/kernel/test/continuous-helpers.ts:9-10`:

> When the DSL grows static and replacement abilities its compiler produces exactly these shapes.

That sentence is the design. This document says what the compiler is, what it compiles from, and in
what order the pieces land.

---

## 1. The DSL shape

### 1.1 Where abilities live on `Card`

On the shared base, beside `keywords` and `effects`, for the reason `card.ts:12-14` already gives
for those two: putting a field on every variant makes per-card-kind legality *a coded structural
violation* rather than an opaque parse error. A `land` with an activated ability parses and then
reports `ABILITY_ILLEGAL_ON_CARD_TYPE`, which is a message a repair loop can act on; a land that
fails a discriminated-union parse is not.

```ts
// packages/dsl/src/card.ts, inside baseShape (currently card.ts:39-52)
const baseShape = {
  // …unchanged…
  keywords: z.array(KeywordSchema).default([]),
  effects: z.array(EffectSchema).default([]),
  /**
   * CR 113 abilities printed on the card. Legal only on permanents that stay
   * on the battlefield; `checkAbilities` enforces that per card kind, the way
   * `checkEffects` enforces the spell-only rule for `effects`.
   */
  abilities: z.array(AbilitySchema).max(2).default([]),
  // …unchanged…
};
```

`max(2)` is a New-World-Order budget, not a technical limit; §6 argues it.

### 1.2 `packages/dsl/src/abilities.ts` (new)

The file mirrors `effects.ts`'s `effectsOver<T>(target)` factory (`effects.ts:36-56`) for the reason
stated at `effects.ts:26-35`: two schemas are built from one union so that `@mtg/setgen` can show
the model a *subset* of the engine's contract. `ModelEffectSchema` exists because "a field the prompt
has not taught is a field the model would fill in by guessing"
(`packages/dsl/src/targets.ts:15-17`). An ability schema that skipped this would reintroduce exactly
that problem one level up.

```ts
/**
 * CR 113 abilities: the three shapes a permanent can carry.
 *
 * Written over the effect schema rather than beside it. An ability's payload is
 * the same ten primitives a spell uses, so `applyEffect` (kernel) and
 * `renderEffect` (oracle) each stay one switch instead of two — which is the
 * property that makes the co-design invariant checkable by the compiler.
 *
 * `abilitiesOver` exists for the same reason `effectsOver` does: `@mtg/setgen`
 * shows the model `ModelAbilitySchema`, which carries `ModelTargetSpec` and so
 * has nothing to say about `distinct`.
 */
import { z } from 'zod';
import type { ZodType } from 'zod';
import { EffectSchema, ModelEffectSchema } from './effects';
import { ManaCostSchema } from './mana';
import {
  KeywordSchema,
  StaticModificationKindSchema,
  StaticScopeSchema,
  TriggerConditionSchema,
} from './vocabulary';

/**
 * CR 602.1: what an activated ability costs. Mana plus, optionally, `{T}`.
 *
 * `tapSelf` is `boolean` rather than `literal(true).optional()` — unlike
 * `TargetSpec.distinct` (targets.ts:36-42) there is no second spelling of
 * "no tap symbol", because the field is required and defaulted.
 */
export const ActivationCostSchema = z.object({
  mana: ManaCostSchema,
  /** CR 302.6: a creature that has not been controlled since your turn began cannot pay this. */
  tapSelf: z.boolean().default(false),
});

export type ActivationCost = z.infer<typeof ActivationCostSchema>;

/** What a static ability modifies. Layer and filter, named rather than invented. */
export const StaticModificationSchema = z.discriminatedUnion('kind', [
  /** CR 613.4c, layer 7c. The lord. */
  z.object({ kind: z.literal('statBonus'), power: z.int(), toughness: z.int() }),
  /** CR 613.1f, layer 6. */
  z.object({ kind: z.literal('grantKeyword'), keyword: KeywordSchema }),
]);

export type StaticModification = z.infer<typeof StaticModificationSchema>;

function abilitiesOver<T extends ZodType>(effect: T) {
  return z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('triggered'),
      condition: TriggerConditionSchema,
      effects: z.array(effect).min(1).max(2),
    }),
    z.object({
      kind: z.literal('activated'),
      cost: ActivationCostSchema,
      effects: z.array(effect).min(1).max(2),
    }),
    z.object({
      kind: z.literal('static'),
      scope: StaticScopeSchema,
      /** Restrict the scope to one creature type, or `null` for all of it. */
      subtype: z.string().nullable().default(null),
      modification: StaticModificationSchema,
    }),
  ]);
}

export const AbilitySchema = abilitiesOver(EffectSchema);
export const ModelAbilitySchema = abilitiesOver(ModelEffectSchema);

export type Ability = z.infer<typeof AbilitySchema>;
export type AbilityInput = z.input<typeof AbilitySchema>;
export type AbilityKind = Ability['kind'];

export type AbilityOf<K extends AbilityKind> = Extract<Ability, { kind: K }>;
export type TriggeredAbility = AbilityOf<'triggered'>;
export type ActivatedAbility = AbilityOf<'activated'>;
export type StaticAbility = AbilityOf<'static'>;

/** Abilities whose payload is an effect list; static abilities have none. */
export type EffectBearingAbility = Extract<Ability, { effects: unknown }>;

export function hasEffects(ability: Ability): ability is EffectBearingAbility {
  return 'effects' in ability;
}
```

`hasEffects` is the sibling of `hasTarget` at `effects.ts:73-75`, and exists for the same reason:
it keeps the validators and the kernel free of casts.

### 1.3 New vocabulary tuples

```ts
// packages/dsl/src/vocabulary.ts
export const ABILITY_KINDS = ['triggered', 'activated', 'static'] as const;
export const AbilityKindSchema = z.enum(ABILITY_KINDS);
export type AbilityKind = z.infer<typeof AbilityKindSchema>;

/**
 * CR 603 trigger conditions. Every one of them is about the source itself; §6
 * says why, and `packages/kernel/src/triggers.ts` says which emitted
 * `GameEvent` each one reads.
 */
export const TRIGGER_CONDITIONS = ['selfEnters', 'selfAttacks', 'selfDies'] as const;
export const TriggerConditionSchema = z.enum(TRIGGER_CONDITIONS);
export type TriggerCondition = z.infer<typeof TriggerConditionSchema>;

/** Which permanents a static ability reaches. Compiles to an `ObjectFilter`. */
export const STATIC_SCOPES = ['self', 'creaturesYouControl', 'otherCreaturesYouControl'] as const;
export const StaticScopeSchema = z.enum(STATIC_SCOPES);
export type StaticScope = z.infer<typeof StaticScopeSchema>;

export const STATIC_MODIFICATION_KINDS = ['statBonus', 'grantKeyword'] as const;
export const StaticModificationKindSchema = z.enum(STATIC_MODIFICATION_KINDS);

/** Printed English for each trigger condition; `{name}` is the card's name. */
export const TRIGGER_PRINT_TEMPLATES: Readonly<Record<TriggerCondition, string>> = {
  selfEnters: 'When {name} enters the battlefield,',
  selfAttacks: 'Whenever {name} attacks,',
  selfDies: 'When {name} dies,',
};
```

`TRIGGER_PRINT_TEMPLATES` is a total `Record`, the same device as `KEYWORD_PRINT_NAMES`
(`vocabulary.ts:41-51`): a condition added without a print rule is a compile error, not a card that
renders as an empty string.

### 1.4 The one change to `TARGET_KINDS`, and why it is worth it

`TARGET_KINDS` gains a fifth member:

```ts
export const TARGET_KINDS = ['anyTarget', 'targetCreature', 'targetPlayer', 'noTarget', 'self'] as const;
```

`'self'` means *the ability's source*. **CR 115.10:** a spell or ability targets only where the word
"target" appears, so a `self` slot is not a target: it is never chosen, never rechecked, never
counts for `distinct`, and cannot cause the ability to fizzle. The name is a lie about the type it
lives in and the doc comment has to carry that weight, the way `targets.ts:11-14` already carries it
for `distinct`.

**What this buys.** "Whenever {name} attacks, it gets +1/+0 until end of turn" and
"{2}: {name} gets +1/+1 until end of turn" are the two most common shapes a named mechanic takes,
and neither is expressible without it. Without `self`, a triggered ability can only draw, gain life,
mill or make a token, because those are the only effects `LEGAL_TARGETS`
(`packages/dsl/src/validate/effects.ts:21-32`) lets run untargeted.

**What it costs**, all of it mechanical and all of it compiler-enforced:

| Site | Change |
|---|---|
| `packages/dsl/src/targets.ts:65-70` `TARGET_SPACES` | `self: []`, so `targetKindsCanCollide` is false against everything and `checkDistinctTargets` (`validate/effects.ts:151-180`) already rejects `distinct` on it |
| `targets.ts:55-57` `requiresTarget` | must become `kind !== 'noTarget' && kind !== 'self'`; it has no in-tree caller today (grep: only the re-export at `index.ts:58`), so this is free now and a landmine later |
| `packages/dsl/src/oracle.ts:60-74` `targetPhrase` | new arm; needs the card name, which `renderEffect` already has (`oracle.ts:99`) |
| `validate/effects.ts:21-32` `LEGAL_TARGETS` | total `Record`, compile error until `self` is placed. Allow it on `pumpUntilEndOfTurn` and `tapPermanent` only |
| `packages/kernel/src/effects.ts:43-51` `matchesTargetKind` | one line: `if (wanted === 'self') return target !== null && target.kind === 'permanent';` |
| `packages/kernel/src/legal.ts:92-101` `targetChoicesFor` | the switch has no `default`, so a missing arm widens the return type and fails typecheck. Spells cannot use `self`; give it `assertNever` while you are there |
| `packages/forge-export/src/vocabulary-map.ts:262-273` `FORGE_TARGETS_BY_EFFECT` | second copy of `LEGAL_TARGETS`, asserted equal by `packages/forge-export/test/conformance.test.ts:47-48` |
| `packages/setgen/src/prompts.ts:141-150` `vocabularySection` | prints `LEGAL_TARGETS[kind]` into the prompt, so this is a fixture-invalidating edit |

Crucially there is **no signature change**: `isTargetStillLegal(state, effect, targets, index)`
(`kernel/src/effects.ts:71`) never learns the source, because the resolved `Target` recorded in the
stack entry *is* the source.

**Rejected: a parallel `AbilityEffect` union.** It would duplicate `applyEffect`'s ten-case switch
(`kernel/src/effects.ts:160-238`), `renderEffect`'s ten print rules (`oracle.ts:99-134`),
`checkEffectParams` (`validate/effects.ts:90-125`), `transpileEffect`
(`packages/forge-export/src/effect-script.ts:184-222`) and `effectMagnitude`
(`packages/deckbuild/src/evaluate.ts:82-105`). Five duplicated exhaustive switches is a worse
outcome than one honestly-documented target kind.

**Rejected: threading `sourceOid` through target legality.** Changes four signatures and makes every
call site decide what "the source" means for a spell. The recorded-target trick gets the same
answer for free.

### 1.5 Extending `exhaustive.ts`

`MutuallyAssignable` (`packages/dsl/src/exhaustive.ts:17`) has teeth only where the union is written
independently of the tuple. `Effect['kind']` qualifies, because `effectsOver` writes
`z.literal('dealDamage')` by hand and `EFFECT_KINDS` writes `'dealDamage'` again. Two of the four new
pairs qualify; two would be tautologies and must not be added, because a guard that cannot fail
teaches the next reader that the guards are decoration.

```ts
// packages/dsl/src/exhaustive.ts
import type { Ability, StaticModification } from './abilities';
import type { ABILITY_KINDS, STATIC_MODIFICATION_KINDS } from './vocabulary';

/** Has teeth: `abilitiesOver` writes each `kind` as a hand-written literal. */
export type AbilityKindsCovered = MutuallyAssignable<Ability['kind'], (typeof ABILITY_KINDS)[number]>;

/** Has teeth: `StaticModificationSchema` writes each `kind` as a hand-written literal. */
export type StaticModificationsCovered = MutuallyAssignable<
  StaticModification['kind'],
  (typeof STATIC_MODIFICATION_KINDS)[number]
>;

// Deliberately absent: TriggerCondition and StaticScope are `z.enum(TUPLE)`, so
// the union is *derived from* the tuple and a guard between them is `true` by
// construction. Their equivalent protection is `TRIGGER_PRINT_TEMPLATES` and
// `SCOPE_FILTERS`, which are total `Record`s over the tuple.
```

`packages/dsl/test/exhaustiveness.test.ts:30-33` grows two `const … = true` assignments and the
`toEqual([true, true, true, true])` at test line 66 becomes six entries; the duplicate-check tuple
list at test line 76 gains `ABILITY_KINDS`, `TRIGGER_CONDITIONS`, `STATIC_SCOPES` and
`STATIC_MODIFICATION_KINDS`. A second constructibility list beside `samples: Effect[]` (test lines
121-137) asserts one sample per `ABILITY_KINDS` entry.

### 1.6 Validators and violation codes

`VIOLATION_CODES` (`packages/dsl/src/violations.ts:7-54`) gains a group:

```ts
  // Abilities.
  'ABILITY_ILLEGAL_ON_CARD_TYPE',
  'ABILITY_COST_INVALID',
  'ILLEGAL_TARGET_IN_ABILITY',
  'STATIC_MODIFICATION_OUT_OF_RANGE',
  'DUPLICATE_ABILITY',
```

`checkAbilities(card)` joins the list at `packages/dsl/src/validate/index.ts:28-39`, after
`checkEffects`. Its rules:

1. Abilities are legal on `creature` and `artifact` only. A `land`, `instant` or `sorcery` carrying
   one gets `ABILITY_ILLEGAL_ON_CARD_TYPE`.
2. `self` may appear as a target kind only inside an ability. A spell effect using it gets
   `ILLEGAL_TARGET_IN_ABILITY` naming the effect index.
3. An activated cost of `{0}` with `tapSelf: false` is free and repeatable and breaks the game;
   `ABILITY_COST_INVALID`.
4. `statBonus` deltas reuse `LIMITS.pumpDelta` (`validate/effects.ts:34-43`); a `+0/+0` static is a
   no-op the same way a `+0/+0` pump is (`validate/effects.ts:104-108`).
5. Two byte-identical abilities on one card are one ability printed twice; `DUPLICATE_ABILITY`,
   compared by `canonicalJson` exactly as `checkDuplicateEffects` does
   (`validate/effects.ts:199-218`).

Two existing messages must change and **both are prompt text one hop away**, under `AGENTS.md`'s
spelling rule: `validate/effects.ts:228` ("DSL v0 has no triggered or activated abilities, so a
`${card.kind}` cannot carry spell effects") and the doc comment at `card.ts:76-81`. Rewording either
is a deliberate change that re-records `@mtg/setgen`'s fixtures, because setgen's repair loop hands
a failing slot's findings back to the model verbatim.

### 1.7 Fingerprints

`mechanicalFingerprint` (`packages/dsl/src/fingerprint.ts:67-69`) is **deny-list** based: `normalize`
(`fingerprint.ts:31-55`) keeps every own key except `id`/`set`/`oracleText`/`name`/`rarity`. The four
fields that get canonical ordering (`colors`, `supertypes`, `subtypes`, `keywords`) are listed
explicitly, and `canonicalJson` preserves array order by design
(`packages/dsl/src/canonical-json.ts:36`), so `abilities` entering both fingerprints the moment the
field was added was a trap: two functionally identical cards whose abilities were authored in a
different order would have fingerprinted differently and slipped past `DUPLICATE_FINGERPRINT`
(`packages/dsl/src/validate/set.ts:82`) and its setgen remap `DUPLICATE_MECHANICS`
(`packages/setgen/src/validate/composition.ts:182`).

**Closed.** `sortAbilities` (`packages/dsl/src/abilities.ts:518-526`) sits beside `sortKeywords`,
keyed on `ABILITY_KINDS.indexOf(kind)` then `canonicalJson(ability)`, exactly as this section
specified, and `normalize` calls it into its explicit list (`fingerprint.ts:53`) — the comment there
now states the same reasoning this section did. Verified against the source rather than inferred from
the commit that landed it.

---

## 2. Triggers versus replacement

A reader who conflates these will write the wrong subsystem, so this section is the vocabulary.

The kernel already draws the distinction one level down, at
`packages/kernel/src/replacement-effects.ts:38-46`:

> These are *not* `GameEvent`s. A `GameEvent` is a record of something that already happened and is
> append-only history; a `ReplaceableEvent` is a proposal that the pipeline may rewrite or delete
> before the kernel carries it out.

That sentence is the whole difference, and everything below follows from it.

| | Replacement (CR 614/615/616) | Triggered ability (CR 603) |
|---|---|---|
| Watches | `ReplaceableEvent` — a **proposal** (`replacement-effects.ts:47-67`) | `GameEvent` — a **record** (`packages/kernel/src/events.ts:23-129`) |
| Declared as | `ReplacementTrigger` (`replacement-effects.ts:72-82`) | `TriggerCondition` (DSL tuple, §1.3) |
| Runs | inline, inside the action, synchronously (`zones.ts:118`, `zones.ts:233`) | later: on the stack, after SBAs, before priority |
| Uses the stack | never | always |
| Is an object | no | yes (CR 113.7a) |
| Can be responded to | no | yes |
| Fires how often | once per event per effect (CR 614.5, enforced by the `applied` list at `replacement.ts:236`) | once per matching event (enforced by a scan watermark, §3.2) |
| Who decides ordering | the **affected** player (CR 616.1, `replacement.ts:77-89`) | APNAP by controller (CR 603.3b) |
| Can delete the event | yes (`applyReplacements` returns `event: null`) | no |
| Kernel file | `replacement.ts`, `replacement-effects.ts` | `triggers.ts` (new) |

"Enters tapped" and "enters with a +1/+1 counter" are **replacement**, not triggers, and
`packages/kernel/src/zones.ts:106-109` already says so in a comment. That is the single most common
place the two get confused, and the code is already on the right side of it.

**What can be shared: almost nothing, and that is the correct answer.** They watch different value
spaces. `ObjectFilter` (`continuous.ts:56-64`) could in principle describe "which permanent" for
both, but v1's conditions are all self-referential, so no filter is needed. Do not build a unifying
`Watches<T>` abstraction; there are two subsystems, and the rule of three has not been met.

**Naming discipline:**

* `ReplacementTrigger` keeps its name. It is already qualified.
* The new DSL type is `TriggerCondition`, never `Trigger`.
* The new kernel types are `PendingTrigger` (a condition that matched, before it is on the stack) and
  `AbilityOnStack` (after). No bare `Trigger` anywhere.
* `packages/kernel/src/triggers.ts` opens with a header naming `replacement-effects.ts` and stating
  in one paragraph what it is not, the way `replacement-effects.ts:38-46` does for events.

---

## 3. Trigger detection

### 3.1 Is the event stream sufficient?

**Yes, for all three conditions in §6's vocabulary, with one gap, since closed.** Verified against
`packages/kernel/src/events.ts`:

| Condition | Event read | Emitted at | Sufficient? |
|---|---|---|---|
| `selfEnters` | `permanentEntered { oid, controller }` (`events.ts:63`) | `completeArrival`, `zones.ts` | Yes, cards and tokens alike. It was no for tokens at the time of writing; `mtg-4vf` routed `createToken` through the arrival path, and the note under this table records it |
| `selfDies` | `zoneChanged { oid, from: 'battlefield', to: 'graveyard' }` (`events.ts:56-62`) | `moveObject`, `zones.ts` | Yes, cards and tokens alike. Covers destruction, lethal damage, zero toughness and the legend rule, because all four route through `moveObject` from `checkStateBasedActions`, and sacrifice, which routes there from `onActivateAbility`. It was no for tokens until `moveObject` stopped redirecting a leaving token to exile; a token now reaches the graveyard and is removed from existence afterwards, by the CR 704.5d state-based action, and `packages/kernel/test/token-death.test.ts` plays both halves |
| `selfAttacks` | `attackersDeclared { player, attacks }` (`events.ts:112`) | `reduce.ts:94` | Yes; `attacks` carries the oids |

The events carry enough: every one of them names the object, and the controller comes from
`controllerOf(state, oid)` (`layers.ts:227`) at trigger time, which is what **CR 603.3a** wants.

**Two holes, both real, both closed in this epic:**

1. **`createToken` bypassed `moveObject`.** `packages/kernel/src/zones.ts` used to build the object
   and append it directly to `state.battlefield`, emitting only `tokenCreated`. No `permanentEntered`,
   no `zoneChanged`, and no CR 614 enters-replacement pipeline (`arrivalOf`, now `zones.ts:129`) —
   which meant an ETB trigger would silently miss tokens.

   **Closed (2026-08-12).** `mtg-4vf` routed `createToken` (`zones.ts:442-482`) through the arrival
   path: it now calls `arrivalOf` and `completeArrival` exactly as `moveObject` does, so a token runs
   the CR 614 pipeline, registers its statics and emits `permanentEntered`; `mtg-bc2.132.7` gave
   `TokenSpec` an abilities field, so there is now a trigger on the token's side to read that event.
   `packages/kernel/test/token-entry.test.ts` plays it. The half still open is a trigger about
   *another* permanent's arrival, which is new condition vocabulary rather than a bypass.
2. **`scenario()` bypassed `moveObject`.** `packages/kernel/src/scenario.ts:76-101` (`addObject`)
   writes battlefield objects straight into the builder and `scenario.ts:213` starts `base.continuous`
   at `[]`. The file header claims "nothing here can fabricate a position the kernel could not have
   reached itself" (`scenario.ts:5-8`), and a lord placed by `scenario()` with no registered static
   effect would have falsified that claim.

   **Closed.** `scenario()` runs `withRegisteredStatics` (`scenario.ts:133-139`) over the built state
   before `settle` sees it (`scenario.ts:233`): one pass over `state.battlefield` that calls
   `registerStatics` and `registerCostModifiers` on every placed permanent, the same static compiler
   `moveObject` calls through `completeArrival` (§5). A lord placed by `scenario()` now registers its
   effect before anything downstream reads `state.continuous`, so the file header's claim holds.

### 3.2 Where detection runs

`settle` (`packages/kernel/src/reduce.ts:41-51`) already has the right shape. **CR 704.3 / CR 603.3b:**
state-based actions are performed, then triggered abilities that have waited are put on the stack,
then a player gets priority; and the whole check repeats. Today's loop is the first and third of
those. The second is inserted between them:

```ts
export function settle(trace: Trace): Trace {
  let current = trace;
  // Events already in the trace when settle was called are this reduction's
  // own, and no trigger has looked at them yet: `reduce` starts every trace at
  // zero events (`beginTrace`), and applies the action *before* settling.
  let scanned = 0;
  for (let iteration = 0; iteration < MAX_SETTLE_STEPS; iteration += 1) {
    current = checkStateBasedActions(current);
    if (current.state.result !== null) return current;

    const fired = collectTriggers(current, scanned);
    scanned = current.events.length;
    if (fired.length > 0) {
      current = putTriggersOnStack(current, fired);
      // CR 117.3b: after abilities are put on the stack the active player gets
      // priority. Without this a death trigger vanishes at end of step.
      if (current.state.turn.priority === null && current.state.turn.awaiting === null) {
        current = givePriority(current, current.state.turn.active);
      }
      continue;
    }

    if (current.state.turn.awaiting !== null) return current;
    if (current.state.turn.priority !== null) return current;
    current = advanceStep(current);
  }
  throw new Error('settle did not converge; the turn machine is looping');
}
```

The watermark is a local, not a state field, and that is sound because of a property worth stating
explicitly: **`settle` is the only exit from `reduce`, and it never returns while a trigger is
unscanned.** Verified: `reduce` is `validate → applyAction → settle` (`reduce.ts:182-188`), and
`settle` is the only other call site of `advanceStep`. The other two callers of `settle` are
`setup.ts:176` (opening hands only — nothing enters the battlefield) and `scenario.ts:163` (a
constructed board, where ETB triggers must *not* fire).

`MAX_SETTLE_STEPS = 10_000` (`reduce.ts:35`) already bounds a trigger that re-triggers itself; it
throws rather than hanging, which is the right failure.

### 3.3 An ability as its own stack object

`StackEntry` (`packages/kernel/src/state.ts:67-71`) gains one nullable field rather than becoming a
union, because the union widening would touch `popStackEntry` (`stack.ts:110`), the counterSpell
target list (`legal.ts:81`), `isTargetStillLegal`'s stack scan (`effects.ts:80`),
`removeFromZone`'s stack case (`zones.ts:77`) and the UI replay schema (below).

```ts
/**
 * An ability on the stack (CR 113.7a): an object that is not a card. `oid` on
 * the entry is minted for it (`abilityObjectId`), so stack identity keeps
 * working; `sourceOid` names the permanent it came from, which may already have
 * left the battlefield — CR 608.2 resolves it anyway.
 */
export interface AbilityOnStack {
  readonly sourceOid: ObjectId;
  /** Index into `getObject(state, sourceOid).card.abilities`. */
  readonly index: number;
}

export interface StackEntry {
  readonly oid: ObjectId;
  readonly controller: PlayerId;
  readonly targets: readonly (Target | null)[];
  /** `null` for a spell. Non-null makes this an ability, not a card. */
  readonly ability: AbilityOnStack | null;
}
```

`packages/kernel/src/ids.ts` gains `abilityObjectId(counter) = \`ab${counter}\`` beside
`objectId` (`ids.ts:21-23`) and `continuousEffectId` (`ids.ts:26-28`), drawn from the same
monotonic `state.nextId` so ids never collide.

`resolveTop` (`stack.ts:68-104`) branches before its `getObject(state, entry.oid)` lookup, because an
ability entry's `oid` has no `GameObject`:

```ts
export function resolveTop(trace: Trace): Trace {
  const entry = topOfStack(trace.state);
  if (entry === undefined) return trace;
  if (entry.ability !== null) return resolveAbility(trace, entry, entry.ability);
  // …today's path, unchanged…
}
```

`resolveAbility` reads `getObject(state, ability.sourceOid).card.abilities[ability.index]`, runs the
same `planResolution`/`applyEffect` loop over the ability's effects with `sourceOid` as the effect
source, pops the entry, and stops. There is no zone move: an ability that finishes resolving simply
ceases to exist (CR 608.2m).

**Two edits that are load-bearing and easy to miss.** `counterSpell` must not be able to counter a
triggered ability — the printed text says "Counter target spell", and a kernel that let it hit an
ability would be a card whose text and behavior disagree, which is the exact failure this DSL exists
to prevent (`validate/effects.ts:182-197` makes the same argument about duplicate effects):

* `packages/kernel/src/legal.ts:80-82` — `state.stack.map(...)` becomes
  `state.stack.filter((entry) => entry.ability === null).map(...)`.
* `packages/kernel/src/effects.ts:80` — `state.stack.some((e) => e.oid === target.oid)` becomes
  `state.stack.some((e) => e.oid === target.oid && e.ability === null)`.

**Responding to it is free.** Once the entry is on the stack and `givePriority` has run,
`priorityDecision` (`legal.ts:161-172`) enumerates the opponent's options, and `canCastNow`
(`legal.ts:105-113`) returns `true` unconditionally for instants. So `mtg-bc2.132.2`'s acceptance
criterion "the trigger goes on the stack as its own object and can be responded to" is satisfied by
machinery that already exists, and the test for it is a scenario where the opponent kills the source
in response and the ability still resolves.

**Ordering.** **CR 603.3b** puts simultaneous triggers on the stack in APNAP order, each controller
choosing among their own. The slice is two-player (`packages/kernel/src/ids.ts:9`), so APNAP is
"active player's first". Within one player, v1 orders deterministically by battlefield index then
ability index, and says so in the code comment. Making that a player decision is a new `AwaitKind`
and is out of scope (§6).

**Events.** Two new `GameEvent` variants, both flat and free of optional fields per `events.ts:1-9`:

```ts
| {
    readonly type: 'abilityTriggered';
    readonly oid: ObjectId;        // the ability object's own id
    readonly sourceOid: ObjectId;
    readonly index: number;
    readonly controller: PlayerId;
    readonly condition: TriggerCondition;
  }
| { readonly type: 'abilityResolved'; readonly oid: ObjectId; readonly sourceOid: ObjectId }
```

Adding to `GameEvent` is a compile error at `packages/ui/src/routes/replay/narrate.ts:208`
(`assertNever` over `GameEvent`), which is the desired behavior: a new event that nothing narrates
would otherwise be invisible in the replay viewer.

---

## 4. Activation

### 4.1 The action

```ts
// packages/kernel/src/actions.ts, joining the union at actions.ts:28-60
  | {
      readonly type: 'activateAbility';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      /** Index into the permanent's `card.abilities`. */
      readonly abilityIndex: number;
      /** Parallel to the ability's effect list; `null` where an effect needs no target. */
      readonly targets: readonly (Target | null)[];
    }
```

Deliberately a *sibling* of `activateManaAbility` (`actions.ts:38-43`) rather than a generalization
of it. **CR 605.1:** a mana ability does not use the stack and cannot be responded to, which is why
`activateManaAbility` reduces to `produceMana` inline (`reduce.ts:150-153`) with no stack entry. They
are different rules and merging them would put a stack entry where the rules forbid one.

### 4.2 Enumeration

`priorityDecision` (`legal.ts:161-172`) gains one line, alongside the four option sources it already
concatenates:

```ts
function priorityDecision(state: GameState, player: PlayerId, cap: number): Decision {
  const casts = castOptions(state, player, cap);
  const activations = activationOptions(state, player, cap);
  const options: Action[] = [
    { type: 'passPriority', player },
    ...landOptions(state, player),
    ...casts.items,
    ...activations.items,
    ...manaAbilityOptions(state, player),
  ];
  return {
    kind: 'priority',
    player,
    options,
    complete: casts.complete && activations.complete,
  };
}
```

`activationOptions` is `castOptions` (`legal.ts:115-138`) with three substitutions: the source list
is `controlledBy(state, player)` (`layers.ts:233`) instead of the hand; the cost check is
`canPay(state, player, cost.mana)` plus the tap conditions; and the target choices come from an
ability-aware sibling of `targetChoicesFor`. Everything else — `cartesian(choices, cap)`,
`honorsDistinctSlots`, the `complete` flag — is reused verbatim.

The tap conditions are where the rules live:

* `cost.tapSelf` requires `!object.tapped`.
* **CR 302.6:** `cost.tapSelf` on a permanent that is currently a creature also requires
  `!object.summoningSick`. `GameObject.summoningSick` already exists (`state.ts:52`) and is cleared
  in the untap step (`turn.ts:85-91`); "currently a creature" is `isCreatureObject(state, oid)`
  (`layers.ts:209`), which is layer-aware, so an animated artifact is correctly summoning-sick.
* Control is read through `controllerOf` (`layers.ts:227`), never `GameObject.controller` — the same
  correction `validateManaAbility` already carries a comment about at `legal.ts:351-353`.
* v1 abilities are instant-speed. **CR 602.2:** that is the default; a sorcery-speed restriction is a
  printed clause, and v1 does not print one.

### 4.3 Reduction and validation

`onActivateAbility` mirrors `onCastSpell` (`reduce.ts:82-90`) almost exactly:

```ts
function onActivateAbility(trace: Trace, action: Extract<Action, { type: 'activateAbility' }>): Trace {
  const ability = abilityAt(trace.state, action.oid, action.abilityIndex);
  if (ability.kind !== 'activated') throw new IllegalActionError(action, 'that ability is not activated');
  const plan = planPayment(trace.state, action.player, ability.cost.mana);
  if (plan === null) throw new IllegalActionError(action, 'cannot pay the mana cost');
  const paid = executePayment(trace, action.player, ability.cost.mana, plan);
  const tapped = ability.cost.tapSelf ? tapObject(paid, action.oid) : paid;
  const pushed = pushAbility(tapped, action.player, action.oid, action.abilityIndex, action.targets);
  return retainPriority(pushed, action.player);
}
```

`validateAction` (`legal.ts:364-416`) gains an arm that re-derives every one of those conditions from
state rather than trusting the enumeration, which is the property `legal.ts:8-11` states the guard
exists for.

**One subtlety with real consequences.** `planPayment` auto-taps lands (`mana.ts:88-124`, documented
at `mana.ts:12-15`). If a v1 activated ability ever lived on a *land*, its `{T}` cost and the payment
planner could tap the same permanent twice. v1 forbids abilities on lands (§1.6 rule 1), which
closes it; the day that changes, the planner must exclude the ability's own source.

### 4.4 What this costs the interaction model

**The button is free. The label, the grouping and the detail line are not.** Verified end to end:

* `packages/ui/src/routes/play/prompt.ts:199-213` maps `decision.options` one-to-one to
  `PlayChoice`s carrying `index`, with the contract stated at `prompt.ts:22`: *"Index into
  `decision.options`. The only thing the UI ever submits."*
* `packages/ui/src/routes/play/PlayView.ts:52-67` builds one `<button>` per choice, submitting
  `choice.index`.
* `packages/kernel/src/session.ts:153-179` takes that index, range-checks it and reduces
  `decision.options[index]`. `session.ts:20-23` states why: *"A human choice is an index into
  `decision.options`, never a constructed action. That is what makes an illegal action
  unrepresentable rather than rejected after the fact."*
* `packages/ui/test/play/play.test.ts:156-168` pins the one-to-one mapping as a test.

So: an enumerated action reaches the play surface as a clickable button with no UI change at all.
Three things degrade quietly and each is a one-line fix that nobody will notice is missing:

| Site | Behavior with a new action type | Fix |
|---|---|---|
| `prompt.ts:102-134` `labelOf` | **Compile error**, but a confusing one: there is no `assertNever`, only an exhaustive-return, so the diagnostic is "function lacks ending return statement" | Add the arm; add `assertNever` while there |
| `prompt.ts:136-147` `detailOf` | `default: return null` — the second line of the button **silently disappears** | Add the arm |
| `PlayView.ts:44-50` `GROUP_ORDER` | Not exhaustive-checked; the button lands in an ungrouped "Other" bucket (`PlayView.ts:89-105`), visible but un-designed | Add `activateAbility` to a group |

`packages/kernel/src/simple-agent.ts:134-156` switches on `action.type` with no default and is a hard
compile error — good. `packages/kernel/src/legal.ts:419-429` `isEnumeratedOption` special-cases
`castSpell` because targets compare structurally; `activateAbility` needs the same treatment or an
option the kernel offered will fail its own membership test.

---

## 5. Static abilities

The resolution machinery is done. What is genuinely new is three things: a compiler, a registration
point, and a third `EffectDuration`.

### 5.1 What is reused, exactly

A static ability compiles to a `ContinuousEffect` (`packages/kernel/src/continuous.ts:188-198`) and
nothing else. Concretely:

| DSL | Kernel type | Layer |
|---|---|---|
| `{ kind: 'statBonus', power, toughness }` | `PtModEffect` (`continuous.ts:174-180`) | `7c` (CR 613.4c) |
| `{ kind: 'grantKeyword', keyword }` | `AbilityChangeEffect` (`continuous.ts:140-148`) | `6` (CR 613.1f) |

The scope compiles to an `ObjectFilter` (`continuous.ts:56-64`) via a total `Record`:

```ts
// packages/kernel/src/abilities.ts (new)
const SCOPE_FILTERS: Readonly<
  Record<StaticScope, (source: ObjectId, controller: PlayerId, subtype: string | null) => ObjectFilter>
> = {
  self: (source) => onlyObject(source),
  creaturesYouControl: (_source, controller, subtype) =>
    objectFilter({ cardTypes: ['creature'], controller, subtypes: subtype === null ? null : [subtype] }),
  otherCreaturesYouControl: (source, controller, subtype) =>
    objectFilter({
      cardTypes: ['creature'],
      controller,
      subtypes: subtype === null ? null : [subtype],
      excludeOids: [source],
    }),
};
```

Everything downstream is already built: `orderLayer` (CR 613.8 dependency ordering,
`dependency.ts:145`), `applyEffectTo` (`characteristics.ts:185`), the memoized whole-board walk
(`layers.ts:131`), expiry bookkeeping, and the `effectsApplyingTo` explainer (`layers.ts:175`). A lord
that grants +1/+1 to creatures that another effect just turned into creatures orders correctly
without a line of new ordering code, because `dependency.ts` computes the relation rather than
declaring it (`dependency.ts:33-47`).

### 5.2 What is genuinely new

**(a) `ObjectFilter.excludeOids`.** "Other creatures you control" needs exclusion and the filter has
only inclusion (`oids: readonly ObjectId[] | null`). Add:

```ts
  /** Permanents this effect skips even when the rest of the filter matches. */
  readonly excludeOids: readonly ObjectId[] | null;
```

with `null` in `ANY_PERMANENT` (`continuous.ts:67-75`) and one line in `matchesFilter`
(`characteristics.ts:86-97`). Every in-tree construction goes through `objectFilter(patch)`
(`continuous.ts:78-80`) or `onlyObject` (`continuous.ts:83-85`), both of which spread
`ANY_PERMANENT`, so the blast radius is the interface, the constant and the predicate.

*Rejected:* registering a positive effect over the group plus a negative one over the source. It
would be a lie in `effectsApplyingTo` and in the layer-7c ordering, and any test that read the
applied-effect list would report two effects where the card has one.

*To verify before writing:* `stateFingerprint` (`packages/kernel/src/fork.ts:61-66`) hashes the whole
state including `state.continuous`, so a new filter field changes fingerprints. It appears to be used
comparatively (two runs of the same seed) rather than against committed goldens — `fork.ts:59-61`
says "used by tests to prove `reduce` left its input alone" — but confirm before landing.

**(b) A third `EffectDuration`.** `continuous.ts:44` is `'endOfTurn' | 'permanent'`, which becomes:

```ts
export type EffectDuration = 'endOfTurn' | 'permanent' | 'whileOnBattlefield';
```

`'whileOnBattlefield'` rather than `'static'` because it names the removal condition, and rather than
reusing `'permanent'` because that word already means a card type three lines away.
`cleanupTurnEffects` (`turn.ts:104-126`) filters on `=== 'endOfTurn'` and is unaffected;
`continuous-helpers.ts` defaults to `'permanent'` and is unaffected.

**(c) Registration and removal, both in `moveObject`.** `packages/kernel/src/zones.ts:145-193` is the
single choke point for zone change and already distinguishes entering from leaving
(`zones.ts:149`, `zones.ts:186`):

* **Entering the battlefield:** append `staticEffectsFor(card, oid, controllerOf(state, oid),
  state.nextId)` to `state.continuous` and advance `nextId`, so the CR 613.7 timestamp is the moment
  the permanent entered.
* **Leaving the battlefield:** drop every effect with `sourceOid === oid && duration ===
  'whileOnBattlefield'` and emit `continuousEffectsExpired { ids }` — an event that already exists
  (`events.ts:110`), so no new event is needed for this half.

Registration must happen after `putObject`/`addToZone`, so `controllerOf` reads the placed object.
Both are in the same immutable rewrite, so this is ordering within one function, not a second pass.

*Rejected: deriving statics inside the layer walk instead of registering them.* Computing them from
`state.battlefield` inside `computeAll` (`layers.ts:103-126`) would make appearance and disappearance
automatic and would need neither a new duration nor a removal hook. It was rejected on the hot path:
`powerOf`, `toughnessOf`, `hasKeyword`, `isCreatureObject` and `controllerOf` all short-circuit on
`state.continuous.length === 0` (`layers.ts:170-172`), and `layers.ts:161-169` says why — those
accessors are called thousands of times per game. Derivation would replace an array-length check with
a battlefield scan at every one of those calls, and CR 613.7 timestamps would need a new
`GameObject` field anyway.

### 5.3 The three known holes, named

1. **Control change does not move a lord's effect.** ~~The `ObjectFilter.controller` is baked in at
   registration.~~ Fixed by `mtg-bc2.152.7`: `ObjectFilter.controllerIsSource` replaces the baked-in
   `controller`, resolved live against the source's current controller on every layer walk
   (`characteristics.ts`'s `resolveFilter`), so a layer-2 control change is visible to layer 6/7
   without re-registration — CR 613's `LAYER_ORDER` guarantees layer 2 resolves first. No DSL surface
   to *author* a control-changing static ability exists yet, so the fix is currently exercised by
   kernel-level construction only; it stops being latent the day one is added.
2. **Layer 6 cannot grant or remove a static ability.** `AbilityChangeEffect` carries
   `addKeywords`/`removeKeywords` (`continuous.ts:144-145`), which are `Keyword`s, not abilities. A
   permanent that "loses all abilities" keeps its registered static effect. Out of scope, and §6 lists
   it.
3. **Two bypasses of `moveObject` into the battlefield**, both from §3.1: `createToken`
   (`zones.ts:442`) and `scenario.addObject` (`scenario.ts:76`). At the time of writing, tokens
   carried no abilities, so only the scenario builder actually broke, and it broke silently, by
   making a static ability do nothing in exactly the tests written to prove it works. Both bypasses
   have since been closed, which is what made the second sentence safe to stop relying on:
   `mtg-bc2.132.7` gave `TokenSpec` an abilities field, so a token that skipped `registerStatics`
   would now break the same way a scenario permanent did.

---

## 6. The minimum viable vocabulary

This is the judgment call. The criterion is not "how much Magic can we express" but **the smallest
vocabulary in which a generated set can carry a named mechanic that is not a re-labeled keyword** —
which is `mtg-bc2.132`'s acceptance criterion, and which is what unblocks the flagship card list and
therefore the art spend.

### 6.1 In

| Shape | Form | Example |
|---|---|---|
| **Triggered** | condition ∈ {`selfEnters`, `selfAttacks`, `selfDies`}, 1-2 effects, targets restricted to `noTarget` and `self` | "When {name} enters the battlefield, you gain 2 life." / "Whenever {name} attacks, it gets +1/+0 until end of turn." |
| **Activated** | cost = mana + optional `{T}`, 1-2 effects, any target kind including `self` | "{1}{R}, {T}: {name} deals 1 damage to any target." / "{2}: {name} gets +1/+1 until end of turn." |
| **Static** | scope ∈ {`self`, `creaturesYouControl`, `otherCreaturesYouControl`} × optional subtype, modification ∈ {`statBonus`, `grantKeyword`} | "Other Merfolk creatures you control get +1/+1." / "Creatures you control have vigilance." |

Three arguments for exactly this set, and no more.

**It is closed under the machinery that already exists.** Every shape resolves through
`applyEffect`'s existing ten-case switch, the existing layer walk, and the existing stack. None of
them introduces a new decision point: a triggered ability that does not target needs no choice when
it is put on the stack, an activated ability chooses targets through the same `cartesian` enumeration
a cast already uses, and a static ability is chosen by nobody. That is what keeps
`packages/kernel/src/legal.ts`'s `AwaitKind` list (`state.ts:139`) at four members.

**It is closed under `renderOracleText`.** Each shape is one printed line built from one template
plus the existing `renderEffect`. No new region, no inline mana symbols beyond text (§8), no
reminder text, no ability words.

**It is the set of shapes real named mechanics are built from.** A Magic keyword ability is
overwhelmingly one of: a self-trigger with a parameter (Battalion, Mentor, Training, Exalted), a
self-activated pump (firebreathing, Outlast, Level Up's shape), or a lord (Battle Cry's cousin, every
tribal static). A designer handed these three can write a mechanic; a designer handed the nine
evergreen keywords cannot.

### 6.2 Out, deliberately

The list is long on purpose. Everything here is a v1.1 conversation, not a v1 omission to be quietly
filled in.

**Triggers.**
* Any condition about something other than the source: "whenever another creature you control
  enters", "whenever you cast a spell", "at the beginning of your upkeep", "whenever {name} deals
  combat damage to a player", "whenever a creature dies". Each needs an `ObjectFilter` on the
  condition and a second look at what the event stream carries.
* ~~**Targeted triggers.**~~ **Closed (2026-08-13).** `mtg-bc2.132.6` landed both halves of this
  item: a trigger whose effects target chooses them as it is put on the stack (CR 603.3d), and a
  trigger printed with "you may" is answered as it resolves (CR 603.3b). `AwaitKind` gained
  `triggerTargets` and `optionalTrigger`, `Decision` gained the matching variants, and the reducer's
  contract needed no restating — §9 Risk 2 says why.
* Intervening-if clauses (CR 603.4), reflexive triggers, delayed triggers (CR 603.7), triggers that
  fire from a zone other than the battlefield.

**Activation.**
* Any cost that is not mana or `{T}`: sacrifice, discard, exile, pay life, remove a counter,
  additional `{X}`. Each is a new cost-payment path in `reduce.ts` and a new legality check.
* Sorcery-speed restrictions, once-per-turn restrictions, loyalty, equip, cycling, and every keyword
  *ability* as opposed to keyword.
* Abilities on lands (which would collide with `planPayment`'s auto-tap, §4.3), on instants and
  sorceries, and on tokens.

**Statics.**
* Layers 1-5 (copy, control, text change, type change, color change) and 7a/7b/7e. The kernel
  resolves all of them; the DSL will not emit them, because each needs its own scope vocabulary and
  its own print rule and none of them is what a first named mechanic is made of.
* Scopes reaching an opponent's permanents ("creatures your opponents control get -1/-1"), scopes
  over noncreature permanents, and conditional statics ("as long as you control three Merfolk").
* Statics that grant an *ability* rather than a keyword.

**Everything else.** Replacement abilities from the DSL — the CR 614/615/616 pipeline exists and is
tested (`packages/kernel/test/replacement.test.ts`), and after this epic the DSL *still* cannot emit
one. Modal abilities. `{X}` anywhere. Ability words and named keyword abilities as first-class DSL
objects: in v1 a mechanic's *name* lives in the `SetBrief` and in flavor, and the card carries the
shape, not the label.

---

## 7. Sequencing, and the invariant

### 7.1 Restating the invariant as a per-commit property

CLAUDE.md's load-bearing invariant, as it read when this document was written — "the set
generator's output space equals the engine's enforceable space" — is not checkable as written,
because "equals" is a claim about two spaces. The checkable form is:

> **At every commit, `{ c : validateCard(c) === [] }` is a subset of `{ c : the kernel can reduce
> every legal action over c }`.**

That recommendation was taken. CLAUDE.md now states the invariant as containment outright — the
output space "stays inside" the enforceable space, "inside, not equal to" — and names the two
compile-time proofs (`ModelAbilityIsAbility`, `ModelEffectSchema`) along with a case where the
containment is deliberately strict: `putCounters` is expressible by hand and unreachable from the
generator. The quoted sentence above is kept as the wording this section was arguing against, not
as the wording in force.

The mechanism that holds it is already in the tree, at `packages/kernel/src/effects.ts:4-6`:

> One `switch` over `Effect['kind']` with an `assertNever` default: the moment the DSL grows an
> eleventh primitive this file fails to compile, which is the co-design invariant enforced by the
> type system rather than by discipline.

Applied to abilities: `@mtg/kernel` depends on `@mtg/dsl`, and the kernel's `applyAbility` switch over
`Ability['kind']` carries an `assertNever`. **So the DSL cannot gain an ability kind without the
kernel failing to compile.** That is the whole guarantee, and it holds if and only if the union grows
one member at a time.

### 7.2 The recommended order: vertical slices, not package halves

The beads declare `132.2` (kernel) blocking `132.1` (DSL), which reads as "kernel first". Taken
literally that cannot compile: the kernel's ability executor imports `Ability` from `@mtg/dsl`, so
there is no state in which the kernel supports an ability type the DSL has not defined.
`mtg-bc2.132.1`'s own description already anticipates this — *"Land this behind the kernel work or
land them in one change."*

The better split is **by ability kind, not by package**. Each slice is DSL + kernel + renderer +
downstream tables, landing together:

| Slice | `ABILITY_KINDS` after | Contains |
|---|---|---|
| **A — static** | `['static']` | `abilities.ts` with one union member; `Card.abilities`; `checkAbilities`; `STATIC_*` tuples; `renderOracleText`; `sortAbilities`; `ObjectFilter.excludeOids`; `EffectDuration` third member; `staticEffectsFor` + registration/removal in `moveObject`; the `scenario()` fix; `deckbuild`/`sim` valuation; forge `S:Mode$` or a rejection code |
| **B — triggered** | `['triggered', 'static']` | `TRIGGER_CONDITIONS`; `TARGET_KINDS += 'self'` and its six tables; `StackEntry.ability`; `abilityObjectId`; `triggers.ts`; the `settle` hook; `resolveAbility`; the two `counterSpell` exclusions; `createToken` emitting `permanentEntered`; two new `GameEvent`s and their narration; forge `T:Mode$` |
| **C — activated** | `['triggered', 'activated', 'static']` | `ActivationCostSchema`; the `activateAbility` action; `activationOptions`; `validateAction` arm; `isEnumeratedOption`; `onActivateAbility`; `labelOf`/`detailOf`/`GROUP_ORDER`; `simpleAgent` and the `@mtg/sim` policy; forge `A:AB$` |
| **D — setgen** (`mtg-bc2.132.3`) | unchanged | `DesiredMechanic.abilityShapes` and the `brief.ts:54-56` refine; `RoleProfile.cardKind` widened past `'instant' \| 'sorcery'`; new roles; `Slot` ability fields; allocator bias; `prompts.ts`; `filled.ts`/`assemble.ts`; `mechanicMatches`; NWO budget; pie subjects; **re-record every setgen fixture** |

Order A → B → C → D, chosen so the riskiest UI-facing work lands last against machinery already
proven, and so the cheapest slice proves the registration/removal pattern first.

### 7.3 What CI sees in each intermediate state

This is the part that matters, because a half-landed state is what CI actually runs.

**After A.** `AbilitySchema` is a one-member "union". A card can be
`{ kind: 'creature', abilities: [{ kind: 'static', … }] }`; `packages/dsl/src/card.ts:77`'s comment is
gone and `EFFECT_ILLEGAL_ON_CARD_TYPE`'s message is rewritten. The artifact type is no longer vanilla
by construction. Nothing can express a trigger or an activation, so nothing can emit one. The balance
gate runs over the committed 90-card set, which has no abilities, and is unchanged. **Coherent.**

**After B.** Triggers exist and resolve; `self` exists as a target kind and is legal on
`pumpUntilEndOfTurn` and `tapPermanent` only, inside abilities only. `ABILITY_KINDS` has two members
and `AbilityKindsCovered` still resolves to `true` because both sides grew together. No card can be
activated, so `legal.ts` is untouched from A and the play surface has nothing new to label.
**Coherent.**

**After C.** All three kinds exist. The DSL's expressible space and the kernel's enforceable space
are equal again at the widest point of the epic, and `mtg-bc2.132.2`'s acceptance criteria are all
demonstrable with hand-written DSL cards. `@mtg/setgen` still cannot *ask* for any of it, so no
generated set changes and every recorded fixture still replays. **Coherent, and this is the natural
place to stop and check the fit gate before touching setgen** (§9, risk 1).

Slice C landed with five departures from the row above, each of which cost something to take:

- `ABILITY_KINDS` is `['static', 'triggered', 'activated']`, not the order printed in the table. The
  tuple is appended to rather than reordered, so a card written before the commit hashes after it
  exactly as it did before. Sorting for display is `sortAbilities`' job and it is unaffected.
- `isEnumeratedOption` did not come back. `mtg-bc2.115` deleted it as dead and argued against
  reviving it on speculation; this slice was named as the caller that would justify it, and it is
  not one. Every activation the bot plays is picked straight off `decision.options`, and
  `validateAction` re-derives legality rather than consulting the enumerated list on purpose — a
  validator that trusted the list would validate the enumeration instead of the action.
- The activation cost is mana plus an optional `{T}` and nothing else. Sacrifice, discard, exile,
  pay-life and additional `{X}` are not expressible, so Fuse's own cost is not yet expressible;
  `ActivationCost` is a closed object and a card that names any of them fails to parse rather than
  parsing into something the kernel would not charge for.
- The slice grew one `GameEvent`, `abilityActivated`, which the row above did not list. It is not
  narration: `@mtg/sim`'s replay-superset log carries 17lands' `{owner}_turn_{N}_{side}_abilities`
  column, and a column counted off no event reports zero forever. The first pass shipped that zero
  and shipped `@mtg/metrics`' join contract calling it structural, both while the bots were paying
  for abilities in every seeded game. `packages/sim/test/log-activations.test.ts` counts the events
  and `packages/sim/test/activation-game.test.ts` asserts the column is non-zero across twelve
  games.
- The play surface was not free after all. Four exhaustive switches outside `@mtg/kernel` had to
  grow the arm — `oidsOf`, `labelOf` and `describeAction` (twice, once per package) — and until they
  did, an activation rendered as an unlabeled button in `PlayView`'s "Other" fallback and appeared
  on no permanent. Measured in Chromium at 1440x900: it now sits under an "Abilities" heading in the
  rail and in the permanent's own picker, labeled with the cost, the printed effect and the chosen
  target.

**After D.** A brief can name a mechanic as an ability shape and the generator emits it. Every setgen
fixture is re-recorded, because `fixtureKey` hashes `(system, prompt, schema)`
(`packages/llm/src/schema.ts:67-80`) and `ModelAbilitySchema` reaches the request schema through
`FillBatchSchema`. That re-recording is unavoidable and should be a single commit of its own so the
diff is readable.

### 7.4 The one place the invariant can still be broken by hand

`@mtg/setgen`'s validators are not type-connected to the kernel. Specifically
`packages/setgen/src/validate/composition.ts:175-182`:

```ts
const byKeyword = card.keywords.some((keyword) => mechanic.keywords.includes(keyword));
const byEffect = card.effects.some((effect) => mechanic.effectKinds.includes(effect.kind));
return byKeyword || byEffect;
```

That disjunction is exhaustive over DSL v0's *two* expression axes. A card whose mechanic lives in an
ability matches neither, so `checkMechanicCoverage` (`composition.ts:190-223`) would report
`MECHANIC_ABSENT_AT_COMMON` — an error — for a set where the mechanic is on every common. It fails
loudly rather than silently, which is the good direction, but it fails *wrongly*, and it is a
runtime string comparison that no compiler will point at. Slice D must add the third axis here first,
before touching the allocator or the prompt.

The same shape recurs at `packages/setgen/src/validate/pie.ts:39-42` (`cardSubjects` concatenates
keywords and effect kinds), `validate/nwo.ts:39-50` (the complexity budget counts effects and
keywords), and `validate/conformance.ts:76-89` (which early-returns when a slot declares no effect
kinds, leaving an ability-bearing artifact unchecked).

---

## 8. Renderers

### 8.1 The parity contract holds, and it holds for a reason worth restating

ADR-0002 §2.1 (`docs/adr/0002-card-renderer-split.md:124`): *"All printed words come from `@mtg/dsl` —
`renderTypeLine`, `renderOracleText`, `formatManaCost` — and neither renderer derives them."*
Verified on both sides:

* DOM: `packages/ui/src/card/Card.ts:77-80` calls `renderOracleText(card)` and splits on `'\n'`, one
  `<span class="mtg-card__line">` per line.
* SVG: `packages/card-render/src/regions.ts:275-289` calls `renderOracleText(card)`, splits on `'\n'`
  into paragraphs, and hands them to `fitParagraphs`.

The parity assertion is `packages/card-render/test/parity.test.ts:235-244`, which compares the
whitespace-normalized *word sequence* from both faces against `renderOracleText` directly. So ability
text reaches both faces the moment `renderOracleText` learns to print it, and a renderer that dropped
it fails the test. **Nothing in `packages/ui/` will fail to compile** — the coupling is string-shaped,
not type-shaped — and the compile errors land one layer down, at `oracle.ts:132` and its four
siblings.

Two follow-on notes:

* `parity.test.ts:127-130`'s `words()` normalizes whitespace, which **erases the `'\n'` structure**.
  Today that cannot matter, because both faces split the same string. It becomes load-bearing when
  abilities make paragraph structure meaningful (each ability is its own line), and it is worth one
  extra assertion comparing line *counts*.
* `Card.ts:84,90` bolds line 0 as the keyword line whenever `card.keywords.length > 0`. That heuristic
  is correct only while `renderOracleText` puts keywords first (`oracle.ts:145`). §8.2 keeps that
  ordering, so the heuristic survives — but it is positional, and it should become a marker the
  renderer emits rather than an index the face guesses.

### 8.2 The printed order

```
Flying, vigilance                                   ← keywords, unchanged (oracle.ts:145)
Other Merfolk creatures you control get +1/+1.         ← static abilities, in card order
When Merfolk Sentry enters the battlefield, you gain 2 life.
{2}, {T}: Merfolk Sentry gets +1/+1 until end of turn.
Merfolk Sentry deals 2 damage to any target.           ← card.effects, unchanged (oracle.ts:146)
```

Ability lines slot between the keyword line and the effect paragraph, one `'\n'`-separated line each.

The trigger template comes from `TRIGGER_PRINT_TEMPLATES` (§1.3) with `{name}` substituted, followed
by the effect sentences. There is one wrinkle: `renderEffect` returns a capitalized sentence
(`oracle.ts:99-134`), and a trigger clause needs it lowercased — *except* when the sentence begins
with the card's own name, as `dealDamage` does (`oracle.ts:102`). The rule is "lowercase the first
character unless the sentence starts with `cardName`", it belongs in `text-util.ts` beside
`capitalize`, and `packages/dsl/test/oracle.test.ts` must cover both branches.

The static template distinguishes the two Magic verbs: P/T uses *get*, keywords use *have*. "Other
creatures you control get +1/+1." / "Creatures you control have vigilance."

The activation template prints the cost as text: `{2}{R}, {T}: `. `formatManaCost` already produces
`{2}{R}`, and the printed face can measure it — `packages/card-render/src/text/metrics-data.ts:23`
covers the full printable-ASCII range including `{`, `}` and `:`. Rendering those as *inline pip
symbols* would be a new shared-specification concern (ADR-0002 §4: "Adding a region to the face is a
three-file change") and belongs in its own bead.

### 8.3 The real risk is the fit gate, not the parity test

The printed rules box is a fixed rectangle: `rulesHeight = 244` user units (24.4 mm) at
`packages/card-render/src/geometry.ts:77`, with a size band of `{ max: 29, min: 13 }` at
`packages/card-render/src/regions.ts:36`. Text that will not fit at 1.3 mm type is **truncated** by
`lastResortLayout` (`regions.ts:329-346`, the `slice(0, keep)` at line 344), and the render is
reported as failed.

`packages/card-render/test/set-fit.test.ts` is the gate, and its header (lines 6-9) predicted this
work:

> A fixed font size that happens to suit today's set would pass the first check and fail the second
> the day a rare gets a third sentence.

The measured baseline is in the same file (lines 45-49): the longest oracle text in the committed
90-card set is **97 characters**. A creature with a keyword line, a trigger and an activated ability
is comfortably 150-220. This is where DSL v1 breaks first, and it will break in `@mtg/card-render`,
not in `@mtg/dsl`.

There is a second, independent ceiling upstream: `packages/setgen/src/validate/nwo.ts:26-27` sets
`MAX_TEXT_LINES = 3` and `MAX_TEXT_CHARS = 140`, and `redFlagsFor` (`nwo.ts:39-50`) charges anything
over that against the New World Order complexity budget for commons. That gate is a *design* control
and should be left to fire — it is the thing that stops the generator putting a three-line activated
ability on a common — but it means the ability vocabulary and the NWO budget have to be tuned
together in slice D.

### 8.4 The compact face, which is a real problem

**Confirmed.** `COMPACT_REGIONS = ['title', 'type', 'footer']`
(`packages/ui/src/card/anatomy.ts:49`); `Card.ts:144` picks it for `size: 'compact'`; the battlefield
uses `size: 'compact'` at `packages/ui/src/board/Battlefield.ts:80`. Pinned by
`packages/ui/test/card.test.ts:300-307` and `packages/card-render/test/parity.test.ts:215-220`.

So a permanent on the played table shows its name, mana pips, type line, rarity seal, collector line
and P/T — and **nothing about its abilities**. After slice C the player will see a button reading
"Activate Merfolk Sentry" attached to a card face that gives no clue such an ability exists.

The hole predates this epic: keywords reach the face only as line 0 of the rules text, so a flier on
the battlefield does not say "flying" today either. Abilities widen it from "you cannot see a
keyword" to "you cannot see why that button exists".

**The cheapest honest fix is not a new region.** `Battlefield.ts:55-65` already maintains a mark
vocabulary on the slot wrapper — `ATK`, `BLK`, `SICK`, `+n`, `-n` — that lives entirely outside the
shared face specification and therefore costs nothing in ADR-0002 terms: no `anatomy.ts` change, no
second renderer, no parity impact. Adding an `ABL` mark for a permanent with an unactivated ability
is a few lines in one file.

Two reasons not to smuggle it into `mtg-bc2.132`: it is a UI legibility change with its own design
question (does the mark show the cost? does it dim when unaffordable? does the same mark serve a
static ability, which needs no button?), and three other agents are editing `packages/ui` right now.
**File it as its own bead, blocked by slice C.**

---

## 9. Risks and kill criteria

### Risk 1 — the printed rules box, and the geometry behind it

**Why it could be bigger than it looks.** Everything in §8.3. If two lines of ability text do not fit
at a readable size, the fix is not in this epic: the rules-box rectangle is
`packages/card-render/src/geometry.ts:77`, and shrinking the art window or the title bar to buy
height is a change to the *shared* face specification, which ADR-0002 §4 prices as a three-file
change (`anatomy.ts` plus both renderers) with a parity-suite update.

**Observation that tells us early, before any kernel code.** Hand-write the three v1 example cards
(a lord, an ETB trigger, an activated pump), run them through `renderSet`, and read
`checkSvgOverflow` and the fit report. This takes an afternoon and is pure `@mtg/dsl` +
`@mtg/card-render`.

**Kill criterion.** If fitting a two-line ability at common requires changing `anatomy.ts` geometry,
stop and split that into its own bead before slice A lands. Do not let a rules-box redesign ride
along inside an ability epic.

### Risk 2 — targeted triggers

**Why it could be bigger than it looks.** The instant a mechanic wants "when {name} enters, destroy
target creature", CR 603.3d requires choosing targets when the ability is *put on the stack*. That
means `settle` can stop for a decision, which contradicts the reducer's stated contract at
`reduce.ts:37-39` and needs a fifth `AwaitKind` (`state.ts:139`), a sixth `Decision` variant
(`legal.ts:34-71`), a `validateAction` arm, a UI prompt, a bot policy and a replay narration. It is
comparable in size to slice C on its own.

**Observation that tells us early.** Draft the flagship mechanic *before* slice D — one page, in DSL
pseudo-text, against §6.1's vocabulary. If it cannot be written without a targeted trigger, we know
before the setgen work starts rather than during it.

**Kill criterion.** A targeted trigger is a separate bead landing between C and D. It is never a
widening of `mtg-bc2.132.2` mid-flight.

**Closed (2026-08-13).** `mtg-bc2.132.6` landed it as its own bead, as the kill criterion required.
The estimate above was right about the shape and wrong about one thing: **the reducer's contract did
not need restating.** "The reducer returns only when a player owes a decision" is exactly what the
two new stops do — a trigger owing targets and a "you may" awaiting an answer are both decisions a
player owes, and `settle` was already able to return from inside itself with `awaiting` set, which is
how `cleanupStep` has always asked for a discard. What the contract forbids is returning when nobody
owes anything, and neither stop does that. `reduce.ts`'s header now says so under a heading of its
own rather than leaving the next reader to reconcile the sentence with the code.

The rest of the estimate held. `AwaitKind` gained two members rather than one — `triggerTargets` and
`optionalTrigger`, the same ability at two different moments, one before either player has priority
over it and one during its resolution — and `Decision` gained the matching two, plus two `Action`
variants, two `validateAction` arms, three events (`triggerTargetsChosen`, `triggerDeclined`,
`triggerRemoved`), a UI prompt, the greedy and random bot policies, and the replay narration. Neither
stop needed a new field on `GameState`: both questions are derived from the stack, so
`stateFingerprint`, the snapshot schema and the replay log's `StackEntrySchema` did not move, and the
recorded fixtures under `packages/ui/test/replay/fixtures/` did not need regenerating. A trigger
whose targets would all be illegal is removed instead of asked (CR 603.3b), which emits
`triggerRemoved` rather than `spellFizzled` — a spell that fizzles resolved and did nothing, while
this ability never resolved at all. Played by `packages/kernel/test/targeted-triggers.test.ts`,
`packages/sim/test/bot-trigger-targets.test.ts` and `packages/ui/test/play/trigger.test.ts`.

### Risk 3 — the bots do not use the mechanic, and the balance gate stays green anyway

**Why it could be bigger than it looks.** This is the failure that produces a confident wrong answer.
`packages/kernel/src/simple-agent.ts:134-156` scores enumerated options; a new `activateAbility` arm
scoring 0 or negative means the bot never activates anything. `npm run test:balance` then plays
10,035 seeded games over a set whose mechanic never fires, reports healthy win-rate bands, and we
ship a set nobody has actually playtested. The same applies to `@mtg/sim`'s policies
(`packages/sim/src/policies/cast.ts:46` already string-compares `'pumpUntilEndOfTurn'` to find combat
tricks, and would not recognize one wrapped in an ability).

**Observation that tells us early.** The balance run must assert a *usage floor*: the
`abilityTriggered` and activation events appear in the seeded logs at a nonzero rate proportional to
how many cards carry abilities. The event log is already the kernel's output (`events.ts:1-9`) and
`eventsOfType` (`events.ts:134-142`) makes the query one line.

**Kill criterion.** If the usage floor cannot be met by a scoring heuristic — if the bot genuinely
cannot tell when to activate — then the mechanic's balance numbers are not evidence, and slice D
should not run until the bot tier can play it.

**Measured for the trigger stops (2026-08-13).** `mtg-bc2.132.6`'s two decision kinds are the same
trap one layer down: an arm that returns a flat score answers the question and aims at nothing.
`packages/sim/test/bot-trigger-targets.test.ts` plays eight seeded games through `playSimGame` with a
recorder around the real greedy bot and counts the actions it submitted: 21 triggers aimed, 18 of
them at a creature that bot controls, 13 optional triggers taken and 1 declined. The scenario tests
beside it hold the aim to the effect rather than to the enumeration order — a `putCounters` trigger
goes on the bot's own creature and a `dealDamage` trigger goes at the opponent's, from one policy on
one board — because "the bot answered" and "the bot played the mechanic" are different claims and
only the second is worth a balance number.

### Two smaller ones worth naming

**Enumeration growth.** `castOptions` caps at `DEFAULT_ENUMERATION_CAP = 512` per cast
(`enumerate.ts:11`). Activations multiply the option list at *every* priority window, not just on
your own turn. Watch `npm run test:balance` wall time across slice C and watch `Decision.complete`
going false — the kernel already reports truncation honestly (`enumerate.ts:4-8`), so the signal
exists.

**A `z.strictObject` with no compile-time link to the kernel.**
`packages/ui/src/routes/replay/log-schema.ts:288` declares `StackEntrySchema` as a *strict* object.
Adding `ability` to `StackEntry` (§3.3) will make the replay viewer reject its own logs at runtime,
with no typecheck failure anywhere. It is one line to fix and zero lines to notice.

---

## 10. Summary of the change surface

Compile-error sites, which is where the invariant is actually enforced. Everything in this table
fails `npm run typecheck` rather than a test, and that is the point.

| Package | Site | Why it breaks |
|---|---|---|
| `@mtg/dsl` | `oracle.ts:72` `targetPhrase`, `validate/effects.ts:21` `LEGAL_TARGETS`, `exhaustive.ts` | `TARGET_KINDS` gains `self` |
| `@mtg/kernel` | `effects.ts:43` `matchesTargetKind`, `legal.ts:92` `targetChoicesFor` | same |
| `@mtg/kernel` | `simple-agent.ts:136`, `legal.ts:372` `validateAction`, `reduce.ts:143` `applyAction` | `Action` gains `activateAbility` |
| `@mtg/ui` | `routes/replay/narrate.ts:208` (events), `:238` (actions) | both unions grow |
| `@mtg/ui` | `routes/play/prompt.ts:102` `labelOf`, `:82` `oidsOf` | exhaustive-return, not `assertNever` — the error message will be confusing |
| `@mtg/forge-export` | `vocabulary-map.ts:262` `FORGE_TARGETS_BY_EFFECT` | total `Record` over `EffectKind × TargetKind`, plus `test/conformance.test.ts:47` |
| `@mtg/setgen` | `prompts.ts:56` `EFFECT_RANGES`, `assemble.ts:177` | total `Record`; new `Filled*` variant |

Runtime-only sites, which is where it is not enforced and therefore where the bugs will be:

| Package | Site | Failure mode |
|---|---|---|
| `@mtg/setgen` | `validate/composition.ts:175-182` `mechanicMatches` | reports `MECHANIC_ABSENT_AT_COMMON` for a set that is full of the mechanic |
| `@mtg/setgen` | `validate/pie.ts:39-42`, `validate/nwo.ts:39-50`, `validate/conformance.ts:76-89` | ability content is invisible to the color-pie, complexity and conformance checks |
| `@mtg/ui` | `routes/replay/log-schema.ts:288` `z.strictObject` | replay parsing rejects its own logs |
| `@mtg/ui` | `card/Card.ts:84,90` | bolds the wrong line if abilities ever precede keywords |
| `@mtg/dsl` | `fingerprint.ts:31-55` `normalize` | closed: `sortAbilities` orders `abilities` before hashing, so authored order no longer escapes `DUPLICATE_FINGERPRINT`; see §1.7 |
| `@mtg/kernel` | `zones.ts:442` `createToken`, `scenario.ts:76` `addObject` | two bypasses of `moveObject`: no ETB trigger for tokens, no static registration in scenarios. Both closed; see the note in §3.1 |
| `@mtg/deckbuild` | `evaluate.ts:126-128` `isRemovalCard` | an ability-shaped removal card is not counted as removal |
| `@mtg/sim` | `policies/cast.ts:46` | an ability-wrapped combat trick is not held for combat |

Packages that need **no** change: `@mtg/metrics`, `@mtg/decklab`, `@mtg/cube`, `@mtg/draft-export`
(which inherits ability text through `renderOracleText` at
`packages/draft-export/src/custom-cards.ts:70`, and inherits its `rating` through `evaluateCard`).
