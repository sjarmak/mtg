/**
 * Printed ability -> Forge `S:` line.
 *
 * The sibling of `effect-script.ts`, and it earns its own file for the reason
 * that one gives: the `switch` is exhaustive with an `assertNever` default, so a
 * DSL ability kind the transpiler has no Forge form for is a compile error here
 * rather than a card that boots in Forge missing half its text.
 *
 * Three kinds exist in DSL v1 and each takes its own line. A static is one
 * `S:Mode$ Continuous | …`; a trigger is one `T:Mode$ … | Execute$ <name>` plus
 * an `SVar:` per effect; an activation is one `A:AB$ … | Cost$ …` carrying its
 * first effect, with an `SVar:` per further one. The last two chain through
 * `SubAbility$` the way a multi-effect spell already does (`card-script.ts`).
 *
 * So this file returns *lines* rather than parameters: the caller cannot know
 * which key an ability takes without knowing its kind, and the switch that
 * knows is here.
 */
import type {
  Ability,
  ActivatedAbility,
  ActivationCost,
  AttachingAbility,
  Condition,
  StaticAbility,
  StaticModification,
  TokenSpec,
  TriggeredAbility,
} from '@mtg/dsl';
import {
  assertNever,
  COLORS,
  isAttachingAbility,
  isExaltedAbility,
  isRegenerationAbility,
  renderAbility,
} from '@mtg/dsl';
import type { ForgeAbility, ForgeParam } from './script-text';
import {
  isScriptSafe,
  params,
  renderActivatedAbility,
  renderStaticAbility,
  renderSubAbility,
} from './script-text';
import type { TranspileRejection } from './rejection';
import { rejection } from './rejection';
import { transpileEffect } from './effect-script';
import {
  FORGE_EQUIPPED_AFFECTED,
  FORGE_GRANTABLE_KEYWORDS,
  FORGE_STATIC_AFFECTED,
  FORGE_TRIGGER_MODES,
} from './vocabulary-map';

/** The lines one printed ability contributes, and any token it declares. */
export interface AbilityScript {
  readonly lines: readonly string[];
  readonly tokens: readonly TokenSpec[];
}

export type AbilityScriptResult =
  | { readonly ok: true; readonly value: AbilityScript }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

type ParamResult =
  | { readonly ok: true; readonly params: readonly ForgeParam[] }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

/** `+2` / `-1`: Forge's signed form for `AddPower$` / `AddToughness$`. */
function signed(delta: number): string {
  return delta < 0 ? String(delta) : `+${delta}`;
}

function affectedFor(ability: StaticAbility): string {
  const base = FORGE_STATIC_AFFECTED[ability.scope];
  return ability.subtype === null ? base : `${base}+${ability.subtype}`;
}

/**
 * What one static modification says, with no `Affected$` of its own.
 *
 * The restriction is the caller's because two different clauses reach the same
 * `S:` grammar: a printed static names one of the DSL's scopes, and an equip
 * clause names the creature the source is attached to (`equipScript`). It is
 * also the caller's because an equip clause can carry two modifications and
 * Forge's `S:` line names `Affected$` once — `Mode$ Continuous | Affected$
 * Creature.EquippedBy | AddPower$ +99 | AddToughness$ -3 | AddKeyword$
 * Deathtouch` is one line, not two — so the parts that vary are what this
 * returns and the part that does not is prepended once.
 */
