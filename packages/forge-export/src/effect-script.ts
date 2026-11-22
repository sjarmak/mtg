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
 * added to `@mtg/dsl` without either a Forge form or its declared-partial
 * refusal is a compile error here exactly as the `assertNever` default used to
 * be. The runtime table lookups still guard for `undefined` because unvalidated
 * input (LLM output, JSON on disk) can carry values the types promise are
 * impossible.
 */
import type {
  AnyEffectKind,
  Amount,
  DeclaredPartialEffectKind,
  Effect,
  EffectScope,
  PumpAmount,
  TargetFilter,
  TargetKind,
  TargetSpec,
  TokenSpec,
  TriggerCondition,
} from '@mtg/dsl';
import {
  hasTarget,
  isAllPlayersScope,
  isGraveyardCardTargetKind,
  isLiteralAmount,
  isRateAmount,
  isReferentTarget,
  isSourceAttachmentTarget,
  isSourceBodyOnlyTarget,
  isSpaceScope,
  requiresDistinctTarget,
  targetFilterOf,
  targetMinimumOf,
  targetRestrictionOf,
  targetsAnyNumber,
  tokenAbilities,
} from '@mtg/dsl';
import type { ForgeAbility, ForgeParam } from './script-text';
import { isScriptSafe, params, renderNamedSubAbilityChain, renderSubAbility } from './script-text';
import type { TranspileRejection } from './rejection';
import { rejection } from './rejection';
import {
  FORGE_CARD_DESTINATIONS,
  FORGE_CARD_TYPES,
  FORGE_COLOR_WORDS,
  FORGE_COLOR_PROPERTIES,
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
  FORGE_TRIGGERING_CREATURE_REFERENTS,
  FORGE_VALID_TARGETS,
  forgeFilteredTargets,
  forgeRestrictedTarget,
  forgeSearchType,
  forgeSearchTypeUnion,
  forgeSweepSelector,
  forgeTargetRestriction,
  unmappedFilterField,
} from './vocabulary-map';
import { transpileAbility } from './ability-script';
import { NO_COMPUTED_AMOUNTS, REMEMBER_CHANGED, type ComputedAmounts } from './remember';
import { forgeTokenScriptName } from './naming';
import { forgeManaCost } from './mana-script';

