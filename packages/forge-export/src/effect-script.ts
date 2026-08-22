/**
 * Effect primitive -> Forge ability line, and the table that says what each
 * primitive *is* to Forge.
 *
 * The table and the writers are one declaration per primitive rather than a
 * `Record` in `vocabulary-map.ts` read by a `switch` here, for the reason
 * `@mtg/dsl`'s `counters.ts` gives at its own `DECLARATIONS`: a vocabulary read
 * as data costs one edit to extend, a vocabulary dispatched on costs one edit
 * per dispatch site, and the second number is the one that grows with the
 * engine. Adding a primitive is now a row in `FORGE_EFFECTS` and nothing else in
 * this package.
 *
 * `FORGE_EFFECTS` is a total mapped type over `AnyEffectKind`, so a primitive
 * added to `@mtg/dsl` without a Forge form is a compile error here exactly as
 * the `assertNever` default used to be. The runtime table lookups still guard
 * for `undefined` because unvalidated input (LLM output, JSON on disk) can carry
 * values the types promise are impossible.
 */
import type {
  AnyEffectKind,
  Amount,
  Effect,
  EffectScope,
  PumpAmount,
  TargetFilter,
  TargetKind,
  TargetSpec,
  TokenSpec,
} from '@mtg/dsl';
import {
  hasTarget,
  isLiteralAmount,
  isRateAmount,
  isReferentTarget,
  isSourceBodyOnlyTarget,
  isSpaceScope,
  requiresDistinctTarget,
  targetFilterOf,
  targetRestrictionOf,
  tokenAbilities,
} from '@mtg/dsl';
import type { ForgeAbility, ForgeParam } from './script-text';
import { isScriptSafe, params } from './script-text';
import type { TranspileRejection } from './rejection';
import { rejection } from './rejection';
import {
  FORGE_CARD_DESTINATIONS,
  FORGE_COUNTER_TYPES,
  FORGE_GRAVEYARD_OWNER_QUALIFIERS,
  FORGE_GRAVEYARD_OWNERS,
  FORGE_GRANTABLE_KEYWORDS,
  FORGE_KEYWORDS,
  FORGE_LIBRARY_POSITIONS,
  FORGE_MANA_PRODUCED,
  FORGE_PLAYER_SCOPE_DEFINED,
  FORGE_SCOPE_CHANGE_TYPES,
  FORGE_SCOPE_ORIGINS,
  FORGE_SCOPED_EFFECT_APIS,
  FORGE_VALID_TARGETS,
  forgeFilteredTargets,
  forgeRestrictedTarget,
  forgeSearchType,
  forgeSweepSelector,
  forgeTargetRestriction,
  unmappedFilterField,
} from './vocabulary-map';
import { transpileAbility } from './ability-script';
import { NO_COMPUTED_AMOUNTS, REMEMBER_CHANGED, type ComputedAmounts } from './remember';
import { forgeTokenScriptName } from './naming';

export interface ForgeEffectScript {
  readonly ability: ForgeAbility;
  /**
   * A second Forge ability this one DSL effect needs, chained straight after
   * the first.
   *
   * One primitive is one Forge API almost everywhere, and the hold on a tap is
   * the exception Forge itself makes: `frost_breath.txt` and `sleep.txt` both
   * write the tap and then a `Pump`/`PumpAll` carrying the hidden keyword, and
   * there is no parameter on `Tap` that says it. A second link rather than a
   * second effect in the DSL, because the DSL has one effect here and the card
   * has one sentence; splitting it into two would put the seam in the wrong
   * language.
   *
   * The chain builders append it in the position the effect occupies, so a
   * card whose second effect draws a card still reads tap, hold, draw.
   */
  readonly follow?: ForgeAbility;
  /** Token this effect creates; the set export writes it as a token script. */
  readonly token?: TokenSpec;
}

export type EffectScriptResult =
  | { readonly ok: true; readonly value: ForgeEffectScript }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

/** `+2` / `-1`: Forge's signed form for `NumAtt$` / `NumDef$`. */
function signed(delta: number): string {
  return delta < 0 ? String(delta) : `+${delta}`;
}

/**
 * The clause that turns a single-object API into a sweep: the group named by
 * `ValidCards$`.
 *
 * Two shapes, because the DSL's two kinds of scope are two kinds of Forge
 * ability. A scope that reads a targeted player keeps the `ValidTgts$` its own
 * target slot wrote and names the group unqualified beside it — which player's
 * creatures those are is the target's job, and `FORGE_SCOPE_CHANGE_TYPES` in
 * `vocabulary-map.ts` has the four cards that settle the spelling. A scope that
 * names a region of the board **drops the target clause outright**: it chooses
 * nothing (CR 115.1), the eight printed sweepers in `res/cardsfolder` carry no
 * `ValidTgts$` at all, and passing `ctx.targeting` here would write the
 * `Defined$ You` a `noTarget` slot maps to and aim a wrath at its caster.
 *
 * The scoped zone moves share neither: those write the group as `ChangeType$`
 * under a different API and carry an `Origin$` besides.
 */
function sweepSelection(
  ctx: EffectScriptContext,
  scope: EffectScope,
  filter: TargetFilter | undefined,
): readonly ForgeParam[] | null {
  if (!isSpaceScope(scope)) {
    return [...ctx.targeting, ...params(['ValidCards', FORGE_SCOPE_CHANGE_TYPES[scope]])];
  }
  if (filter === undefined) return null;
  const selector = forgeSweepSelector(scope, filter);
  return selector === null ? null : params(['ValidCards', selector]);
}

/**
 * A conjunctive printed card type, refused by name.
 *
 * `allCardTypes` says "artifact creature": one object that is both. Forge's
 * selector grammar plausibly writes that as `Creature.Artifact`, and plausibly
 * is the whole problem — every mapping in `vocabulary-map.ts` is read off
 * `res/cardsfolder`, that corpus is not in this checkout, and a parity oracle
 * that invents a selector reports a mismatch as agreement. So the DSL grew the
 * field (`mtg-nhyv.2`) and the exporter names the gap instead of guessing at
 * it; writing the mapping belongs to `mtg-17a`, which is where every other
 * unverified row here already is.
 */
const UNMAPPED_FILTER_REASONS: Readonly<Record<NonNullable<ReturnType<typeof unmappedFilterField>>, string>> =
  {
    allCardTypes:
      'a conjunctive card type ("allCardTypes") has no Forge selector attested in res/cardsfolder, and this exporter does not guess one',
    keywords:
      'a keyword narrowing ("keywords") has no Forge selector attested in res/cardsfolder, and this exporter does not guess one',
  };

/**
 * A filter with no Forge selector, refused by the field that caused it.
 *
 * `unmappedFilterField` owns the list and this owns the sentences, so a field
 * added there without a sentence here fails to compile rather than exporting a
 * card with an empty reason. The alternative — one message naming the
 * conjunction, which is what this was until `mtg-nhyv.62` — told an author to
 * rewrite a card type on a card that carried none.
 *
 * The rejections rather than a whole result, because the three sites that call
 * it return two different result shapes: a target clause is assembled into an
 * effect's params and an effect script is not. Both hold `rejections`, so the
 * refusal is written once and each site wraps it in its own `ok: false`.
 */
function unmappedFilterRejections(
  ctx: { readonly cardId: string },
  at: string,
  filter: TargetFilter | undefined,
): readonly TranspileRejection[] {
  const field = filter === undefined ? null : unmappedFilterField(filter);
  if (field === null) throw new Error(`${ctx.cardId}: ${at} has a Forge selector and was refused anyway`);
  return [rejection('UNMAPPED_EFFECT_KIND', ctx.cardId, at, UNMAPPED_FILTER_REASONS[field])];
}

/**
 * A sweep whose `ValidCards$` cannot be written, refused by name and by cause.
 *
 * Two causes, and the messages are separate because the fixes are: a space
 * scope with no `scopeFilter` beside it names a region and not which permanents
 * in it, and a `scopeFilter` carrying a conjunctive card type or a keyword
 * names permanents this exporter has no attested selector for.
 *
 * `checkSpaceScope` (`@mtg/dsl`) already refuses the first card, so nothing
 * valid reaches here — but this transpiler runs on whatever it is handed, and
 * the one thing a parity oracle must not do is quietly widen a card.
 * `ValidCards$ Permanent` is what a defaulted empty filter would emit, and that
 * is a Forge script that destroys the lands too.
 */
function unwritableSweepRejection(
  ctx: EffectScriptContext,
  scope: EffectScope,
  filter: TargetFilter | undefined,
): EffectScriptResult {
  if (filter !== undefined && unmappedFilterField(filter) !== null) {
    return { ok: false, rejections: unmappedFilterRejections(ctx, `${ctx.path}.scopeFilter`, filter) };
  }
  return {
    ok: false,
    rejections: [
      rejection(
        'UNMAPPED_EFFECT_KIND',
        ctx.cardId,
        `${ctx.path}.scopeFilter`,
        `scope "${scope}" names a region of the board and this effect carries no scopeFilter saying which permanents in it, so there is no Forge ValidCards selector to write`,
      ),
    ],
  };
}

/**
 * A zone move whose scope names a region of the board, refused by name.
 *
 * `ChangeZoneAll` needs an `Origin$`, and a space scope has no zone to give it:
 * `FORGE_SCOPE_ORIGINS` is keyed `TargetedPlayerScope` for exactly that reason,
 * so this arm exists rather than a lookup that could not be written. The DSL
 * refuses the combination too (`SCOPES_LEGAL_ON` admits no space scope on
 * either zone-move primitive), so this is the belt to that suspenders — and a
 * parity oracle that dropped the scope and exported the unscoped card would
 * report a mismatch as agreement, which is worse than the gap.
 */
function spaceScopeZoneMoveRejection(ctx: EffectScriptContext, scope: EffectScope): EffectScriptResult {
  return {
    ok: false,
    rejections: [
      rejection(
        'UNMAPPED_EFFECT_KIND',
        ctx.cardId,
        `${ctx.path}.scope`,
        `Forge writes a scoped zone move as ChangeZoneAll with an Origin$, and scope "${scope}" names a region of the board rather than a zone to read from; there is no Forge form for this combination`,
      ),
    ],
  };
}