function modificationParams(modification: StaticModification, cardId: string, path: string): ParamResult {
  switch (modification.kind) {
    case 'statBonus':
      return {
        ok: true,
        params: params(
          ['AddPower', signed(modification.power)],
          ['AddToughness', signed(modification.toughness)],
        ),
      };
    case 'grantKeyword': {
      const forgeKeyword = FORGE_GRANTABLE_KEYWORDS[modification.keyword];
      if (forgeKeyword === undefined) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_KEYWORD',
              cardId,
              `${path}.keyword`,
              `keyword "${modification.keyword}" has no Forge K: mapping, so a static cannot grant it`,
            ),
          ],
        };
      }
      return { ok: true, params: params(['AddKeyword', forgeKeyword]) };
    }
    case 'definePt':
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_CHARACTERISTIC_DEFINING_PT',
            cardId,
            `${path}.countOf`,
            `characteristic-defining P/T ("${modification.countOf}") has no Forge script mapping yet`,
          ),
        ],
      };
    // Refused, and not for want of a spelling: Forge writes both of these
    // perfectly well, as an `R:Event$ DamageDone | ... | ReplaceWith$` line and
    // an `R:Event$ GainLife | ...` line. What it does not write them as is an
    // `S:` line, and an `S:` line is the only thing this function returns
    // parameters for — a CR 614 replacement is not a CR 613 static in Forge's
    // grammar any more than it is in ours (`static-replacements.ts` in
    // `@mtg/kernel` makes the same split for the same reason).
    //
    // So the gap is an `R:` emitter this transpiler does not have, and naming it
    // is better than approximating it: there is no `S:` body that doubles
    // damage, and the nearest one that parses would be a card that does
    // something else.
    case 'doubleDamage':
    case 'doubleLifeGain':
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            `${path}.kind`,
            `"${modification.kind}" is a replacement effect: Forge writes it as an R: line and this transpiler emits only S: lines for a static ability`,
          ),
        ],
      };
    // Refused for the same shape of reason the two doublers just above are,
    // not the same cause: Forge writes these six perfectly well too, but as a
    // *different* static grammar than the one this function builds params
    // for. `aura-script.ts`'s `modificationLine` already transpiles
    // `cantAttack`/`cantBlock`/`cantBeBlocked` on an Aura, into
    // `Mode$ CantAttack` / `CantBlock` / `CantBlockBy`, each with its own
    // `ValidCard$`/`ValidAttacker$` scope param — a shape with no
    // `Affected$`, no `AddPower$`/`AddKeyword$`, and a `Mode$` this
    // function's fixed `Continuous` never emits. The four remaining
    // requirements and restrictions (`attacksEachCombatIfAble`,
    // `mustBeBlockedIfAble`, `blockOnlyCreaturesWithKeyword`,
    // `cantBeBlockedBySubtype`) have no Forge form in this codebase at all yet.
    // `cantBeBlockedBySubtype` is the closest of the four to having one and is
    // still refused: Forge's `Mode$ CantBlockBy` takes a `ValidBlocker$` the
    // subtype would go in, but reaching that mode at all means the Aura grammar
    // `aura-script.ts` owns, and guessing the param spelling from a mode name
    // this file has never emitted is how a wrong `S:` line ships looking right.
    // Generalizing a plain static onto the Aura grammar, or adding a grammar
    // Forge has no worked example of here, is a second transpiler this bead did
    // not scope; refusing by name keeps that gap visible instead of emitting an
    // `S:` line Forge would parse as something else.
    case 'cantAttack':
    case 'cantBlock':
    case 'cantBeBlocked':
    case 'attacksEachCombatIfAble':
    case 'mustBeBlockedIfAble':
    case 'blockOnlyCreaturesWithKeyword':
    case 'cantBeBlockedBySubtype':
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            `${path}.kind`,
            `"${modification.kind}" is a combat restriction (CR 508/509): Forge's Aura combat grammar (Mode$ CantAttack/CantBlock/CantBlockBy) does not fit this function's Continuous/Affected$ shape, and this transpiler has no other static grammar to emit it as`,
          ),
        ],
      };
    case 'statBonusPer':
      // Forge spells a scaled continuous bonus with an `SVar` counting the
      // board and an `AddPower$ X` referring to it, which is a second grammar
      // this function's fixed `Continuous`/`Affected$` shape does not emit —
      // the same gap, and the same refusal, the six combat members above take.
      // `board-count.ts` already builds the SVar half for a one-shot amount;
      // joining the two is a transpiler change with its own bead, not a line
      // to guess at here.
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            `${path}.kind`,
            '"statBonusPer" is a layer-7c bonus scaled by a live board count: Forge spells it with a counting SVar plus AddPower$/AddToughness$ referring to it, and this transpiler emits only fixed AddPower$/AddToughness$ values',
          ),
        ],
      };
    default:
      return assertNever(modification, 'modificationParams');
  }
}

/**
 * Every modification one equip clause grants, as the body of a single `S:` line.
 *
 * One line and not one per modification, because Forge reads a `Description$`
 * per static ability and the DSL prints one sentence for the whole clause: two
 * lines would put "Equipped creature gets +99/-3 and has deathtouch." in the
 * card's text box twice. Rejections are collected across every modification
 * rather than returned at the first, so a weapon naming two unmapped keywords
 * reports both.
 */