export interface ForgeEffectScript {
  readonly ability: ForgeAbility;
  /**
   * Additional Forge abilities this one DSL effect needs, chained straight
   * after the first.
   *
   * One primitive is one Forge API almost everywhere, and the hold on a tap is
   * the exception Forge itself makes: `frost_breath.txt` and `sleep.txt` both
   * write the tap and then a `Pump`/`PumpAll` carrying the hidden keyword, and
   * there is no parameter on `Tap` that says it. Cultivate needs three links
   * after its search: two destinations and remembered-state cleanup. Links
   * rather than extra effects in the DSL, because each DSL effect is still one
   * printed instruction; splitting it would put the seam in the wrong language.
   *
   * The chain builders append it in the position the effect occupies, so a
   * card whose second effect draws a card still reads tap, hold, draw.
   */
  readonly follow?: readonly ForgeAbility[];
  /** Token this effect creates; the set export writes it as a token script. */
  readonly token?: TokenSpec;
  /** Supporting `SVar:` declarations referenced by this effect's ability. */
  readonly supportingLines?: readonly string[];
  /** This effect's follow chain already clears the remembered-card register. */
  readonly cleansRemembered?: true;
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
  if (isAllPlayersScope(scope)) return null;
  if (scope === 'targetAndPermanentsItsPlayerControls') return null;
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
 * in it, and a `scopeFilter` carrying a conjunctive card type names permanents
 * this exporter has no attested selector for.
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
 * A zone move whose scope names a region but carries no selection filter,
 * refused by name.
 *
 * A region alone does not say which permanents move. The DSL validator refuses
 * this shape too, but the exporter keeps its own boundary: dropping the scope
 * and exporting an unscoped card would report a mismatch as agreement, which
 * is worse than the gap. A filtered battlefield region takes the
 * source-attested `ChangeZoneAll` path in the exile row instead.
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
  /** Enclosing trigger, when the effect reads an event-retained referent. */
  readonly triggerCondition?: TriggerCondition;
  /**
   * Forge's name for the creature this trigger retains, when the enclosing
   * `T:` line settles it rather than the condition does.
   *
   * Only `selfBlocksOrIsBlockedByGreaterPower` passes one. Its two lines are
   * the two halves of a block and each retains the *other* creature, so the
   * referent is a fact about the line rather than about the condition and the
   * body is compiled once per line. Every other condition leaves this unset and
   * `FORGE_TRIGGERING_CREATURE_REFERENTS` answers from the condition alone.
   */
  readonly triggeringCreatureReferent?: string;
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

/** An explicit boundary refusal for a kernel-complete, declared-partial kind. */
export interface ForgeEffectRefusal {
  readonly refusal: {
    readonly code: 'UNMAPPED_EFFECT_KIND';
    readonly reason: string;
  };
}

/** Narrows a total-table row without making every mapped row carry a tag. */
export function isForgeEffectRefusal(row: object): row is ForgeEffectRefusal {
  if (!('refusal' in row) || typeof row.refusal !== 'object' || row.refusal === null) return false;
  return (
    'code' in row.refusal &&
    row.refusal.code === 'UNMAPPED_EFFECT_KIND' &&
    'reason' in row.refusal &&
    typeof row.refusal.reason === 'string'
  );
}

/**
 * The Forge form or named refusal of every DSL effect primitive.
 *
 * A mapped type rather than `Record<AnyEffectKind, ForgeEffectMapping>` so each
 * row's writer is checked against the effect shape *that row* carries: the
 * `dealDamage` writer sees an `amount` and the `putCounters` writer sees a
 * `counter`, without either narrowing the union by hand. Being mapped over the
 * whole union also makes a missing row a compile error, which is what the
 * `assertNever` default on the old `switch` bought.
 */
export type ForgeEffectTable = {
  readonly [K in AnyEffectKind]: K extends DeclaredPartialEffectKind
    ? ForgeEffectRefusal
    : ForgeEffectMapping<K>;
};

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
      'targetCreatureYouDontControl',
      'targetPlayer',
      'targetOpponent',
      'targetPlayerOrPlaneswalker',
      'noTarget',
      'thatCreaturesController',
      'targetCreatureDefendingPlayerControls',
      'chosenPlayer',
      'selfPermanent',
      'triggeringPlayer',
    ],
    deckHas: null,
    script: (effect, ctx) => {
      const chosenX = !isLiteralAmount(effect.amount) && effect.amount.kind === 'chosenX';
      const triggeringDamage =
        !isLiteralAmount(effect.amount) && effect.amount.kind === 'triggeringDamageAmount';
      const damage = chosenX || triggeringDamage ? 'X' : forgeNumber(effect.amount, ctx.computed);
      if (damage === null) return computedRejection(ctx.cardId, `${ctx.path}.amount`);
      const dealt = params(['NumDmg', damage]);
      if (effect.eachScopedPermanentDealsToItsController === true) {
        if (effect.scope === undefined) return unwritableSweepRejection(ctx, 'allPermanents', undefined);
        const group = sweepSelection(ctx, effect.scope, effect.scopeFilter);
        const selector = group?.find(([name]) => name === 'ValidCards')?.[1];
        if (group === null || selector === undefined) {
          return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
        }
        const prevention = effect.preventable === false ? ' | NoPrevention$ True' : '';
        return {
          ok: true,
          value: {
            ability: {
              api: 'RepeatEach',
              params: params(
                ['RepeatCards', selector],
                ['RepeatSubAbility', 'DBDamage'],
                ['DamageMap', 'True'],
              ),
            },
            supportingLines: [
              `SVar:DBDamage:DB$ DealDamage | Defined$ RememberedController | DamageSource$ Remembered | NumDmg$ ${damage}${prevention}`,
              ...(chosenX ? ['SVar:X:Count$xPaid'] : []),
              ...(triggeringDamage ? ['SVar:X:TriggerCount$DamageAmount'] : []),
            ],
          },
        };
      }
      if (effect.scope === 'targetAndPermanentsItsPlayerControls') {
        const filter = effect.scopeFilter;
        if (filter === undefined) return unwritableSweepRejection(ctx, effect.scope, filter);
        const members = forgeFilteredTargets('Permanent', filter, 'base');
        if (members === null) return unwritableSweepRejection(ctx, effect.scope, filter);
        const controlled = members.map((member) => `${member}.ControlledBy TargetedOrController`).join(',');
        const prevention = effect.preventable === false ? params(['NoPrevention', 'True']) : [];
        const scopedDamage =
          effect.scopeAmount === undefined ? damage : forgeNumber(effect.scopeAmount, ctx.computed);
        if (scopedDamage === null) return computedRejection(ctx.cardId, `${ctx.path}.scopeAmount`);
        return {
          ok: true,
          value: {
            ability: {
              api: ctx.api,
              params: [
                ...ctx.targeting,
                ...playerOrPlaneswalkerDamagePrompt(
                  effect.target,
                  effect.scope,
                  effect.opponentPlayerOrPlaneswalkerOnly === true,
                ),
                ...dealt,
                ...prevention,
                ...params(['DamageMap', 'True']),
              ],
            },
            follow: [
              {
                api: 'DamageAll',
                params: [
                  ...params(['NumDmg', scopedDamage]),
                  ...params(['ValidCards', controlled]),
                  ...prevention,
                ],
              },
              { api: 'DamageResolve', params: [] },
            ],
          },
        };
      }
      if (effect.scope === undefined && effect.players === undefined) {
        const prevention = effect.preventable === false ? params(['NoPrevention', 'True']) : [];
        const linkedDeathReplacement =
          effect.exileDamagedCreatureIfItWouldDieThisTurn === true
            ? [
                ...params(['RememberDamaged', 'True']),
                ...params(['ReplaceDyingDefined', 'Remembered.Creature']),
                ...params(['SubAbility', 'DBCleanup']),
              ]
            : [];
        const cardinality = ctx.targeting.filter(([key]) => key === 'TargetMin' || key === 'TargetMax');
        const ordinaryTarget = ctx.targeting.filter(([key]) => key !== 'TargetMin' && key !== 'TargetMax');
        const target =
          effect.opponentPlayerOrPlaneswalkerOnly === true
            ? params(['ValidTgts', 'Opponent,Planeswalker'])
            : ordinaryTarget;
        const division =
          effect.division === undefined || effect.division.kind === 'each'
            ? []
            : effect.division.kind === 'evenlyRoundedDown'
              ? params(['DivideEvenly', 'RoundedDown'])
              : params(['DividedAsYouChoose', String(effect.amount)]);
        const prompt =
          effect.division?.kind === 'asYouChoose'
            ? params(['TgtPrompt', 'Select any target to distribute damage to'])
            : [];
        const supportingLines = [
          ...(chosenX ? ['SVar:X:Count$xPaid'] : []),
          ...(triggeringDamage ? ['SVar:X:TriggerCount$DamageAmount'] : []),
          ...(effect.division?.kind === 'evenlyRoundedDown' && targetsAnyNumber(effect.target)
            ? [
                'SVar:MaxTargets:SVar$MaxPlayers/Plus.MaxPermanents',
                'SVar:MaxPlayers:PlayerCountPlayers$Amount',
                'SVar:MaxPermanents:Count$Valid Any',
              ]
            : []),
        ];
        return {
          ok: true,
          value: {
            ability: {
              api: ctx.api,
              params: [
                ...target,
                ...prompt,
                ...playerOrPlaneswalkerDamagePrompt(
                  effect.target,
                  effect.scope,
                  effect.opponentPlayerOrPlaneswalkerOnly === true,
                ),
                ...dealt,
                ...cardinality,
                ...division,
                ...prevention,
                ...filteredCreaturePrompt(effect.target),
                ...linkedDeathReplacement,
              ],
            },
            ...(supportingLines.length === 0 && effect.exileDamagedCreatureIfItWouldDieThisTurn !== true
              ? {}
              : {
                  supportingLines: [
                    ...supportingLines,
                    ...(effect.exileDamagedCreatureIfItWouldDieThisTurn === true
                      ? ['SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True']
                      : []),
                  ],
                }),
          },
        };
      }
      // Aggravate and Magma Phoenix are the two widened forms of this row: the
      // same `NumDmg$` under `DamageAll`, with a permanent group, a player
      // group, or both named beside it.
      //
      // No `ValidPlayers$ Targeted`, which is the parameter that would burn the
      // targeted player as well. The DSL's scope reads "each creature that
      // player controls" and stops there; the cards that mean both say both,
      // and adding the key here would make the Forge card hit for damage the
      // kernel never deals.
      const players =
        effect.players === undefined
          ? []
          : params(['ValidPlayers', FORGE_PLAYER_SCOPE_DEFINED[effect.players]]);
      if (effect.scope === undefined) return ok('DamageAll', [...players, ...dealt]);
      const damageGroup = (() => {
        const primary = sweepSelection(ctx, effect.scope, effect.scopeFilter);
        if (primary === null || effect.additionalScopeFilter === undefined) return primary;
        const additional = sweepSelection(ctx, effect.scope!, effect.additionalScopeFilter);
        if (additional === null) return null;
        const primarySelector = primary.find(([name]) => name === 'ValidCards')?.[1];
        const additionalSelector = additional.find(([name]) => name === 'ValidCards')?.[1];
        return primarySelector === undefined || additionalSelector === undefined
          ? null
          : params(['ValidCards', `${primarySelector},${additionalSelector}`]);
      })();
      if (damageGroup === null) return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
      const supportingLines = chosenX ? ['SVar:X:Count$xPaid'] : [];
      if (effect.tapScopeGroup !== true) {
        const result = ok('DamageAll', [...damageGroup, ...players, ...dealt]);
        return supportingLines.length === 0 || !result.ok
          ? result
          : { ...result, value: { ...result.value, supportingLines } };
      }
      return {
        ok: true,
        value: {
          ability: { api: 'DamageAll', params: [...damageGroup, ...players, ...dealt] },
          follow: [{ api: 'TapAll', params: damageGroup }],
          ...(supportingLines.length === 0 ? {} : { supportingLines }),
        },
      };
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
      'targetCreatureOpponentControls',
      'targetArtifactOrEnchantment',
      'targetArtifactYouDontControl',
      'targetPermanent',
      'noTarget',
      'selfPermanent',
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
      if (effect.controllerLibraryFollowup === 'revealUntilLandToGraveyard') {
        return {
          ok: true,
          value: {
            ability: { api: ctx.api, params: ctx.targeting },
            follow: [
              {
                api: 'DigUntil',
                params: params(
                  ['Defined', 'TargetedController'],
                  ['Valid', 'Land'],
                  ['ValidDescription', 'land'],
                  ['RevealedDestination', 'Graveyard'],
                ),
              },
            ],
          },
        };
      }
      if (effect.scope === undefined) {
        return ok(ctx.api, [
          ...ctx.targeting,
          ...monocoloredCreaturePrompt(effect.target),
          ...dealtDamageCreaturePrompt(effect.target),
        ]);
      }
      const group = sweepSelection(ctx, effect.scope, effect.scopeFilter);
      return group === null
        ? unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter)
        : ok('DestroyAll', group);
    },
  },
  destroyAttachedPermanents: {
    api: 'DestroyAll',
    targets: ['thatCreature', 'targetPermanent'],
    deckHas: null,
    script: (effect, ctx) => {
      const attachment = effect.filter.subtypes?.length === 1 ? effect.filter.subtypes[0] : null;
      if (effect.target.kind === 'thatCreature' && attachment === 'Equipment') {
        return ok(ctx.api, params(['ValidCards', 'Targeted.Equipment+Attached']));
      }
      if (effect.target.kind === 'targetPermanent' && attachment === 'Aura') {
        return ok(ctx.api, [...params(['ValidCards', 'Card.Aura+AttachedTo Targeted']), ...ctx.targeting]);
      }
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            ctx.cardId,
            `${ctx.path}.filter`,
            'attached-permanent destruction maps only Equipment on a retained creature or Auras on a targeted land',
          ),
        ],
      };
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
      'targetCreatureYouControl',
      'targetCreatureYouDontControl',
      'targetCreatureDefendingPlayerControls',
      'targetPlayer',
      'targetOpponent',
      'selfCreature',
      'enchantedCreature',
      'noTarget',
      'thatCreature',
      'thatCreaturesController',
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
      const omitZero = effect.target.kind === 'selfCreature';
      // Forge's `IsCurse` is an AI hint rather than a rule the card carries,
      // so it is derived at this export boundary instead of entering the DSL.
      // Its useful source-attested role here is disambiguating an
      // indiscriminate negative sweep: Golgari Charm, Mutilate and Nausea all
      // say `Creature`, so the selector alone does not tell Forge which mode is
      // hostile. A targeted or controller-qualified selector already carries
      // that direction, and Forge's shipped Chemister's Trick, Downsize, Cower
      // in Fear and Public Execution lines deliberately omit this hint.
      const hostileBlockingPump =
        effect.target.kind === 'targetCreature' &&
        effect.target.filter?.combat === 'blocking' &&
        (attack.startsWith('-') || defense.startsWith('-'));
      const curse =
        (effect.scope === 'allPermanents' && (attack.startsWith('-') || defense.startsWith('-'))) ||
        hostileBlockingPump
          ? params(['IsCurse', 'True'])
          : [];
      const deltas = [
        ...params(
          ['NumAtt', omitZero && attack === '+0' ? undefined : attack],
          ['NumDef', omitZero && defense === '+0' ? undefined : defense],
        ),
        ...curse,
        ...rider,
      ];
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
    // `triggeringPlayer` is reachable only through the validated Righteous
    // Authority bundle. The generic target mapper correctly contributes no
    // clause for a retained event player; the trigger writes `Defined$
    // TriggeredPlayer` at its effect seam.
    targets: ['noTarget', 'targetPlayer', 'triggeringPlayer'],
    deckHas: null,
    // `players` is Temple Bell, and Forge writes it the short way: `A:AB$ Draw |
    // Cost$ T | NumCards$ 1 | Defined$ Player`. `FORGE_PLAYER_SCOPE_DEFINED` is
    // which seats that word names, and it is a table rather than a literal so
    // the second scope is a lookup here rather than an edit; either way the
    // sweep replaces the target clause rather than qualifying it, because the
    // `noTarget` slot beside it would otherwise write `Defined$ You` and draw
    // for one.
    script: (effect, ctx) => {
      const chosenX = !isLiteralAmount(effect.count) && effect.count.kind === 'chosenX';
      if (effect.players === undefined) {
        const scripted = chosenX
          ? ok(ctx.api, [...ctx.targeting, ...params(['NumCards', 'X'])])
          : numCards(effect.count, ctx);
        if (!scripted.ok) return scripted;
        const supportingLines = [
          ...(chosenX ? ['SVar:X:Count$xPaid'] : []),
          ...(targetsAnyNumber(effect.target) ? ['SVar:MaxTgt:PlayerCountPlayers$Amount'] : []),
        ];
        if (supportingLines.length === 0) return scripted;
        return {
          ok: true,
          value: {
            ...scripted.value,
            supportingLines,
          },
        };
      }
      const cards = chosenX ? 'X' : forgeNumber(effect.count, ctx.computed);
      if (cards === null) return computedRejection(ctx.cardId, `${ctx.path}.count`);
      const scripted = ok(
        ctx.api,
        params(['NumCards', cards], ['Defined', FORGE_PLAYER_SCOPE_DEFINED[effect.players]]),
      );
      if (!scripted.ok) return scripted;
      return chosenX
        ? { ...scripted, value: { ...scripted.value, supportingLines: ['SVar:X:Count$xPaid'] } }
        : scripted;
    },
  },
  gainLife: {
    api: 'GainLife',
    targets: ['noTarget', 'targetPlayer', 'thatCreaturesController'],
    deckHas: 'LifeGain',
    script: (effect, ctx) => {
      const chosenX = !isLiteralAmount(effect.amount) && effect.amount.kind === 'chosenX';
      const chosenColorCount =
        !isLiteralAmount(effect.amount) && effect.amount.kind === 'triggeringSpellChosenColorCount';
      const targetedPlayerHand = effect.amountFrom === 'thatPlayersHandSize';
      const life =
        chosenX || chosenColorCount || targetedPlayerHand ? 'X' : forgeNumber(effect.amount, ctx.computed);
      if (life === null) return computedRejection(ctx.cardId, `${ctx.path}.amount`);
      const scripted = ok(ctx.api, [
        ...(chosenColorCount ? [] : ctx.targeting),
        ...params(['LifeAmount', life]),
      ]);
      if (!scripted.ok) return scripted;
      const supportingLines = [
        ...(chosenX ? ['SVar:X:Count$xPaid'] : []),
        ...(chosenColorCount ? ['SVar:X:Count$HasNumChosenColors.TriggeredCard'] : []),
        ...(targetedPlayerHand ? ['SVar:X:Count$ValidHand Card.TargetedPlayerOwn'] : []),
        ...(targetsAnyNumber(effect.target) ? ['SVar:MaxTgt:PlayerCountPlayers$Amount'] : []),
      ];
      if (supportingLines.length === 0) return scripted;
      return {
        ok: true,
        value: {
          ...scripted.value,
          supportingLines,
        },
      };
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
      const opposing = 'spellSelection' in effect && effect.spellSelection === 'targetSpellYouDontControl';
      const members =
        effect.spellFilter === undefined ? [] : forgeFilteredTargets('Card', effect.spellFilter, 'qualifier');
      if (members === null)
        return {
          ok: false,
          rejections: unmappedFilterRejections(ctx, `${ctx.path}.spellFilter`, effect.spellFilter),
        };
      const instantSorcery =
        effect.spellFilter?.cardTypes?.length === 2 &&
        effect.spellFilter.cardTypes[0] === 'instant' &&
        effect.spellFilter.cardTypes[1] === 'sorcery';
      const nonCreature =
        effect.spellFilter?.excludeCardTypes?.length === 1 &&
        effect.spellFilter.excludeCardTypes[0] === 'creature';
      const creature =
        effect.spellFilter?.cardTypes?.length === 1 && effect.spellFilter.cardTypes[0] === 'creature';
      const validTargets = instantSorcery ? ['Instant', 'Sorcery'] : members;
      const chosenX = effect.unlessCost !== undefined && 'kind' in effect.unlessCost;
      const result = ok(
        ctx.api,
        params(
          ['TargetType', 'Spell'],
          [
            'ValidTgts',
            (validTargets.length === 0 ? ['Card'] : validTargets)
              .map((member) => (opposing ? `${member}.YouDontCtrl` : member))
              .join(','),
          ],
          [
            'TgtPrompt',
            opposing
              ? "Select target spell you don't control"
              : instantSorcery
                ? 'Select target instant or sorcery spell'
                : creature
                  ? 'Select target creature spell'
                  : nonCreature
                    ? 'Select target noncreature spell'
                    : 'Select target spell',
          ],
          ['Destination', effect.destination === 'exile' ? 'Exile' : undefined],
          [
            'UnlessCost',
            effect.unlessCost === undefined
              ? undefined
              : 'kind' in effect.unlessCost
                ? 'X'
                : forgeManaCost(effect.unlessCost),
          ],
        ),
      );
      if (!result.ok) return result;
      const supportingLines = [
        ...(chosenX ? ['SVar:X:Count$xPaid'] : []),
        ...(effect.dealDamageToControllerEqualToSpellPower === true
          ? ['SVar:Backlash:Targeted$CardPower']
          : []),
      ];
      return {
        ok: true,
        value: {
          ...result.value,
          ...(effect.dealDamageToControllerEqualToSpellPower === true
            ? {
                follow: [
                  {
                    api: 'DealDamage',
                    params: params(['NumDmg', 'Backlash'], ['Defined', 'TargetedController']),
                  },
                ],
              }
            : {}),
          ...(supportingLines.length === 0 ? {} : { supportingLines }),
        },
      };
    },
  },
  changeSpellTargets: {
    api: 'ChangeTargets',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const members =
        effect.spellFilter === undefined ? [] : forgeFilteredTargets('Card', effect.spellFilter, 'qualifier');
      if (members === null) {
        return {
          ok: false,
          rejections: unmappedFilterRejections(ctx, `${ctx.path}.spellFilter`, effect.spellFilter),
        };
      }
      return ok(
        ctx.api,
        params(
          ['TargetType', 'Spell'],
          ['Optional', 'True'],
          ['ValidTgts', members.length === 0 ? 'Card' : members.join(',')],
        ),
      );
    },
  },
  copySpell: {
    api: 'CopySpellAbility',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const controlled = effect.spellSelection === 'targetSpellYouControl';
      const members =
        effect.spellFilter === undefined ? [] : forgeFilteredTargets('Card', effect.spellFilter, 'base');
      if (members === null) {
        return {
          ok: false,
          rejections: unmappedFilterRejections(ctx, `${ctx.path}.spellFilter`, effect.spellFilter),
        };
      }
      return ok(
        ctx.api,
        params(
          [
            'ValidTgts',
            (members.length === 0 ? ['Card'] : members)
              .map((member) => (controlled ? `${member}.YouCtrl` : member))
              .join(','),
          ],
          ['TargetType', 'Spell'],
          ['AILogic', controlled ? 'Once' : undefined],
          ['MayChooseTarget', 'True'],
        ),
      );
    },
  },
  copyNextInstantOrSorceryThisTurn: {
    api: 'DelayedTrigger',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: params(
            ['AILogic', 'SpellCopy'],
            ['Mode', 'SpellCast'],
            ['ValidCard', 'Instant,Sorcery'],
            ['ValidActivatingPlayer', 'You'],
            ['ThisTurn', 'True'],
            ['Execute', 'EffTrigCopy'],
          ),
        },
        supportingLines: [
          'SVar:EffTrigCopy:DB$ CopySpellAbility | Defined$ TriggeredSpellAbility | MayChooseTarget$ True',
        ],
      },
    }),
  },
  populate: {
    api: 'CopyPermanent',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, params(['Populate', 'True'])),
  },
  createTokenCopyOfSelf: {
    api: 'CopyPermanent',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, params(['Defined', 'Self'])),
  },
  createToken: {
    api: 'Token',
    targets: [],
    deckHas: 'Token',
    script: (effect, ctx) => {
      const lifeTotal = !isLiteralAmount(effect.count) && effect.count.kind === 'controllerLifeTotal';
      const tokenAmount = isLiteralAmount(effect.count)
        ? String(effect.count)
        : lifeTotal
          ? 'X'
          : ctx.computed.numeral(effect.count);
      const chosenXBody = effect.token.creationPowerToughness?.kind === 'chosenX';
      if (tokenAmount === null) {
        return computedRejection(ctx.cardId, `${ctx.path}.count`);
      }
      const rejections = tokenRejections(effect.token, ctx);
      if (rejections.length > 0) return { ok: false, rejections };
      const ability: ForgeAbility = {
        api: ctx.api,
        params: params(
          ...(effect.count === 1 ? [] : ([['TokenAmount', tokenAmount]] as const)),
          ['TokenScript', forgeTokenScriptName(effect.token)],
          ['TokenOwner', 'You'],
          ...(chosenXBody
            ? ([
                ['TokenPower', 'X'],
                ['TokenToughness', 'X'],
              ] as const)
            : []),
        ),
      };
      return {
        ok: true,
        value: {
          ability,
          token: effect.token,
          ...(lifeTotal || chosenXBody
            ? {
                supportingLines: [`SVar:X:${chosenXBody ? 'Count$xPaid' : 'Count$YourLifeTotal'}`],
              }
            : {}),
        },
      };
    },
  },
  tapPermanent: {
    api: 'Tap',
    targets: [
      'targetCreature',
      'targetCreatureYouDontControl',
      'targetPlayer',
      'targetOpponent',
      'targetPermanent',
      'thatCreature',
    ],
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
      return {
        ok: true,
        value: { ...tapped.value, follow: [holdPump(effect.scope !== undefined)] },
      };
    },
  },
  returnToHand: {
    api: 'ChangeZone',
    targets: [
      'targetCreature',
      'targetCreatureDefendingPlayerControls',
      'targetArtifactOrEnchantment',
      'targetNonlandPermanentOpponentControls',
      'targetNonlandPermanentYouDontControl',
      'targetCardInYourGraveyard',
      'targetCardInAGraveyard',
      'selfPermanent',
    ],
    deckHas: null,
    script: (effect, ctx) =>
      ok(ctx.api, [
        ...ctx.targeting,
        ...params(
          ['Origin', isGraveyardCardTargetKind(effect.target.kind) ? 'Graveyard' : 'Battlefield'],
          ['Destination', 'Hand'],
        ),
      ]),
  },
  exchangeControl: {
    api: 'ExchangeControl',
    targets: ['targetCreature', 'targetPermanentYouNeitherOwnNorControl'],
    deckHas: null,
    script: (effect, ctx) =>
      ok(
        ctx.api,
        effect.exchangeSource === true ? [...params(['Defined', 'Self']), ...ctx.targeting] : ctx.targeting,
      ),
  },
  millCards: {
    // `targetOpponent` rides the same `ValidTgts$` clause `targetPlayer` does
    // (`Player.Opponent` against `Player`, `FORGE_VALID_TARGETS`), so Mind
    // Sculpt's "target opponent mills seven cards" needs no second API and no
    // second parameter — only the DSL's permission, which arrived with the
    // hand-authored widening on this kind's rule.
    api: 'Mill',
    targets: ['noTarget', 'targetPlayer', 'targetOpponent', 'triggeringPlayer'],
    deckHas: null,
    script: (effect, ctx) => {
      if (!isLiteralAmount(effect.count) && effect.count.kind === 'triggeringDamageAmount') {
        return {
          ok: true,
          value: {
            ability: {
              api: ctx.api,
              params: [...ctx.targeting, ...params(['NumCards', 'X'])],
            },
            supportingLines: ['SVar:X:TriggerCount$DamageAmount'],
          },
        };
      }
      if (!isLiteralAmount(effect.count) && effect.count.kind === 'halfTargetLibraryRoundedDown') {
        return {
          ok: true,
          value: {
            ability: {
              api: ctx.api,
              params: [...ctx.targeting, ...params(['NumCards', 'X'])],
            },
            supportingLines: ['SVar:X:TargetedPlayer$CardsInLibrary/HalfDown'],
          },
        };
      }
      return numCards(effect.count, ctx);
    },
  },
  putCounters: {
    api: 'PutCounter',
    // The hand-authored target widenings live in the DSL rule for this effect;
    // this declaration mirrors all of them so the conformance drift alarm can
    // prove Forge does not silently drop one. `selfCreature` is Quirion Dryad's
    // source referent and maps to `Defined$ Self` through `targetParams`.
    targets: [
      'targetCreature',
      'targetCreatureYouControl',
      'targetOpponent',
      'thatCreature',
      'selfCreature',
      'selfPermanent',
      'noTarget',
      'targetCreatureDefendingPlayerControls',
      'enchantedCreature',
      'equippedCreature',
    ],
    deckHas: null,
    script: (effect, ctx) => {
      if (effect.timing === 'nextEndStep') {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.timing`,
              'next-end-step counter placement requires a source-attested delayed-trigger envelope',
            ),
          ],
        };
      }
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
      const triggeringDamageAmount =
        !isLiteralAmount(effect.count) && effect.count.kind === 'triggeringDamageAmount';
      const count = triggeringDamageAmount
        ? 'X'
        : isLiteralAmount(effect.count)
          ? String(effect.count)
          : ctx.computed.numeral(effect.count);
      if (count === null) return computedRejection(ctx.cardId, `${ctx.path}.count`);
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
      const condition =
        effect.recipientCondition === undefined
          ? []
          : params(
              ['ConditionDefined', 'Equipped'],
              ['ConditionPresent', `Creature.${FORGE_COLOR_PROPERTIES[effect.recipientCondition.color]}`],
              ['ConditionCompare', 'EQ1'],
            );
      const selection = [...(scoped ?? ctx.targeting), ...condition];
      const [only, ...rest] = counters;
      const withKeywordRider = (primary: EffectScriptResult): EffectScriptResult => {
        if (!primary.ok || effect.keyword === undefined) return primary;
        return {
          ok: true,
          value: {
            ...primary.value,
            follow: [
              {
                api: 'PumpAll',
                params: [...selection, ...params(['KW', FORGE_KEYWORDS[effect.keyword]])],
              },
            ],
          },
        };
      };
      if (rest.length === 0) {
        const singular: ForgeParam = ['CounterType', only];
        const rendered = withKeywordRider(
          ok(api, [...selection, ...params(singular, ['CounterNum', count])]),
        );
        if (!triggeringDamageAmount || !rendered.ok) return rendered;
        return {
          ok: true,
          value: {
            ...rendered.value,
            supportingLines: [...(rendered.value.supportingLines ?? []), 'SVar:X:TriggerCount$DamageAmount'],
          },
        };
      }
      if (!isLiteralAmount(effect.count)) return computedRejection(ctx.cardId, `${ctx.path}.count`);
      const repeated = Array.from({ length: effect.count }, () => counters).flat();
      const plural: ForgeParam = ['CounterTypes', repeated.join(',')];
      return withKeywordRider(ok(api, [...selection, ...params(plural, ['CounterNum', '1'])]));
    },
  },
  exileTarget: {
    // Forge moves an object between zones with one API and a `Destination$`, so
    // exile is `ChangeZone` the way `returnToHand` is. Unverified against a
    // booted Forge, like every row here.
    api: 'ChangeZone',
    // Altar's Light is `A:SP$ ChangeZone | ValidTgts$ Artifact,Enchantment |
    // Destination$ Exile`, which is this row with one selector swapped.
    targets: [
      'targetCreature',
      'targetOpponent',
      'targetArtifactOrEnchantment',
      'targetPermanent',
      'targetCreatureOpponentControls',
      'targetCardInYourGraveyard',
      'targetCardInOpponentsGraveyard',
      'targetCardInAGraveyard',
      'noTarget',
    ],
    deckHas: null,
    // The same `ChangeZone` with the destination changed, which is how
    // `res/cardsfolder` writes every exile-a-creature spell — and a different
    // API entirely once the effect is scoped, because Forge separates moving one
    // object from moving a group and the DSL does not.
    script: (effect, ctx) => {
      // `RememberChanged$ True` only when a later clause counts what this one
      // exiled; `remember.ts` decides that from the whole chain, because this
      // writer can only see one effect.
      const delayedReturn = effect.returnAtNextEndStep !== undefined;
      const remembered = ctx.computed.remembers || delayedReturn ? [REMEMBER_CHANGED] : [];
      if (effect.scope === undefined) {
        const ability = {
          api: ctx.api,
          params: [
            ...ctx.targeting,
            ...params(
              ['Origin', isGraveyardCardTargetKind(effect.target.kind) ? 'Graveyard' : 'Battlefield'],
              ['Destination', 'Exile'],
            ),
            ...remembered,
          ],
        };
        if (!delayedReturn) return { ok: true, value: { ability } };
        return {
          ok: true,
          value: {
            ability,
            follow: [
              {
                api: 'DelayedTrigger',
                params: params(
                  ['Mode', 'Phase'],
                  ['Phase', 'End of Turn'],
                  ['Execute', 'DelayedZoneReturn'],
                  ['RememberObjects', 'RememberedLKI'],
                  ['TriggerDescription', 'Return exiled card to the battlefield.'],
                ),
              },
              { api: 'Cleanup', params: params(['ClearRemembered', 'True']) },
            ],
            supportingLines: [
              'SVar:DelayedZoneReturn:DB$ ChangeZone | Origin$ Exile | Destination$ Battlefield | Defined$ DelayTriggerRememberedLKI | Tapped$ True',
            ],
            cleansRemembered: true,
          },
        };
      }
      if (isSpaceScope(effect.scope)) {
        if (effect.scopeFilter === undefined) return spaceScopeZoneMoveRejection(ctx, effect.scope);
        const selector = forgeSweepSelector(effect.scope, effect.scopeFilter);
        if (selector === null) return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
        return ok('ChangeZoneAll', [
          ...params(['ChangeType', selector], ['Origin', 'Battlefield'], ['Destination', 'Exile']),
          ...remembered,
        ]);
      }
      if (isAllPlayersScope(effect.scope)) return spaceScopeZoneMoveRejection(ctx, effect.scope);
      if (effect.scope === 'targetAndPermanentsItsPlayerControls') {
        return unwritableSweepRejection(ctx, effect.scope, undefined);
      }
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
    targets: ['targetOpponent', 'targetPlayer'],
    deckHas: null,
    // The targeting clause is the whole ability: which hand is the target, and
    // showing it is what the API does.
    script: (_effect, ctx) => ok(ctx.api, ctx.targeting),
  },
  revealRandomCardFromHand: {
    // Forge's shipped Merfolk Spy source: the random flag precedes the event
    // referent, and `Reveal` (not `RevealHand`) reveals the selected subset.
    api: 'Reveal',
    targets: ['triggeringPlayer'],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, [...params(['Random', 'True']), ...ctx.targeting]),
  },
  playRandomHandCardWithoutPayingManaCost: {
    // Wild Evocation's shipped four-link chain. Remembering bridges the random
    // reveal to mutually exclusive land and spell selectors; Cleanup makes the
    // register local to this resolution.
    api: 'Reveal',
    targets: ['triggeringPlayer'],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: [...params(['Random', 'True'], ['RememberRevealed', 'True']), ...ctx.targeting],
        },
        follow: [
          {
            api: 'ChangeZone',
            params: params(
              ['Origin', 'Hand'],
              ['Destination', 'Battlefield'],
              ['Defined', 'ValidHand Land.IsRemembered'],
              ['ForgetChanged', 'True'],
            ),
          },
          {
            api: 'Play',
            params: params(
              ['ValidZone', 'Hand'],
              ['Controller', 'TriggeredPlayer'],
              ['Defined', 'Remembered'],
              ['ValidSA', 'Spell'],
              ['WithoutManaCost', 'True'],
            ),
          },
          { api: 'Cleanup', params: params(['ClearRemembered', 'True']) },
        ],
        cleansRemembered: true,
      },
    }),
  },
  castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts: {
    api: 'Play',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      if (effect.topXOriginalsProfile !== true) {
        return ok(
          ctx.api,
          params(
            ['Defined', 'Remembered'],
            ['Amount', 'All'],
            ['CopyCard', 'True'],
            ['WithoutManaCost', 'True'],
          ),
        );
      }
      return {
        ok: true,
        value: {
          ability: {
            api: 'Dig',
            params: params(
              ['Defined', 'You'],
              ['DigNum', 'X'],
              ['ChangeNum', 'All'],
              ['DestinationZone', 'Exile'],
              ['RememberChanged', 'True'],
            ),
          },
          follow: [
            {
              api: 'Play',
              params: params(
                ['Valid', 'Card.IsRemembered+YouOwn'],
                ['ValidZone', 'Exile'],
                ['ValidSA', 'Instant.cmcLEX,Sorcery.cmcLEX'],
                ['Controller', 'You'],
                ['WithoutManaCost', 'True'],
                ['Optional', 'True'],
                ['Amount', 'All'],
              ),
            },
            {
              api: 'ChangeZoneAll',
              params: params(
                ['Origin', 'Exile'],
                ['Destination', 'Graveyard'],
                ['ChangeType', 'Card.IsRemembered+YouOwn'],
              ),
            },
            { api: 'Cleanup', params: params(['ClearRemembered', 'True']) },
          ],
          supportingLines: ['SVar:X:Count$xPaid'],
          cleansRemembered: true,
        },
      };
    },
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
    targets: [
      'targetPlayer',
      'targetOpponent',
      'noTarget',
      'targetCardInYourGraveyard',
      'targetCardInAGraveyard',
    ],
    deckHas: null,
    script: (effect, ctx) => {
      if (effect.fromBattlefieldThisTurn === true) {
        return ok('ChangeZone', [
          ...params(
            ['Origin', 'Graveyard'],
            ['Destination', 'Battlefield'],
            ['Defined', 'ValidGraveyard Permanent.YouOwn+ThisTurnEnteredFrom_Battlefield'],
          ),
        ]);
      }
      if (effect.scope === undefined) {
        const arrival = effect.alsoBecomes;
        const ability: ForgeAbility = {
          api: 'ChangeZone',
          params: [
            ...ctx.targeting,
            ...params(
              ['Origin', 'Graveyard'],
              ['Destination', FORGE_CARD_DESTINATIONS[effect.destination ?? 'battlefield']],
            ),
            ...(effect.control === 'you' ? params(['GainControl', 'True']) : []),
            ...(arrival === undefined ? [] : params(['StaticEffect', 'Animate'])),
          ],
        };
        if (arrival === undefined) return { ok: true, value: { ability } };
        return {
          ok: true,
          value: {
            ability,
            supportingLines: [
              `SVar:Animate:Mode$ Continuous | Affected$ Card.IsRemembered${
                arrival.subtypes === undefined ? '' : ` | AddType$ ${arrival.subtypes.join(',')}`
              }${
                arrival.colors === undefined
                  ? ''
                  : ` | AddColor$ ${arrival.colors.map((color) => FORGE_COLOR_PROPERTIES[color]).join(',')}`
              }`,
            ],
          },
        };
      }
      if (effect.scope === 'creatureCardsInAllGraveyards') {
        return ok(ctx.api, [
          ...params(
            ['ChangeType', 'Creature'],
            ['Origin', 'Graveyard'],
            ['Destination', FORGE_CARD_DESTINATIONS[effect.destination ?? 'battlefield']],
          ),
          ...(effect.control === 'you' ? params(['GainControl', 'True']) : []),
        ]);
      }
      if (isSpaceScope(effect.scope)) return spaceScopeZoneMoveRejection(ctx, effect.scope);
      if (effect.scope === 'targetAndPermanentsItsPlayerControls') {
        return unwritableSweepRejection(ctx, effect.scope, undefined);
      }
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
        ...(effect.control === 'you' ? params(['GainControl', 'True']) : []),
      ]);
    },
  },
  fight: {
    api: 'Fight',
    targets: ['targetCreatureYouDontControl', 'targetCreatureDefendingPlayerControls'],
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
    script: (effect, ctx) => {
      if (effect.fighter === undefined) {
        return ok(ctx.api, [...params(['Defined', 'TriggeredCardLKICopy']), ...ctx.targeting]);
      }
      const fighterTargets = FORGE_VALID_TARGETS.targetCreatureYouControl;
      if (fighterTargets === null) {
        throw new Error('Forge has no selector for target creature you control');
      }
      return {
        ok: true,
        value: {
          ability: {
            api: 'Pump',
            params: params(
              ['ValidTgts', fighterTargets],
              ['TgtPrompt', 'Select target creature you control'],
              ['StackDescription', 'None'],
            ),
          },
          follow: [
            {
              api: ctx.api,
              params: [
                ...params(['Defined', 'ParentTarget']),
                ...ctx.targeting,
                ...params(['TgtPrompt', "Select target creature you don't control"]),
              ],
            },
          ],
        },
      };
    },
  },
  petrifyCreature: {
    api: 'PutCounter',
    targets: ['targetCreature'],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: [
            ...ctx.targeting,
            ...params(['CounterNum', '1'], ['CounterType', 'PETRIFICATION'], ['IsCurse', 'True']),
          ],
        },
        follow: [
          {
            api: 'Animate',
            params: params(
              ['Defined', 'Targeted'],
              ['Keywords', 'Defender'],
              ['Colors', 'Colorless'],
              ['OverwriteColors', 'True'],
              ['Types', 'Artifact'],
              ['Duration', 'Permanent'],
            ),
          },
          {
            api: 'Effect',
            params: params(
              ['RememberObjects', 'Targeted'],
              ['StaticAbilities', 'PetrificationCantActivate'],
              ['ForgetOnMoved', 'Battlefield'],
              ['Duration', 'Permanent'],
            ),
          },
        ],
        supportingLines: [
          "SVar:PetrificationCantActivate:Mode$ CantBeActivated | ValidCard$ Card.IsRemembered | Description$ Its activated abilities can't be activated.",
        ],
      },
    }),
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
  revealTopCardToHand: {
    // Dark Tutelage, verbatim: Forge's `Dig` both reveals and moves the same
    // top card. Remembering that moved card lets the following `LoseLife`
    // link read its mana value before the chain clears the register.
    api: 'Dig',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) =>
      ok(
        ctx.api,
        params(
          ['DigNum', '1'],
          ['Reveal', 'True'],
          ['ChangeNum', 'All'],
          ['ChangeValid', 'Card'],
          ['DestinationZone', 'Hand'],
          ...(ctx.computed.remembers ? [REMEMBER_CHANGED] : []),
        ),
      ),
  },
  revealUntilCreatureCards: {
    api: 'DigUntil',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const count = forgeNumber(effect.count, ctx.computed);
      if (count === null) return computedRejection(ctx.cardId, `${ctx.path}.count`);
      const cleansRemembered = ctx.computed.readsRemembered && ctx.computed.isFinalRememberedRead;
      return {
        ok: true,
        value: {
          ability: {
            api: ctx.api,
            params: params(
              ['Amount', count],
              ['Valid', 'Creature.YouOwn'],
              ['ValidDescription', 'creature'],
              ['RevealedDestination', 'Library'],
              ['RevealedLibraryPosition', '0'],
              ['FoundDestination', 'Battlefield'],
              ['Shuffle', 'True'],
            ),
          },
          follow: [
            ...(cleansRemembered ? [{ api: 'Cleanup', params: params(['ClearRemembered', 'True']) }] : []),
            { api: 'Shuffle', params: [] },
          ],
          ...(cleansRemembered ? { cleansRemembered: true } : {}),
        },
      };
    },
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
  putSourceAndTargetOnOwnersLibrariesThenShuffle: {
    // Forge's shipped Void Stalker script is one ChangeZone ability over Self
    // plus the chosen creature. Shuffle$ True applies only after the move and
    // deduplicates a shared owner library, matching the kernel helper.
    api: 'ChangeZone',
    targets: ['targetCreature'],
    deckHas: null,
    script: (_effect, ctx) =>
      ok(ctx.api, [
        ...ctx.targeting,
        ...params(
          ['ThisDefinedAndTgts', 'Self'],
          ['Origin', 'Battlefield'],
          ['Destination', 'Library'],
          ['LibraryPosition', '0'],
          ['Shuffle', 'True'],
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
     * though they ask it at different points in the activation. Forge's
     * Chromatic Lantern uses the canonical `Produced$ Any` spelling for the
     * exact WUBRG choice, so that closed five-color case is preserved too.
     */
    api: 'Mana',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      if (effect.distribution === 'anyCombinationOfColors') {
        return {
          ok: true,
          value: {
            ability: {
              api: ctx.api,
              params: params(['Produced', 'Combo Any'], ['Amount', 'X']),
            },
            supportingLines: ['SVar:X:Count$Valid Creature.withDefender+YouCtrl'],
          },
        };
      }
      const produced = effect.produces.map((color) => FORGE_MANA_PRODUCED[color]);
      const [only] = produced;
      if (only === undefined) return computedRejection(ctx.cardId, `${ctx.path}.produces`);
      const amount = forgeNumber(effect.amount, ctx.computed);
      if (amount === null) return computedRejection(ctx.cardId, `${ctx.path}.amount`);
      const choice =
        amount === '1' && produced.join(' ') === 'W U B R G'
          ? 'Any'
          : produced.length === 1
            ? only
            : `Combo ${produced.join(' ')}`;
      const quantity: readonly ForgeParam[] = amount === '1' ? [] : params(['Amount', amount]);
      return ok(ctx.api, [...params(['Produced', choice]), ...quantity]);
    },
  },
  createEmblem: {
    api: 'Effect',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const grant = effect.emblem.grantsManaAbility;
      const subtype = grant.filter.subtypes[0];
      const color = grant.produces[0];
      const suffix = ctx.path.replace(/[^A-Za-z0-9]/g, '');
      const staticName = `EmblemManaGrant${suffix}`;
      const abilityName = `EmblemManaAbility${suffix}`;
      const symbols = `{${color}}`.repeat(grant.amount);
      return {
        ok: true,
        value: {
          ability: {
            api: ctx.api,
            params: params(
              ['Name', effect.emblem.name],
              ['StaticAbilities', staticName],
              ['Stackable', 'False'],
              ['Duration', 'Permanent'],
            ),
          },
          supportingLines: [
            `SVar:${staticName}:Mode$ Continuous | Affected$ ${subtype}.YouCtrl | AffectedZone$ Battlefield | AddAbility$ ${abilityName} | Description$ ${subtype}s you control have "{T}: Add ${symbols}."`,
            `SVar:${abilityName}:AB$ Mana | Cost$ T | Produced$ ${FORGE_MANA_PRODUCED[color]} | Amount$ ${String(grant.amount)} | SpellDescription$ Add ${symbols}.`,
          ],
        },
      };
    },
  },
  exileGraveyard: {
    // Both forms are `ChangeZoneAll` from `Graveyard` to `Exile`. A targeted
    // player uses Forge's targeting clause and moves `Card`; the legacy owner
    // form keeps the owner in `ChangeType$` and deliberately has no target.
    api: 'ChangeZoneAll',
    targets: ['targetPlayer'],
    deckHas: null,
    script: (effect, ctx) => {
      if (hasTarget(effect)) {
        return ok(ctx.api, [
          ...params(['Origin', 'Graveyard'], ['Destination', 'Exile']),
          ...ctx.targeting,
          ...params(['ChangeType', 'Card']),
          ...(ctx.path.startsWith('modes[') ? params(['IsCurse', 'True']) : []),
        ]);
      }
      if (effect.whose === undefined) {
        throw new Error('Validated exileGraveyard effect lost its owner form');
      }
      return ok(
        ctx.api,
        params(
          ['ChangeType', FORGE_GRAVEYARD_OWNERS[effect.whose]],
          ['Origin', 'Graveyard'],
          ['Destination', 'Exile'],
        ),
      );
    },
  },
  exileNonbasicGraveyardAndMatchingLibrary: {
    api: 'ChangeZoneAll',
    targets: ['targetPlayer'],
    deckHas: null,
    // Verbatim from Forge's Haunting Echoes script. `RememberChanged` retains
    // only cards the first move actually changed; the follow-up lets the
    // controller choose zero-to-all cards sharing one of those names from the
    // targeted player's library, then cleanup ends the temporary relation.
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: params(
            ['Origin', 'Graveyard'],
            ['Destination', 'Exile'],
            ...ctx.targeting,
            ['ChangeType', 'Card.nonBasic'],
            ['RememberChanged', 'True'],
          ),
        },
        follow: [
          {
            api: 'ChangeZone',
            params: params(
              ['Origin', 'Library'],
              ['DefinedPlayer', 'Targeted'],
              ['Destination', 'Exile'],
              ['ChangeType', 'Card.sharesNameWith Remembered'],
              ['ChangeNum', 'X'],
              ['Chooser', 'You'],
              ['Shuffle', 'True'],
            ),
          },
          { api: 'Cleanup', params: params(['ClearRemembered', 'True']) },
        ],
        supportingLines: ['SVar:X:TargetedPlayer$CardsInLibrary'],
      },
    }),
  },
  eachPlayerNamesCardThenRevealsTop: {
    api: 'NameCard',
    targets: [],
    deckHas: null,
    // Verbatim machinery from Forge's Conundrum Sphinx script: collect every
    // player's name before the repeated Dig reveals anything, then clear the
    // temporary named-card relation. `DBDig` stays a named supporting ability
    // because RepeatEach invokes it for each remembered player rather than as
    // the next linear subability in this effect's chain.
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: params(['Defined', 'Player'], ['AILogic', 'RandomInComputerDeck']),
        },
        follow: [
          {
            api: 'RepeatEach',
            params: params(['RepeatPlayers', 'Player'], ['RepeatSubAbility', 'DBDig']),
          },
          { api: 'Cleanup', params: params(['ClearNamedCard', 'True']) },
        ],
        supportingLines: [
          'SVar:DBDig:DB$ Dig | DigNum$ 1 | Defined$ Player.IsRemembered | ChangeNum$ All | ChangeValid$ Card.NamedByRememberedPlayer | Reveal$ True',
        ],
      },
    }),
  },
  nameNonlandCardAndExileMatchingOpponentZones: {
    api: 'NameCard',
    targets: ['targetOpponent'],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: params(['Defined', 'You'], ['ValidCards', 'Card.nonLand'], ['ValidDescription', 'nonland']),
        },
        follow: [
          {
            api: 'ChangeZone',
            params: params(
              ['Origin', 'Graveyard'],
              ['Destination', 'Exile'],
              ...ctx.targeting,
              ['ChangeType', 'Card.NamedCard'],
              ['Chooser', 'You'],
              ['ChangeNum', 'NumInYard'],
              ['Hidden', 'True'],
            ),
          },
          {
            api: 'ChangeZone',
            params: params(
              ['Origin', 'Hand'],
              ['Destination', 'Exile'],
              ['DefinedPlayer', 'Targeted'],
              ['ChangeType', 'Card.NamedCard'],
              ['ChangeNum', 'NumInHand'],
              ['Chooser', 'You'],
            ),
          },
          {
            api: 'ChangeZone',
            params: params(
              ['Origin', 'Library'],
              ['Destination', 'Exile'],
              ['DefinedPlayer', 'Targeted'],
              ['ChangeType', 'Card.NamedCard'],
              ['ChangeNum', 'NumInLib'],
              ['Chooser', 'You'],
              ['Shuffle', 'True'],
            ),
          },
        ],
        supportingLines: [
          'SVar:NumInLib:TargetedPlayer$CardsInLibrary',
          'SVar:NumInHand:TargetedPlayer$CardsInHand',
          'SVar:NumInYard:TargetedPlayer$CardsInGraveyard',
        ],
      },
    }),
  },
  shuffleGraveyardIntoLibrary: {
    // The parameter is `Shuffle$`, and `archangels_light.txt` is the whole
    // plain form: `DB$ ChangeZoneAll | ChangeType$ Card.YouOwn | Origin$
    // Graveyard | Destination$ Library | Shuffle$ True`. It was refused here
    // for as long as `res/cardsfolder` was outside the checkout, which was the
    // right refusal and is no longer the situation; 26 shipped scripts sweep a
    // graveyard into a library and every one of them names `Shuffle$`.
    //
    // The `includeSelf` form is `elixir_of_immortality.txt`, which is the card
    // the DSL field was written for, and its chain is why the field exists
    // rather than a second effect. CR 701.22b makes the two moves and the
    // shuffle one action, so neither move may shuffle: both carry `Shuffle$
    // False` and remember what they moved, a `DB$ Shuffle` on
    // `RememberedOwner` then shuffles once, and a cleanup ends the relation.
    // The order is Elixir's -- the permanent leaves the battlefield first --
    // and `Defined$ Self` is how a permanent names itself while it is still
    // one.
    //
    // One word deviates from Elixir, which writes `ChangeType$ Card.YouCtrl`
    // for the sweep where this writes `Card.YouOwn`. Both ship, and the owner's
    // is the one 13 scripts use for this sweep and the one CR 404.1 makes
    // meaningful: a graveyard is its owner's zone, and a card in it has no
    // controller to name.
    api: 'ChangeZoneAll',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const sweep = (shuffle: 'True' | 'False'): readonly ForgeParam[] =>
        params(
          ['ChangeType', 'Card.YouOwn'],
          ['Origin', 'Graveyard'],
          ['Destination', 'Library'],
          ['Shuffle', shuffle],
        );
      if (effect.includeSelf !== true) {
        return ok(
          ctx.api,
          params(
            ['ChangeType', 'Card.YouOwn'],
            ['Origin', 'Graveyard'],
            ['Destination', 'Library'],
            ['Shuffle', 'True'],
            ...(ctx.computed.remembers ? [REMEMBER_CHANGED] : []),
          ),
        );
      }
      return {
        ok: true,
        value: {
          ability: {
            api: 'ChangeZone',
            params: params(
              ['Origin', 'Battlefield'],
              ['Destination', 'Library'],
              ['Shuffle', 'False'],
              ['RememberChanged', 'True'],
              ['Defined', 'Self'],
            ),
          },
          follow: [
            { api: ctx.api, params: [...sweep('False'), ...params(['RememberChanged', 'True'])] },
            { api: 'Shuffle', params: params(['Defined', 'RememberedOwner']) },
            { api: 'Cleanup', params: params(['ClearRemembered', 'True']) },
          ],
          cleansRemembered: true,
        },
      };
    },
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
      const quotaTypes =
        effect.filterQuotas?.map((quota) => (quota.count === 1 ? forgeSearchType(quota.filter) : null)) ??
        null;
      // `forgeSearchType` is the one-member spelling by contract, so a quota
      // term can never carry the comma that `EACH A & B` has no reading for.
      const quotaChangeType =
        quotaTypes !== null && quotaTypes.every((value): value is string => value !== null)
          ? `EACH ${quotaTypes.join(' & ')}`
          : null;
      const changeType =
        effect.filterQuotas === undefined ? forgeSearchTypeUnion(effect.filter ?? {}) : quotaChangeType;
      if (changeType === null) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.filter`,
              'this search filter has no Forge ChangeType spelling: a named card cannot be spelled, and a quota term takes one spec rather than a member list',
            ),
          ],
        };
      }
      const count = effect.filterQuotas === undefined ? (effect.count ?? 1) : 1;
      if (!isLiteralAmount(count)) return computedRejection(ctx.cardId, `${ctx.path}.count`);
      if (effect.destination === 'libraryTop') {
        return ok(
          ctx.api,
          params(
            ['Origin', 'Library'],
            ['Destination', 'Library'],
            ['LibraryPosition', '0'],
            ['ChangeType', changeType],
            ['ChangeNum', String(count)],
            ['Mandatory', 'True'],
          ),
        );
      }
      if (effect.destination === 'sourceLinkedExile') {
        return ok(
          ctx.api,
          params(
            ['Origin', 'Library'],
            ['Destination', 'Exile'],
            ['ChangeType', changeType],
            ['ChangeNum', String(count)],
            ['ShuffleNonMandatory', 'True'],
          ),
        );
      }
      if (typeof effect.destination !== 'string') {
        if (
          count === 2 &&
          effect.reveal === true &&
          effect.destination.kind === 'oneToHandRestToGraveyard' &&
          changeType === 'Creature'
        ) {
          return {
            ok: true,
            value: {
              ability: {
                api: ctx.api,
                params: params(
                  ['Origin', 'Library'],
                  ['Destination', 'Library'],
                  ['ChangeType', 'Creature'],
                  ['ChangeNum', '2'],
                  ['RememberChanged', 'True'],
                  ['Reveal', 'True'],
                  ['Shuffle', 'False'],
                ),
              },
              follow: [
                {
                  api: 'ChangeZone',
                  params: params(
                    ['Origin', 'Library'],
                    ['Destination', 'Hand'],
                    ['ChangeType', 'Creature.IsRemembered'],
                    ['ChangeNum', '1'],
                    ['Mandatory', 'True'],
                    ['NoLooking', 'True'],
                    ['Shuffle', 'False'],
                  ),
                },
                {
                  api: 'ChangeZone',
                  params: params(
                    ['Origin', 'Library'],
                    ['Destination', 'Graveyard'],
                    ['ChangeType', 'Creature.IsRemembered'],
                    ['Mandatory', 'True'],
                    ['NoLooking', 'True'],
                  ),
                },
                { api: 'Cleanup', params: params(['ClearRemembered', 'True']) },
              ],
            },
          };
        }
        if (
          count !== 2 ||
          effect.reveal !== true ||
          effect.destination.kind !== 'oneAndRest' ||
          effect.destination.one !== 'battlefieldTapped' ||
          effect.destination.rest !== 'hand' ||
          changeType !== 'Land.Basic'
        ) {
          return {
            ok: false,
            rejections: [
              rejection(
                'UNMAPPED_EFFECT_KIND',
                ctx.cardId,
                ctx.path,
                "Forge export currently has source evidence only for Cultivate's two revealed basic lands split between the battlefield tapped and hand",
              ),
            ],
          };
        }
        return {
          ok: true,
          value: {
            ability: {
              api: ctx.api,
              params: params(
                ['Origin', 'Library'],
                ['Destination', 'Library'],
                ['ChangeType', changeType],
                ['ChangeNum', '2'],
                ['RememberChanged', 'True'],
                ['Reveal', 'True'],
                ['Shuffle', 'False'],
              ),
            },
            follow: [
              {
                api: 'ChangeZone',
                params: params(
                  ['Origin', 'Library'],
                  ['Destination', 'Battlefield'],
                  ['ChangeType', 'Land.IsRemembered'],
                  ['ChangeNum', '1'],
                  ['Mandatory', 'True'],
                  ['NoLooking', 'True'],
                  ['Tapped', 'True'],
                  ['Shuffle', 'False'],
                ),
              },
              {
                api: 'ChangeZone',
                params: params(
                  ['Origin', 'Library'],
                  ['Destination', 'Hand'],
                  ['ChangeType', 'Land.IsRemembered'],
                  ['Mandatory', 'True'],
                  ['NoLooking', 'True'],
                ),
              },
              { api: 'Cleanup', params: params(['ClearRemembered', 'True']) },
            ],
          },
        };
      }
      // A revealed search adds no Forge parameter. This is source-proven rather
      // than inferred: upstream `res/cardsfolder/f/fauna_shaman.txt` prints the
      // Oracle word "reveal" and represents the search with an ordinary
      // `ChangeZone` line, with no reveal-specific key. Forge's ChangeZone
      // search machinery owns that public-information consequence, so the DSL
      // flag changes Oracle text while the external script remains the same.
      return ok(
        ctx.api,
        params(
          ['Origin', 'Library'],
          ['Destination', FORGE_CARD_DESTINATIONS[effect.destination]],
          ['ChangeType', changeType],
          ...(effect.filterQuotas === undefined ? ([['ChangeNum', String(count)]] as const) : ([] as const)),
          ['Hidden', 'True'],
          ...(effect.destination === 'battlefieldTapped' ? ([['Tapped', 'True']] as const) : ([] as const)),
          ['ShuffleNonMandatory', 'True'],
        ),
      );
    },
  },
  moveSourceLinkedExile: {
    // Every Forge ChangeZone into exile records the source and its game
    // timestamp through `ExiledWith`. Unlike the card's general remembered set,
    // the source's exiled-card collection is copied into LKI but not into a new
    // ordinary zone incarnation. That is the same CR 400.7 boundary the kernel
    // carries explicitly, including a death trigger resolving after reentry.
    api: 'ChangeZone',
    targets: [],
    deckHas: null,
    script: (effect, ctx) =>
      ok(
        ctx.api,
        params(
          ['Defined', 'ExiledWith'],
          ['Origin', 'Exile'],
          ['Destination', effect.destination === 'hand' ? 'Hand' : 'Battlefield'],
        ),
      ),
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
     * This row intentionally exports a non-targeted resolution-time choice.
     * Printed graveyard targets take the ordinary targeted ChangeZone path
     * instead, with `ValidTgts$` and ownership qualifiers, so the two rules
     * shapes cannot collapse into one another here.
     */
    api: 'ChangeZone',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const changeType = forgeSearchTypeUnion(effect.filter, FORGE_GRAVEYARD_OWNER_QUALIFIERS[effect.whose]);
      if (changeType === null) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.filter`,
              'a graveyard filter naming a card outright has no Forge ChangeType spelling: a card name may contain the comma this grammar reads as the separator between members',
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
  chooseFromBattlefield: {
    api: 'ChangeZone',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const changeType = forgeSweepSelector('permanentsYouControl', effect.filter);
      if (changeType === null) {
        return {
          ok: false,
          rejections: unmappedFilterRejections(ctx, `${ctx.path}.filter`, effect.filter),
        };
      }
      return ok(
        ctx.api,
        params(
          ['Origin', 'Battlefield'],
          ['Destination', 'Hand'],
          ['Hidden', 'True'],
          ['Mandatory', 'True'],
          ['ChangeType', changeType],
          ['ChangeNum', '1'],
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
    targets: [
      'noTarget',
      'targetPlayer',
      'targetOpponent',
      'triggeringPlayer',
      'thatCreaturesController',
      'thatPlayerOrPlaneswalkerController',
    ],
    deckHas: null,
    // A player sweep replaces targeting with its Forge-defined seat group. A
    // bare `noTarget` is the resolving controller (Thoughtflare), so it writes
    // `Defined$ You` without turning the spell into a targeted one.
    script: (effect, ctx) => {
      const targeting =
        effect.players !== undefined
          ? params(['Defined', FORGE_PLAYER_SCOPE_DEFINED[effect.players]])
          : effect.target.kind === 'noTarget'
            ? params(['Defined', 'You'])
            : ctx.targeting;
      if (effect.count === 'all') return ok(ctx.api, [...targeting, ...params(['Mode', 'Hand'])]);
      const count = effect.countFrom === 'chosenX' ? 'X' : String(effect.count);
      const ability = {
        api: ctx.api,
        params: [
          ...targeting,
          ...params(['NumCards', count], ['Mode', effect.random === true ? 'Random' : 'TgtChoose']),
        ],
      };
      return effect.countFrom === 'chosenX'
        ? { ok: true, value: { ability, supportingLines: ['SVar:X:Count$xPaid'] } }
        : { ok: true, value: { ability } };
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
  /**
   * The two linked revealed-hand shapes shipped on Mindclaw Shaman and
   * Shimian Specter. Forge keeps the reveal, choice and use of the chosen
   * object/name in one sub-ability chain, just as the kernel keeps them in one
   * pending record; splitting the link would let a later effect read an
   * unrelated card or leaked name.
   */
  chooseFromRevealedHand: {
    api: 'RevealHand',
    targets: ['targetOpponent', 'triggeringPlayer'],
    deckHas: null,
    script: (effect, ctx) => {
      if (effect.outcome.kind === 'mayCastWithoutPayingManaCost') {
        if (effect.target.kind !== 'targetOpponent') {
          return {
            ok: false,
            rejections: [
              rejection(
                'UNMAPPED_EFFECT_KIND',
                ctx.cardId,
                `${ctx.path}.target`,
                'Forge revealed-hand free casting is source-attested here only for Mindclaw Shaman targeting an opponent',
              ),
            ],
          };
        }
        const kinds = effect.filter.cardTypes ?? [];
        const unsupported =
          kinds.length !== 2 ||
          !kinds.includes('instant') ||
          !kinds.includes('sorcery') ||
          effect.filter.subtypes !== undefined ||
          effect.filter.supertypes !== undefined ||
          effect.filter.colors !== undefined ||
          effect.filter.keywords !== undefined ||
          effect.filter.maxManaValue !== undefined ||
          effect.filter.excludeCardTypes !== undefined ||
          effect.filter.names !== undefined;
        if (unsupported) {
          return {
            ok: false,
            rejections: [
              rejection(
                'UNMAPPED_EFFECT_KIND',
                ctx.cardId,
                `${ctx.path}.filter`,
                "Forge Play from a revealed hand is source-attested here only for Mindclaw Shaman's instant-or-sorcery ValidSA selector",
              ),
            ],
          };
        }
        return {
          ok: true,
          value: {
            ability: { api: ctx.api, params: ctx.targeting },
            follow: [
              {
                api: 'Play',
                params: params(
                  ['Valid', 'Card.TargetedPlayerCtrl'],
                  ['ValidSA', kinds.map((kind) => FORGE_CARD_TYPES[kind]).join(',')],
                  ['ValidZone', 'Hand'],
                  ['WithoutManaCost', 'True'],
                  ['Optional', 'True'],
                ),
              },
            ],
          },
        };
      }

      if (effect.target.kind !== 'triggeringPlayer') {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.target`,
              "Forge remembered-name purging is source-attested here only for Shimian Specter's triggering player",
            ),
          ],
        };
      }

      const excluded = effect.filter.excludeCardTypes ?? [];
      const unsupported =
        excluded.length !== 1 ||
        excluded[0] !== 'land' ||
        effect.filter.cardTypes !== undefined ||
        effect.filter.subtypes !== undefined ||
        effect.filter.supertypes !== undefined ||
        effect.filter.colors !== undefined ||
        effect.filter.keywords !== undefined ||
        effect.filter.maxManaValue !== undefined ||
        effect.filter.names !== undefined;
      if (unsupported) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.filter`,
              "Forge remembered-name choice is source-attested here only for Shimian Specter's nonland selector",
            ),
          ],
        };
      }
      return {
        ok: true,
        value: {
          ability: { api: ctx.api, params: ctx.targeting },
          follow: [
            {
              api: 'ChooseCard',
              params: params(
                ['Choices', 'Card.nonLand+OwnedBy TriggeredTarget'],
                ['ChoiceZone', 'Hand'],
                ['RememberChosen', 'True'],
              ),
            },
            {
              api: 'ChangeZoneAll',
              params: params(
                ['Origin', 'Graveyard'],
                ['Destination', 'Exile'],
                ['Defined', 'TriggeredTarget'],
                ['ChangeType', 'Remembered.sameName'],
              ),
            },
            {
              api: 'ChangeZone',
              params: params(
                ['Origin', 'Hand'],
                ['Destination', 'Exile'],
                ['DefinedPlayer', 'TriggeredTarget'],
                ['ChangeType', 'Remembered.sameName'],
                ['ChangeNum', 'NumInHand'],
                ['Chooser', 'You'],
              ),
            },
            {
              api: 'ChangeZone',
              params: params(
                ['Origin', 'Library'],
                ['Destination', 'Exile'],
                ['DefinedPlayer', 'TriggeredTarget'],
                ['ChangeType', 'Remembered.sameName'],
                ['ChangeNum', 'NumInLib'],
                ['Chooser', 'You'],
                ['Shuffle', 'True'],
              ),
            },
            { api: 'Cleanup', params: params(['ClearRemembered', 'True']) },
          ],
          supportingLines: [
            'SVar:NumInHand:Count$Valid Remembered.sameName+inZoneHand',
            'SVar:NumInLib:Count$Valid Remembered.sameName+inZoneLibrary',
          ],
          cleansRemembered: true,
        },
      };
    },
  },
  // `gainLife`'s row with Forge's other life API, and the same three parts.
  // `deckHas` is `null` rather than a mirror of `LifeGain`: the hint names what
  // a *deck* is built around, and the corpus writes `LifeGain` on cards that
  // gain it, not on cards that take it away.
  loseLife: {
    api: 'LoseLife',
    targets: [
      'noTarget',
      'targetPlayer',
      'targetOpponent',
      'thatPlayer',
      'thatCreaturesController',
      'triggeringPlayer',
    ],
    deckHas: null,
    // `players` is written the way `drawCards` writes it, because Forge's
    // `Defined$` is a definition selector rather than an API's own parameter:
    // `Defined$ Player` is every player at the table on `LoseLife` exactly as
    // it is on `Draw`, which is how the corpus scripts Howling Banshee. The
    // sweep replaces the target clause rather than qualifying it, for that
    // row's reason — the `noTarget` slot beside it would otherwise write
    // `Defined$ You` and take the life off one seat.
    script: (effect, ctx) => {
      if (effect.amountFrom === 'triggeringPlayerLifeHalfRoundedUp') {
        return {
          ok: true,
          value: {
            ability: {
              api: ctx.api,
              params: [...ctx.targeting, ...params(['LifeAmount', 'HavocX'])],
            },
            supportingLines: ['SVar:HavocX:TriggeredPlayer$LifeTotal/HalfUp'],
          },
        };
      }
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
      const defined = effect.players === undefined ? 'You' : FORGE_PLAYER_SCOPE_DEFINED[effect.players];
      return ok(ctx.api, params(['Defined', defined], ['LifeAmount', life]));
    },
  },
  loseGame: {
    api: 'LosesGame',
    targets: ['targetPlayer', 'triggeringPlayer'],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, ctx.targeting),
  },
  winGame: {
    api: 'WinsGame',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, params(['Defined', 'You'])),
  },
  // Fog, copied from Forge master `forge-gui/res/cardsfolder/f/fog.txt`, whose
  // whole ability line is `A:SP$ Fog | SpellDescription$ Prevent all combat
  // damage that would be dealt this turn.` — the DSL primitive's exact sentence
  // on a dedicated API with no parameters to get wrong. Nine more files carry
  // that line verbatim (Holy Day, Darkness, Angelsong, Lull, Root Snare,
  // Moment's Peace, Haze of Pollen, Pause for Reflection, Constant Mists);
  // 2.0.14's shipped corpus spells `Fog` in 69 files in all, 19 of them as this
  // `A:SP$`. `SpellDescription$` is `card-script`'s to write, so this row
  // contributes the API and nothing else.
  //
  // It refused until `mtg-udc9`, on the stated ground that a turn-long blanket
  // prevention is not an effect API in Forge's grammar at all but a continuous
  // replacement installed by an `SP$ Effect`. That sentence is true of the
  // targeted prevention below and false here. The difference is not a detail: a
  // refusal that names a limitation the oracle does not have takes a card off
  // the parity surface permanently, and unlike a wrong export it never trips a
  // boot. `FORGE_VALID_TARGETS`' rule was satisfied the whole time — the
  // spelling was in the corpus, unread.
  preventCombatDamage: {
    api: 'Fog',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, []),
  },
  // Forge master `druids_deliverance.txt`: unlike the symmetric Fog API, the
  // fixed recipient lives on a command-zone damage replacement. The primary
  // Effect installs that replacement and the ordinary effect-chain writer
  // links Populate as its SubAbility, reproducing the source file without a
  // card-name branch.
  preventCombatDamageToYou: {
    api: 'Effect',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: params(['ReplacementEffects', 'RPrevent'], ['AILogic', 'Fog']),
        },
        supportingLines: [
          'SVar:RPrevent:Event$ DamageDone | Prevent$ True | IsCombat$ True | ActiveZones$ Command | ValidTarget$ You | Description$ Prevent all combat damage that would be dealt to you this turn.',
        ],
      },
    }),
  },
  detainPermanent: {
    api: 'Detain',
    targets: ['targetCreatureOpponentControls', 'targetNonlandPermanentOpponentControls'],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, ctx.targeting),
  },
  chooseBlockersThisCombat: {
    api: 'Effect',
    targets: [],
    deckHas: null,
    script: () => ({
      ok: true,
      value: {
        ability: {
          api: 'Effect',
          params: params(['StaticAbilities', 'DeclareCombatants'], ['Duration', 'UntilEndOfCombat']),
        },
        supportingLines: [
          'SVar:DeclareCombatants:Mode$ Continuous | Affected$ Player | DeclaresBlockers$ You | Description$ You choose which creatures block this combat and how those creatures block.',
        ],
      },
    }),
  },
  // A targeted prevention is not an effect API in Forge: there is no
  // `PreventDamage` spelling that takes a target and lasts the turn. Forge
  // writes it as a continuous replacement the resolving `Effect` installs, and
  // `indestructible_aura.txt` and `shielded_passage.txt` are that shape whole
  // and identical to each other:
  //
  //   A:SP$ Effect | ValidTgts$ Creature | ReplacementEffects$ RPrevent |
  //     RememberObjects$ Targeted | ExileOnMoved$ Battlefield
  //   SVar:RPrevent:Event$ DamageDone | Prevent$ True |
  //     ValidTarget$ Card.IsRemembered | Description$ ...
  //
  // `harvestguard_alseids.txt` installs the same pair from a trigger as
  // `DB$ Effect`, and `faithful_squire_kaiso_memory_of_loyalty.txt` from an
  // activation, so the shape is the effect's rather than the spell's -- which
  // is what lets one row serve all three placements. The prevention is scoped
  // by remembering the target rather than by naming it: `RememberObjects$
  // Targeted` puts the creature on the command-zone effect and
  // `Card.IsRemembered` is how the replacement finds it, so the shield follows
  // the object and not a card name. `ExileOnMoved$ Battlefield` ends it when the
  // creature leaves, which is Forge's spelling of a shield on an object that
  // stops existing.
  //
  // Two things those two scripts carry that this does not. `SpellDescription$`
  // is the ability writer's, as for every other row. `AI:RemoveDeck:All` is a
  // card-level directive and both instants have it, but `harvestguard_alseids`
  // does not, and this row cannot tell an instant from a creature's trigger; a
  // card removed from every AI deck because one of its abilities prevents
  // damage would be a worse parity oracle than one the AI plays badly.
  //
  // `RPrevent` is the corpus's own name for the SVar and 89 shipped scripts use
  // it, none of them twice. Two rows here already emit a different definition
  // under it (the combat-damage Fog above, and Safe Passage below), and
  // `appendAbilityLines` deduplicates whole lines rather than names, so a card
  // carrying two prevention effects would export two definitions of one name
  // and Forge would read whichever it read last. That is `mtg-9111`; keeping
  // the corpus name here is the parity-preserving half and the guard belongs in
  // the writer, not in a rename that puts all three rows off-corpus.
  preventAllDamageToTarget: {
    api: 'Effect',
    targets: ['targetCreature'],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: [
            ...ctx.targeting,
            ...params(
              ['ReplacementEffects', 'RPrevent'],
              ['RememberObjects', 'Targeted'],
              ['ExileOnMoved', 'Battlefield'],
            ),
          ],
        },
        supportingLines: [
          'SVar:RPrevent:Event$ DamageDone | Prevent$ True | ValidTarget$ Card.IsRemembered | Description$ Prevent all damage that would be dealt to that creature this turn.',
        ],
      },
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
    targets: [
      'targetCreature',
      'targetCreatureYouControl',
      'selfCreature',
      'thatCreature',
      'equippedCreature',
      'noTarget',
    ],
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
      const granted = params([
        'KW',
        [effect.keyword, ...(effect.additionalKeywords ?? [])]
          .map((keyword) => FORGE_GRANTABLE_KEYWORDS[keyword])
          .join(' & '),
      ]);
      if (effect.scope === undefined) {
        if (effect.removeKeywordAbility === undefined) return ok(ctx.api, [...ctx.targeting, ...granted]);
        return {
          ok: true,
          value: {
            ability: {
              api: 'Debuff',
              params: [...ctx.targeting, ...params(['Keywords', 'Defender'])],
            },
            follow: [{ api: ctx.api, params: [...ctx.targeting, ...granted] }],
          },
        };
      }
      const group = sweepSelection(ctx, effect.scope, effect.scopeFilter);
      if (group === null) return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
      return ok('PumpAll', [...group, ...granted]);
    },
  },
  // Both rows below refused until `mtg-ij03` on one reason: Forge expresses
  // them, but which parameter names it uses is exactly what `res/cardsfolder`
  // would settle and that corpus was not in the checkout. It is now, and both
  // are shipped whole. `preventAllDamageToTarget` above is the same story told
  // earlier.
  //
  // `infiltrate.txt` is a U instant reading "Target creature can't be blocked
  // this turn", which is this row's targeted arm with a different name on it:
  //
  //   A:SP$ Effect | ValidTgts$ Creature | RememberObjects$ Targeted |
  //     ExileOnMoved$ Battlefield | StaticAbilities$ Unblockable
  //   SVar:Unblockable:Mode$ CantBlockBy | ValidAttacker$ Card.IsRemembered |
  //     Description$ This creature can't be blocked this turn.
  //
  // 206 scripts write `StaticAbilities$ Unblockable` and 190 carry that SVar
  // line unedited. The self-scoped arm already wrote the shape, so the two arms
  // differ by what they remember — `Self` against `Targeted` — and by the
  // `ValidTgts$` the targeting builds, which is the whole of the difference
  // between "this creature" and "target creature" in Forge as well.
  //
  // `AILogic$ Pump` is on 30 of the 206 and is not written here. It steers the
  // AI rather than the rule, and the majority omit it; a row that cannot see
  // whether the card is worth the hint should not invent one.
  cantBeBlockedThisTurn: {
    api: 'Effect',
    targets: ['targetCreature', 'targetCreatureYouControl', 'selfCreature', 'thatCreature'],
    deckHas: null,
    script: (effect, ctx) => {
      const self = effect.target.kind === 'selfCreature';
      const retained = effect.target.kind === 'thatCreature';
      return {
        ok: true,
        value: {
          ability: {
            api: ctx.api,
            params: [
              ...(self || retained ? [] : ctx.targeting),
              ...params(
                ['RememberObjects', self ? 'Self' : 'Targeted'],
                [retained ? 'ForgetOnMoved' : 'ExileOnMoved', 'Battlefield'],
                ['StaticAbilities', 'Unblockable'],
              ),
            ],
          },
          supportingLines: [
            `SVar:Unblockable:Mode$ CantBlockBy | ValidAttacker$ Card.IsRemembered | Description$ ${
              self ? 'EFFECTSOURCE' : 'This creature'
            } can't be blocked this turn.`,
          ],
          ...(retained === true
            ? {
                follow: [{ api: 'Cleanup', params: params(['ClearRemembered', 'True']) }],
                cleansRemembered: true,
              }
            : {}),
        },
      };
    },
  },
  // `alluring_siren.txt` settles the question the refusal here named out loud —
  // whether the defender is written at all or left implicit. It is written:
  //
  //   ... RememberObjects$ Targeted | ExileOnMoved$ Battlefield |
  //     StaticAbilities$ MustAttack | IsCurse$ True
  //   SVar:MustAttack:Mode$ MustAttack | ValidCreature$ Creature.IsRemembered |
  //     MustAttack$ You | Description$ This creature attacks you this turn if able.
  //
  // `attacksThisTurnIfAble` below is the same shape with that one key left off,
  // which is what makes the pair legible: the key is the difference between
  // "attacks if able" and "attacks *you* if able", and nothing else is.
  //
  // `IsCurse$ True` is the corpus's, and it is a rule about who may be asked to
  // take the effect rather than an AI hint: Forge refuses to aim a curse at its
  // own creatures. The DSL kind names an opponent's creature, so the two agree.
  //
  // `MustAttack` is the SVar name both rows write, because it is the name the
  // corpus writes for both. Two definitions of one name on one card is
  // `mtg-9111`, which `appendAbilityLines` refuses outright; renaming one of
  // them here to dodge a guard that already exists would put the row off-corpus
  // to no end. The `RPrevent` note above argues the same policy at length.
  attacksYouThisTurnIfAble: {
    api: 'Effect',
    targets: ['targetCreatureYouDontControl'],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: [
            ...ctx.targeting,
            ...params(
              ['RememberObjects', 'Targeted'],
              ['ExileOnMoved', 'Battlefield'],
              ['StaticAbilities', 'MustAttack'],
              ['IsCurse', 'True'],
            ),
          ],
        },
        supportingLines: [
          'SVar:MustAttack:Mode$ MustAttack | ValidCreature$ Creature.IsRemembered | MustAttack$ You | Description$ This creature attacks you this turn if able.',
        ],
      },
    }),
  },
  setColorsUntilEndOfTurn: {
    api: 'Animate',
    targets: ['targetCreature'],
    deckHas: null,
    script: (effect, ctx) =>
      ok(ctx.api, [
        ...ctx.targeting,
        ['Colors', effect.colors.map((color) => FORGE_COLOR_PROPERTIES[color]).join(',')],
        ['OverwriteColors', 'True'],
      ]),
  },
  attacksThisTurnIfAble: {
    api: 'Effect',
    targets: ['targetCreature', 'thatCreature'],
    deckHas: null,
    // Incite in Forge 2.0.14 creates a remembered battlefield effect whose
    // supporting static carries the actual MustAttack rule. `Defined$` is not
    // forwarded: the Effect API remembers the primary spell's Targeted object
    // and the static reads that remembered object by name.
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: params(
            ['StaticAbilities', 'MustAttack'],
            ['ExileOnMoved', 'Battlefield'],
            ['RememberObjects', 'Targeted'],
          ),
        },
        supportingLines: [
          'SVar:MustAttack:Mode$ MustAttack | ValidCreature$ Creature.IsRemembered | Description$ This creature attacks this turn if able.',
        ],
      },
    }),
  },
  cantBlockThisTurn: {
    api: 'Pump',
    targets: ['targetCreature'],
    deckHas: null,
    script: (_effect, ctx) =>
      ok(ctx.api, [...ctx.targeting, ...params(['IsCurse', 'True'], ['KW', "HIDDEN CARDNAME can't block."])]),
  },
  blocksThisTurnIfAble: {
    api: 'Effect',
    targets: ['targetCreature', 'noTarget'],
    deckHas: null,
    script: (effect, ctx) => {
      if (effect.scope === undefined) {
        return {
          ok: true,
          value: {
            ability: {
              api: ctx.api,
              params: [
                ...ctx.targeting,
                ...params(
                  ['StaticAbilities', 'MustBlock'],
                  ['RememberObjects', 'Targeted'],
                  ['ExileOnMoved', 'Battlefield'],
                ),
              ],
            },
            supportingLines: [
              'SVar:MustBlock:Mode$ MustBlock | ValidCreature$ Card.IsRemembered | Description$ This creature blocks this turn if able.',
            ],
          },
        };
      }
      if (
        effect.scope !== 'permanentsOpponentsControl' ||
        effect.scopeFilter?.cardTypes?.length !== 1 ||
        effect.scopeFilter.cardTypes[0] !== 'creature'
      ) {
        return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
      }
      return {
        ok: true,
        value: {
          ability: { api: ctx.api, params: params(['StaticAbilities', 'STBlock']) },
          supportingLines: [
            'SVar:STBlock:Mode$ MustBlock | ValidCreature$ Creature.OppCtrl | Description$ Each creature your opponents control blocks this turn if able.',
          ],
        },
      };
    },
  },
  shuffleHandsAndGraveyardsIntoLibraries: {
    api: 'ChangeZoneAll',
    targets: [],
    deckHas: null,
    // Time Reversal, verbatim from Forge's shipped card script. The two
    // origins are one ChangeZoneAll action and UseAllOriginZones prevents the
    // first origin from exhausting the operation before the second is read.
    script: (_effect, ctx) =>
      ok(
        ctx.api,
        params(
          ['ChangeType', 'Card'],
          ['Origin', 'Hand,Graveyard'],
          ['Destination', 'Library'],
          ['Shuffle', 'True'],
          ['UseAllOriginZones', 'True'],
        ),
      ),
  },
  exileHandsAndGraveyards: {
    api: 'ChangeZoneAll',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: params(['Origin', 'Hand'], ['Destination', 'Exile'], ['ChangeType', 'Card']),
        },
        follow: [
          {
            api: 'ChangeZoneAll',
            params: params(['Origin', 'Graveyard'], ['Destination', 'Exile'], ['ChangeType', 'Card']),
          },
        ],
      },
    }),
  },
  exileThisSpell: {
    api: 'ChangeZone',
    targets: [],
    deckHas: null,
    // A resolving spell is the current stack object, so Forge needs neither a
    // target nor a Defined parameter; this is Time Reversal's shipped line.
    script: (_effect, ctx) => ok(ctx.api, params(['Origin', 'Stack'], ['Destination', 'Exile'])),
  },
  untapPermanent: {
    // Forge's own API, and the corpus spelling is Voltaic Key's: `AB$ Untap`
    // with `ValidTgts$ Permanent` and nothing else. The row is the shortest in
    // this table because the primitive is -- one verb, one target, no rider to
    // carry across. `tapPermanent`'s two extra links are its sweep and its
    // hold, and this kind has neither.
    api: 'Untap',
    targets: [
      'targetPermanent',
      'targetCreature',
      'targetCreatureYouControl',
      'selfCreature',
      'thatCreature',
    ],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, ctx.targeting),
  },
  untapPermanents: {
    api: 'Untap',
    targets: [],
    deckHas: null,
    // Rewind in Forge 2.0.14: `DB$ Untap | UntapUpTo$ True | UntapType$ Land
    // | Amount$ 4`. This non-targeted form deliberately carries no
    // `ValidTgts$`; the filter names the selectable battlefield class instead.
    script: (effect, ctx) => {
      const selectors = forgeFilteredTargets('Permanent', effect.filter, 'base');
      if (selectors === null) {
        return { ok: false, rejections: unmappedFilterRejections(ctx, `${ctx.path}.filter`, effect.filter) };
      }
      return ok(
        ctx.api,
        params(['UntapUpTo', 'True'], ['UntapType', selectors.join(',')], ['Amount', String(effect.upTo)]),
      );
    },
  },
  skipNextUntap: {
    api: 'Pump',
    // `triggeringCreature` is condition-gated in the DSL and bypasses both
    // per-effect target tables. These are the directly chosen spell forms.
    targets: ['targetPermanent', 'targetCreature'],
    deckHas: null,
    // Wall of Frost's current Forge body: a permanent-duration hidden keyword,
    // with no Tap API ahead of it. `targetParams` supplies the block-pair
    // referent.
    script: (_effect, ctx) =>
      ok(ctx.api, [...ctx.targeting, ...params(['KW', HOLD_KEYWORD], ['Duration', 'Permanent'])]),
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
    targets: ['selfCreature', 'selfPermanent'],
    deckHas: 'Sacrifice',
    // The one row in this table that deliberately DROPS `ctx.targeting`.
    // Everywhere else `Defined$ Self` is the right words for a retained
    // referent, but Forge's `Sacrifice` API reads `Defined$` as the PLAYER who
    // sacrifices and `SacValid$` as what gets sacrificed, so passing the
    // source-body target through would name a card where a player belongs.
    // `SacValid$ Self` is the corpus spelling and it is the whole clause.
    script: (_effect, _ctx) => ok('Sacrifice', params(['SacValid', 'Self'])),
  },
  // Diabolic Edict's targeted shape and Destructive Force's player sweep: the
  // affected player, never the caster, chooses what leaves their own board.
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
  // instead. So the targeted form states: the target is a player
  // (`ctx.targeting`), that targeted player is who sacrifices (`Defined$
  // Targeted`), and `SacValid$` carries the filtered permanent set. The sweep
  // replaces those targeting clauses with Forge's source-attested player-scope
  // definition; Destructive Force supplies `Player`, `Land`, and `Amount$ 5`.
  sacrificePermanent: {
    api: 'Sacrifice',
    targets: [
      'targetPlayer',
      'targetOpponent',
      'triggeringPlayer',
      'noTarget',
      'thatPlayerOrPlaneswalkerController',
    ],
    deckHas: 'Sacrifice',
    script: (effect, ctx) => {
      const filter = effect.filter ?? { cardTypes: ['creature'] as const };
      if (unmappedFilterField(filter) !== null) {
        return { ok: false, rejections: unmappedFilterRejections(ctx, `${ctx.path}.filter`, filter) };
      }
      const valid = forgeFilteredTargets('Permanent', filter, 'base');
      if (valid === null) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.filter`,
              'the permanent sacrifice filter has no source-proven Forge SacValid selector',
            ),
          ],
        };
      }
      const who =
        effect.players === undefined
          ? effect.target.kind === 'noTarget'
            ? []
            : effect.target.kind === 'triggeringPlayer' ||
                effect.target.kind === 'thatPlayerOrPlaneswalkerController'
              ? ctx.targeting
              : [...ctx.targeting, ...params(['Defined', 'Targeted'])]
          : params(['Defined', FORGE_PLAYER_SCOPE_DEFINED[effect.players]]);
      const count = effect.count ?? 1;
      const sacrificeValid =
        effect.excludeSource === true ? valid.map((selector) => `${selector}.Other`) : valid;
      return ok('Sacrifice', [
        ...who,
        ...params(['SacValid', sacrificeValid.join(',')]),
        ...(ctx.computed.remembers ? params(['RememberSacrificed', 'True']) : []),
        ...(count === 1 ? [] : params(['Amount', String(count)])),
      ]);
    },
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
  animateLandWhileSourceOnBattlefield: {
    api: 'Animate',
    targets: ['targetPermanent'],
    deckHas: null,
    script: (effect, ctx) =>
      ok(ctx.api, [
        ...ctx.targeting,
        ...params(
          ['Types', ['Creature', ...effect.subtypes].join(',')],
          ['Power', String(effect.power)],
          ['Toughness', String(effect.toughness)],
          ['Colors', effect.colors.map((color) => FORGE_COLOR_PROPERTIES[color]).join(',')],
          ['OverwriteColors', 'True'],
          ['Duration', 'AsLongAsInPlay'],
        ),
      ]),
  },
  animateSourceUntilEndOfTurn: {
    api: 'Animate',
    targets: ['selfPermanent'],
    deckHas: null,
    script: (effect, ctx) =>
      ok(ctx.api, [
        ...ctx.targeting,
        ...params(
          ['Power', String(effect.power)],
          ['Toughness', String(effect.toughness)],
          ['Types', ['Artifact', 'Creature', ...effect.subtypes].join(',')],
          ['RemoveCreatureTypes', 'True'],
          ['Colors', effect.colors.map((color) => FORGE_COLOR_PROPERTIES[color]).join(',')],
          ['OverwriteColors', 'True'],
        ),
        ...(effect.keywords.length === 0
          ? []
          : params(['Keywords', effect.keywords.map((keyword) => FORGE_KEYWORDS[keyword]).join(',')])),
      ]),
  },
  returnSourceFromGraveyard: {
    api: 'ChangeZone',
    targets: [],
    deckHas: null,
    script: (effect, ctx) =>
      ok(ctx.api, [
        ...params(
          ['Origin', 'Graveyard'],
          ['Destination', effect.destination === 'hand' ? 'Hand' : 'Battlefield'],
        ),
        ...(effect.destination === 'battlefieldTapped' ? params(['Tapped', 'True']) : []),
      ]),
  },
  returnDepartedSourceToOwnerHand: {
    api: 'ChangeZone',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) =>
      ok(
        ctx.api,
        params(['Origin', 'Graveyard'], ['Destination', 'Hand'], ['Defined', 'TriggeredNewCardLKICopy']),
      ),
  },
  putDepartedSourceOnTopOfOwnerLibrary: {
    api: 'ChangeZone',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) =>
      ok(
        ctx.api,
        params(
          ['Defined', 'TriggeredNewCardLKICopy'],
          ['Origin', 'Graveyard'],
          ['Destination', 'Library'],
          ['LibraryPosition', '0'],
        ),
      ),
  },
  shuffleSourceIntoOwnerLibrary: {
    api: 'ChangeZone',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) =>
      ok(
        ctx.api,
        params(
          ['Origin', 'Graveyard'],
          ['Destination', 'Library'],
          ['Shuffle', 'True'],
          ['Defined', 'TriggeredCardLKICopy'],
        ),
      ),
  },
  // Forge's Act of Treason script spells temporary control as GainControl with
  // LoseControl$ EOT. Untap and haste remain separate chained DSL effects, so
  // this row contains no card-specific flags.
  gainControlUntilEndOfTurn: {
    api: 'GainControl',
    targets: ['targetCreature'],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, [...ctx.targeting, ...params(['LoseControl', 'EOT'])]),
  },
  // Captivating Vampire, copied from Forge master: a permanent GainControl has
  // no LoseControl clause, and its chained Animate retains the chosen creature
  // through `Defined$ Targeted` for a permanent additive type change.
  gainControl: {
    api: 'GainControl',
    targets: ['targetCreature'],
    deckHas: null,
    script: (_effect, ctx) => ok(ctx.api, ctx.targeting),
  },
  addSubtype: {
    api: 'Animate',
    targets: ['targetCreature', 'thatCreature'],
    deckHas: null,
    script: (effect, ctx) =>
      ok(ctx.api, [...ctx.targeting, ...params(['Types', effect.subtype], ['Duration', 'Permanent'])]),
  },
  // Jinxed Idol, copied from Forge master: the affected object is the source
  // permanent and the opponent is the actual CR 115 target. `Defined$ Self`
  // therefore precedes the ordinary `ValidTgts$ Opponent` clause.
  targetPlayerGainsControlOfSelfPermanent: {
    api: 'GainControl',
    targets: ['targetOpponent'],
    deckHas: null,
    script: (_effect, ctx) =>
      ok(ctx.api, [...params(['Defined', 'Self']), ...params(['ValidTgts', 'Opponent'])]),
  },
  doubleSourceCounters: {
    api: 'MultiplyCounter',
    targets: [],
    deckHas: 'Counters',
    script: (effect, ctx) => {
      const counters = FORGE_COUNTER_TYPES[effect.counter] ?? null;
      if (counters === null || counters.length !== 1) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              ctx.cardId,
              `${ctx.path}.counter`,
              'counter doubling requires one exact Forge counter type',
            ),
          ],
        };
      }
      return ok(ctx.api, params(['Defined', 'Self'], ['CounterType', counters[0]]));
    },
  },
  regeneratePermanent: {
    api: 'Regenerate',
    targets: ['equippedCreature', 'noTarget'],
    deckHas: null,
    script: (effect, ctx) => {
      if (effect.scope === undefined) return ok(ctx.api, ctx.targeting);
      const group = sweepSelection(ctx, effect.scope, effect.scopeFilter);
      if (group === null) return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
      const valid = group.find(([name]) => name === 'ValidCards')?.[1];
      if (valid === undefined) return unwritableSweepRejection(ctx, effect.scope, effect.scopeFilter);
      return ok(ctx.api, params(['Defined', `Valid ${valid}`]));
    },
  },
  returnSourceAuraAttached: {
    api: 'Pump',
    targets: ['targetCreatureYouDontControl'],
    deckHas: null,
    script: (_effect, _ctx) => ({
      ok: true,
      value: {
        ability: {
          api: 'Pump',
          params: params(
            ['ValidTgts', 'Creature'],
            ['TgtPrompt', 'Choose a creature your opponents control'],
            ['TargetsWithDefinedController', 'TriggeredCardOpponent'],
            ['IsCurse', 'True'],
            ['TargetingPlayer', 'TriggeredCardController'],
          ),
        },
        follow: [
          {
            api: 'ChangeZone',
            params: params(
              ['Defined', 'Self'],
              ['Origin', 'Graveyard'],
              ['Destination', 'Battlefield'],
              ['AttachedTo', 'ParentTarget'],
            ),
          },
        ],
      },
    }),
  },
  // Safe Passage, copied from Forge master
  // `forge-gui/res/cardsfolder/s/safe_passage.txt`. Unlike the two older
  // prevention rows above, the exact spell provides both sides of the
  // effect-object seam: an ordinary `SP$ Effect` ability and the named
  // replacement definition it installs in the command zone. `card-script.ts`
  // already carries supporting SVar lines beside an effect chain, so no
  // card-name branch or alternate card assembler is needed.
  preventAllDamageToYouAndCreaturesYouControl: {
    api: 'Effect',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: params(['ReplacementEffects', 'RPrevent'], ['AILogic', 'Fog']),
        },
        supportingLines: [
          'SVar:RPrevent:Event$ DamageDone | Prevent$ True | ActiveZones$ Command | ValidTarget$ You,Creature.YouCtrl | Description$ Prevent all damage that would be dealt to you and creatures you control this turn.',
        ],
      },
    }),
  },
  // Forge master `vengeful_archon.txt`: the target is selected on the harmless
  // primary Pump API and retained by `ParentTarget`; the prevention DB spends X
  // against `You`, and its PreventionSubAbility reads exactly the amount this
  // shield prevented. Keeping the whole protocol on this typed primitive avoids
  // a card-name branch in either the activated-ability or card writer. The DSL
  // schema admits only `chosenX` and its placement validator admits this effect
  // only on an X activation, so the literal `Amount$ X` and `Count$xPaid` below
  // cannot silently rewrite another amount or read a value nobody announced.
  preventNextDamageToYouAndRetaliate: {
    api: 'Pump',
    targets: ['targetPlayerOrPlaneswalker', 'noTarget'],
    deckHas: null,
    script: (effect, ctx) => {
      if (effect.target.kind === 'noTarget') {
        const amount = forgeNumber(effect.amount, ctx.computed);
        return amount === null
          ? computedRejection(ctx.cardId, `${ctx.path}.amount`)
          : ok('PreventDamage', params(['Defined', 'You'], ['Amount', amount]));
      }
      return {
        ok: true,
        value: {
          ability: {
            api: ctx.api,
            params: [
              ...ctx.targeting,
              ...params(
                ['TgtPrompt', 'Select target player or planeswalker damaged by shield effect'],
                ['IsCurse', 'True'],
                ['SubAbility', 'ArchonPrevention'],
                ['StackDescription', 'None'],
                ['AILogic', 'Never'],
              ),
            ],
          },
          supportingLines: [
            'SVar:ArchonPrevention:DB$ PreventDamage | Defined$ You | Amount$ X | PreventionSubAbility$ ArchonsVengeance | ShieldEffectTarget$ ParentTarget',
            'SVar:ArchonsVengeance:DB$ DealDamage | Defined$ ShieldEffectTarget | NumDmg$ PreventedDamage | SpellDescription$ CARDNAME deals that much damage to target player or planeswalker.',
            'SVar:X:Count$xPaid',
            'AI:RemoveDeck:All',
          ],
        },
      };
    },
  },
  // Silence, copied from Forge master
  // `forge-gui/res/cardsfolder/s/silence.txt`: the resolving Effect installs
  // one command-zone CantBeCast rule. This is deliberately not Counter$ True;
  // a spell already on the stack is outside the rule's event.
  cantCastSpellsThisTurn: {
    api: 'Effect',
    targets: [],
    deckHas: null,
    script: (_effect, ctx) => ({
      ok: true,
      value: {
        ability: {
          api: ctx.api,
          params: params(['StaticAbilities', 'STCantBeCast'], ['AILogic', 'BeginningOfOppTurn']),
        },
        supportingLines: [
          "SVar:STCantBeCast:Mode$ CantBeCast | ValidCard$ Card | Caster$ Opponent | Description$ Your opponents can't cast spells.",
        ],
      },
    }),
  },
  // Autumn's Veil, copied from Forge master
  // `forge-gui/res/cardsfolder/a/autumns_veil.txt`. One created effect carries
  // both rules; emitting two chained Effect abilities would be executable but
  // would no longer be parity with the oracle this package exists to provide.
  protectSpellsAndCreaturesFromSpellColorsThisTurn: {
    api: 'Effect',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const words = effect.colors.map((color) => FORGE_COLOR_WORDS[color]);
      const titled = words.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`);
      const last = words.at(-1);
      if (last === undefined) return computedRejection(ctx.cardId, `${ctx.path}.colors`);
      const phrase = words.length === 1 ? last : `${words.slice(0, -1).join(', ')} or ${last}`;
      return {
        ok: true,
        value: {
          ability: {
            api: ctx.api,
            params: params(['ReplacementEffects', 'AntiMagic'], ['StaticAbilities', 'STCantBeTarget']),
          },
          supportingLines: [
            `SVar:AntiMagic:Event$ Counter | ValidSA$ Spell.YouCtrl | ValidCause$ ${titled.map((color) => `Spell.${color}`).join(',')} | Layer$ CantHappen | Description$ Spells you control can't be countered by ${phrase} spells this turn.`,
            `SVar:STCantBeTarget:Mode$ CantTarget | ValidTarget$ Creature.YouCtrl | ValidSource$ ${titled.map((color) => `Card.${color}`).join(',')} | ValidSA$ Spell | Description$ Creatures you control can't be the targets of ${phrase} spells this turn.`,
          ],
        },
      };
    },
  },
  flipCoin: {
    api: 'FlipCoin',
    targets: [],
    deckHas: null,
    script: (effect, ctx) => {
      const names = new Set<string>();
      const supportingLines: string[] = [];
      let token: TokenSpec | undefined;
      const freshName = (preferred: string): string => {
        let candidate = preferred;
        let suffix = 2;
        while (names.has(candidate)) {
          candidate = `${preferred}${String(suffix)}`;
          suffix += 1;
        }
        names.add(candidate);
        return candidate;
      };
      const buildBranch = (
        branch: 'winEffects' | 'loseEffects',
      ): { readonly first: string | undefined; readonly rejections: readonly TranspileRejection[] } => {
        const abilities: { readonly name: string; readonly ability: ForgeAbility }[] = [];
        const rejections: TranspileRejection[] = [];
        for (const [index, nested] of (effect[branch] ?? []).entries()) {
          const result = transpileEffect(nested, ctx.cardId, `${ctx.path}.${branch}[${index}]`, ctx.computed);
          if (!result.ok) {
            rejections.push(...result.rejections);
            continue;
          }
          if (result.value.token !== undefined) {
            if (token !== undefined) {
              rejections.push(
                rejection(
                  'UNMAPPED_EFFECT_KIND',
                  ctx.cardId,
                  `${ctx.path}.${branch}[${index}]`,
                  'a coin branch exporting more than one token surface needs a plural token channel in ForgeEffectScript',
                ),
              );
              continue;
            }
            token = result.value.token;
          }
          const primary =
            nested.kind === 'sacrificeSelf' ? { ...result.value.ability, params: [] } : result.value.ability;
          for (const ability of [primary, ...(result.value.follow ?? [])]) {
            const preferred = ability.api === 'Sacrifice' ? 'DBSac' : `DB${ability.api}`;
            abilities.push({ name: freshName(preferred), ability });
          }
          for (const line of result.value.supportingLines ?? []) {
            if (!supportingLines.includes(line)) supportingLines.push(line);
          }
        }
        supportingLines.push(
          ...renderNamedSubAbilityChain(
            abilities.map((entry) => ({
              name: entry.name,
              rendered: renderSubAbility(entry.ability),
            })),
          ),
        );
        return { first: abilities[0]?.name, rejections };
      };
      const win = buildBranch('winEffects');
      const loss = buildBranch('loseEffects');
      const rejections = [...win.rejections, ...loss.rejections];
      if (rejections.length > 0) return { ok: false, rejections };
      return {
        ok: true,
        value: {
          ability: {
            api: ctx.api,
            params: params(['WinSubAbility', win.first], ['LoseSubAbility', loss.first]),
          },
          ...(supportingLines.length === 0 ? {} : { supportingLines }),
          ...(token === undefined ? {} : { token }),
        },
      };
    },
  },
  reorderTopLibrary: {
    api: 'Dig',
    targets: [],
    deckHas: null,
    script: (effect, ctx) =>
      ok(ctx.api, [
        ['DigNum', String(effect.count)],
        ['ChangeNum', 'All'],
        ['DestinationZone', 'Library'],
        ['DestinationPosition', 'Top'],
      ]),
  },
  selectFromTopLibrary: {
    api: 'Dig',
    targets: [],
    deckHas: null,
    script: (effect, ctx) =>
      effect.grislySalvageProfile === true
        ? ok(ctx.api, [
            ['DigNum', '5'],
            ['Reveal', 'True'],
            ['ChangeNum', '1'],
            ['ChangeValid', 'Creature,Land'],
            ['DestinationZone2', 'Graveyard'],
            ['Optional', 'True'],
          ])
        : ok(ctx.api, [
            ['DigNum', String(effect.count)],
            ['ChangeNum', '1'],
            ['ChangeValid', 'Card.Instant,Card.Sorcery'],
            ['DestinationZone', 'Hand'],
            ['RestRandomOrder', 'False'],
            ['RestZone', 'Library'],
            ['RestPosition', 'Bottom'],
          ]),
  },
  separateTopLibraryIntoPiles: {
    api: 'MultiplePiles',
    targets: [],
    deckHas: null,
    script: (effect, ctx) =>
      ok(ctx.api, [
        ['Zone', 'Library'],
        ['Amount', String(effect.count)],
        ['Reveal', 'True'],
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
    // A retained event referent is a `Defined$` value rather than a
    // `ValidTgts$` choice, and which value depends on the mode: most supported
    // ones name it `TriggeredTarget`, the block modes name the two sides of the
    // pairing `TriggeredAttackerLKICopy` and `TriggeredBlockerLKICopy`.
    // `FORGE_TRIGGERING_CREATURE_REFERENTS` is where those names live, keyed by
    // condition and indexed by `T:` line; the explicit referent wins over it,
    // because a condition whose two lines retain two different creatures can
    // only be answered by the line.
    const named =
      ctx.triggeringCreatureReferent ??
      (ctx.triggerCondition === undefined
        ? undefined
        : FORGE_TRIGGERING_CREATURE_REFERENTS[ctx.triggerCondition]?.[0]);
    return { ok: true, params: [['Defined', named ?? 'TriggeredTarget']] };
  }
  if (target.kind === 'triggeringPlayer') {
    // Both are retained event players rather than `ValidTgts$` choices, but
    // Forge gives the two events different names: Discarded supplies the card
    // controller, while DamageDone supplies its `TriggeredTarget` directly.
    return {
      ok: true,
      params: [
        [
          'Defined',
          ctx.triggerCondition === 'selfDealsCombatDamageToPlayer'
            ? 'TriggeredTarget'
            : ctx.triggerCondition === 'creatureAttacksYouOrPlaneswalkerYouControl'
              ? 'TriggeredAttackerController'
              : ctx.triggerCondition === 'selfAttacksAlone'
                ? 'TriggeredDefendingPlayer'
                : ctx.triggerCondition === 'beginningOfEachPlayersUpkeep'
                  ? 'TriggeredPlayer'
                  : 'TriggeredCardController',
        ],
      ],
    };
  }
  if (target.kind === 'chosenPlayer') {
    return { ok: true, params: [['Defined', 'ChosenPlayer']] };
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
  if (isSourceAttachmentTarget(target.kind)) {
    return {
      ok: true,
      params: [['Defined', target.kind === 'enchantedCreature' ? 'Enchanted' : 'Equipped']],
    };
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
      params: [
        [
          'Defined',
          target.kind === 'thatCreaturesController'
            ? 'TargetedController'
            : target.kind === 'thatPlayerOrPlaneswalkerController'
              ? 'TargetedOrController'
              : 'Targeted',
        ],
      ],
    };
  }
  const mapping: ForgeEffectRow | undefined = FORGE_EFFECTS[effect.kind];
  if (mapping === undefined || isForgeEffectRefusal(mapping)) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          ctx.cardId,
          ctx.path,
          mapping?.refusal.reason ?? `effect "${effect.kind}" has no Forge targeting table`,
        ),
      ],
    };
  }
  const allowed = mapping.targets;
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
  if (isGraveyardCardTargetKind(target.kind)) {
    const filter = targetFilterOf(target);
    const members = filter === null ? ['Card'] : forgeFilteredTargets('Card', filter, 'base');
    if (members === null) {
      return {
        ok: false,
        rejections: unmappedFilterRejections(ctx, `${ctx.path}.target.filter`, filter ?? undefined),
      };
    }
    const qualified =
      target.kind === 'targetCardInYourGraveyard'
        ? members.map((member) => forgeGraveyardTarget(member, 'YouCtrl'))
        : target.kind === 'targetCardInOpponentsGraveyard'
          ? members.map((member) => forgeGraveyardTarget(member, 'OppOwn'))
          : members;
    if (qualified.some((member) => member === null)) {
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_TARGET_KIND',
            ctx.cardId,
            `${ctx.path}.target.kind`,
            'graveyard-card target filter cannot retain Forge ownership qualification',
          ),
        ],
      };
    }
    return {
      ok: true,
      params: [
        ['ValidTgts', qualified.join(',')],
        ...(requiresDistinctTarget(target) ? ([['TargetUnique', 'True']] as const) : []),
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
  const filterBase = target.kind === 'targetCreatureOpponentControls' ? 'Creature' : base;
  const filtered =
    filterBase === null || filterBase === undefined || filter === null
      ? null
      : forgeFilteredTargets(filterBase, filter, 'base');
  const members =
    filtered === null || target.kind !== 'targetCreatureOpponentControls'
      ? filtered
      : filtered.map((member) => forgeRestrictedTarget(member, 'OppCtrl'));
  if (filter !== null && base !== null && base !== undefined && members === null) {
    return { ok: false, rejections: unmappedFilterRejections(ctx, `${ctx.path}.target.filter`, filter) };
  }
  const selectedTargets = members === null ? base : members.join(',');
  const validTgts =
    selectedTargets === null || selectedTargets === undefined || target.excludeSource !== true
      ? selectedTargets
      : forgeRestrictedTarget(selectedTargets, 'Other');
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
  const cardinality: readonly ForgeParam[] = targetsAnyNumber(target)
    ? params(['TargetMin', '0'], ['TargetMax', target.kind === 'anyTarget' ? 'MaxTargets' : 'MaxTgt'])
    : target.count === undefined
      ? []
      : params(['TargetMin', String(targetMinimumOf(target))], ['TargetMax', String(target.count)]);
  const unique: readonly ForgeParam[] = requiresDistinctTarget(target) ? [['TargetUnique', 'True']] : [];
  // The restriction narrows the same clause the kind opened, so it is attached
  // here rather than written as a second parameter: Forge says "creature you
  // control with a +1/+1 counter on it" as one selector
  // (`Creature.YouCtrl+counters_GE1_P1P1`) and has no second place to put half
  // of it. Dropping it silently is what this code did before, and a target list
  // that is quietly wider than the card's is the one bug a parity oracle must
  // not have.
  const restriction = targetRestrictionOf(target);
  if (restriction === null) {
    return { ok: true, params: [['ValidTgts', validTgts], ...cardinality, ...unique] };
  }
  const qualifier = forgeTargetRestriction(restriction);
  if (qualifier === null) {
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
  const exclusionBeforeYouDontControl =
    target.kind === 'targetCreatureYouDontControl' && restriction.kind === 'withoutKeyword';
  const defendingPlayerToughness =
    target.kind === 'targetCreatureDefendingPlayerControls' && restriction.kind === 'maxToughness';
  const restrictionBase = exclusionBeforeYouDontControl || defendingPlayerToughness ? 'Creature' : validTgts;
  const narrowed = forgeRestrictedTarget(restrictionBase, qualifier);
  const restricted = exclusionBeforeYouDontControl
    ? forgeRestrictedTarget(narrowed, 'YouDontCtrl')
    : defendingPlayerToughness
      ? forgeRestrictedTarget(narrowed, 'ControlledBy TriggeredDefendingPlayer')
      : narrowed;
  const prompt: readonly ForgeParam[] =
    restriction.kind === 'playerLostLifeThisTurn'
      ? [['TgtPrompt', 'Select target player who lost life this turn']]
      : [];
  return { ok: true, params: [['ValidTgts', restricted], ...prompt, ...cardinality, ...unique] };
}

/** Forge writes graveyard ownership before characteristic qualifiers. */
function forgeGraveyardTarget(member: string, owner: 'YouCtrl' | 'OppOwn'): string | null {
  if (member.includes(',')) return null;
  const separator = member.indexOf('.');
  return separator === -1
    ? `${member}.${owner}`
    : `${member.slice(0, separator)}.${owner}+${member.slice(separator + 1)}`;
}

/**
 * Forge's optional human-facing prompt for a pure color-filtered creature
 * target. The selector remains the rules-bearing field; this is derived only
 * when it can repeat that selector without dropping another restriction.
 */
function filteredCreaturePrompt(target: TargetSpec): readonly ForgeParam[] {
  if (target.kind !== 'targetCreature') return [];
  const filter = targetFilterOf(target);
  const colors = filter?.colors;
  if (filter === null || colors === undefined || Object.keys(filter).length !== 1) return [];
  const words = colors.map((color) => FORGE_COLOR_WORDS[color].toLowerCase());
  const phrase = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
  return phrase === undefined ? [] : params(['TgtPrompt', `Select target ${phrase} creature.`]);
}

/** Ultimate Price's installed prompt, including its source's absent terminal punctuation. */
function monocoloredCreaturePrompt(target: TargetSpec): readonly ForgeParam[] {
  if (target.kind !== 'targetCreature') return [];
  const filter = targetFilterOf(target);
  return filter?.monocolored === true && Object.keys(filter).length === 1
    ? params(['TgtPrompt', 'Select target monocolored creature'])
    : [];
}

/** Avenging Arrow's installed prompt, including its terminal punctuation. */
function dealtDamageCreaturePrompt(target: TargetSpec): readonly ForgeParam[] {
  if (target.kind !== 'targetCreature') return [];
  const filter = targetFilterOf(target);
  return filter?.dealtDamageThisTurn === true && Object.keys(filter).length === 1
    ? params(['TgtPrompt', 'Select target creature that dealt damage this turn.'])
    : [];
}

/** Forge's source-attested prompts for damage aimed at a player or planeswalker. */
function playerOrPlaneswalkerDamagePrompt(
  target: TargetSpec,
  scope: EffectScope | undefined,
  opponentOnly = false,
): readonly ForgeParam[] {
  if (target.kind !== 'targetPlayerOrPlaneswalker') return [];
  const text = opponentOnly
    ? 'Select target opponent or planeswalker'
    : scope === 'targetAndPermanentsItsPlayerControls'
      ? 'Select a player or planeswalker'
      : 'Select target player or planeswalker';
  return params(['TgtPrompt', text]);
}

function tokenRejections(token: TokenSpec, ctx: TargetContext): TranspileRejection[] {
  const found: TranspileRejection[] = [];
  if (token.characteristicPowerToughness?.kind === 'creaturesYouControl') {
    found.push(
      rejection(
        'UNMAPPED_CHARACTERISTIC_VALUE',
        ctx.cardId,
        `${ctx.path}.token.characteristicPowerToughness`,
        'this token CDA has no source-proven Forge Count$ spelling; exporting its 0/0 storage sentinel would change the token',
      ),
    );
  }
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
  triggerCondition?: TriggerCondition,
  triggeringCreatureReferent?: string,
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
  if (isForgeEffectRefusal(mapping)) {
    return {
      ok: false,
      rejections: [rejection(mapping.refusal.code, cardId, path, mapping.refusal.reason)],
    };
  }
  const target: TargetContext = {
    cardId,
    path,
    ...(triggerCondition === undefined ? {} : { triggerCondition }),
    ...(triggeringCreatureReferent === undefined ? {} : { triggeringCreatureReferent }),
  };

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
  const result = write(effect, { ...target, api: mapping.api, targeting, computed });
  if (effect.kind === 'addMana' && effect.distribution === 'anyCombinationOfColors') return result;
  if (!result.ok || computed.supportingLines.length === 0) return result;
  return {
    ok: true,
    value: {
      ...result.value,
      supportingLines: [...(result.value.supportingLines ?? []), ...computed.supportingLines],
    },
  };
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