interface TargetContext {
  readonly cardId: string;
  readonly path: string;
}

/**
 * What a writer is handed: its own row's `api`, the target clause already
 * resolved against that row's `targets`, and where the effect sits for the
 * rejection messages.
 *
 * The targeting is resolved once, before dispatch, rather than by each writer:
 * every targeted primitive resolves it identically and the two rows that do not
 * take the clause (`counterSpell` writes its own, `createToken` has no target)
 * simply ignore it.
 */
interface EffectScriptContext extends TargetContext {
  readonly api: string;
  readonly targeting: readonly ForgeParam[];
  /**
   * How the enclosing card spells a quantity this effect cannot count from its
   * own fields, and whether what this effect moves is counted later
   * (`remember.ts`). Chains that carry no such protocol pass
   * `NO_COMPUTED_AMOUNTS`, under which every computed quantity rejects exactly
   * as it did before the protocol existed.
   */
  readonly computed: ComputedAmounts;
}

/** The one effect the union carries for a given kind. */
type EffectOf<K extends AnyEffectKind> = Extract<Effect, { readonly kind: K }>;

/**
 * Everything the transpiler needs to know about one DSL effect primitive.
 *
 * One declaration rather than a table plus a `switch` arm somewhere else, for
 * the reason `@mtg/dsl`'s `CounterDeclaration` is one: a primitive's Forge form
 * is a single fact with several parts, and splitting it made adding a primitive
 * several separate compile errors in several separate places that a reader had
 * to know to look for. The compiler now asks for all of it at the one site, and
 * a row that answers some of it does not build.
 */
export interface ForgeEffectMapping<K extends AnyEffectKind = AnyEffectKind> {
  /** Forge `ApiType` (`res/cardsfolder`, e.g. Shock's `DealDamage`). */
  readonly api: string;
  /**
   * Which targeting modes this transpiler can express for the effect.
   *
   * Deliberately stated here rather than read from `@mtg/dsl`'s
   * `LEGAL_TARGETS`: the two are asserted equal by a conformance test, so
   * widening the DSL's legality without extending the Forge mapping fails a
   * test instead of producing a script that silently drops the target.
   */
  readonly targets: readonly TargetKind[];
  /**
   * `DeckHas` hint Forge's deck AI reads, or `null` when the shipped corpus
   * carries none for this effect. `null` rather than an absent field, so the
   * row states the answer instead of leaving it to be inferred from a gap.
   */
  readonly deckHas: string | null;
  /** The ability line itself, or the named reason there is none. */
  readonly script: (effect: EffectOf<K>, ctx: EffectScriptContext) => EffectScriptResult;
}

/**
 * The Forge form of every DSL effect primitive.
 *
 * A mapped type rather than `Record<AnyEffectKind, ForgeEffectMapping>` so each
 * row's writer is checked against the effect shape *that row* carries: the
 * `dealDamage` writer sees an `amount` and the `putCounters` writer sees a
 * `counter`, without either narrowing the union by hand. Being mapped over the
 * whole union also makes a missing row a compile error, which is what the
 * `assertNever` default on the old `switch` bought.
 */
export type ForgeEffectTable = { readonly [K in AnyEffectKind]: ForgeEffectMapping<K> };

/**
 * One row of the table with the caller's kind unknown: the union of every row,
 * not `ForgeEffectMapping<AnyEffectKind>`.
 *
 * The difference is `script`'s parameter, which is contravariant — a row whose
 * writer takes only a `dealDamage` is not a row whose writer takes any effect —
 * so the widened row type is unwritable and only the union is. `api`, `targets`
 * and `deckHas` read straight off it; `script` needs the assertion in
 * `transpileEffect`.
 */
type ForgeEffectRow = ForgeEffectTable[AnyEffectKind];