function modificationsParams(
  modifications: readonly StaticModification[],
  affected: string,
  cardId: string,
  path: string,
): ParamResult {
  const collected: ForgeParam[] = [...params(['Affected', affected])];
  const rejections: TranspileRejection[] = [];
  for (const [index, modification] of modifications.entries()) {
    const result = modificationParams(modification, cardId, `${path}[${index}]`);
    if (result.ok) collected.push(...result.params);
    else rejections.push(...result.rejections);
  }
  if (rejections.length > 0) return { ok: false, rejections };
  return { ok: true, params: collected };
}

/**
 * Forge's `S:` params for `enabledWhile` (CR 611.2c): the static reads live
 * as `Mode$ Continuous` with no clause of its own to switch off, so a
 * condition needs its own pair of params or Forge runs the ability whether or
 * not the condition holds — the exact "strictly better than ours" divergence
 * this function exists to close.
 *
 * `ConditionPresent$`/`ConditionCompare$` is Forge's own conditional-static
 * grammar for `controlsSubtype`: `ConditionPresent$` names the same dotted
 * `Valid` filter `Affected$` already writes elsewhere in this file, and
 * `ConditionCompare$` is a `GE<n>` floor over how many match it — the same
 * "or more" shape `ControlsSubtypeCondition` carries. Unverified against a
 * booted Forge for the reason the `S:`/`T:` mappings already carry that
 * disclaimer (`mtg-17a` is the check).
 *
 * `opponentGraveyardAtLeast` rejects on the same policy and for a sharper
 * reason: `ConditionPresent$` takes the dotted `Valid` filter `Affected$`
 * writes, every one of which selects permanents on a battlefield, and a
 * graveyard count needs a zone qualifier no card in the corpus this package
 * was built from demonstrates. A guess here transpiles clean and counts the
 * wrong pile.
 *
 * `anyCreatureHasCounter` rejects rather than guesses a Forge grammar: it is
 * a board-wide "any creature, not just yours" presence check with no `YouCtrl`
 * scope and no floor to compare, which is not a shape this function's
 * `ConditionPresent$`/`ConditionCompare$` pair was built to express, and this
 * package has no other worked example of a board-wide counter-presence
 * static to crib from. `UNMAPPED_TARGET_RESTRICTION`'s docblock in
 * `rejection.ts` argues the identical policy for a counter-based target
 * restriction this file also refuses rather than guesses at.
 *
 * Real `kind` switch as of `mtg-jp23`, mirroring `conditionHolds`
 * (`packages/kernel/src/characteristics.ts`), `combatConditionHolds`
 * (`packages/kernel/src/combat.ts`) and `checkStaticCondition`
 * (`packages/dsl/src/validate/abilities.ts`): `condition.ts` argues why every
 * call site is real `switch`/`assertNever` dispatch now that `ConditionSchema`
 * has more than one member. Returning `ParamResult` rather than
 * a bare param list, unlike the other four readers, is this function's own
 * addition: it is the one call site whose target format (a Forge `S:` line)
 * cannot express every `Condition` member, so it needed a way to say no that
 * `conditionHolds`, `combatConditionHolds`, `checkStaticCondition` and
 * `conditionPhrase` do not.
 */
function conditionParams(condition: Condition, cardId: string, path: string): ParamResult {
  switch (condition.kind) {
    case 'controlsSubtype':
      return {
        ok: true,
        params: params(
          ['ConditionPresent', `${condition.subtype}.YouCtrl`],
          ['ConditionCompare', `GE${condition.atLeast}`],
        ),
      };
    case 'anyCreatureHasCounter':
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            path,
            '"anyCreatureHasCounter" is a board-wide counter-presence condition: Forge\'s ' +
              'ConditionPresent$/ConditionCompare$ grammar this function otherwise writes has no ' +
              '"any creature, not just yours" scope and no floor to compare against, so there is no ' +
              'Forge form to emit it as',
          ),
        ],
      };
    case 'opponentGraveyardAtLeast':
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            path,
            '"opponentGraveyardAtLeast" counts cards in a graveyard: every `ConditionPresent$` ' +
              'filter this function writes names permanents on a battlefield, and this package ' +
              'has no worked example of a zone-scoped one to crib the qualifier from',
          ),
        ],
      };
    // Forge spells both of these, and this transpiler cannot reach the spelling.
    // Serra Ascendant's own script is `CheckSVar$ X | SVarCompare$ GE30` with
    // `SVar:X:Count$YourLifeTotal` on a line of its own, and Bloodcrazed
    // Goblin's is the same grammar over
    // `SVar:X:PlayerCountPropertyYou$DamageToOppsThisTurn`. `ParamResult`
    // carries params and no `SVar:` line, so the static path can emit the
    // comparison and not the thing compared — a card script naming an SVar
    // nothing defines. That is the limit `statBonusPer` states above, reached
    // from the condition side.
    case 'lifeAtLeast':
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            path,
            '"lifeAtLeast" compares a life total: Forge writes it as CheckSVar$/SVarCompare$ ' +
              "against an SVar:X:Count$YourLifeTotal line, and this transpiler's static path " +
              'emits params with no SVar: line beside them',
          ),
        ],
      };
    case 'noOpponentDealtDamageThisTurn':
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            path,
            '"noOpponentDealtDamageThisTurn" reads accumulated turn state: Forge writes it as ' +
              'CheckSVar$/SVarCompare$ against an SVar:X:PlayerCountPropertyYou$DamageToOppsThisTurn ' +
              "line, and this transpiler's static path emits params with no SVar: line beside them",
          ),
        ],
      };
    default:
      return assertNever(condition, 'conditionParams');
  }
}

function staticParams(ability: StaticAbility, cardId: string, path: string): ParamResult {
  const body = modificationsParams(
    [ability.modification],
    affectedFor(ability),
    cardId,
    `${path}.modification`,
  );
  if (!body.ok) return body;
  const condition = ability.enabledWhile ?? null;
  if (condition === null) return body;
  const conditionResult = conditionParams(condition, cardId, `${path}.enabledWhile`);
  if (!conditionResult.ok) return conditionResult;
  return { ok: true, params: [...body.params, ...conditionResult.params] };
}

/**
 * The `T:` line and the `SVar:` chain behind it.
 *
 * `Execute$` names the first sub-ability and each link names the next, which is
 * the same chaining a multi-effect spell uses; the names carry the ability's
 * index so two triggers on one card cannot collide. A token-making trigger
 * returns the token spec, because Forge needs the token declared on the card
 * whichever line created it.
 */
function triggerScript(
  ability: TriggeredAbility,
  index: number,
  description: string,
  cardId: string,
  path: string,
): AbilityScriptResult {
  if (isExaltedAbility(ability)) {
    return { ok: true, value: { lines: ['K:Exalted'], tokens: [] } };
  }
  if (ability.condition === 'controlledCreatureAttacksAlone') {
    return {
      ok: false,
      rejections: [
        rejection(
          'DSL_VIOLATION',
          cardId,
          path,
          'controlledCreatureAttacksAlone is reserved for the canonical exalted ability; Forge will not approximate an altered envelope',
        ),
      ],
    };
  }
  const rejections: TranspileRejection[] = [];
  const tokens: TokenSpec[] = [];
  const bodies: { readonly name: string; readonly rendered: string }[] = [];
  for (const [position, effect] of ability.effects.entries()) {
    const result = transpileEffect(effect, cardId, `${path}.effects[${position}]`);
    if (!result.ok) {
      rejections.push(...result.rejections);
      continue;
    }
    if (result.value.token !== undefined) tokens.push(result.value.token);
    bodies.push({
      name: `Trig${index + 1}Effect${position + 1}`,
      rendered: renderSubAbility(result.value.ability),
    });
    // A second link from one effect takes the next name in the same sequence,
    // so the `SVar:` chain stays a straight line whatever contributed to it.
    if (result.value.follow !== undefined) {
      bodies.push({
        name: `Trig${index + 1}Effect${position + 1}Hold`,
        rendered: renderSubAbility(result.value.follow),
      });
    }
  }
  if (rejections.length > 0) return { ok: false, rejections };

  const first = bodies[0];
  if (first === undefined) {
    // `AbilitySchema` requires at least one effect and a rejected one returns
    // above, so this is unreachable; it is a rejection rather than a cast
    // because a `T:` line with no `Execute$` would boot in Forge doing nothing.
    return {
      ok: false,
      rejections: [
        rejection('UNMAPPED_EFFECT_KIND', cardId, path, 'a triggered ability carries no effect to execute'),
      ],
    };
  }
  const mode = FORGE_TRIGGER_MODES[ability.condition];
  // A `may` on a trigger is a parameter on the `T:` line rather than anything
  // in the effect body: 1,507 shipped cards write `OptionalDecider$ You` and
  // every one of them puts it ahead of `TriggerDescription$`. Without it the
  // exported card reads "you may" in its description and then does the thing
  // anyway, which is the one failure mode this package exists to rule out —
  // the parity oracle disagreeing with us about a card we exported wrong.
  const decider = ability.optional === true ? ['OptionalDecider$ You'] : [];
  const trigger = [
    ...mode.map(([key, value]) => `${key}$ ${value}`),
    `Execute$ ${first.name}`,
    ...decider,
    `TriggerDescription$ ${description}`,
  ].join(' | ');
  const lines = [`T:${trigger}`];
  for (const [position, body] of bodies.entries()) {
    const next = bodies[position + 1];
    const chained = next === undefined ? body.rendered : `${body.rendered} | SubAbility$ ${next.name}`;
    lines.push(`SVar:${body.name}:${chained}`);
  }
  return { ok: true, value: { lines, tokens } };
}