export const FORGE_EFFECTS: ForgeEffectTable = {
  dealDamage: {
    api: 'DealDamage',
    targets: [
      'anyTarget',
      'targetCreature',
      'targetPlayer',
      'targetOpponent',
      'targetPlayerOrPlaneswalker',
      'noTarget',
      'thatCreaturesController',
    ],
    deckHas: null,
    script: (effect, ctx) => {
      const damage = forgeNumber(effect.amount, ctx.computed);
      if (damage === null) return computedRejection(ctx.cardId, `${ctx.path}.amount`);
      const dealt = params(['NumDmg', damage]);
      if (effect.scope === undefined) return ok(ctx.api, [...ctx.targeting, ...dealt]);
      // Aggravate's line, which is this row scoped: the same `NumDmg$` under
      // `DamageAll` with the group named beside the target.
      //
      // No `ValidPlayers$ Targeted`, which is the parameter that would burn the
      // targeted player as well. The DSL's scope reads "each creature that
      // player controls" and stops there; the cards that mean both say both,
      // and adding the key here would make the Forge card hit for damage the
      // kernel never deals.
      const damageGroup = sweepSelection(ctx, effect.scope, effect.scopeFilter);
      if (damageGroup === null) return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
      return ok('DamageAll', [...damageGroup, ...dealt]);
    },
  },
  destroyPermanent: {
    api: 'Destroy',
    // Disenchant is `A:SP$ Destroy | ValidTgts$ Artifact,Enchantment` in
    // 2.0.14's own `res/cardsfolder`, so the artifact-or-enchantment kind takes
    // this row's existing API and only the selector changes.
    targets: [
      'targetCreature',
      'targetPlayer',
      'targetOpponent',
      'targetArtifactOrEnchantment',
      'targetPermanent',
      'noTarget',
    ],
    deckHas: null,
    // Scoped, this is Mogg Infestation's first line: a different API, because
    // Forge separates destroying one permanent from destroying a group and the
    // DSL folds both into one primitive plus a scope word.
    //
    // No `NoRegen$ True`, which the two-sided wraths carry. The DSL primitive
    // is CR 701.7b destruction and nothing else, and the kernel's arm goes
    // through `destroyPermanent`, which spends a regeneration shield when the
    // permanent has one. Suppressing it here would be a card that reads one way
    // in Forge and another in the kernel, which is the single thing this
    // transpiler exists to avoid.
    script: (effect, ctx) => {
      if (effect.scope === undefined) return ok(ctx.api, ctx.targeting);
      const group = sweepSelection(ctx, effect.scope, effect.scopeFilter);
      return group === null
        ? unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter)
        : ok('DestroyAll', group);
    },
  },
  pumpUntilEndOfTurn: {
    api: 'Pump',
    // `selfCreature` is listed here, unlike `triggeringCreature` elsewhere in
    // this table: that kind is refused from `legalTargetsFor` on both sides of
    // the conformance check (`forge-export/test/triggering-creature.test.ts`)
    // because its legality is gated per triggered condition, not per effect
    // kind, so no per-effect-kind table — Forge's or the DSL's — is the right
    // place to say it is legal. `selfCreature` is different: `pumpUntilEndOfTurn`
    // hand-authors it into `legalTargetsFor` (`validate/effects.ts`), so this
    // row must agree or `conformance.test.ts`'s drift alarm catches the gap.
    // `targetParams` (below) still routes it to `Defined$ Self` before this
    // array is ever consulted for real target selection; the entry exists
    // purely to keep the two legality tables in agreement.
    targets: [
      'targetCreature',
      'targetCreatureDefendingPlayerControls',
      'targetPlayer',
      'targetOpponent',
      'selfCreature',
      'noTarget',
    ],
    deckHas: null,
    script: (effect, ctx) => {
      // A rate refuses under its own code when it refuses at all, because the
      // general message enumerates the countable shapes and a rate's missing
      // half is never the count — it is the tally the multiplier is charged
      // against. Both magnitudes are spelled before either is judged so the
      // refusal names the effect rather than whichever half was read first.
      const rated = isRateAmount(effect.power) || isRateAmount(effect.toughness);
      const attack = pumpNumeral(effect.power, ctx.computed);
      const defense = pumpNumeral(effect.toughness, ctx.computed);
      if (attack === null) {
        return rated
          ? rateRejection(ctx.cardId, ctx.path)
          : computedRejection(ctx.cardId, `${ctx.path}.power`);
      }
      if (defense === null) {
        return rated
          ? rateRejection(ctx.cardId, ctx.path)
          : computedRejection(ctx.cardId, `${ctx.path}.toughness`);
      }
      // The keyword rider goes on the same line rather than into a second
      // `SubAbility`, and Forge is the reason it can: `Pump` is "until end of
      // turn, this creature gets and/or gains", so `NumAtt`, `NumDef` and `KW`
      // are three parameters of one API. That is also the far end of the
      // argument for the rider being a field rather than a second effect kind —
      // one chosen target on our side compiles to one targeted line on Forge's,
      // and the two-effect spelling compiles to two lines that each choose.
      // `FORGE_KEYWORDS` is the same table the grant kind and a printed `K:`
      // line read, so a rider and a printed keyword spell identically.
      const rider = effect.keyword === undefined ? [] : params(['KW', FORGE_KEYWORDS[effect.keyword]]);
      const deltas = [...params(['NumAtt', attack], ['NumDef', defense]), ...rider];
      if (effect.scope === undefined) return ok(ctx.api, [...ctx.targeting, ...deltas]);
      // Arms of Hadar, which is this row scoped: the same two deltas over a
      // named group under `PumpAll` instead of over one target under `Pump`.
      // Both APIs last until end of turn on their own, so neither line says so.
      const pumpedGroup = sweepSelection(ctx, effect.scope, effect.scopeFilter);
      if (pumpedGroup === null) return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
      return ok('PumpAll', [...pumpedGroup, ...deltas]);
    },
  },
  drawCards: {
    api: 'Draw',
    targets: ['noTarget', 'targetPlayer'],
    deckHas: null,
    // `players` is Temple Bell, and Forge writes it the short way: `A:AB$ Draw |
    // Cost$ T | NumCards$ 1 | Defined$ Player`. `FORGE_PLAYER_SCOPE_DEFINED` is
    // which seats that word names, and it is a table rather than a literal so
    // the second scope is a lookup here rather than an edit; either way the
    // sweep replaces the target clause rather than qualifying it, because the
    // `noTarget` slot beside it would otherwise write `Defined$ You` and draw
    // for one.
    script: (effect, ctx) =>
      effect.players === undefined
        ? numCards(effect.count, ctx)
        : numCards(effect.count, {
            ...ctx,
            targeting: params(['Defined', FORGE_PLAYER_SCOPE_DEFINED[effect.players]]),
          }),
  },
  gainLife: {
    api: 'GainLife',
    targets: ['noTarget', 'targetPlayer'],
    deckHas: 'LifeGain',
    script: (effect, ctx) => {
      const life = forgeNumber(effect.amount, ctx.computed);
      if (life === null) return computedRejection(ctx.cardId, `${ctx.path}.amount`);
      return ok(ctx.api, [...ctx.targeting, ...params(['LifeAmount', life])]);
    },
  },
  counterSpell: {
    api: 'Counter',
    targets: [],
    deckHas: null,
    // `TargetType$ Spell` fixes the base at `Card`, so the filter qualifies it
    // rather than replacing it — Essence Scatter is `ValidTgts$ Card.Creature`
    // and Negate is `ValidTgts$ Card.nonCreature`. This row writes its own
    // target clause instead of going through `targetParams`, because the
    // primitive carries no `TargetSpec` at all, so the filter is read here.
    script: (effect, ctx) => {
      const members =
        effect.spellFilter === undefined ? [] : forgeFilteredTargets('Card', effect.spellFilter, 'qualifier');
      if (members === null)
        return {
          ok: false,
          rejections: unmappedFilterRejections(ctx, `${ctx.path}.spellFilter`, effect.spellFilter),
        };
      return ok(
        ctx.api,
        params(
          ['TargetType', 'Spell'],
          ['ValidTgts', members.length === 0 ? 'Card' : members.join(',')],
          ['TgtPrompt', 'Select target spell'],
        ),
      );
    },
  },
  createToken: {
    api: 'Token',
    targets: [],
    deckHas: 'Token',
    script: (effect, ctx) => {
      if (!isLiteralAmount(effect.count)) return computedRejection(ctx.cardId, `${ctx.path}.count`);
      const rejections = tokenRejections(effect.token, ctx);
      if (rejections.length > 0) return { ok: false, rejections };
      const ability: ForgeAbility = {
        api: ctx.api,
        params: params(
          ['TokenAmount', String(effect.count)],
          ['TokenScript', forgeTokenScriptName(effect.token)],
          ['TokenOwner', 'You'],
        ),
      };
      return { ok: true, value: { ability, token: effect.token } };
    },
  },
  tapPermanent: {
    api: 'Tap',
    targets: ['targetCreature', 'targetPlayer', 'targetOpponent', 'thatCreature'],
    deckHas: null,
    // Dawnglare Invoker's activated ability is this row scoped, down to the
    // parameters: `TapAll` with the group beside the target, and tapping is the
    // whole of what the API does.
    //
    // The hold is a second link, because Forge writes it that way: Frost Breath
    // is `SP$ Tap` then `DB$ Pump`, Sleep is `SP$ TapAll` then `DB$ PumpAll`,
    // and in both the hold is a hidden keyword with a permanent duration rather
    // than a parameter on the tap.
    script: (effect, ctx) => {
      const tapGroup =
        effect.scope === undefined ? null : sweepSelection(ctx, effect.scope, effect.scopeFilter);
      if (effect.scope !== undefined && tapGroup === null)
        return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
      const tapped = tapGroup === null ? ok(ctx.api, ctx.targeting) : ok('TapAll', tapGroup);
      if (effect.doesNotUntap !== true || !tapped.ok) return tapped;
      return { ok: true, value: { ...tapped.value, follow: holdPump(effect.scope !== undefined) } };
    },
  },
  returnToHand: {
    api: 'ChangeZone',
    targets: ['targetCreature', 'targetArtifactOrEnchantment'],
    deckHas: null,
    script: (_effect, ctx) =>
      ok(ctx.api, [...ctx.targeting, ...params(['Origin', 'Battlefield'], ['Destination', 'Hand'])]),
  },
  millCards: {
    // `targetOpponent` rides the same `ValidTgts$` clause `targetPlayer` does
    // (`Player.Opponent` against `Player`, `FORGE_VALID_TARGETS`), so Mind
    // Sculpt's "target opponent mills seven cards" needs no second API and no
    // second parameter — only the DSL's permission, which arrived with the
    // hand-authored widening on this kind's rule.
    api: 'Mill',
    targets: ['noTarget', 'targetPlayer', 'targetOpponent'],
    deckHas: null,
    script: (effect, ctx) => numCards(effect.count, ctx),
  },
  putCounters: {
    api: 'PutCounter',
    // `noTarget` and `targetCreatureDefendingPlayerControls` arrive together
    // with the DSL's own widening (`mtg-hfex`, `mtg-fz3s`) and for the reasons
    // the neighboring rows already carry: the first is the untargeted sweep's
    // slot, the second is `Creature.DefenderCtrl` (`vocabulary-map.ts`), which
    // `pumpUntilEndOfTurn` has written since it was the only row that could.
    // Both must be listed or `conformance.test.ts`'s drift alarm catches the
    // gap against `legalTargetsFor('putCounters')`.
    targets: [
      'targetCreature',
      'targetCreatureYouControl',
      'targetOpponent',
      'selfPermanent',
      'noTarget',
      'targetCreatureDefendingPlayerControls',
    ],
    deckHas: null,
    script: (effect, ctx) => {
      const counters = FORGE_COUNTER_TYPES[effect.counter] ?? null;
      if (counters === null) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.counter`,
              `counter kind "${effect.counter}" has no Forge counters; what carrying one means is not a bundle of counters Forge ships`,
            ),
          ],
        };
      }
      // One counter takes Forge's singular key and several take the plural one,
      // which is how `res/cardsfolder` writes each case (`CounterType$ P1P1` on
      // Bond Beetle, `CounterTypes$ P1P1,Trample` on Champion of Dusan).
      //
      // How the two keys combine with `CounterNum$` is where they stop being
      // symmetric, and Forge 2.0.14's corpus is thin enough there that it rules
      // one form out without demonstrating the one this writes.
      //
      // The singular key is settled: `CounterType$ X | CounterNum$ 3` is three
      // of X, written that way 3,884 times. The plural key is not. It appears
      // on 19 lines (a twentieth grep hit is `AllCounterTypes$`, a different
      // key), two of which are `CounterTypes$ EachType_…`, a rule rather than a
      // list. Of the 17 that name kinds, 2 name one and 15 name several; of
      // those 15, eight carry `CounterNum$ 1`, one splits a total with
      // `CounterNum$ X | SplitAmount$ True`, and six carry no `CounterNum$` at
      // all. What that rules out is the alternative this could have emitted:
      // no multi-kind list anywhere in 2.0.14 carries a `CounterNum$` above 1.
      //
      // Exactly one shipped script repeats a kind inside the list, Scavenged
      // Brawler's graveyard ability, and it writes
      // `CounterTypes$ P1P1,P1P1,P1P1,P1P1,Flying,Vigilance,Trample,Lifelink`
      // with no `CounterNum$`. So the two halves of what this emits are each
      // shown separately and never together: the repetition by Brawler without
      // `CounterNum$`, and `CounterNum$ 1` beside a list by the eight, none of
      // which repeats. A part placed three times therefore repeats the list
      // three times rather than raising a `CounterNum$` no card raises beside a
      // list, and whether the trailing `CounterNum$ 1` is redundant or wrong is
      // the same standing gap the rest of this file carries: read off
      // `res/cardsfolder`, not off a game Forge ran.
      if (!isLiteralAmount(effect.count)) return computedRejection(ctx.cardId, `${ctx.path}.count`);
      // A scoped placement is a different Forge API for the reason a scoped
      // exile is: Forge separates acting on one object from acting on a group,
      // and the DSL folds both into one primitive plus a scope word. Only the
      // two battlefield scopes reach here (`SCOPES_LEGAL_ON`, `@mtg/dsl`), so
      // the `ValidCards$` qualifier is either the one the scoped
      // `ChangeZoneAll` writes for its `ChangeType$` or the sweep selector the
      // four wraths write. Unverified against a booted Forge, like every row in
      // this file.
      const api = effect.scope === undefined ? ctx.api : 'PutCounterAll';
      // The `scopeFilter` is handed over rather than dropped: `mtg-hfex` gave
      // this primitive `permanentsYouControl`, and a space scope with no filter
      // beside it is the one case `sweepSelection` answers `null` to, which is
      // Steel Overseer's line written as a counter on every land its caster
      // controls.
      const scoped =
        effect.scope === undefined ? null : sweepSelection(ctx, effect.scope, effect.scopeFilter);
      if (effect.scope !== undefined && scoped === null)
        return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
      const selection = scoped ?? ctx.targeting;
      const [only, ...rest] = counters;
      if (rest.length === 0) {
        const singular: ForgeParam = ['CounterType', only];
        return ok(api, [...selection, ...params(singular, ['CounterNum', String(effect.count)])]);
      }
      const repeated = Array.from({ length: effect.count }, () => counters).flat();
      const plural: ForgeParam = ['CounterTypes', repeated.join(',')];
      return ok(api, [...selection, ...params(plural, ['CounterNum', '1'])]);
    },
  },
  exileTarget: {
    // Forge moves an object between zones with one API and a `Destination$`, so
    // exile is `ChangeZone` the way `returnToHand` is. Unverified against a
    // booted Forge, like every row here.
    api: 'ChangeZone',
    // Altar's Light is `A:SP$ ChangeZone | ValidTgts$ Artifact,Enchantment |
    // Destination$ Exile`, which is this row with one selector swapped.
    targets: ['targetCreature', 'targetOpponent', 'targetArtifactOrEnchantment', 'targetPermanent'],
    deckHas: null,
    // The same `ChangeZone` with the destination changed, which is how
    // `res/cardsfolder` writes every exile-a-creature spell — and a different
    // API entirely once the effect is scoped, because Forge separates moving one
    // object from moving a group and the DSL does not.
    script: (effect, ctx) => {
      // `RememberChanged$ True` only when a later clause counts what this one
      // exiled; `remember.ts` decides that from the whole chain, because this
      // writer can only see one effect.
      const remembered = ctx.computed.remembers ? [REMEMBER_CHANGED] : [];
      if (effect.scope === undefined) {
        return ok(ctx.api, [
          ...ctx.targeting,
          ...params(['Origin', 'Battlefield'], ['Destination', 'Exile']),
          ...remembered,
        ]);
      }
      if (isSpaceScope(effect.scope)) return spaceScopeZoneMoveRejection(ctx, effect.scope);
      return ok(FORGE_SCOPED_EFFECT_APIS[effect.scope], [
        ...ctx.targeting,
        ...params(
          ['ChangeType', FORGE_SCOPE_CHANGE_TYPES[effect.scope]],
          // The origin is the scope's, not the effect's: the DSL folds "where"
          // into the scope word and Forge spells it out.
          ['Origin', FORGE_SCOPE_ORIGINS[effect.scope]],
          ['Destination', 'Exile'],
        ),
        ...remembered,
      ]);
    },
  },
  revealHand: {
    // Forge's own name for CR 701.16a's action on a whole hand. Unverified against
    // a booted Forge, like every row in this file; `mtg-17a` is that check.
    api: 'RevealHand',
    targets: ['targetOpponent'],
    deckHas: null,
    // The targeting clause is the whole ability: which hand is the target, and
    // showing it is what the API does.
    script: (_effect, ctx) => ok(ctx.api, ctx.targeting),
  },
  scry: {
    /**
     * The one row in this file that is not taken on faith. Every other carries
     * the `mtg-17a` disclaimer because its spelling was reasoned out of Forge's
     * API names; this one was read off Forge's own shipped card data, which is
     * the corpus Forge itself parses at boot. 468 ability lines there scry, and
     * all of them spell it `Scry | ScryNum$ <n>`: Preordain is
     * `A:SP$ Scry | ScryNum$ 2`, Opt is the same line with a 1.
     *
     * `Defined$` is omitted, and that is the corpus's default rather than an
     * oversight: 448 of the 468 name no player at all, and the twenty that do
     * are pointing the scry at somebody other than the controller. The DSL
     * primitive takes no target, so the controller scries, so the parameter
     * that would say otherwise is absent.
     *
     * This row is why `mtg-q5yg` could promote `scry` into the generator's
     * vocabulary at all. A generated set is exported to Forge as the last step
     * of `npm run slice`, and a primitive that rejects there is a primitive
     * that fails the slice on any card the model prints it on.
     */
    api: 'Scry',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const depth = forgeNumber(effect.count, ctx.computed);
      if (depth === null) return computedRejection(ctx.cardId, `${ctx.path}.count`);
      return ok(ctx.api, params(['ScryNum', depth]));
    },
  },
  returnFromGraveyard: {
    // The scoped `exileTarget` arm with one destination changed, which is the
    // whole of it: Forge moves a group between zones with `ChangeZoneAll` and a
    // `Origin$`/`Destination$` pair, and a graveyard is one of the zones that
    // pair names. Control follows Forge's own default for the API — a card put
    // onto the battlefield this way arrives under its owner's control unless
    // `GainControl$` says otherwise — which is exactly what the DSL primitive
    // does and what its printed text says. Unverified against a booted Forge,
    // like every row in this file.
    api: 'ChangeZoneAll',
    targets: ['targetPlayer', 'targetOpponent'],
    deckHas: null,
    script: (effect, ctx) => {
      if (isSpaceScope(effect.scope)) return spaceScopeZoneMoveRejection(ctx, effect.scope);
      return ok(FORGE_SCOPED_EFFECT_APIS[effect.scope], [
        ...ctx.targeting,
        ...params(
          ['ChangeType', FORGE_SCOPE_CHANGE_TYPES[effect.scope]],
          ['Origin', FORGE_SCOPE_ORIGINS[effect.scope]],
          // The one parameter that reads the effect rather than the scope. It
          // was the literal `'Battlefield'` while the primitive had one
          // destination; a return to hand written as a return to the
          // battlefield is a strictly stronger Forge card than the DSL one,
          // which is the class of divergence this transpiler exists to avoid
          // producing silently.
          ['Destination', FORGE_CARD_DESTINATIONS[effect.destination ?? 'battlefield']],
        ),
      ]);
    },
  },
  fight: {
    api: 'Fight',
    targets: ['targetCreatureYouDontControl'],
    deckHas: null,
    // Affectionate Indrik, verbatim: `DB$ Fight | Defined$ TriggeredCardLKICopy
    // | ValidTgts$ Creature.YouDontCtrl`. `Defined$` is the other fighter, and
    // naming it is not optional — Forge's `Fight` takes two combatants and only
    // one of them is the target. `TriggeredCardLKICopy` is the corpus's own
    // spelling for "the permanent that triggered this", last known information
    // included, so a creature that dies to first strike before the trigger
    // resolves still fights with the power it had (CR 701.12c is the reverse
    // case: it deals no damage at all once it has left, which is the kernel's
    // arm rather than this line's).
    //
    // The `Defined$` value is what confines this row to a `selfEnters` trigger:
    // a fight on a sorcery would have to name the caster's chosen creature, and
    // `@mtg/dsl`'s `checkSourceBodyEffectInTrigger` refuses to print one.
    script: (_effect, ctx) => ok(ctx.api, [...params(['Defined', 'TriggeredCardLKICopy']), ...ctx.targeting]),
  },
  shuffleLibrary: {
    // Forge's own one-word API, with the player named because `Shuffle` takes
    // one: `Defined$ You` is what the corpus writes on a card that shuffles its
    // own controller's library, and the DSL primitive takes no target, so the
    // controller is who shuffles.
    api: 'Shuffle',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, params(['Defined', 'You'])),
  },
  revealTopCards: {
    // `PeekAndReveal` is Forge's API for looking at the top of a library and
    // showing what was there, which is CR 701.16a's action on that zone.
    // `PeekAmount$` is the depth and `RevealValid$ Card` is "all of them" — a
    // narrower spec would be a card that reveals some of what it looked at,
    // which the DSL primitive cannot print.
    api: 'PeekAndReveal',
    targets: [],
    deckHas: null,
    script: (effect, ctx) =>
      ok(ctx.api, params(['PeekAmount', String(effect.count)], ['RevealValid', 'Card'])),
  },
  putOnLibrary: {
    // Condemn's and Griptide's line: an ordinary `ChangeZone` off the
    // battlefield, with `LibraryPosition$` saying which end. The index is a
    // table lookup rather than a ternary (`FORGE_LIBRARY_POSITIONS`) so a third
    // position in the DSL fails to compile rather than falling to the bottom.
    api: 'ChangeZone',
    targets: ['targetCreature', 'targetArtifactOrEnchantment'],
    deckHas: null,
    script: (effect, ctx) =>
      ok(ctx.api, [
        ...ctx.targeting,
        ...params(
          ['Origin', 'Battlefield'],
          ['Destination', 'Library'],
          ['LibraryPosition', FORGE_LIBRARY_POSITIONS[effect.position]],
        ),
      ]),
  },
  addMana: {
    /**
     * Read off Forge's own shipped card data rather than reasoned out of an API
     * name, which puts this row beside `scry` as one of the two in this file
     * that are not taken on faith. Llanowar Elves is
     * `A:AB$ Mana | Cost$ T | Produced$ G`, Sol Ring is
     * `A:AB$ Mana | Cost$ T | Produced$ C | Amount$ 2`, and Dark Ritual is
     * `A:SP$ Mana | Cost$ B | Produced$ B | Amount$ 3`. One API for the
     * permanent's tap and the ritual alike, exactly as the DSL has one effect
     * for both.
     *
     * `Amount$` is omitted when the effect adds one, because the corpus omits
     * it: the parameter defaults to 1 and the thousands of one-mana lines do
     * not write it. Writing `Amount$ 1` everywhere would still parse, and would
     * still make every generated mana source diff against every hand-written
     * one for no reason a reader could act on.
     *
     * A source that offers several colors is `Produced$ Combo W U`, which is
     * Forge's spelling for a choice made as the ability resolves. That is the
     * same moment the kernel's `activateManaSource` narrows `produces` to the
     * color the action carried, so the two surfaces ask the same question even
     * though they ask it at different points in the activation.
     */
    api: 'Mana',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const produced = effect.produces.map((color) => FORGE_MANA_PRODUCED[color]);
      const [only] = produced;
      if (only === undefined) return computedRejection(ctx.cardId, `${ctx.path}.produces`);
      const choice = produced.length === 1 ? only : `Combo ${produced.join(' ')}`;
      const amount = forgeNumber(effect.amount, ctx.computed);
      if (amount === null) return computedRejection(ctx.cardId, `${ctx.path}.amount`);
      const quantity: readonly ForgeParam[] = amount === '1' ? [] : params(['Amount', amount]);
      return ok(ctx.api, [...params(['Produced', choice]), ...quantity]);
    },
  },
  exileGraveyard: {
    // The scoped-move shape without a scope: `ChangeZoneAll` from `Graveyard`
    // to `Exile`, with whose graveyard written into `ChangeType$` rather than
    // into a `ValidTgts$` clause. The DSL primitive names an owner by word and
    // takes no target (`exileGraveyardEffect`), so there is nothing for a
    // targeting clause to say and `ctx.targeting` is absent here on purpose —
    // `FORGE_GRAVEYARD_OWNERS` carries the whole answer.
    api: 'ChangeZoneAll',
    targets: [],
    deckHas: null,
    script: (effect, ctx) =>
      ok(
        ctx.api,
        params(
          ['ChangeType', FORGE_GRAVEYARD_OWNERS[effect.whose]],
          ['Origin', 'Graveyard'],
          ['Destination', 'Exile'],
        ),
      ),
  },
  shuffleGraveyardIntoLibrary: {
    // Refused rather than guessed, for `UNMAPPED_FILTER_REASONS`' reason. The
    // graveyard half looks like `exileGraveyard` with `Destination$ Library`
    // and a shuffle parameter beside it, but which parameter — `Shuffle$`,
    // `LibraryPosition$`, or neither because `ChangeZoneAll` into a library
    // shuffles on its own — is a fact about Forge's card scripts, and
    // `res/cardsfolder` is not in this checkout. The `includeSelf` half has no
    // single-effect spelling at all: a permanent moving itself alongside a zone
    // sweep is a `SubAbility` in every Forge script that does it, and this
    // table writes one ability per effect.
    api: 'ChangeZoneAll',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          ctx.cardId,
          ctx.path,
          'shuffling a graveyard back into a library has no Forge parameter attested in res/cardsfolder, and this exporter does not guess one',
        ),
      ],
    }),
  },
  searchLibrary: {
    // Demonic Tutor's line: `ChangeZone | Origin$ Library | Destination$ Hand |
    // ChangeType$ Card | ChangeNum$ 1 | Hidden$ True`. `Hidden$ True` is what
    // makes it a *search* rather than a move Forge performs itself — it is the
    // parameter that hands the choice to the player, which is the same fact the
    // kernel spells as a `PendingSearch` (`scry.ts`).
    //
    // `ChangeNum$` is the DSL's `count`, defaulting to the 1 every search
    // printed before the field existed. `Tapped$ True` is the third
    // destination's second half — Forge keeps the zone in `Destination$` and the
    // tap in its own parameter, which is why `FORGE_CARD_DESTINATIONS` maps
    // `battlefieldTapped` and `battlefield` to one string.
    //
    // `ShuffleNonMandatory$ True` is the shuffle. CR 701.19c shuffles whether
    // or not a card was found, and Forge's parameter name says "non-mandatory"
    // about the *find*, not about the shuffle: it is the key the corpus writes
    // on every tutor that lets its controller fail to find, which is every
    // tutor the DSL prints (`searchDecision` always offers `found: null`).
    api: 'ChangeZone',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const changeType = forgeSearchType(effect.filter);
      if (changeType === null) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.filter`,
              'a search filter naming two card types, two subtypes, two supertypes or two colors has no Forge spelling here; Forge writes an OR as a comma-separated list of whole specs and this transpiler writes one spec',
            ),
          ],
        };
      }
      const count = effect.count ?? 1;
      if (!isLiteralAmount(count)) return computedRejection(ctx.cardId, `${ctx.path}.count`);
      // CR 701.16a's reveal is refused rather than guessed at. Forge spells a
      // tapped arrival with a parameter this transpiler can name from the
      // corpus (`Tapped$ True`, on this same `ChangeZone` line); it spells a
      // search's reveal with something, and nothing in this checkout says what.
      // `tools/forge/README.md` keeps Forge a downloaded artifact and commits no
      // card scripts, so the corpus is not here to read, and a parameter name
      // invented from memory would export a card that either does nothing or
      // fails to parse — the kind of unevidenced cross-project claim this repo
      // refuses elsewhere. A named rejection is checkable; a guess is not.
      if (effect.reveal === true) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.reveal`,
              "a search that reveals what it found has no Forge spelling here; Forge's parameter for it is not derivable from this checkout, which vendors no card scripts, and a guessed parameter name would export a card nobody could run",
            ),
          ],
        };
      }
      return ok(
        ctx.api,
        params(
          ['Origin', 'Library'],
          ['Destination', FORGE_CARD_DESTINATIONS[effect.destination]],
          ['ChangeType', changeType],
          ['ChangeNum', String(count)],
          ['Hidden', 'True'],
          ...(effect.destination === 'battlefieldTapped' ? ([['Tapped', 'True']] as const) : ([] as const)),
          ['ShuffleNonMandatory', 'True'],
        ),
      );
    },
  },
  chooseFromGraveyard: {
    /**
     * Black Sun's Twilight's reanimation SVar, which is the corpus's own
     * spelling of a non-targeted fetch out of a graveyard: `ChangeZone |
     * Origin$ Graveyard | Chooser$ You | ChangeNum$ 1 | Destination$
     * Battlefield | Hidden$ True | ChangeType$ Creature.YouOwn+cmcLEX`.
     *
     * `Hidden$ True` on a *public* zone reads wrong and is right, and this is
     * the row that proves the parameter is misnamed rather than mis-used: it
     * is what hands the choice to a player instead of letting Forge perform
     * the move itself, which is the same fact the `searchLibrary` row above
     * spells out and the same fact the kernel spells as a pending record. It
     * is not a judgment call: 288 of the 291 `ChangeZone` lines in Forge
     * 2.0.14's `res/cardsfolder` that leave a graveyard by `ChangeType$`
     * rather than by target carry it. `Chooser$ You` then says *which* player,
     * which matters at `whose: 'opponent'`, where the cards are in the
     * opponent's graveyard and the controller is still the one picking.
     *
     * No `DefinedPlayer$`, because the corpus does not write one here: whose
     * graveyard is reachable rides in the `ChangeType$` qualifier
     * (`FORGE_GRAVEYARD_OWNER_QUALIFIERS`), and Dermotaxi's "a creature card
     * from a graveyard" is exactly the qualifier-free form. Adding
     * `DefinedPlayer$` would be a second place to say the same thing and a
     * second chance to say it differently.
     *
     * No shuffle, which is the whole difference from the row above: CR 701.19c
     * shuffles because a library search exposes a hidden zone, and a graveyard
     * is public (CR 400.2), so there is nothing to hide again afterwards.
     *
     * The divergence this row carries is the one `chooseFromGraveyard`'s own
     * docblock names: the DSL effect is a choice and not a target, so an
     * opponent cannot respond to it by making the chosen card illegal. Forge
     * agrees here — a `Chooser$` fetch is chosen on resolution, the way the
     * kernel does it — and it is the *printed* cards that disagree, since
     * Disentomb and Gravedigger are `ValidTgts$ Creature.YouCtrl` in the
     * corpus. An export of our Disentomb is therefore a slightly different
     * card from Forge's Disentomb, and that is the DSL's gap showing through
     * rather than this transpiler guessing.
     */
    api: 'ChangeZone',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const changeType = forgeSearchType(effect.filter, FORGE_GRAVEYARD_OWNER_QUALIFIERS[effect.whose]);
      if (changeType === null) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.filter`,
              'a graveyard filter naming two card types, two subtypes, two supertypes or two colors has no Forge spelling here; Forge writes an OR as a comma-separated list of whole specs and this transpiler writes one spec',
            ),
          ],
        };
      }
      return ok(
        ctx.api,
        params(
          ['Origin', 'Graveyard'],
          ['Destination', FORGE_CARD_DESTINATIONS[effect.destination]],
          ['ChangeType', changeType],
          ['ChangeNum', '1'],
          ['Hidden', 'True'],
          ['Chooser', 'You'],
        ),
      );
    },
  },
  /**
   * Mind Rot's line: `Discard | ValidTgts$ Player | NumCards$ 2 | Mode$
   * TgtChoose`.
   *
   * One API for both DSL kinds, which is Forge's arrangement rather than a
   * convenience taken here: `Discard` is CR 701.8 and `Mode$` is who chooses,
   * so the two rows below differ in one parameter and share everything else.
   * That is the same split `PendingHandDiscard` makes in the kernel, reached
   * independently, which is the closest thing to corroboration a row in this
   * file gets.
   *
   * `NumCards$` takes the printed count and not the clamped one. CR 701.8a's
   * "as many as possible" is the engine's job on both sides, and writing a
   * number this transpiler derived from a hand it cannot see would be a claim
   * about a position rather than about a card.
   *
   * Unverified against a booted Forge, like every row in this file except
   * `scry`; `mtg-17a` is that check. The `Mode$` values in particular were
   * reasoned from Forge's API vocabulary and not read out of the shipped
   * corpus, so they are the likeliest thing in these two rows to be wrong.
   */
  discardCards: {
    api: 'Discard',
    targets: ['noTarget', 'targetPlayer', 'targetOpponent'],
    deckHas: null,
    // `players` is Liliana's Specter, and it is written the way `drawCards` and
    // `loseLife` write theirs: `Defined$` replaces the target clause, because
    // `Mode$ TgtChoose` still means "the seat holding the hand chooses" whether
    // that seat was targeted or named. The `noTarget` slot admitted above is
    // the sweep's slot alone — `EFFECT_RULES` in `@mtg/dsl` refuses a bare one
    // — so this arm never writes `Defined$ You`.
    script: (effect, ctx) => {
      const targeting =
        effect.players === undefined
          ? ctx.targeting
          : params(['Defined', FORGE_PLAYER_SCOPE_DEFINED[effect.players]]);
      return ok(ctx.api, [
        ...targeting,
        ...params(['NumCards', String(effect.count)], ['Mode', 'TgtChoose']),
      ]);
    },
  },
  /**
   * Coercion's line: the row above with `Mode$ RevealYouChoose`, which is
   * Forge's name for the reveal and the choice together.
   *
   * One parameter carries both halves there, where the DSL prints the reveal as
   * part of `chooseDiscard`'s own meaning and the kernel emits a separate
   * `handRevealed` before it asks. Three spellings of one card, and the
   * difference is where each host draws the line between an effect and its
   * mechanism; none of them is a rider a set could print on its own.
   */
  chooseDiscard: {
    api: 'Discard',
    targets: ['targetOpponent'],
    deckHas: null,
    script: (effect, ctx) => {
      // Duress's narrow half is refused rather than guessed at, which is the
      // same call the `searchLibrary` row makes about a reveal two hundred lines
      // up and for the identical reason. `Mode$ RevealYouChoose` is attested;
      // the parameter that would restrict *which* revealed cards may be named is
      // not, because `res/cardsfolder` is a downloaded artifact this checkout
      // does not vendor (`tools/forge/README.md`). A guessed parameter name is
      // worse than a refusal by exactly the margin this lane was opened over: a
      // card that transpiles clean and discards something the printed sentence
      // protects.
      //
      // The refusal is keyed on the filter's presence rather than on its
      // contents, so a filter this exporter *could* spell as a `forgeSearchType`
      // is refused too. That is deliberate: the question here is not how to
      // write the class of cards, it is which Forge parameter the class goes in,
      // and knowing the first says nothing about the second.
      if (effect.filter !== undefined) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.filter`,
              'a hand choice restricted to some of the revealed cards has no Forge parameter attested in res/cardsfolder, and this exporter does not guess one; the unrestricted "Mode$ RevealYouChoose" line would discard cards the printed sentence protects',
            ),
          ],
        };
      }
      return ok(ctx.api, [
        ...ctx.targeting,
        ...params(['NumCards', String(effect.count)], ['Mode', 'RevealYouChoose']),
      ]);
    },
  },
  // `gainLife`'s row with Forge's other life API, and the same three parts.
  // `deckHas` is `null` rather than a mirror of `LifeGain`: the hint names what
  // a *deck* is built around, and the corpus writes `LifeGain` on cards that
  // gain it, not on cards that take it away.
  loseLife: {
    api: 'LoseLife',
    targets: ['noTarget', 'targetPlayer', 'targetOpponent', 'thatPlayer'],
    deckHas: null,
    // `players` is written the way `drawCards` writes it, because Forge's
    // `Defined$` is a definition selector rather than an API's own parameter:
    // `Defined$ Player` is every player at the table on `LoseLife` exactly as
    // it is on `Draw`, which is how the corpus scripts Howling Banshee. The
    // sweep replaces the target clause rather than qualifying it, for that
    // row's reason — the `noTarget` slot beside it would otherwise write
    // `Defined$ You` and take the life off one seat.
    script: (effect, ctx) => {
      const life = forgeNumber(effect.amount, ctx.computed);
      if (life === null) return computedRejection(ctx.cardId, `${ctx.path}.amount`);
      const targeting =
        effect.players === undefined
          ? ctx.targeting
          : params(['Defined', FORGE_PLAYER_SCOPE_DEFINED[effect.players]]);
      return ok(ctx.api, [...targeting, ...params(['LifeAmount', life])]);
    },
  },
  // The effect names no target, so the `Defined$ You` that `targetParams` would
  // have written for a `noTarget` slot is written here instead — the row has no
  // `ctx.targeting` to spread, for `counterSpell`'s reason.
  setLife: {
    api: 'SetLife',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const life = forgeNumber(effect.amount, ctx.computed);
      if (life === null) return computedRejection(ctx.cardId, `${ctx.path}.amount`);
      return ok(ctx.api, params(['Defined', 'You'], ['LifeAmount', life]));
    },
  },
  // Refused, and the refusal is the point.
  //
  // A turn-long blanket prevention is not an effect API in Forge's grammar at
  // all: it is a continuous replacement, which the corpus writes as an `SP$
  // Effect` that installs a named `ReplacementEffects$` line living on a
  // created effect object. This transpiler writes one `A:` ability line per DSL
  // effect and emits no `R:` lines and no effect objects, so there is no
  // shipped spelling here to write, and `FORGE_VALID_TARGETS`' rule applies:
  // every spelling in this package is read off the corpus rather than guessed.
  //
  // A guess would be worse than the rejection rather than merely riskier. This
  // artifact exists to disagree with the kernel when the kernel is wrong, and a
  // Fog that exported as a one-shot `PreventDamage` would prevent the first
  // instance and let the rest of the combat damage step through — a strictly
  // different card, booting cleanly, in the file whose whole job is to catch
  // that.
  preventCombatDamage: {
    api: 'PreventDamage',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          ctx.cardId,
          ctx.path,
          'a blanket "prevent all combat damage this turn" is a Forge replacement effect installed by an SP$ Effect, not an effect API; this transpiler emits no R: lines, and no corpus-sourced spelling for it exists here',
        ),
      ],
    }),
  },
  // The row above with one word changed and the refusal unchanged: a targeted
  // prevention is still a continuous replacement in Forge's grammar, aimed by
  // `ValidTgts$` rather than `Defined$` if this transpiler ever grew the `R:`
  // lines to write it, which it does not. `targets` is `['targetCreature']`
  // rather than `[]` so the conformance test still agrees with
  // `legalTargetsFor` while the refusal keeps this from ever reading that list.
  preventAllDamageToTarget: {
    api: 'PreventDamage',
    targets: ['targetCreature'],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          ctx.cardId,
          ctx.path,
          'a targeted "prevent all damage to target creature this turn" is a Forge replacement effect installed by an SP$ Effect, not an effect API; this transpiler emits no R: lines, and no corpus-sourced spelling for it exists here',
        ),
      ],
    }),
  },
  // `AB$ Pump | KW$ Flying`, which is the same Forge API the P/T version uses
  // with the deltas left off and a keyword put on: Forge's `Pump` is
  // "until end of turn, this creature gets and/or gains", and a line with only
  // `KW$` is the grant half of it. `FORGE_GRANTABLE_KEYWORDS` is what turns
  // `firstStrike` into `First Strike`, and it extends the same table a printed
  // `K:` line uses, so a granted keyword and a printed one spell identically in
  // the export. It is the grantable table rather than `FORGE_KEYWORDS` because
  // this field reaches the keyword abilities too: Cleaver Riot's own line in
  // 2.0.14's `res/cardsfolder` is `KW$ Double Strike`, which is spelled exactly
  // as its 129 printed `K:Double Strike` lines are.
  //
  // `selfCreature` is listed for `pumpUntilEndOfTurn`'s stated reason: the DSL
  // legalizes it, `targetParams` routes it to `Defined$ Self` before this array
  // is read for real selection, and the entry exists so the two legality tables
  // agree under `conformance.test.ts`. `noTarget` is there for the same reason
  // and arrived with the scope: it is the slot a card that chooses nobody
  // carries, and `sweepSelection` writes the group in its place.
  grantKeywordUntilEndOfTurn: {
    api: 'Pump',
    targets: ['targetCreature', 'targetCreatureYouControl', 'selfCreature', 'noTarget'],
    deckHas: null,
    // Scoped, this is `PumpAll` with the deltas left off — the same relationship
    // `Pump` and `PumpAll` have on the row above, and Forge's own
    // `res/cardsfolder` writes exactly that line for a mass grant with no
    // arithmetic on it: Cleaver Riot is `A:SP$ PumpAll | ValidCards$
    // Creature.YouCtrl | KW$ Double Strike`, and Overwhelming Stampede is the
    // same line with `NumAtt$`/`NumDef$` added back. Both APIs last until end
    // of turn on their own, so neither line says so. Corpus-sourced rather than
    // inferred from `Pump`'s parameter list, which is `FORGE_VALID_TARGETS`'
    // standing rule.
    script: (effect, ctx) => {
      const granted = params(['KW', FORGE_GRANTABLE_KEYWORDS[effect.keyword]]);
      if (effect.scope === undefined) return ok(ctx.api, [...ctx.targeting, ...granted]);
      const group = sweepSelection(ctx, effect.scope, effect.scopeFilter);
      if (group === null) return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
      return ok('PumpAll', [...group, ...granted]);
    },
  },
  // Two refusals, and `preventCombatDamage`'s reason is the whole of both.
  //
  // Forge does express these — a hidden-keyword `Pump` for the evasion, an
  // attack requirement API for the lure — but which parameter names it uses is
  // exactly what `res/cardsfolder` would settle and that corpus is not in this
  // checkout. `FORGE_VALID_TARGETS`' rule stands: read off the corpus, never
  // guessed. A guess here fails the way the prevention rows describe. An
  // evasion grant that exported with the wrong keyword string would boot
  // cleanly and simply not apply, and the parity oracle would report our kernel
  // wrong about a blocker it was right about.
  //
  // `targets` matches `legalTargetsFor` in both rows so `conformance.test.ts`
  // still agrees, exactly as `preventAllDamageToTarget` does above; the refusal
  // keeps the list from ever being read for real selection.
  cantBeBlockedThisTurn: {
    api: 'Pump',
    targets: ['targetCreature'],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          ctx.cardId,
          ctx.path,
          'a turn-scoped "can\'t be blocked" is a hidden keyword on Forge\'s Pump rather than a parameter of it, and no corpus-sourced spelling for the keyword string exists here',
        ),
      ],
    }),
  },
  attacksYouThisTurnIfAble: {
    api: 'MustAttack',
    targets: ['targetCreatureYouDontControl'],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          ctx.cardId,
          ctx.path,
          "a turn-scoped attack requirement naming the ability's controller as the defender has no corpus-sourced spelling here, including whether the defender is named at all or left implicit",
        ),
      ],
    }),
  },
  untapPermanent: {
    // Forge's own API, and the corpus spelling is Voltaic Key's: `AB$ Untap`
    // with `ValidTgts$ Permanent` and nothing else. The row is the shortest in
    // this table because the primitive is -- one verb, one target, no rider to
    // carry across. `tapPermanent`'s two extra links are its sweep and its
    // hold, and this kind has neither.
    api: 'Untap',
    targets: ['targetPermanent', 'targetCreature', 'targetCreatureYouControl'],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, ctx.targeting),
  },
  sacrificeSelf: {
    // Arc Runner's and Ball Lightning's line, read off `res/cardsfolder`:
    // `SVar:TrigSac:DB$ Sacrifice | SacValid$ Self`. Arc Runner writes the
    // bare `DB$ Sacrifice` and Ball Lightning writes the explicit
    // `SacValid$ Self`; the explicit one is emitted here because a default is
    // a thing to be verified and a written parameter is not.
    api: 'Sacrifice',
    // The entry exists to satisfy `conformance.test.ts`'s drift alarm against
    // `legalTargetsFor('sacrificeSelf')`, exactly as `pumpUntilEndOfTurn`'s
    // `selfCreature` entry does. It is never read for target selection:
    // `targetParams` answers a source-body-only target before this array is
    // consulted.
    targets: ['selfCreature'],
    deckHas: 'Sacrifice',
    // The one row in this table that deliberately DROPS `ctx.targeting`.
    // Everywhere else `Defined$ Self` is the right words for a retained
    // referent, but Forge's `Sacrifice` API reads `Defined$` as the PLAYER who
    // sacrifices and `SacValid$` as what gets sacrificed, so passing the
    // source-body target through would name a card where a player belongs.
    // `SacValid$ Self` is the corpus spelling and it is the whole clause.
    script: (_effect, _ctx) => ok('Sacrifice', params(['SacValid', 'Self'])),
  },
  // Diabolic Edict's shape: a spell that targets a player and makes that
  // player, not the caster, choose what leaves their own board (CR 701.17a).
  // Unverified against a booted Forge, `mtg-17a` is that check, but every
  // word here is composed rather than guessed. `ctx.targeting` is
  // `targetParams`'s own `ValidTgts$ Player` (or `Player.Opponent`) for
  // `targetPlayer`/`targetOpponent` — the ordinary spell-targeting clause,
  // unremarkable on its own. What is remarkable is `sacrificeSelf`'s
  // corpus-read fact just above: this API reads `Defined$` as WHO sacrifices
  // and `SacValid$` as WHAT is valid to sacrifice, the reverse of most other
  // rows in this table. `Defined$ Targeted` is not a new word either — it is
  // the same "the referent already picked by `ValidTgts$`" idiom `holdPump`
  // uses below for a targeted creature, aimed here at the targeted player
  // instead. So the row states: the target is a player (`ctx.targeting`),
  // that targeted player is who sacrifices (`Defined$ Targeted`), and a
  // creature is what's valid to give up (`SacValid$ Creature` — no filter to
  // carry, `sacrificePermanentEffect`'s stated cut in `@mtg/dsl`).
  sacrificePermanent: {
    api: 'Sacrifice',
    targets: ['targetPlayer', 'targetOpponent'],
    deckHas: 'Sacrifice',
    script: (_effect, ctx) =>
      ok('Sacrifice', [...ctx.targeting, ...params(['Defined', 'Targeted'], ['SacValid', 'Creature'])]),
  },
  // Diminish, read off `res/cardsfolder/d/diminish.txt` rather than composed:
  // `A:SP$ Animate | ValidTgts$ Creature | Power$ 1 | Toughness$ 1 |
  // IsCurse$ True`. `Animate` is Forge's characteristic-setting API and the
  // two numerals are its parameters, so this row is `untapPermanent`'s shape
  // with a stat line carried across.
  //
  // No `Duration$`, and that is corpus-read too rather than a default taken on
  // trust: `m/mass_diminish.txt` writes `AnimateAll | ... |
  // Duration$ UntilYourNextTurn` for the line that lasts longer, so the bare
  // form Diminish writes is the until-end-of-turn one.
  //
  // No `IsCurse$ True`. It is a hint to Forge's AI about which way to aim the
  // spell, not part of what the card does, and its truth depends on the body
  // the spell lands on — base 1/1 is a curse on a 5/5 and a gift on a 0/1, the
  // same thing `@mtg/kernel`'s `isHarmful` arm has to guess at. This
  // transpiler writes what the card does; a hint that is true of Diminish and
  // false of the next card printed off this kind is not that.
  setBasePtUntilEndOfTurn: {
    api: 'Animate',
    targets: ['targetCreature'],
    deckHas: null,
    script: (effect, ctx) =>
      ok(ctx.api, [
        ...ctx.targeting,
        ...params(['Power', String(effect.power)], ['Toughness', String(effect.toughness)]),
      ]),
  },
};