/**
 * Forge's cost string for an activation: `1 R T Sac<1/CARDNAME>`.
 *
 * Generic first, then one letter per colored pip, then `T` for the tap symbol,
 * then the sacrifice, which is the order and the spelling every
 * `A:AB$ … | Cost$ …` line in `res/cardsfolder` uses. It is `forgeManaCost`'s
 * grammar with the non-mana costs appended, and it is written here rather than
 * reusing that function because a free cost differs: a card with no mana cost
 * writes `0`, while a `{T}`-only ability writes `T` and never `0 T`.
 *
 * `Sac<1/CARDNAME>` is Forge's count-and-filter form for a sacrifice cost, with
 * `CARDNAME` naming the source itself — the same word this transpiler already
 * puts in every `Description$`, so the cost and the printed line name the same
 * permanent. `cost.sacrificeOther` is the same form with a count and a subtype
 * where `1` and `CARDNAME` are — `Sac<2/Key>`. It writes the DSL's subtype
 * verbatim, which is the same word the card's own `Types:` line already carries
 * into Forge, so a set whose subtype Forge does not know fails as one thing
 * rather than as a cost that disagrees with a type line.
 *
 * How common that shape is, counted over the 33,587 scripts in 2.0.14's
 * `res/cardsfolder`: `Sac<count/filter>` appears 2,387 times, 1,192 of them
 * naming a type rather than the source. Of those 1,192, a literal count above
 * one appears 109 times and a variable `X` count 33 more. Narrow it to a
 * *creature* subtype at a literal count above one and eleven
 * remain: `Sac<3/Rat>` and `Sac<2/Saproling>` twice each, then `Sac<8/Spirit>`,
 * `Sac<5/Illusion>`, `Sac<3/Spirit>`, `Sac<3/Cleric>`, `Sac<2/Human>`,
 * `Sac<2/Goblin>` and `Sac<2/Eldrazi>` once each. A Chest is rare, not
 * unprecedented.
 *
 * The commit that first wrote this paragraph said Forge ships 21 scripts of the
 * form, and its commit message repeated it. Twenty-one is `Sac<1/Goblin>` alone;
 * Goblin, Saproling and Food together are 69 occurrences in 67 files, and the
 * form as a whole is the 2,387 above. It is corrected here because a merged
 * commit message cannot be.
 *
 * The mana half is read off Forge 2.0.14's `res/cardsfolder`, not off a game it
 * ran: the same standing gap the `S:` and `T:` mappings carry.
 */
/**
 * The refusal an activation cost with an `{X}` in it earns, or no refusal at
 * all.
 *
 * `card-script.ts` already refuses a *spell* whose mana cost prints X under this
 * code, and the sentence it gives is the whole argument: the exporter has no
 * source-proven X payment mapping. `forgeActivationCost` would drop the symbol
 * silently — it reads `generic` and the five pips and nothing else — and a card
 * that costs `{X}{G}{G}` here and `{G}{G}` in Forge is not the same card, which
 * is exactly the failure the spell-side rejection exists to prevent. So the
 * activation side gets the mirror rather than a wrong script.
 *
 * There is a second half Forge has no spelling for even if the cost were mapped:
 * the effect has to read the announced value back, and `effect-script.ts`
 * refuses every computed amount as `UNMAPPED_COMPUTED_AMOUNT`. Both halves are
 * refused, and neither is worth guessing at — Forge's own `Cost$ X` scripts pair
 * with `SVar:X:Count$xPaid`, which is a mapping this exporter has never proven
 * against a game Forge ran, and this transpiler's standing rule is that an
 * unproven mapping is a rejection rather than a plausible line.
 *
 * Written once and called at both `forgeActivationCost` call sites rather than
 * folded into that function, which returns a string and has no rejection channel
 * to speak through.
 */
function variableActivationCostRejections(
  cost: ActivationCost,
  cardId: string,
  path: string,
): readonly TranspileRejection[] {
  if (!cost.mana.hasX) return [];
  return [
    rejection(
      'UNMAPPED_VARIABLE_MANA',
      cardId,
      `${path}.cost.mana.hasX`,
      'this activation cost contains X, and the Forge exporter has no source-proven X payment mapping; exporting it would ship an ability that costs less here than the kernel charges',
    ),
  ];
}

function forgeActivationCost(cost: ActivationCost): string {
  const pips = COLORS.flatMap((color) => Array.from({ length: Math.max(0, cost.mana[color]) }, () => color));
  const generic = cost.mana.generic > 0 ? [String(cost.mana.generic)] : [];
  const sacrifice = cost.sacrificeOther;
  const parts = [
    ...generic,
    ...pips,
    ...(cost.tapSelf ? ['T'] : []),
    ...(cost.sacrificeSelf ? ['Sac<1/CARDNAME>'] : []),
    ...(sacrifice === undefined ? [] : [`Sac<${sacrifice.count}/${sacrifice.subtype}>`]),
  ];
  return parts.join(' ');
}

type LoyaltyResult =
  | { readonly ok: true; readonly value: { readonly cost: string; readonly description: string } | null }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

/**
 * CR 606.4's loyalty symbol -> the `Cost$` and `SpellDescription$` a Forge
 * loyalty ability writes, or `null` when the ability is an ordinary activation.
 *
 * The cost is a counter payment rather than mana: `AddCounter<1/LOYALTY>` for a
 * plus ability, `SubCounter<6/LOYALTY>` for a minus, and `AddCounter<0/LOYALTY>`
 * for zero, which 53 shipped scripts write against 5 that write `SubCounter<0>`.
 * `checkActivatedAbility` already refuses any mana, tap or sacrifice cost
 * alongside it, so the loyalty payment is the whole cost and not a part of one.
 *
 * The description is the split `equipScript` makes for the same reason: Forge
 * writes the `[+1]:` prefix itself from the cost, so passing the DSL's printed
 * line straight through would put the symbol on the card twice. The prefix is
 * removed by finding the colon that ends it rather than by rebuilding the
 * sentence, so the Forge card and the printed card cannot drift; a printed line
 * that stops carrying the prefix is rejected by name rather than exported with
 * half a card's text, the alarm `equipScript`'s own text rejections are.
 *
 * `Ultimate$ True` is deliberately not written. It is an AI preference hint
 * that tells Forge's AI a walker is worth holding loyalty for, 75 of the 356
 * shipped walkers omit it, and its absence changes how well the AI plays a
 * walker rather than what the rules do with one — unlike `AttachAILogic`,
 * whose absence makes the AI enchant its own creature with a Pacifism.
 * Emitting it would mean threading "this is the last ability" down from
 * `transpileCardScript`, which is real coupling for a preference. `mtg-bc2.153`.
 */
function loyaltyClause(
  ability: ActivatedAbility,
  printed: string,
  cardId: string,
  path: string,
): LoyaltyResult {
  const loyalty = ability.loyaltyCost;
  if (loyalty === undefined) return { ok: true, value: null };
  const cost = loyalty < 0 ? `SubCounter<${-loyalty}/LOYALTY>` : `AddCounter<${loyalty}/LOYALTY>`;
  const end = printed.indexOf(']: ');
  if (!printed.startsWith('[') || end === -1) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNSAFE_SCRIPT_TEXT',
          cardId,
          path,
          `a loyalty ability prints as "[+1]: ..." and this one printed ${JSON.stringify(printed)}, so the loyalty symbol cannot be split off the sentence Forge writes it above`,
        ),
      ],
    };
  }
  return { ok: true, value: { cost, description: printed.slice(end + 3) } };
}

/**
 * The `A:` line and any `SVar:` chain behind it.
 *
 * The first effect rides on the `A:` line itself and each further one hangs off
 * `SubAbility$`, which is the shape a multi-effect spell already uses
 * (`card-script.ts`); the SVar names carry the ability's index so two activated
 * abilities on one card cannot collide. A token-making activation returns the
 * token spec, because Forge needs the token declared on the card whichever line
 * created it.
 *
 * A cost of nothing at all is a rejection rather than an empty `Cost$`: Forge
 * would read `Cost$ | ValidTgts$ Any` as a malformed line, and `checkAbilities`
 * has already refused that card as `ABILITY_COST_INVALID`, so reaching here
 * means the caller skipped validation. "Nothing at all" is measured off the
 * built string rather than off the mana and the tap symbol, so a cost that is
 * only a sacrifice passes here exactly as `checkActivationCost` accepts it.
 */