/**
 * Target clause for a targeted effect: `ValidTgts$ …` when the effect really
 * targets, `Defined$ You` when the DSL says `noTarget`.
 *
 * A `distinct` slot adds `TargetUnique$ True`, Forge's own name for the rule:
 * it excludes the targets already chosen elsewhere in the spell's sub-ability
 * chain, which is exactly what the kernel enforces on the chosen tuple. A
 * `noTarget` spec chooses nothing, so the flag has nowhere to apply and the DSL
 * validator has already rejected it there.
 */
function targetParams(
  effect: Effect,
  target: TargetSpec,
  ctx: TargetContext,
):
  | { readonly ok: true; readonly params: readonly ForgeParam[] }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] } {
  if (target.kind === 'triggeringCreature') {
    // `Defined$ TriggeredTarget` rather than a `ValidTgts$` clause, because the
    // kind names a referent the event retained and not a choice the caster
    // makes. Which referent is decided by the enclosing trigger, and the DSL
    // admits this kind under exactly two: the canonical exalted ability, and
    // `selfDealsCombatDamageToCreature` (`dsl/src/validate/abilities.ts`, whose
    // message names both). Exalted never reaches here — `ability-script.ts`
    // answers it with `K:Exalted` before any effect is written, and a
    // non-canonical exalted envelope is rejected there too — so everything that
    // arrives is a combat-damage trigger, whose Forge mode is `DamageDone` with
    // `ValidTarget$ Creature`, and `TriggeredTarget` is the name that mode gives
    // the damaged creature.
    return { ok: true, params: [['Defined', 'TriggeredTarget']] };
  }
  if (isSourceBodyOnlyTarget(target.kind)) {
    // `Defined$ Self`, Forge's generic reference to the object whose card
    // script is running — the same escape from `ValidTgts$` the
    // `triggeringCreature` branch above takes, and for the same reason: these
    // kinds name a referent the ability retains rather than a choice the
    // caster makes, so there is no target list to validate against. Unlike
    // `TriggeredTarget`, `Self` needs no enclosing trigger to have a referent:
    // it is the card whose ability this is, on an activated ability exactly as
    // much as a triggered one. Unverified against a booted Forge: `mtg-17a` is
    // that check.
    //
    // Both members of `SOURCE_BODY_ONLY_TARGETS` land on the same two words,
    // and that is the one place `selfPermanent` (`mtg-rji`) is cheaper here
    // than in the DSL: `Self` carries no card type, so the distinction the DSL
    // draws between "this creature" and "this permanent" — which noun the
    // oracle text prints, and which cards may print it — has no counterpart in
    // Forge's grammar and nothing to translate into.
    return { ok: true, params: [['Defined', 'Self']] };
  }
  if (isReferentTarget(target.kind)) {
    // The third `Defined$` escape from `ValidTgts$`, and the one Forge's own
    // corpus settles most directly. A back-reference names what an earlier slot
    // of the same spell chose (`mtg-nhyv.75`), and Forge's word for that inside
    // a sub-ability chain is `Targeted` — 1,188 lines across 1,025 cards in
    // 2.0.14's `res/cardsfolder`. The two cards this vocabulary's kinds are
    // spelled after write it verbatim:
    //
    //   Stabbing Pain SVar:DBTap:DB$ Tap      | Defined$ Targeted
    //   Sign in Blood SVar:DBLoseLife:DB$ LoseLife | LifeAmount$ 2 | Defined$ Targeted
    //
    // One word for a creature and for a player both, which is why this branch
    // does not split the way `TARGET_KINDS` does: the DSL splits `thatCreature`
    // from `thatPlayer` because the printed noun differs, and Forge's referent
    // has no noun to differ about.
    //
    // `TargetedController` is the projection, 175 lines across 167 cards, and
    // Chandra's Outrage — the card the DSL kind is spelled after — writes
    // `SVar:DBDealDamage:DB$ DealDamage | Defined$ TargetedController | NumDmg$ 2`.
    // Unverified against a booted Forge, for the reason every row in
    // `FORGE_VALID_TARGETS` is: `mtg-17a` is that check.
    //
    // Both words resolve against the *parent* ability's target, which is
    // exactly the chain `card-script.ts` emits — the first effect carries the
    // `ValidTgts$` clause and every later one hangs off it as a `SubAbility$`.
    // A back-reference in the first position would therefore point at nothing,
    // and it cannot occur: `checkReferentTargets` (`@mtg/dsl`) refuses a
    // referent with no earlier chooser before a card ever reaches this file.
    return {
      ok: true,
      params: [['Defined', target.kind === 'thatCreaturesController' ? 'TargetedController' : 'Targeted']],
    };
  }
  const mapping: ForgeEffectRow | undefined = FORGE_EFFECTS[effect.kind];
  const allowed = mapping?.targets;
  if (allowed === undefined) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          ctx.cardId,
          ctx.path,
          `effect "${effect.kind}" has no Forge targeting table`,
        ),
      ],
    };
  }
  if (!allowed.includes(target.kind)) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_TARGET_FOR_EFFECT',
          ctx.cardId,
          `${ctx.path}.target.kind`,
          `Forge mapping for "${effect.kind}" does not cover target "${target.kind}"; mapped targets are ${allowed.join(', ') || 'none'}`,
        ),
      ],
    };
  }
  const base = FORGE_VALID_TARGETS[target.kind];
  // The filter narrows the base before anything else touches it, because it can
  // change the base outright: "destroy target artifact" is `ValidTgts$ Artifact`
  // in `res/cardsfolder` and not `Permanent.Artifact`. It runs ahead of the
  // restriction for the same reason the restriction runs ahead of the join —
  // each stage narrows what the one before it opened, and they end as one
  // string because Forge has one clause to put them in.
  const filter = targetFilterOf(target);
  const members =
    base === null || base === undefined || filter === null
      ? null
      : forgeFilteredTargets(base, filter, 'base');
  if (filter !== null && base !== null && base !== undefined && members === null) {
    return { ok: false, rejections: unmappedFilterRejections(ctx, `${ctx.path}.target.filter`, filter) };
  }
  const validTgts = members === null ? base : members.join(',');
  if (validTgts === undefined) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_TARGET_KIND',
          ctx.cardId,
          `${ctx.path}.target.kind`,
          `targeting mode "${target.kind}" has no Forge ValidTgts mapping`,
        ),
      ],
    };
  }
  if (validTgts === null) return { ok: true, params: [['Defined', 'You']] };
  const unique: readonly ForgeParam[] = requiresDistinctTarget(target) ? [['TargetUnique', 'True']] : [];
  // The restriction narrows the same clause the kind opened, so it is attached
  // here rather than written as a second parameter: Forge says "creature you
  // control with a +1/+1 counter on it" as one selector
  // (`Creature.YouCtrl+counters_GE1_P1P1`) and has no second place to put half
  // of it. Dropping it silently is what this code did before, and a target list
  // that is quietly wider than the card's is the one bug a parity oracle must
  // not have.
  const restriction = targetRestrictionOf(target);
  if (restriction === null) return { ok: true, params: [['ValidTgts', validTgts], ...unique] };
  const qualifier = forgeTargetRestriction(restriction);
  const restricted = qualifier === null ? null : forgeRestrictedTarget(validTgts, qualifier);
  if (restricted === null) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_TARGET_RESTRICTION',
          ctx.cardId,
          `${ctx.path}.target.restriction`,
          `restriction "${restriction.kind}" has no Forge selector on target "${target.kind}"`,
        ),
      ],
    };
  }
  return { ok: true, params: [['ValidTgts', restricted], ...unique] };
}