function activatedScript(
  ability: ActivatedAbility,
  index: number,
  printed: string,
  cardId: string,
  path: string,
): AbilityScriptResult {
  const loyalty = loyaltyClause(ability, printed, cardId, path);
  if (!loyalty.ok) return { ok: false, rejections: loyalty.rejections };
  const variable = variableActivationCostRejections(ability.cost, cardId, path);
  if (variable.length > 0) return { ok: false, rejections: variable };
  const description = loyalty.value?.description ?? printed;
  const cost = loyalty.value?.cost ?? forgeActivationCost(ability.cost);
  if (cost.length === 0) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNSAFE_SCRIPT_TEXT',
          cardId,
          `${path}.cost`,
          'an activation that costs no mana and does not tap has no Forge cost string, and would emit an empty Cost$',
        ),
      ],
    };
  }

  if (isRegenerationAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `A:${renderActivatedAbility({
            api: 'Regenerate',
            params: params(['Cost', cost], ['SpellDescription', description]),
          })}`,
        ],
        tokens: [],
      },
    };
  }

  const rejections: TranspileRejection[] = [];
  const tokens: TokenSpec[] = [];
  const bodies: ForgeAbility[] = [];
  for (const [position, effect] of ability.effects.entries()) {
    const result = transpileEffect(effect, cardId, `${path}.effects[${position}]`);
    if (!result.ok) {
      rejections.push(...result.rejections);
      continue;
    }
    if (result.value.token !== undefined) tokens.push(result.value.token);
    bodies.push(result.value.ability);
    if (result.value.follow !== undefined) bodies.push(result.value.follow);
  }
  if (rejections.length > 0) return { ok: false, rejections };

  const [primary, ...subs] = bodies;
  if (primary === undefined) {
    // `AbilitySchema` requires at least one effect and a rejected one returns
    // above, so this is unreachable; it is a rejection rather than a cast
    // because an `A:` line with no API would boot in Forge doing nothing.
    return {
      ok: false,
      rejections: [
        rejection('UNMAPPED_EFFECT_KIND', cardId, path, 'an activated ability carries no effect to run'),
      ],
    };
  }

  const subName = (position: number): string => `Act${index + 1}Effect${position + 1}`;
  const primaryParams: ForgeParam[] = [
    ['Cost', cost],
    ...primary.params,
    ...(loyalty.value === null ? [] : ([['Planeswalker', 'True']] as readonly ForgeParam[])),
    ...(subs.length > 0 ? ([['SubAbility', subName(1)]] as readonly ForgeParam[]) : []),
    ['SpellDescription', description],
  ];
  const lines = [`A:${renderActivatedAbility({ api: primary.api, params: primaryParams })}`];
  for (const [position, sub] of subs.entries()) {
    const last = position === subs.length - 1;
    const params: ForgeParam[] = [
      ...sub.params,
      ...(last ? [] : ([['SubAbility', subName(position + 2)]] as readonly ForgeParam[])),
    ];
    lines.push(`SVar:${subName(position + 1)}:${renderSubAbility({ api: sub.api, params })}`);
  }
  return { ok: true, value: { lines, tokens } };
}

/**
 * CR 702.6b's equip clause -> `K:Equip:<cost>` plus the static it carries.
 *
 * Forge has the keyword, so the ability that would be an `A:` line anywhere
 * else is a `K:` line here: `Bonesplitter` in 2.0.14's `res/cardsfolder` is
 * `K:Equip:1` beside `S:Mode$ Continuous | Affected$ Creature.EquippedBy |
 * AddPower$ 2`, and 622 shipped scripts carry a `K:Equip:` line. The cost after
 * the colon is Forge's cost string in the same grammar `Cost$` uses —
 * `K:Equip:2`, `K:Equip:1 R` and `K:Equip:Sac<1/Creature>` all ship — so
 * `forgeActivationCost` builds it, and a cost the DSL refuses to print is a
 * cost this line never sees. Which of the two lines comes first is free:
 * 273 shipped scripts write the keyword above the static and 283 below it. The
 * keyword goes first here, beside the card's other `K:` lines.
 *
 * The DSL prints one equip ability as Magic's two lines, "Equipped creature
 * gets +2/+0." and "Equip {2}" (`renderEquipAbility`). Forge writes its own
 * text for a keyword, so only the first line becomes a `Description$` and the
 * second is spent as the `K:` line's cost. That split is the DSL renderer's
 * shape rather than this file's, so a render that stops being two lines is
 * refused by name here instead of silently putting half a card's text into a
 * `Description$`: the two halves of the script have to keep agreeing about what
 * the card says.
 *
 * Both text rejections below are unreachable from a DSL-valid card today, the
 * way `triggerScript`'s empty-`Execute$` one is: `renderEquipAbility` returns
 * exactly two lines and every word in the first comes from a pinned vocabulary,
 * so no card text reaches them. They are the alarm for the renderer changing
 * shape under a transpiler that would otherwise keep exporting.
 */
function equipScript(ability: AttachingAbility, cardId: string, path: string): AbilityScriptResult {
  const printed = renderAbility(ability, 'CARDNAME').split('\n');
  const [granted, equipLine, ...extra] = printed;
  if (granted === undefined || equipLine === undefined || extra.length > 0) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNSAFE_SCRIPT_TEXT',
          cardId,
          path,
          `an equip ability prints two lines, a granted clause and the equip cost; the DSL rendered ${printed.length}`,
        ),
      ],
    };
  }
  if (!isScriptSafe(granted)) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNSAFE_SCRIPT_TEXT',
          cardId,
          path,
          'the clause an equip ability grants contains "|", which would break the static line',
        ),
      ],
    };
  }
  const body = modificationsParams(
    ability.attach.modifications,
    FORGE_EQUIPPED_AFFECTED,
    cardId,
    `${path}.attach.modifications`,
  );
  if (!body.ok) return body;
  // Unreachable from a DSL-valid weapon, the way the two text rejections above
  // are: `checkEquipAbility` holds an equip cost to mana and an equip ability
  // prints no effect, so `checkActivationCost` refuses an `{X}` nothing reads
  // before a card can carry one here. It is the alarm for that pairing changing
  // under an exporter that would otherwise write `K:Equip:` with the symbol
  // silently gone.
  const variable = variableActivationCostRejections(ability.cost, cardId, path);
  if (variable.length > 0) return { ok: false, rejections: variable };
  const cost = forgeActivationCost(ability.cost);
  if (cost.length === 0) {
    // `checkEquipAbility` holds an equip cost to mana and `checkActivationCost`
    // refuses a mana value of zero, so a legal weapon always has a cost string;
    // this is the rejection for one that skipped validation, because `K:Equip:`
    // with nothing after it is a keyword Forge would read as free.
    return {
      ok: false,
      rejections: [
        rejection('UNSAFE_SCRIPT_TEXT', cardId, `${path}.cost`, 'an equip ability costs nothing to activate'),
      ],
    };
  }
  const line = renderStaticAbility([...body.params, ...params(['Description', granted])]);
  return { ok: true, value: { lines: [`K:Equip:${cost}`, `S:${line}`], tokens: [] } };
}

/**
 * The lines one printed ability contributes, `Description$` included.
 *
 * The description is the DSL's own printed line, so the Forge card and the
 * oracle text cannot disagree about what the ability says — the same rule
 * `abilityBlock` follows for spell effects. An equip ability is the one that
 * prints two of them, and it is answered before the rest for that reason.
 */
export function transpileAbility(
  ability: Ability,
  index: number,
  cardId: string,
  path: string,
): AbilityScriptResult {
  if (isAttachingAbility(ability)) return equipScript(ability, cardId, path);
  const description = renderAbility(ability, 'CARDNAME');
  if (!isScriptSafe(description)) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNSAFE_SCRIPT_TEXT',
          cardId,
          path,
          'rendered ability description contains a newline or "|", which would break the ability line',
        ),
      ],
    };
  }
  switch (ability.kind) {
    case 'static': {
      const body = staticParams(ability, cardId, path);
      if (!body.ok) return body;
      const line = renderStaticAbility([...body.params, ...params(['Description', description])]);
      return { ok: true, value: { lines: [`S:${line}`], tokens: [] } };
    }
    case 'triggered':
      return triggerScript(ability, index, description, cardId, path);
    case 'activated':
      return activatedScript(ability, index, description, cardId, path);
    default:
      return assertNever(ability, 'transpileAbility');
  }
}