function tokenRejections(token: TokenSpec, ctx: TargetContext): TranspileRejection[] {
  const found: TranspileRejection[] = [];
  if (!isScriptSafe(token.name)) {
    found.push(
      rejection(
        'UNSAFE_SCRIPT_TEXT',
        ctx.cardId,
        `${ctx.path}.token.name`,
        `token name ${JSON.stringify(token.name)} contains a newline or "|", which would break Forge's script grammar`,
      ),
    );
  }
  for (const [index, subtype] of token.subtypes.entries()) {
    if (!isScriptSafe(subtype)) {
      found.push(
        rejection(
          'UNSAFE_SCRIPT_TEXT',
          ctx.cardId,
          `${ctx.path}.token.subtypes[${index}]`,
          `token subtype ${JSON.stringify(subtype)} contains a newline or "|"`,
        ),
      );
    }
  }
  for (const [index, keyword] of token.keywords.entries()) {
    if (FORGE_KEYWORDS[keyword] === undefined) {
      found.push(
        rejection(
          'UNMAPPED_KEYWORD',
          ctx.cardId,
          `${ctx.path}.token.keywords[${index}]`,
          `token keyword "${keyword}" has no Forge K: mapping`,
        ),
      );
    }
  }
  // Every printed ability the token carries, checked here rather than inside
  // `transpileTokenScript`: that function returns a string, and the one path a
  // token reaches it by is this one, so a token whose Fuse has no Forge form
  // must be refused while there is still a rejection list to put it on.
  for (const [index, ability] of tokenAbilities(token).entries()) {
    const result = transpileAbility(ability, index, ctx.cardId, `${ctx.path}.token.abilities[${index}]`);
    if (!result.ok) found.push(...result.rejections);
  }
  // The script name is derived from these fields, so it is only meaningful
  // once they are known good.
  if (found.length > 0) return found;
  if (forgeTokenScriptName(token).length === 0) {
    found.push(
      rejection(
        'UNSAFE_SCRIPT_TEXT',
        ctx.cardId,
        `${ctx.path}.token`,
        'token has no name or subtype that yields a Forge token-script file name',
      ),
    );
  }
  return found;
}

/**
 * A printed quantity as a Forge numeral, or `null` when the card computes it.
 *
 * Every row that writes a number goes through this and handles the `null`
 * itself, rather than a check before dispatch that later rows would have to
 * trust. The type system cannot narrow an `Amount` across a helper, and a shared
 * numeric fallback would be a script that transpiles clean and plays a
 * different card.
 */
function forgeNumber(amount: Amount, computed: ComputedAmounts): string | null {
  return isLiteralAmount(amount) ? String(amount) : computed.numeral(amount);
}

/**
 * `NumCards$ n`, which draw and mill write identically off different field
 * names. Two rows sharing one line rather than one row handling two kinds: the
 * shape is the same and the primitives are not.
 */
function numCards(count: Amount, ctx: EffectScriptContext): EffectScriptResult {
  const cards = forgeNumber(count, ctx.computed);
  if (cards === null) return computedRejection(ctx.cardId, `${ctx.path}.count`);
  return ok(ctx.api, [...ctx.targeting, ...params(['NumCards', cards])]);
}

/**
 * A pump magnitude as a signed Forge numeral, or `null` when it has no
 * spelling.
 *
 * Separate from `forgeNumber` because `Pump` and `PumpAll` want the sign in the
 * parameter — `NumAtt$ -2`, `NumAtt$ -X`, `NumAtt$ +Y` are all shapes Forge's
 * 2.0.14 corpus ships — while every other numeral slot in this file takes a
 * bare count. A rate's sign therefore rides here and its multiplier rides
 * inside the `Count$` expression (`board-count.ts`), which is how Mutilate and
 * Ancestral Mask are each written upstream.
 *
 * A rate of zero is a literal zero and asks for no SVar: zero per permanent is
 * zero whatever the board holds, and a card that printed `+0/-1 for each Swamp`
 * would otherwise bind an SVar it never reads.
 *
 * A computed amount that is not a rate returns `null` here even when the
 * chain's protocol could name it. That is the row's standing position, not an
 * oversight: no card in the tree pumps by a board count without a rate, and
 * admitting one would mean deciding whether `NumAtt$ +Y` and the kernel's
 * layer-7c reading agree on a board that changes mid-turn.
 */
function pumpNumeral(amount: PumpAmount, computed: ComputedAmounts): string | null {
  if (isLiteralAmount(amount)) return signed(amount);
  if (!isRateAmount(amount)) return null;
  if (amount.rate === 0) return signed(0);
  const svar = computed.numeral(amount);
  return svar === null ? null : `${amount.rate < 0 ? '-' : '+'}${svar}`;
}

/**
 * The refusal a rate gets when its tally has no `Valid` spec, and the sentence
 * that says what would lift it.
 *
 * Named separately from `computedRejection` for the reason
 * `UNMAPPED_RATE_AMOUNT` gives: what is missing is the group the rate is
 * charged per, and a message that listed the countable shapes would point
 * whoever reads it at a `Count$` grammar that is already written.
 */
function rateRejection(cardId: string, path: string): EffectScriptResult {
  return {
    ok: false,
    rejections: [
      rejection(
        'UNMAPPED_RATE_AMOUNT',
        cardId,
        path,
        'a stat change charged per permanent needs a `Valid` spec for the group it counts, and this one has none. A land subtype and a board filter naming at most one card type and at most one subtype both have one (board-count.ts); `countWithCounter` does not, because its part counters each decompose into two Forge counter types and no `counters_GE1_` restriction counts the same permanents',
      ),
    ],
  };
}

function computedRejection(cardId: string, path: string): EffectScriptResult {
  return {
    ok: false,
    rejections: [
      rejection(
        'UNMAPPED_COMPUTED_AMOUNT',
        cardId,
        path,
        'this quantity has no Forge spelling here. Two shapes do: `exiledThisResolution` in a spell chain that has already exiled something (remember.ts), and one `countMatching` of a board this transpiler can name a `Valid` spec for (board-count.ts). A count of a graveyard, an X chosen on casting, a count read before the exile that would feed it, a board filter naming two card types or two subtypes, and `countWithCounter`, whose part counters each decompose into two Forge counter types so no `counters_GE1_` restriction counts the same permanents (board-count.ts), are the ones left',
      ),
    ],
  };
}

/** Transpiles one effect into its Forge ability, or rejects with a named reason. */
export function transpileEffect(
  effect: Effect,
  cardId: string,
  path: string,
  computed: ComputedAmounts = NO_COMPUTED_AMOUNTS,
): EffectScriptResult {
  const mapping: ForgeEffectRow | undefined = FORGE_EFFECTS[effect.kind];
  if (mapping === undefined) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          cardId,
          path,
          `effect "${effect.kind}" has no Forge effect-API mapping`,
        ),
      ],
    };
  }
  const target: TargetContext = { cardId, path };

  let targeting: readonly ForgeParam[] = [];
  if (hasTarget(effect)) {
    const resolved = targetParams(effect, effect.target, target);
    if (!resolved.ok) return { ok: false, rejections: resolved.rejections };
    targeting = resolved.params;
  }

  // The one place this package narrows by assertion rather than by control
  // flow. `FORGE_EFFECTS` is keyed by the same discriminant `effect` carries, so
  // `mapping` is by construction the row for `effect.kind` and its writer takes
  // exactly this effect; TypeScript cannot correlate the two across an index
  // lookup. Each writer is still checked against its own row's effect shape at
  // the definition site above, which is where a mistake would actually be made.
  const write = mapping.script as (e: Effect, c: EffectScriptContext) => EffectScriptResult;
  return write(effect, { ...target, api: mapping.api, targeting, computed });
}

function ok(api: string, abilityParams: readonly ForgeParam[]): EffectScriptResult {
  return { ok: true, value: { ability: { api, params: abilityParams } } };
}

/**
 * Forge's spelling of "it doesn't untap during its controller's next untap
 * step": a hidden keyword granted for a permanent duration, copied from
 * `frost_breath.txt` and `sleep.txt` rather than composed.
 *
 * "Your" in the keyword text reads from the permanent's own controller once
 * Forge has granted it, which is why one string serves both halves; the sweep
 * differs only in the API and in naming the group it pumps, exactly as Sleep
 * does beside Frost Breath.
 */
const HOLD_KEYWORD = "HIDDEN This card doesn't untap during your next untap step.";

function holdPump(scoped: boolean): ForgeAbility {
  return scoped
    ? {
        api: 'PumpAll',
        params: [
          ['Defined', 'Targeted'],
          ['ValidCards', 'Creature'],
          ['KW', HOLD_KEYWORD],
          ['Duration', 'Permanent'],
        ],
      }
    : {
        api: 'Pump',
        params: [
          ['Defined', 'Targeted'],
          ['KW', HOLD_KEYWORD],
          ['Duration', 'Permanent'],
        ],
      };
}
