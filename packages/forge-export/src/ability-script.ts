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
  AttachModification,
  AttachingAbility,
  Condition,
  LayeredStaticModification,
  StaticAbility,
  StaticGameRuleAbility,
  StaticPlayerRuleAbility,
  StaticBundleAbility,
  StateTriggeredAbility,
  StaticModification,
  TokenSpec,
  TriggeredAbility,
} from '@mtg/dsl';
import {
  abilityLineReminder,
  assertNever,
  counterPhrase,
  effectUsesRevealedCardManaValue,
  effectUsesPaidDiscardManaValue,
  effectUsesPaidSacrificePower,
  effectUsesPaidSacrificeToughness,
  effectUsesSacrificedPermanentPower,
  effectUsesTriggeringCreaturePower,
  effectUsesTriggeringCreatureToughness,
  isAttachingAbility,
  isAngelOfSerenityExileAbility,
  isAngelOfSerenityReturnAbility,
  isConjuredCurrencyAbility,
  isGuildFeudAbility,
  isCounterTriggeringSpellOrAbilityAbility,
  isControlledCreatureCombatDamageCountersAbility,
  isControlledSubtypeAttacksTokenAbility,
  isCombatDamageRetaliationAbility,
  isJaceArchitectAttackDebuffAbility,
  isJaceArchitectPilesAbility,
  isJaceArchitectSearchAndCastAbility,
  isSourceLinkedMatchingPlayCompletionAbility,
  isSourceLinkedTopFiveExileAbility,
  isDamageTargetAndCreaturesWithSameNameAbility,
  isExaltedAbility,
  isEnchantedLandBecomesTappedMillAbility,
  isLayeredStaticModification,
  isOptionalDrawThenDiscardAbility,
  isOptionalDiscardThenDrawAbility,
  isOpponentCreatureDiesReturnAbility,
  isPluralSourceLinkedReturnAbility,
  isRegenerationAbility,
  isReturnAnotherCreatureOrSacrificeSelfAbility,
  isSacrificeSelfUnlessControllerPaysAbility,
  isSacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility,
  isSameNameCohortLinkedExileAbility,
  isScavengeAbility,
  isVariableLoyaltyCost,
  manaValue,
  renderAbility,
  renderEffectList,
  renderEquipModificationClause,
} from '@mtg/dsl';
import type { ForgeAbility, ForgeParam } from './script-text';
import {
  isScriptSafe,
  params,
  renderActivatedAbility,
  renderModeAbility,
  renderNamedSubAbilityChain,
  renderStaticAbility,
  renderSubAbility,
} from './script-text';
import type { TranspileRejection } from './rejection';
import { rejection } from './rejection';
import { transpileEffect } from './effect-script';
import { boardCountValid, statBonusPerValues } from './board-count';
import {
  FORGE_EQUIPPED_AFFECTED,
  FORGE_ADDITIONAL_TRIGGER_MODES,
  FORGE_CARD_TYPES,
  FORGE_COLOR_PROPERTIES,
  FORGE_COLOR_WORDS,
  FORGE_COUNTER_TYPES,
  FORGE_GRANTABLE_KEYWORDS,
  FORGE_KEYWORDS,
  FORGE_STATIC_AFFECTED,
  FORGE_TRIGGER_MODES,
  FORGE_TRIGGERING_CREATURE_REFERENTS,
  FORGE_TRIGGER_SUPPORTING_LINES,
  forgeSearchType,
  forgeSearchTypeUnion,
  forgeFilteredTargets,
} from './vocabulary-map';
import { forgeManaCost } from './mana-script';
import { forgeTokenScriptName } from './naming';
import { forgeSacrificeMatching } from './sacrifice-script';
import { boardCountSvarLines, withBoardCounts } from './board-count';
import {
  NO_COMPUTED_AMOUNTS,
  RESOLUTION_COUNT_CLEANUP,
  readsResolutionCount,
  resolutionCountSpellings,
} from './remember';

/** The lines one printed ability contributes, and any token it declares. */
export interface AbilityScript {
  readonly lines: readonly string[];
  readonly tokens: readonly TokenSpec[];
}

/** Forge's source-proven live player-rule grammars. */
function staticPlayerRuleScript(
  ability: StaticPlayerRuleAbility,
  description: string,
  cardId: string,
  path: string,
): AbilityScriptResult {
  switch (ability.rule) {
    case 'cantAttackWithCreaturesIfCastSpellThisTurn':
      return {
        ok: true,
        value: {
          lines: [
            `S:Mode$ CantAttack | ValidCard$ Creature.ControlledBy Opponent.castSpellThisTurn | Description$ ${description}`,
          ],
          tokens: [],
        },
      };
    case 'cantCastSpellsIfAttackedWithCreatureThisTurn':
      return {
        ok: true,
        value: {
          lines: [
            `S:Mode$ CantBeCast | ValidCard$ Card | Caster$ Opponent.attackedWithCreaturesThisTurn | Description$ ${description}`,
          ],
          tokens: [],
        },
      };
    case 'hasHexproof':
      return {
        ok: true,
        value: {
          lines: [
            `S:Mode$ Continuous | Affected$ You | AddKeyword$ Hexproof | Description$ ${description}`,
            'SVar:NonStackingEffect:True',
          ],
          tokens: [],
        },
      };
    case 'castSpellsAsThoughFlash': {
      const validCard =
        ability.spellFilter === undefined ? 'Card' : forgeSearchTypeUnion(ability.spellFilter);
      if (validCard === null) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_CAST_PERMISSION_FILTER',
              cardId,
              `${path}.spellFilter`,
              'the spell filter has no source-proven Forge ValidCard spelling',
            ),
          ],
        };
      }
      const forgeDescription =
        ability.flashTimingReminder === true
          ? description.replace(' (You may cast them any time you could cast an instant.)', '')
          : description;
      return {
        ok: true,
        value: {
          lines: [
            `S:Mode$ CastWithFlash | ValidCard$ ${validCard} | ValidSA$ Spell | Caster$ You | Description$ ${forgeDescription}`,
            ...(ability.spellFilter === undefined ? ['SVar:NonStackingEffect:True'] : []),
          ],
          tokens: [],
        },
      };
    }
    case 'castSpellsFromHandWithoutPayingManaCost':
      return {
        ok: true,
        value: {
          lines: [
            `S:Mode$ Continuous | Affected$ Card.nonLand+YouOwn | MayPlay$ True | MayPlayWithoutManaCost$ True | AffectedZone$ Hand | Description$ ${description}`,
          ],
          tokens: [],
        },
      };
    case 'cardsToGraveyardAreExiled':
      return {
        ok: true,
        value: {
          lines: [
            `R:Event$ Moved | ActiveZones$ Battlefield | Destination$ Graveyard | ValidCard$ Card.!token+OppOwn | ReplaceWith$ Exile | Description$ ${description}`,
            'SVar:Exile:DB$ ChangeZone | Hidden$ True | Origin$ All | Destination$ Exile | Defined$ ReplacedCard',
            'SVar:NonStackingEffect:True',
          ],
          tokens: [],
        },
      };
    case 'cardsOrTokensToGraveyardAreExiled':
      return {
        ok: true,
        value: {
          lines: [
            `R:Event$ Moved | ActiveZones$ Battlefield | Destination$ Graveyard | ValidCard$ Card | ReplaceWith$ Exile | Description$ ${description}`,
            'SVar:Exile:DB$ ChangeZone | Hidden$ True | Origin$ All | Destination$ Exile | Defined$ ReplacedCard',
          ],
          tokens: [],
        },
      };
    case 'instantOrSorceryCardsToGraveyardAreExiled':
      return {
        ok: true,
        value: {
          lines: [
            `R:Event$ Moved | ActiveZones$ Battlefield | Destination$ Graveyard | ValidCard$ Instant,Sorcery | ReplaceWith$ Exile | Description$ ${description}`,
            'SVar:Exile:DB$ ChangeZone | Hidden$ True | Origin$ All | Destination$ Exile | Defined$ ReplacedCard',
          ],
          tokens: [],
        },
      };
    case 'noMaximumHandSize':
      return {
        ok: true,
        value: {
          lines: [
            `S:Mode$ Continuous | Affected$ You | SetMaxHandSize$ Unlimited | Description$ ${description}`,
          ],
          tokens: [],
        },
      };
    case 'playWithTopLibraryRevealed':
      return {
        ok: true,
        value: {
          lines: [
            `S:Mode$ Continuous | Affected$ Card.TopLibrary+YouCtrl | AffectedZone$ Library | MayLookAt$ Player | Description$ ${description}`,
          ],
          tokens: [],
        },
      };
    case 'attackControllerOrPlaneswalkersTaxedByControlledEnchantments':
      return {
        ok: true,
        value: {
          lines: [
            `S:Mode$ CantAttackUnless | ValidCard$ Creature | Target$ You,Planeswalker.YouCtrl | Cost$ X | Description$ ${description}`,
            'SVar:X:Count$Valid Enchantment.YouCtrl',
          ],
          tokens: [],
        },
      };
    default:
      return assertNever(ability.rule, 'staticPlayerRuleScript');
  }
}

/** Forge master uses two event replacements for Platinum Angel's one line. */
function staticGameRuleScript(ability: StaticGameRuleAbility, description: string): AbilityScriptResult {
  switch (ability.rule) {
    case 'controllerCantLoseAndOpponentsCantWin':
      return {
        ok: true,
        value: {
          lines: [
            `R:Event$ GameLoss | ActiveZones$ Battlefield | ValidPlayer$ You | Layer$ CantHappen | Description$ ${description}`,
            `R:Event$ GameWin | ActiveZones$ Battlefield | ValidPlayer$ Opponent | Layer$ CantHappen | Secondary$ True | Description$ ${description}`,
          ],
          tokens: [],
        },
      };
    case 'playersCantGainLife':
      return {
        ok: true,
        value: {
          lines: [`S:Mode$ CantGainLife | ValidPlayer$ Player | Description$ ${description}`],
          tokens: [],
        },
      };
    case 'damageCantBePrevented':
      return {
        ok: true,
        value: {
          lines: [`S:Mode$ CantPreventDamage | Description$ ${description}`, 'SVar:NonStackingEffect:True'],
          tokens: [],
        },
      };
    case 'cardsInGraveyardsCantBeTargets':
      return {
        ok: true,
        value: {
          lines: [
            `S:Mode$ CantTarget | AffectedZone$ Graveyard | Description$ ${description}`,
            'SVar:NonStackingEffect:True',
          ],
          tokens: [],
        },
      };
    default:
      return assertNever(ability.rule, 'staticGameRuleScript');
  }
}

export type AbilityScriptResult =
  | { readonly ok: true; readonly value: AbilityScript }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

type ParamResult =
  | {
      readonly ok: true;
      readonly params: readonly ForgeParam[];
      readonly supportingLines?: readonly string[];
    }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

type EquipCombatKind = Exclude<AttachModification['kind'], LayeredStaticModification['kind']>;
type EquipCombatModification = Extract<AttachModification, { kind: EquipCombatKind }>;

const FORGE_EQUIP_COMBAT_MODE: Readonly<Record<EquipCombatKind, string>> = {
  cantBeBlocked: 'CantBlockBy',
};

function isEquipCombatModification(
  modification: AttachModification,
): modification is EquipCombatModification {
  return !isLayeredStaticModification(modification);
}

function equipCombatLine(modification: EquipCombatModification, description: readonly ForgeParam[]): string {
  return `S:${renderModeAbility(FORGE_EQUIP_COMBAT_MODE[modification.kind], [
    ...params(['ValidAttacker', FORGE_EQUIPPED_AFFECTED]),
    ...description,
  ])}`;
}

/**
 * The delta a static `AddPower$` / `AddToughness$` carries, written the way the
 * corpus writes it: bare for a bonus, `-` for a penalty.
 *
 * `Pump`'s `NumAtt$` is signed and this is not, which is a difference between
 * two grammar positions rather than an inconsistency. 2.0.15's
 * `res/cardsfolder` writes `NumAtt$ +1` 1,174 times and `NumAtt$ 1` never,
 * while it writes `AddPower$ 1` 863 times, `AddPower$ 2` 497 times, and the
 * signed `AddPower$ +N` in three scripts total. A penalty is bare in both:
 * `AddPower$ -1` is shipped 47 times.
 *
 * Forge reads the two forms identically, which is what makes this a matter of
 * matching the corpus rather than of correctness:
 * `AbilityUtils.calculateAmount` strips a leading `+` or `-` off the value and
 * carries the sign as a multiplier, so `+4` and `4` reach `Integer.parseInt`
 * as the same string.
 */
function statDelta(delta: number): string {
  return String(delta);
}

function affectedFor(ability: StaticAbility): string {
  const base =
    ability.scope === 'allLands'
      ? 'Land'
      : ability.scope === 'allCreatures'
        ? 'Creature'
        : ability.scope === 'landsYouControl'
          ? 'Land.YouCtrl'
          : FORGE_STATIC_AFFECTED[ability.scope];
  if (ability.filter === undefined) return ability.subtype === null ? base : `${base}+${ability.subtype}`;
  const filtered = forgeFilteredTargets(
    'Creature',
    {
      ...(ability.filter.colors === undefined ? {} : { colors: ability.filter.colors }),
      ...(ability.filter.excludeColors === undefined ? {} : { excludeColors: ability.filter.excludeColors }),
    },
    'qualifier',
  );
  if (filtered === null) throw new Error('StaticScopeFilterSchema admitted an unmapped Forge filter');
  const scopeQualifiers =
    ability.scope === 'creaturesYouControl'
      ? ['YouCtrl']
      : ability.scope === 'otherCreaturesYouControl'
        ? ['Other', 'YouCtrl']
        : [];
  const qualifiers = [...(ability.subtype === null ? [] : [ability.subtype]), ...scopeQualifiers];
  const tappedFiltered =
    ability.filter.tapped === true
      ? filtered.map((member) => (member.includes('.') ? `${member}+tapped` : `${member}.tapped`))
      : filtered;
  const tokenFiltered =
    ability.filter.token === true
      ? tappedFiltered.map((member) => (member.includes('.') ? `${member}+token` : `${member}.token`))
      : tappedFiltered;
  return tokenFiltered
    .map((member) => (qualifiers.length === 0 ? member : `${member}+${qualifiers.join('+')}`))
    .join(',');
}

/**
 * What one static modification says, with no `Affected$` of its own.
 *
 * The restriction is the caller's because two different clauses reach the same
 * `S:` grammar: a printed static names one of the DSL's scopes, and an equip
 * clause names the creature the source is attached to (`equipScript`). It is
 * also the caller's because an equip clause can carry several modifications and
 * Forge's `S:` line names `Affected$` once — `Mode$ Continuous | Affected$
 * Creature.EquippedBy | AddPower$ 99 | AddToughness$ -3 | AddKeyword$
 * Deathtouch` is one line, not two — so the parts that vary are what this
 * returns and the part that does not is prepended once.
 */
function modificationParams(
  modification: StaticModification,
  cardId: string,
  path: string,
  svarPrefix: string,
): ParamResult {
  switch (modification.kind) {
    case 'statBonus':
      return {
        ok: true,
        params: params(
          ['AddPower', modification.power === 0 ? undefined : statDelta(modification.power)],
          ['AddToughness', modification.toughness === 0 ? undefined : statDelta(modification.toughness)],
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
    case 'grantKeywordAbilities': {
      const grants = modification.grants.map((grant) => {
        if (grant.kind === 'landwalk') return `Landwalk:${grant.landType}`;
        if (grant.kind === 'protection') {
          const quality =
            grant.quality.kind === 'color' ? FORGE_COLOR_WORDS[grant.quality.color] : grant.quality.subtype;
          return `Protection from ${quality}`;
        }
        return FORGE_GRANTABLE_KEYWORDS[grant.keyword];
      });
      return { ok: true, params: params(['AddKeyword', grants.join(' & ')]) };
    }
    case 'grantTriggeredAbility':
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            `${path}.ability`,
            'a general layer-6 triggered-ability grant needs Forge AddTrigger support; native Exalted is handled by the exact static-ability route',
          ),
        ],
      };
    case 'grantAnyColorManaAbility':
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            path,
            'the exact lands-you-control mana grant is emitted by the static-ability route',
          ),
        ],
      };
    case 'addSubtype':
      return { ok: true, params: params(['AddType', modification.subtype]) };
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
    // Refused here, and not for want of a spelling: Forge writes these as
    // `R:` lines, while this function returns only `S:` parameters. The
    // filtered damage doubler is intercepted by `abilityScript` below and
    // emitted through its `R:Event$ DamageDone` seam. Unfiltered damage and
    // life-gain replacements still have no corresponding ability-line route.
    //
    // Naming the remaining gap is better than approximating it: there is no
    // `S:` body that doubles damage or life gain, and the nearest one that
    // parses would be a card that does something else.
    case 'doubleDamage':
    case 'doubleLifeGain':
    case 'doublePlusOnePlusOneCountersOnCreaturesYouControl':
    case 'damageCannotReduceControllerLifeBelow':
    case 'discardedByOpponentEntersBattlefield':
    case 'preventDamageToSelfAndRemoveCounters':
    case 'preventCombatDamage':
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
    case 'canBlockAnyNumber':
      return { ok: true, params: params(['CanBlockAny', 'True']) };
    // Forge writes a combat restriction as its own `S:Mode$` line, so it can
    // never be a param on the shared `Mode$ Continuous` line this function
    // builds for. Every one a DSL-valid card can print is written before this:
    // `combatRestriction` for a scoped static, `aura-script.ts` and
    // `equipCombatLine` for an attached one, the `cantAttackWithoutAnyOf`
    // intercept for the global restriction, and the `cantAttackOrBlockAlone`
    // `K:` line for the keyword Forge spells out.
    //
    // So these arms are unreachable today, and they stay because the parameter
    // type is the whole `StaticModification` union while the only caller left
    // that shares one line, `staticBundleScript`, takes three kinds none of
    // which are here. A caller that starts passing one must fail by name rather
    // than have its restriction quietly become an `Affected$` param that
    // restricts nothing.
    // CR 509.1c's blocking requirement, and the one combat rule Forge writes as
    // an ordinary Continuous static: `stone_tongue_basilisk.txt` is
    // `S:Mode$ Continuous | Affected$ Card.Self | AddHiddenKeyword$ All
    // creatures able to block CARDNAME do so.` on a plain creature, and 7 more
    // shipped scripts write the same value onto an Aura's or an Equipment's
    // affected creature. `CARDNAME` inside a hidden keyword is the card the
    // keyword was granted to, which is what makes one string serve every scope.
    // Forge's `Mode$ MustBlock` is the near-miss and means the other side of
    // the combat: it names the creature that must block, not the one that must
    // be blocked (`combatRestriction`'s docblock).
    case 'mustBeBlockedIfAble':
      return {
        ok: true,
        params: params(['AddHiddenKeyword', 'All creatures able to block CARDNAME do so.']),
      };
    case 'cantAttack':
    case 'cantBlock':
    case 'cantBeBlocked':
    case 'attacksEachCombatIfAble':
    case 'blockOnlyCreaturesWithKeyword':
    case 'cantBeBlockedBySubtype':
    case 'cantAttackWithoutAnyOf':
    case 'cantAttackOrBlock':
    case 'cantAttackOrBlockAlone':
    case 'canAttackAsThoughNoDefender':
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            `${path}.kind`,
            `"${modification.kind}" is a combat restriction (CR 508/509): Forge writes each one as its own S: mode line (CantAttack/CantBlock/CantBlockBy/MustAttack/MustBlock), which cannot be folded into the Mode$ Continuous line this function builds params for`,
          ),
        ],
      };
    case 'statBonusPer': {
      const values = statBonusPerValues(modification, svarPrefix);
      if (values === null) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              cardId,
              `${path}.each`,
              '"statBonusPer" names a live board tally with no exact Forge Count$Valid spelling',
            ),
          ],
        };
      }
      return {
        ok: true,
        params: params(['AddPower', values.power], ['AddToughness', values.toughness]),
        supportingLines: values.supportingLines,
      };
    }
    case 'statBonusPerColor':
      return {
        ok: true,
        params: params(['AddPower', 'AffectedX']),
        supportingLines: ['SVar:AffectedX:Count$CardNumColors'],
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
  sourceIndices?: readonly number[],
): ParamResult {
  let collected: readonly ForgeParam[] = [...params(['Affected', affected])];
  let rejections: readonly TranspileRejection[] = [];
  let keywordInsert: number | null = null;
  let keywords: readonly string[] = [];
  let supportingLines: readonly string[] = [];
  for (const [index, modification] of modifications.entries()) {
    const sourceIndex = sourceIndices?.[index] ?? index;
    const result = modificationParams(
      modification,
      cardId,
      `${path}[${sourceIndex}]`,
      `StaticStat${String(sourceIndex + 1)}`,
    );
    if (!result.ok) {
      rejections = [...rejections, ...result.rejections];
      continue;
    }
    for (const line of result.supportingLines ?? []) {
      if (!supportingLines.includes(line)) supportingLines = [...supportingLines, line];
    }
    for (const parameter of result.params) {
      if (parameter[0] === 'AddKeyword') {
        keywordInsert ??= collected.length;
        keywords = [...keywords, parameter[1]];
      } else {
        collected = [...collected, parameter];
      }
    }
  }
  if (rejections.length > 0) return { ok: false, rejections };
  if (keywordInsert === null) return { ok: true, params: collected, supportingLines };
  const joined: ForgeParam = ['AddKeyword', keywords.join(' & ')];
  return {
    ok: true,
    params: [...collected.slice(0, keywordInsert), joined, ...collected.slice(keywordInsert)],
    supportingLines,
  };
}

/**
 * Forge's `S:` params for `enabledWhile` (CR 611.2c): the static reads live
 * as `Mode$ Continuous` with no clause of its own to switch off, so a
 * condition needs its own pair of params or Forge runs the ability whether or
 * not the condition holds — the exact "strictly better than ours" divergence
 * this function exists to close.
 *
 * `IsPresent$`/`PresentCompare$` is Forge's board-presence pair on both line
 * kinds this function feeds: `IsPresent$` names the same dotted `Valid` filter
 * `Affected$` already writes elsewhere in this file, and `PresentCompare$` is
 * the comparison over how many match it. `StaticAbility.checkConditions`
 * (`forge-game/.../staticability/StaticAbility.java:426`) reads `IsPresent`,
 * `PresentZone` and `PresentCompare` and nothing else of that family, and
 * `CardTraitBase.meetsCommonRequirements` (`:403`), which is the intervening-if
 * path a `Trigger` inherits, reads the same three. Both default the comparison
 * to `GE1`; this writes it out anyway, which 3 shipped `S:` lines and 11 `T:`
 * lines do, so no branch here has to know what the default is.
 *
 * `controlsSubtype` wrote `ConditionPresent$`/`ConditionCompare$` until
 * `mtg-qd0e`, alone among the cases below. Those are the *spell ability*
 * spelling — `SpellAbilityRestriction` reads them, `StaticAbility` and
 * `CardTraitBase` never query the keys at all — so Forge dropped the condition
 * and ran the static unconditionally, which is a card strictly better than
 * ours in the one artifact whose job is to disagree with us when we are wrong.
 * The corpus says the same thing from outside: of 1587 `ConditionPresent$`
 * uses, 0 sit on an `S:` line.
 *
 * `opponentGraveyardAtLeast` used to reject here on the reasoning that a board
 * presence filter names permanents on a battlefield and a graveyard count needs
 * a zone qualifier nothing demonstrated. The premise was right and the
 * conclusion was too narrow: Forge does not write that condition as a board
 * filter at all, and the case below carries the line `jaces_phantasm.txt`
 * writes instead.
 *
 * `anyCreatureHasCounter` also used to reject, on the reasoning that a
 * board-wide "any creature, not just yours" check has no `YouCtrl` scope to
 * write and no floor to compare. Both halves dissolve on reading the source:
 * `IsPresent` collects `PresentPlayer$ Any` by default, which is every seat,
 * so *unscoped is the wide scope* rather than a missing one, and
 * `PresentCompare` defaults to `GE1`, which is exactly "any". The corpus
 * writes the selector this needs — `ConditionPresent$ Creature.counters_GE1_P1P1`
 * (2 cards) and `Creature.counters_GE1_OIL` (1) on the spell-ability side,
 * `IsPresent$ Creature` (2) and `IsPresent$ Permanent.Black` (1) unscoped on
 * the static side — and the two halves meet in one selector here.
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
          ['IsPresent', `${condition.subtype}.YouCtrl`],
          ['PresentCompare', `GE${condition.atLeast}`],
        ),
      };
    case 'anyCreatureHasCounter': {
      const counterTypes = FORGE_COUNTER_TYPES[condition.counter];
      if (counterTypes === null || counterTypes.length !== 1) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              cardId,
              `${path}.counter`,
              'this board-wide counter condition has no single exact Forge counter type',
            ),
          ],
        };
      }
      return {
        ok: true,
        params: params(['IsPresent', `Creature.counters_GE1_${counterTypes[0]}`], ['PresentCompare', 'GE1']),
      };
    }
    // Not `ConditionPresent$` at all, which is why the refusal this replaces
    // could not find a qualifier: Forge counts a graveyard with a player count
    // rather than a board filter, and compares it the way the two conditions
    // around this one do. `jaces_phantasm.txt` is the card the DSL member was
    // written for and the line is its own, unedited -- `CheckSVar$ X |
    // SVarCompare$ GE10` over `SVar:X:PlayerCountOpponents$HighestCardsInGraveyard`.
    // The count is the highest across opponents, which is "an opponent has ten
    // or more" at any seat count, and 14 shipped scripts define it.
    //
    // `X`, where the life-total conditions below pick `YourLife`: that rename
    // was available because the corpus itself writes both names for that count,
    // and here it writes `X` (12), `Y` (1) and `Z` (1) -- three placeholders
    // and no word. Inventing one would be the going-off-corpus that
    // `COLLIDING_SVAR_DEFINITION` exists to make unnecessary; a card that
    // defines `X` twice is now refused by name rather than exported wrong.
    case 'opponentGraveyardAtLeast':
      return {
        ok: true,
        params: params(['CheckSVar', 'X'], ['SVarCompare', `GE${String(condition.atLeast)}`]),
        supportingLines: ['SVar:X:PlayerCountOpponents$HighestCardsInGraveyard'],
      };
    case 'opponentUndamagedThisTurn':
      return {
        ok: true,
        params: params(['CheckSVar', 'X'], ['SVarCompare', 'LT1']),
        supportingLines: ['SVar:X:PlayerCountPropertyYou$DamageToOppsThisTurn'],
      };
    // `YourLife` rather than the `X` the other conditions here use, and the
    // corpus writes it both ways: 45 shipped scripts define
    // `SVar:X:Count$YourLifeTotal` and 2 define `SVar:YourLife:` with the same
    // count. What separates them is whether `X` was already taken, in both of
    // the two -- `elderscale_wurm.txt` needs `X` for
    // `SVar:X:ReplaceCount$Amount/LimitMax.Difference` and `the_end.txt` for
    // `SVar:X:Count$RememberedSize`, so each author moved the condition off `X`
    // by hand. `serra_ascendant.txt` had no such conflict and kept `X`.
    //
    // A per-card choice is not available here -- a condition writer cannot see
    // what the rest of the card wrote -- so one name is picked per condition
    // kind, and it is the one that never collides. A `CheckSVar$` name is
    // referenced by nothing but its own `SVarCompare$`, so the choice is free
    // where an effect's `X` is not: `Amount$ X` and `NumDmg$ X` name that one.
    // Before this, Elderscale Wurm exported two definitions of `X` and Forge
    // enforced whichever it read last, which is the collision
    // `appendAbilityLines` now refuses outright (`mtg-9111`).
    case 'controllerLifeAtLeast':
      return {
        ok: true,
        params: params(['CheckSVar', 'YourLife'], ['SVarCompare', `GE${String(condition.atLeast)}`]),
        supportingLines: ['SVar:YourLife:Count$YourLifeTotal'],
      };
    case 'controllerLifeBelow':
      return {
        ok: true,
        params: params(['CheckSVar', 'YourLife'], ['SVarCompare', `LT${String(condition.fewerThan)}`]),
        supportingLines: ['SVar:YourLife:Count$YourLifeTotal'],
      };
    case 'controllerLibraryAtLeast':
      return {
        ok: true,
        params: params(
          ['IsPresent', 'Card.YouCtrl'],
          ['PresentZone', 'Library'],
          ['PresentCompare', `GE${String(condition.atLeast)}`],
        ),
      };
    case 'controllerTopLibraryHasColor':
      return {
        ok: true,
        params: params(['TopCardOfLibraryIs', `Card.${FORGE_COLOR_PROPERTIES[condition.color]}`]),
      };
    case 'battlefieldCountBelow': {
      const present = boardCountValid(condition.filter, { whose: 'each' });
      if (present === null) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              cardId,
              path,
              'this whole-battlefield condition filter has no single source-proven Forge IsPresent spelling',
            ),
          ],
        };
      }
      return {
        ok: true,
        params: params(['IsPresent', present], ['PresentCompare', `LT${String(condition.fewerThan)}`]),
      };
    }
    case 'controlsNoneOfSubtypes':
      return {
        ok: true,
        params: params(
          ['IsPresent', condition.subtypes.map((subtype) => `${subtype}.YouCtrl`).join(',')],
          ['PresentCompare', 'EQ0'],
        ),
      };
    case 'selfCounterCountBelow': {
      const counterTypes = FORGE_COUNTER_TYPES[condition.counter];
      if (counterTypes === null || counterTypes.length !== 1) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              cardId,
              `${path}.counter`,
              'this source-counter condition has no single exact Forge counter type',
            ),
          ],
        };
      }
      const variable = condition.counter === 'charge' && condition.fewerThan === 1 ? 'NoCharge' : 'X';
      return {
        ok: true,
        params: params(
          ['CheckSVar', variable],
          ['SVarCompare', variable === 'NoCharge' ? 'EQ0' : `LT${String(condition.fewerThan)}`],
        ),
        supportingLines: [`SVar:${variable}:Count$CardCounters.${counterTypes[0]}`],
      };
    }
    case 'selfCounterCountAtLeast': {
      const counterTypes = FORGE_COUNTER_TYPES[condition.counter];
      if (counterTypes === null || counterTypes.length !== 1) {
        return {
          ok: false,
          rejections: [
            rejection(
              'UNMAPPED_EFFECT_KIND',
              cardId,
              `${path}.counter`,
              'this source-counter condition has no single exact Forge counter type',
            ),
          ],
        };
      }
      return {
        ok: true,
        params: params(['CheckSVar', 'X'], ['SVarCompare', `GE${String(condition.atLeast)}`]),
        supportingLines: [`SVar:X:Count$CardCounters.${counterTypes[0]}`],
      };
    }
    default:
      return assertNever(condition, 'conditionParams');
  }
}

function staticBundleScript(
  ability: StaticBundleAbility,
  description: string,
  cardId: string,
  path: string,
): AbilityScriptResult {
  const subtype = ability.subtype === undefined ? '' : `.${ability.subtype}`;
  const affected = `Creature${subtype}+Other+YouCtrl${ability.includeSelf === true ? ',Card.Self' : ''}`;
  const body = modificationsParams(ability.modifications, affected, cardId, `${path}.modifications`);
  if (!body.ok) return body;
  const condition = conditionParams(ability.enabledWhile, cardId, `${path}.enabledWhile`);
  if (!condition.ok) return condition;
  const forgeDescription = description.replace(', this creature and ', ', CARDNAME and ');
  return {
    ok: true,
    value: {
      lines: [
        `S:${renderStaticAbility([
          ...body.params,
          ...condition.params,
          ...params(['Description', forgeDescription]),
        ])}`,
        ...(condition.supportingLines ?? []),
      ],
      tokens: [],
    },
  };
}

/**
 * Forge's combat-restriction grammar for a static ability, or `null` when the
 * modification is not one.
 *
 * Combat rules are the statics Forge does not write as `Mode$ Continuous`. Each
 * restriction is its own mode, and each mode names the creature it is about
 * under its own key -- `ValidCard$` for CantAttack and CantBlock,
 * `ValidAttacker$` for CantBlockBy, `ValidCreature$` for MustAttack. That key
 * is the whole difference from the body `staticParams`
 * builds for every other static, so this returns the mode and the params
 * together and the caller writes one line from the pair.
 *
 * The restriction string is `affectedFor`'s, the same one the card's other
 * statics use, and every mode attests it: `Mode$ CantAttack | ValidCard$
 * Card.Self` (67 shipped scripts) and `ValidCard$ Creature` (6), `Mode$
 * CantBlock | ValidCard$ Card.Self` (108), `Mode$ CantBlockBy | ValidAttacker$
 * Card.Self` (38), `Mode$ MustAttack | ValidCreature$ Card.Self` (74) and
 * `ValidCreature$ Creature.YouCtrl` (1). Where a mode has a favorite spelling
 * of "this creature" that
 * is not ours -- CantBlockBy writes `Creature.Self` 196 times against
 * `Card.Self`'s 38 -- the table still wins: `FORGE_STATIC_AFFECTED` is one
 * mapping from a DSL scope to a Forge restriction, and a per-mode second
 * spelling is a second place for a scope to come to mean something else.
 *
 * The two modifications that carry a field name the creature on the far side of
 * the block, so they write both keys. `juggernaut.txt` is the first, verbatim:
 * `S:Mode$ CantBlockBy | ValidAttacker$ Creature.Self | ValidBlocker$
 * Creature.Wall`. The second is how Forge writes "can block only creatures with
 * flying" -- `ValidAttacker$ Creature.withoutFlying | ValidBlocker$
 * Creature.Self` -- where the scope is the blocker and the attacker it may not
 * block is the one lacking the keyword. `forgeTargetRestriction` already spells
 * that `without` form for targets, so the keyword half is a reuse.
 *
 * `mustBeBlockedIfAble` is not here, and `Mode$ MustBlock` is the trap that
 * put it in this comment: Forge's MustBlock names the creature that must
 * block, and CR 509.1c's requirement names the creature that must be blocked.
 * Emitting one as the other reads correct and enforces the wrong side of the
 * combat -- a lure that makes the lure itself block. Forge writes the
 * requirement as a hidden keyword on an ordinary Continuous line, so
 * `modificationParams` writes it, and `stone_tongue_basilisk.txt` is that line
 * on a plain creature rather than an Aura.
 *
 * `affectedFor` reaches only the three scopes `FORGE_STATIC_AFFECTED` maps,
 * because `validate/abilities.ts` gives `allLands` one modification
 * (`addSubtype`) and `allCreatures` one (`cantAttackWithoutAnyOf`, intercepted
 * before this). A combat rule about a land, which neither attacks nor blocks,
 * is not a card this transpiler has to refuse: it is not a card.
 */
function combatRestriction(
  ability: StaticAbility,
): { readonly mode: string; readonly params: readonly ForgeParam[] } | null {
  const modification = ability.modification;
  const affected = (): string => affectedFor(ability);
  switch (modification.kind) {
    case 'cantAttack':
      return { mode: 'CantAttack', params: params(['ValidCard', affected()]) };
    case 'cantBlock':
      return { mode: 'CantBlock', params: params(['ValidCard', affected()]) };
    case 'cantAttackOrBlock':
      return { mode: 'CantAttack,CantBlock', params: params(['ValidCard', affected()]) };
    case 'cantBeBlocked':
      return { mode: 'CantBlockBy', params: params(['ValidAttacker', affected()]) };
    case 'attacksEachCombatIfAble':
      return { mode: 'MustAttack', params: params(['ValidCreature', affected()]) };
    case 'blockOnlyCreaturesWithKeyword':
      return {
        mode: 'CantBlockBy',
        params: params(
          ['ValidAttacker', `Creature.without${FORGE_KEYWORDS[modification.keyword]}`],
          ['ValidBlocker', affected()],
        ),
      };
    case 'cantBeBlockedBySubtype':
      return {
        mode: 'CantBlockBy',
        params: params(['ValidAttacker', affected()], ['ValidBlocker', `Creature.${modification.subtype}`]),
      };
    default:
      return null;
  }
}

function staticParams(ability: StaticAbility, index: number, cardId: string, path: string): ParamResult {
  let body: ParamResult;
  const combat = combatRestriction(ability);
  if (combat !== null) {
    body = { ok: true, params: combat.params };
  } else {
    const modification = modificationParams(
      ability.modification,
      cardId,
      `${path}.modification`,
      `Static${String(index + 1)}`,
    );
    body = modification.ok
      ? {
          ok: true,
          params: [...params(['Affected', affectedFor(ability)]), ...modification.params],
          ...(modification.supportingLines === undefined
            ? {}
            : { supportingLines: modification.supportingLines }),
        }
      : modification;
  }
  if (!body.ok) return body;
  const timedBody =
    ability.activeDuring === 'turnsOtherThanYours'
      ? { ...body, params: [...body.params, ...params(['Condition', 'NotPlayerTurn'])] }
      : body;
  const condition = ability.enabledWhile ?? null;
  if (condition === null) return timedBody;
  if (condition.kind === 'selfCounterCountAtLeast' && ability.scope === 'self') {
    const counterTypes = FORGE_COUNTER_TYPES[condition.counter];
    if (counterTypes === null || counterTypes.length !== 1) {
      return conditionParams(condition, cardId, `${path}.enabledWhile`);
    }
    return {
      ...timedBody,
      params: timedBody.params.map(([key, value]): ForgeParam =>
        key === 'Affected'
          ? [key, `${value}+counters_GT${String(condition.atLeast - 1)}_${counterTypes[0]}`]
          : [key, value],
      ),
    };
  }
  // Armory Guard proves Forge's `IsPresent$` spelling for a self-scoped
  // keyword grant gated by one controlled permanent. Do not generalize that
  // card-specific executable precedent to anthem/stat layers: those retain
  // the established ConditionPresent/ConditionCompare grammar below.
  if (
    condition.kind === 'controlsSubtype' &&
    condition.atLeast === 1 &&
    ability.scope === 'self' &&
    ability.subtype === null &&
    ability.filter === undefined &&
    ability.modification.kind === 'grantKeyword'
  ) {
    return {
      ...timedBody,
      params: [...timedBody.params, ...params(['IsPresent', `${condition.subtype}.YouCtrl`])],
    };
  }
  const conditionResult = conditionParams(condition, cardId, `${path}.enabledWhile`);
  if (!conditionResult.ok) return conditionResult;
  return {
    ok: true,
    params: [...timedBody.params, ...conditionResult.params],
    supportingLines: [...(timedBody.supportingLines ?? []), ...(conditionResult.supportingLines ?? [])],
  };
}

/**
 * Whether the trigger's own effects aim at the creature its event retained.
 *
 * Top level only, which is the exact set of effects a per-line referent can
 * reach: a nested branch transpiles through `transpileEffect` without the
 * enclosing condition (`effect-script.ts`'s coin-flip writer), so a
 * `triggeringCreature` inside one already compiles to the default referent and
 * a second body chain would not change it. A trigger that retains nothing keeps
 * one shared body, which is what Chub Toad's two lines do.
 */
function retainsTriggeringCreature(ability: TriggeredAbility): boolean {
  return ability.effects.some((effect) => 'target' in effect && effect.target?.kind === 'triggeringCreature');
}

/**
 * One pass over a trigger's effects, with or without remembered-card writers
 * enabled.
 *
 * `referent` is the creature the enclosing `T:` line retains, passed only by
 * the conditions whose lines retain different ones; `namePrefix` is what the
 * generated `SVar` bodies are called, and it differs per line for the same
 * reason, so two chains on one trigger cannot collide by name.
 */
function triggerEffectChain(
  ability: TriggeredAbility | StateTriggeredAbility,
  index: number,
  cardId: string,
  path: string,
  remembering: boolean,
  referent?: string,
  namePrefix: string = `Trig${index + 1}`,
) {
  const rejections: TranspileRejection[] = [];
  const tokens: TokenSpec[] = [];
  const supportingLines: string[] = [...boardCountSvarLines(ability.effects)];
  const bodies: { readonly name: string; readonly rendered: string }[] = [];
  let cleansRemembered = false;
  // Printed abilities still reject the general spell-chain count protocol:
  // its existing acceptance boundary is load-bearing. The source-attested
  // event-retained protocols opt in through their exact amount kinds.
  //
  // The board count is not one of them and needs no opt-in. It carries no
  // protocol across the chain — `SVar:Y:Count$Valid ...` is read out of the
  // battlefield wherever a numeral sits, so a trigger reads it exactly the way
  // a spell does, and `modalActivatedScript` has always folded it in here.
  const spellings = withBoardCounts(
    ability.effects.some(
      (effect) =>
        effectUsesRevealedCardManaValue(effect) ||
        effectUsesTriggeringCreaturePower(effect) ||
        effectUsesTriggeringCreatureToughness(effect) ||
        effectUsesSacrificedPermanentPower(effect),
    )
      ? resolutionCountSpellings(ability.effects, remembering)
      : ability.effects.map(() => NO_COMPUTED_AMOUNTS),
    ability.effects,
  );
  for (const [position, effect] of ability.effects.entries()) {
    const result = transpileEffect(
      effect,
      cardId,
      `${path}.effects[${position}]`,
      spellings[position],
      ability.kind === 'triggered' ? ability.condition : undefined,
      referent,
    );
    if (!result.ok) {
      rejections.push(...result.rejections);
      continue;
    }
    if (result.value.token !== undefined) tokens.push(result.value.token);
    if (result.value.cleansRemembered === true) cleansRemembered = true;
    for (const line of result.value.supportingLines ?? []) {
      if (!supportingLines.includes(line)) supportingLines.push(line);
    }
    const abilityBody =
      result.value.ability.api === 'Mill'
        ? {
            ...result.value.ability,
            // Triggered Mill puts its quantity before the target selector in
            // Forge's Jace's Erasure and Hedron Crab scripts.
            params: [...result.value.ability.params].sort(([left], [right]) =>
              left === 'NumCards' && right !== 'NumCards'
                ? -1
                : right === 'NumCards' && left !== 'NumCards'
                  ? 1
                  : 0,
            ),
          }
        : result.value.ability;
    const exactAbilityBody =
      ability.kind === 'triggered' &&
      ability.enchantedControllerDrawStepAdditionalDraw === true &&
      abilityBody.api === 'Draw'
        ? {
            ...abilityBody,
            params: abilityBody.params.filter(([name]) => name !== 'NumCards'),
          }
        : abilityBody;
    const infernoDistribution =
      ability.condition === 'selfEntersOrAttacks' &&
      ability.effects.length === 1 &&
      effect.kind === 'dealDamage' &&
      effect.amount === 3 &&
      effect.target.kind === 'anyTarget' &&
      effect.target.count === 3 &&
      effect.target.minimum === 1 &&
      effect.division?.kind === 'asYouChoose';
    bodies.push({
      name:
        ability.effects.length === 1 && effect.kind === 'putDepartedSourceOnTopOfOwnerLibrary'
          ? namePrefix
          : infernoDistribution
            ? 'DmgDistro'
            : `${namePrefix}Effect${position + 1}`,
      rendered: renderSubAbility(exactAbilityBody),
    });
    for (const [followIndex, follow] of (result.value.follow ?? []).entries()) {
      bodies.push({
        name: `${namePrefix}Effect${position + 1}Hold${followIndex === 0 ? '' : String(followIndex + 1)}`,
        rendered: renderSubAbility(follow),
      });
    }
  }
  return { rejections, tokens, supportingLines, bodies, spellings, cleansRemembered };
}

/** Forge's source-attested `Mode$ Always` grammar for a typed state trigger. */
function stateTriggerScript(
  ability: StateTriggeredAbility,
  index: number,
  description: string,
  cardId: string,
  path: string,
): AbilityScriptResult {
  const firstPass = triggerEffectChain(ability, index, cardId, path, false);
  const counted = readsResolutionCount(firstPass.spellings);
  const built = counted ? triggerEffectChain(ability, index, cardId, path, true) : firstPass;
  if (built.rejections.length > 0) return { ok: false, rejections: built.rejections };
  const first = built.bodies[0];
  if (first === undefined) {
    return {
      ok: false,
      rejections: [rejection('UNMAPPED_EFFECT_KIND', cardId, path, 'a state trigger carries no effect')],
    };
  }
  const counterTypes = FORGE_COUNTER_TYPES[ability.condition.counter];
  if (counterTypes === null || counterTypes.length !== 1) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          cardId,
          `${path}.condition.counter`,
          'this state-trigger counter has no single exact Forge counter type',
        ),
      ],
    };
  }
  const lines = [
    `T:Mode$ Always | TriggerZones$ Battlefield | IsPresent$ Permanent.counters_GE1_${counterTypes[0]}+YouCtrl | PresentCompare$ EQ0 | Execute$ ${first.name} | TriggerDescription$ ${description}`,
    ...renderNamedSubAbilityChain(built.bodies),
    ...built.supportingLines,
  ];
  return { ok: true, value: { lines, tokens: built.tokens } };
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
  if (isGuildFeudAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ OppPick | TriggerDescription$ ${description}`,
          'SVar:OppPick:DB$ Dig | ValidTgts$ Opponent | DigNum$ 3 | Reveal$ True | ChangeNum$ 1 | ChangeValid$ Creature | DestinationZone$ Battlefield | DestinationZone2$ Graveyard | Choser$ Targeted | Optional$ True | RememberChanged$ True | SubAbility$ YouPick',
          'SVar:YouPick:DB$ Dig | Defined$ You | DigNum$ 3 | Reveal$ True | ChangeNum$ 1 | ChangeValid$ Creature | DestinationZone$ Battlefield | DestinationZone2$ Graveyard | Optional$ True | RememberChanged$ True | SubAbility$ PicksFight',
          'SVar:PicksFight:DB$ Fight | Defined$ Remembered | SubAbility$ DBCleanup | ConditionCheckSVar$ NumFighters | ConditionSVarCompare$ EQ2 | StackDescription$ If two creatures are put onto the battlefield this way, those creatures fight each other.',
          'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
          'SVar:NumFighters:Remembered$Amount',
          'AI:RemoveDeck:Random',
        ],
        tokens: [],
      },
    };
  }
  if (isSourceLinkedTopFiveExileAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ SetupSearch | TriggerDescription$ ${description.replace(/^When this enchantment enters/, 'When CARDNAME enters')}`,
          'SVar:SetupSearch:DB$ Dig | Defined$ You | DigNum$ 5 | ChangeNum$ All | DestinationZone$ Exile | RememberChanged$ True | ForgetOtherRemembered$ True',
        ],
        tokens: [],
      },
    };
  }
  if (isSourceLinkedMatchingPlayCompletionAbility(ability)) {
    const forgeDescription = description.replaceAll('this enchantment', 'CARDNAME');
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ SpellCast | ValidCard$ Card.sharesNameWith Remembered | ValidActivatingPlayer$ You | TriggerZones$ Battlefield | OptionalDecider$ You | Execute$ TrigFind | TriggerDescription$ ${forgeDescription}`,
          `T:Mode$ LandPlayed | ValidCard$ Land.YouCtrl+sharesNameWith Remembered | TriggerZones$ Battlefield | Execute$ TrigFind | OptionalDecider$ You | Secondary$ True | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigFind:DB$ ChangeZone | ChangeType$ TriggeredCard.sharesNameWith | Hidden$ True | SelectPrompt$ Select a card exiled with CARDNAME that shares a name with the played card | Origin$ Exile | Destination$ Hand | ChangeNum$ 1 | ForgetChanged$ True | SubAbility$ SacSelf',
          'SVar:SacSelf:DB$ Sacrifice | ConditionCheckSVar$ StillLooking | ConditionSVarCompare$ EQ0 | RememberSacrificed$ True | SubAbility$ AllFoundCelebration',
          'SVar:AllFoundCelebration:DB$ AddTurn | NumTurns$ 1 | ConditionCheckSVar$ X | ConditionSVarCompare$ EQ1',
          'SVar:StillLooking:Remembered$Amount',
          'SVar:X:Remembered$Amount',
        ],
        tokens: [],
      },
    };
  }
  if (isExaltedAbility(ability)) {
    return { ok: true, value: { lines: ['K:Exalted'], tokens: [] } };
  }
  if (ability.opponentMaySacrificeCreatureThenTapAndCounterSelf === true) {
    const forgeDescription = description
      .replace(' a creature of their choice', ' a creature')
      .replace('tap this creature', 'tap CARDNAME');
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ Phase | Phase$ BeginCombat | TriggerZones$ Battlefield | Execute$ TrigSac | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigSac:DB$ Sacrifice | Defined$ Opponent | Amount$ 1 | SacValid$ Creature | RememberSacrificed$ True | Optional$ True | AILogic$ DesecrationDemon | SubAbility$ DBSacSelf',
          'SVar:DBSacSelf:DB$ Tap | Defined$ Self | ConditionCheckSVar$ X | SubAbility$ DBPutCounter',
          'SVar:DBPutCounter:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1 | ConditionCheckSVar$ X | SubAbility$ DBCleanup',
          'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
          'SVar:X:Remembered$Amount',
        ],
        tokens: [],
      },
    };
  }
  if (isSacrificeSelfUnlessControllerPaysAbility(ability)) {
    const number = String(index + 1);
    const name = `Trig${number}Effect1`;
    const forgeDescription = description.replace(/^When this land enters/, 'When CARDNAME enters');
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ ${name} | TriggerDescription$ ${forgeDescription}`,
          `SVar:${name}:DB$ Sacrifice | UnlessCost$ ${forgeManaCost(ability.sacrificeSelfUnlessControllerPays.cost)} | UnlessPayer$ You`,
        ],
        tokens: [],
      },
    };
  }
  if (isSacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ Player.EnchantedController | TriggerZones$ Battlefield | Execute$ TrigSac | TriggerDescription$ ${description}`,
          'SVar:TrigSac:DB$ SacrificeAll | Defined$ Enchanted | UnlessCost$ X | UnlessPayer$ EnchantedController',
          'SVar:X:Enchanted$CardManaCost',
        ],
        tokens: [],
      },
    };
  }
  if (isEnchantedLandBecomesTappedMillAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ Taps | ValidCard$ Card.AttachedBy | TriggerZones$ Battlefield | Execute$ TrigMill | TriggerDescription$ ${description}`,
          'SVar:TrigMill:DB$ Mill | Defined$ TriggeredCardController | NumCards$ 3',
        ],
        tokens: [],
      },
    };
  }
  if (isControlledCreatureCombatDamageCountersAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ DamageDone | ValidSource$ Creature.YouCtrl | ValidTarget$ Player | TriggerZones$ Battlefield | CombatDamage$ True | Execute$ TrigPutCounter | TriggerDescription$ ${description}`,
          'SVar:TrigPutCounter:DB$ PutCounter | Defined$ TriggeredSourceLKICopy | CounterType$ P1P1 | CounterNum$ X',
          'SVar:X:TriggerCount$DamageAmount',
        ],
        tokens: [],
      },
    };
  }
  if (isOpponentCreatureDiesReturnAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Creature.YouDontCtrl | TriggerZones$ Battlefield | Execute$ DelTrig | TriggerDescription$ ${description}`,
          'SVar:DelTrig:DB$ DelayedTrigger | Mode$ Phase | Phase$ End of Turn | Execute$ GBReturn | RememberObjects$ TriggeredNewCardLKICopy | TriggerDescription$ Return creature to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step. It is a black Zombie in addition to its other colors and types.',
          'SVar:GBReturn:DB$ ChangeZone | Defined$ DelayTriggerRememberedLKI | Origin$ Graveyard | Destination$ Battlefield | GainControl$ True | WithCountersType$ P1P1 | StaticEffect$ Animate',
          'SVar:Animate:Mode$ Continuous | Affected$ Card.IsRemembered | AddType$ Zombie | AddColor$ Black',
        ],
        tokens: [],
      },
    };
  }
  if (isConjuredCurrencyAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ Phase | Phase$ Upkeep | TriggerZones$ Battlefield | ValidPlayer$ You | Execute$ ExchangeCards | OptionalDecider$ You | TriggerDescription$ ${description}`,
          'SVar:ExchangeCards:DB$ ExchangeControl | Defined$ Self | ValidTgts$ Permanent.YouDontCtrl+YouDontOwn | TgtPrompt$ Select target permanent you neither own nor control',
        ],
        tokens: [],
      },
    };
  }
  if (isAngelOfSerenityExileAbility(ability)) {
    const forgeDescription = description.replace(/^When this creature enters/, 'When CARDNAME enters');
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile | OptionalDecider$ You | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigExile:DB$ ChangeZone | TargetMin$ 0 | TargetMax$ 3 | IsCurse$ True | ValidTgts$ Creature.Other | TgtPrompt$ Choose another target creature | RememberChanged$ True | Origin$ Battlefield,Graveyard | Destination$ Exile',
        ],
        tokens: [],
      },
    };
  }
  if (isAngelOfSerenityReturnAbility(ability)) {
    const forgeDescription = description.replace(
      /^When this creature leaves the battlefield/,
      'When CARDNAME leaves the battlefield',
    );
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ TrigReturn | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Hand | SubAbility$ DBCleanup',
          'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
        ],
        tokens: [],
      },
    };
  }
  if (isSameNameCohortLinkedExileAbility(ability)) {
    const excludedName = ability.effects[0].sameNameCohort!.excludedName;
    const forgeDescription = description.replace(/^When this enchantment enters/, 'When CARDNAME enters');
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | OptionalDecider$ You | Execute$ TrigExile | TriggerDescription$ ${forgeDescription}`,
          `SVar:TrigExile:DB$ Pump | ValidTgts$ Permanent.nonLand+!named${excludedName} | IsCurse$ True | TgtPrompt$ Choose target nonland permanent not named ${excludedName} | SubAbility$ DBChangeZoneAll`,
          'SVar:DBChangeZoneAll:DB$ ChangeZoneAll | ChangeType$ Targeted.Self,Targeted.sameName | Origin$ Battlefield | Destination$ Exile',
        ],
        tokens: [],
      },
    };
  }
  if (isPluralSourceLinkedReturnAbility(ability)) {
    const forgeDescription = description.replace(
      /^When this enchantment leaves the battlefield/,
      'When CARDNAME leaves the battlefield',
    );
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ TrigReturn | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigReturn:DB$ ChangeZoneAll | ChangeType$ Card.ExiledWithSource | Origin$ Exile | Destination$ Battlefield',
          'SVar:OblivionRing:TRUE',
        ],
        tokens: [],
      },
    };
  }
  if (isReturnAnotherCreatureOrSacrificeSelfAbility(ability)) {
    const forgeDescription = description.replace(/^When this creature enters/, 'When CARDNAME enters');
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSacUnless | TriggerDescription$ ${forgeDescription}`,
          `SVar:TrigSacUnless:DB$ Sacrifice | UnlessCost$ Return<1/Creature.Other/other creature> | UnlessPayer$ You`,
        ],
        tokens: [],
      },
    };
  }
  if (isControlledSubtypeAttacksTokenAbility(ability)) {
    const effect = ability.effects[0];
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ Attacks | ValidCard$ ${ability.attackingCreatureSubtype}.YouCtrl | Execute$ TrigToken | TriggerZones$ Battlefield | TriggerDescription$ ${description}`,
          `SVar:TrigToken:DB$ Token | TokenScript$ ${forgeTokenScriptName(effect.token)} | TokenOwner$ You`,
        ],
        tokens: [effect.token],
      },
    };
  }
  const firstEffect = ability.effects[0];
  const secondEffect = ability.effects[1];
  const damageLossFlip =
    ability.condition === 'selfIsDealtDamage' &&
    ability.effects.length === 1 &&
    firstEffect?.kind === 'flipCoin' &&
    firstEffect.winEffects === undefined &&
    firstEffect.loseEffects?.length === 1 &&
    firstEffect.loseEffects[0]?.kind === 'sacrificeSelf' &&
    firstEffect.loseEffects[0].target.kind === 'selfCreature';
  if (damageLossFlip) {
    const forgeDescription = description
      .replace(/^Whenever this creature is dealt damage/, 'Whenever CARDNAME is dealt damage')
      .replace('sacrifice this creature', 'sacrifice CARDNAME');
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ DamageDoneOnce | Execute$ TrigFlipSac | ValidTarget$ Card.Self | TriggerZones$ Battlefield | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigFlipSac:DB$ FlipCoin | LoseSubAbility$ DBSacrifice',
          'SVar:DBSacrifice:DB$ Sacrifice',
        ],
        tokens: [],
      },
    };
  }
  const deathLossFlipDamage =
    ability.condition === 'selfDies' &&
    ability.effects.length === 1 &&
    firstEffect?.kind === 'flipCoin' &&
    firstEffect.winEffects === undefined &&
    firstEffect.loseEffects?.length === 1 &&
    firstEffect.loseEffects[0]?.kind === 'dealDamage' &&
    firstEffect.loseEffects[0].amount === 4 &&
    firstEffect.loseEffects[0].scope === 'allPermanents' &&
    firstEffect.loseEffects[0].scopeFilter?.cardTypes?.length === 1 &&
    firstEffect.loseEffects[0].scopeFilter.cardTypes[0] === 'creature' &&
    firstEffect.loseEffects[0].players === 'eachPlayer' &&
    firstEffect.loseEffects[0].target.kind === 'noTarget';
  if (deathLossFlipDamage) {
    const forgeDescription = description.replace(/^When this creature dies/, 'When CARDNAME dies');
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigFlipDamage | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigFlipDamage:DB$ FlipCoin | LoseSubAbility$ DBDamage',
          'SVar:DBDamage:DB$ DamageAll | ValidCards$ Creature | ValidPlayers$ Player | NumDmg$ 4 | ValidDescription$ each creature and each player.',
        ],
        tokens: [],
      },
    };
  }
  if (isDamageLinkedMillAbility(ability)) {
    const forgeDescription = description.replace(
      /^Whenever this creature deals combat damage to a player/,
      'Whenever CARDNAME deals combat damage to a player',
    );
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigMill | TriggerZones$ Battlefield | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigMill:DB$ Mill | Defined$ TriggeredTarget | NumCards$ X',
          'SVar:X:TriggerCount$DamageAmount',
        ],
        tokens: [],
      },
    };
  }
  const sourcePowerOtherCreaturesPump =
    ability.condition === 'selfAttacks' &&
    ability.effects.length === 1 &&
    firstEffect?.kind === 'pumpUntilEndOfTurn' &&
    typeof firstEffect.power !== 'number' &&
    firstEffect.power.kind === 'triggeringCreaturePower' &&
    typeof firstEffect.toughness !== 'number' &&
    firstEffect.toughness.kind === 'triggeringCreaturePower' &&
    firstEffect.scope === 'permanentsYouControl' &&
    firstEffect.scopeFilter?.cardTypes?.length === 1 &&
    firstEffect.scopeFilter.cardTypes[0] === 'creature' &&
    Object.keys(firstEffect.scopeFilter).length === 1 &&
    firstEffect.excludeReferent === true &&
    firstEffect.target.kind === 'noTarget';
  if (sourcePowerOtherCreaturesPump) {
    const forgeDescription = description
      .replace(/^Whenever this creature attacks/, 'Whenever CARDNAME attacks')
      .replace("this creature's power", "CARDNAME's power");
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ Attacks | ValidCard$ Card.Self | TriggerZones$ Battlefield | Execute$ TrigPump | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigPump:DB$ PumpAll | ValidCards$ Creature.YouCtrl+StrictlyOther | NumAtt$ +X | NumDef$ +X',
          'SVar:X:Count$CardPower',
        ],
        tokens: [],
      },
    };
  }
  const bazaarKrovodShape =
    ability.condition === 'selfAttacks' &&
    ability.printedSourceReference === 'thisCreature' &&
    ability.effects.length === 2 &&
    firstEffect?.kind === 'pumpUntilEndOfTurn' &&
    firstEffect.power === 0 &&
    firstEffect.toughness === 2 &&
    firstEffect.target.kind === 'targetCreature' &&
    firstEffect.target.excludeSource === true &&
    firstEffect.target.filter?.combat === 'attacking' &&
    Object.keys(firstEffect.target.filter).length === 1 &&
    secondEffect?.kind === 'untapPermanent' &&
    secondEffect.target.kind === 'thatCreature';
  if (bazaarKrovodShape) {
    const forgeDescription = description.replace(
      /^Whenever this creature attacks/,
      'Whenever CARDNAME attacks',
    );
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigPump | TriggerZones$ Battlefield | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigPump:DB$ Pump | ValidTgts$ Creature.attacking+Other | TgtPrompt$ Select another target attacking creature. | NumDef$ +2 | SubAbility$ DBUntap',
          'SVar:DBUntap:DB$ Untap | Defined$ Targeted',
        ],
        tokens: [],
      },
    };
  }
  if (ability.condition === 'selfDealsCombatDamageToPlayer' && isOptionalDrawThenDiscardAbility(ability)) {
    const forgeDescription = description.replace(
      /^Whenever this (?:creature|artifact) deals combat damage to a player/,
      'Whenever CARDNAME deals combat damage to a player',
    );
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigLoot | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigLoot:AB$ Discard | Defined$ You | Mode$ TgtChoose | NumCards$ 1 | Cost$ Draw<1/You>',
        ],
        tokens: [],
      },
    };
  }
  if (ability.condition === 'selfEnters' && isOptionalDiscardThenDrawAbility(ability)) {
    const forgeDescription = description.replace(/^When this creature enters/, 'When CARDNAME enters');
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDiscard | TriggerDescription$ ${forgeDescription}`,
          'SVar:TrigDiscard:AB$ Draw | Cost$ Discard<1/Card>',
        ],
        tokens: [],
      },
    };
  }
  if (ability.optionalControllerPayment !== undefined) {
    const discard = ability.effects[0];
    if (discard?.kind !== 'discardCards') {
      return {
        ok: false,
        rejections: [
          rejection('UNMAPPED_EFFECT_KIND', cardId, path, 'paid optional trigger lost its discard payload'),
        ],
      };
    }
    const forgeDescription = description.replace(/^When this creature dies/, 'When CARDNAME dies');
    return {
      ok: true,
      value: {
        lines: [
          `T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | OptionalDecider$ You | Execute$ TrigDiscard | TriggerDescription$ ${forgeDescription}`,
          `SVar:TrigDiscard:AB$ Discard | Cost$ ${forgeManaCost(ability.optionalControllerPayment.cost)} | ValidTgts$ Player | NumCards$ 1 | Mode$ TgtChoose | SpellDescription$ Target player discards a card.`,
        ],
        tokens: [],
      },
    };
  }
  const delayedCounter = ability.effects.length === 1 ? ability.effects[0] : undefined;
  if (
    ability.condition === 'selfPlusOnePlusOneCounterRemoved' &&
    delayedCounter?.kind === 'putCounters' &&
    delayedCounter.timing === 'nextEndStep' &&
    delayedCounter.target.kind === 'selfPermanent' &&
    typeof delayedCounter.count === 'number'
  ) {
    const counterTypes = FORGE_COUNTER_TYPES[delayedCounter.counter];
    if (counterTypes === null || counterTypes.length !== 1) {
      return {
        ok: false,
        rejections: [
          rejection(
            'UNMAPPED_EFFECT_KIND',
            cardId,
            `${path}.effects[0].counter`,
            'this delayed placement has no single exact Forge counter type',
          ),
        ],
      };
    }
    const delayedName = `Trig${index + 1}DelayedCounter`;
    const putName = `Trig${index + 1}PutCounter`;
    const mode = FORGE_TRIGGER_MODES[ability.condition].map(([key, value]) => `${key}$ ${value}`).join(' | ');
    const optional = ability.optional === true ? ' | OptionalDecider$ You' : '';
    return {
      ok: true,
      value: {
        lines: [
          `T:${mode} | Execute$ ${delayedName}${optional} | TriggerDescription$ ${description}`,
          `SVar:${delayedName}:DB$ DelayedTrigger | Mode$ Phase | Phase$ End of Turn | Execute$ ${putName} | RememberObjects$ TriggeredCardLKICopy | TriggerDescription$ Put ${counterPhrase(delayedCounter.counter, delayedCounter.count)} on it at the beginning of the next end step.`,
          `SVar:${putName}:DB$ PutCounter | Defined$ DelayTriggerRememberedLKI | CounterType$ ${counterTypes[0]} | CounterNum$ ${delayedCounter.count}`,
        ],
        tokens: [],
      },
    };
  }
  const rejections: TranspileRejection[] = [];
  const tokens: TokenSpec[] = [];
  const supportingLines: string[] = [];
  // One body chain per emitted `T:` line. Almost every trigger has exactly one
  // chain and every line executes it, which is what the corpus does too — Chub
  // Toad's two lines both run `TrigPump`. A condition whose lines retain
  // *different* creatures cannot share one body, because the body names the
  // retained creature in `Defined$`: Ashmouth Hound's two lines run
  // `TrigDamageAttacker` and `TrigDamageBlocker` for that reason and nothing
  // else. `perLineReferents` is non-null exactly in that case.
  const additional = FORGE_ADDITIONAL_TRIGGER_MODES[ability.condition] ?? [];
  const referents = FORGE_TRIGGERING_CREATURE_REFERENTS[ability.condition] ?? [];
  const perLineReferents =
    new Set(referents).size > 1 &&
    referents.length === additional.length + 1 &&
    retainsTriggeringCreature(ability)
      ? referents
      : null;
  const chains: (readonly { readonly name: string; readonly rendered: string }[])[] = [];
  if (isCounterTriggeringSpellOrAbilityAbility(ability)) {
    chains.push([
      {
        name: `Trig${index + 1}Counter`,
        rendered: renderSubAbility({
          api: 'Counter',
          params: params(
            ['Defined', 'TriggeredSourceSA'],
            ['UnlessCost', forgeManaCost(ability.counterTriggeringSpellOrAbilityUnless.cost)],
            ['UnlessPayer', 'TriggeredSourceSAController'],
          ),
        }),
      },
    ]);
  } else {
    for (const [line, referent] of (perLineReferents ?? [undefined]).entries()) {
      const darkRevenantChange =
        ability.effects.length === 1 && ability.effects[0]?.kind === 'putDepartedSourceOnTopOfOwnerLibrary';
      const namePrefix =
        line === 0 && darkRevenantChange
          ? 'TrigChange'
          : line === 0
            ? `Trig${index + 1}`
            : `Trig${index + 1}Line${line + 1}`;
      const firstPass = triggerEffectChain(ability, index, cardId, path, false, referent, namePrefix);
      const counted = readsResolutionCount(firstPass.spellings);
      const built = counted
        ? triggerEffectChain(ability, index, cardId, path, true, referent, namePrefix)
        : firstPass;
      rejections.push(...built.rejections);
      // Only the first chain contributes tokens: the later chains transpile the
      // same effects and would mint the same token script a second time.
      if (line === 0) tokens.push(...built.tokens);
      for (const supporting of built.supportingLines) {
        if (!supportingLines.includes(supporting)) supportingLines.push(supporting);
      }
      const chain = [...built.bodies];
      if (counted && !built.cleansRemembered) {
        chain.push({
          name: `${namePrefix}Effect${ability.effects.length + 1}`,
          rendered: renderSubAbility(RESOLUTION_COUNT_CLEANUP),
        });
      }
      chains.push(chain);
    }
  }
  if (rejections.length > 0) return { ok: false, rejections };

  const intervening =
    ability.triggeringPlayerHandAtMost !== undefined
      ? {
          ok: true as const,
          params: params(
            ['CheckSVar', 'CardsInHand'],
            ['SVarCompare', `LE${String(ability.triggeringPlayerHandAtMost)}`],
          ),
          supportingLines: ['SVar:CardsInHand:Count$ValidHand Card.ActivePlayerCtrl'],
        }
      : ability.interveningIf === undefined
        ? { ok: true as const, params: [] as readonly ForgeParam[] }
        : conditionParams(ability.interveningIf, cardId, `${path}.interveningIf`);
  if (!intervening.ok) return { ok: false, rejections: intervening.rejections };
  supportingLines.push(...(intervening.supportingLines ?? []));

  const first = chains[0]?.[0];
  if (first === undefined) {
    // A valid trigger carries either an ordinary effect or a special body
    // assembled above, and a rejected effect returns before this point. Keep
    // this as a rejection because a `T:` line with no `Execute$` would boot in
    // Forge doing nothing.
    return {
      ok: false,
      rejections: [
        rejection('UNMAPPED_EFFECT_KIND', cardId, path, 'a triggered ability carries no effect to execute'),
      ],
    };
  }
  const primaryMode: readonly (readonly [string, string])[] =
    ability.enchantedControllerDrawStepAdditionalDraw === true
      ? [
          ['Mode', 'Phase'],
          ['Phase', 'Draw'],
          ['ValidPlayer', 'Player.EnchantedController'],
          ['TriggerZones', 'Battlefield'],
        ]
      : ability.condition === 'beginningOfEachPlayersUpkeep' &&
          ability.triggeringPlayerIsEnchantedCreatureController === true
        ? [
            ['Mode', 'Phase'],
            ['Phase', 'Upkeep'],
            ['ValidPlayer', 'Player.EnchantedController'],
            ['TriggerZones', 'Battlefield'],
          ]
        : ability.condition === 'beginningOfEachPlayersUpkeep' && ability.triggeringPlayerIsOpponent === true
          ? [
              ['Mode', 'Phase'],
              ['Phase', 'Upkeep'],
              ['ValidPlayer', 'Opponent'],
              ['TriggerZones', 'Battlefield'],
            ]
          : ability.condition === 'controlledLandSubtypeEnters' && ability.landSubtype !== undefined
            ? [
                ['Mode', 'ChangesZone'],
                ['Origin', 'Any'],
                ['Destination', 'Battlefield'],
                ['ValidCard', `${ability.landSubtype}.YouCtrl`],
                ['TriggerZones', ability.triggerZone === 'graveyard' ? 'Graveyard' : 'Battlefield'],
              ]
            : ability.condition === 'youCastSpell' && ability.castFromGraveyardByAnyPlayer === true
              ? [
                  ['Mode', 'SpellCast'],
                  ['ValidCard', 'Card.wasCastFromGraveyard'],
                  ['TriggerZones', 'Battlefield'],
                ]
              : ability.condition === 'youCastSpell' && ability.spellSharesChosenColors === true
                ? [
                    ['Mode', 'SpellCast'],
                    ['ValidCard', 'Card.AnyChosenColor'],
                    ['ValidActivatingPlayer', 'You'],
                  ]
                : ability.condition === 'youCastSpell' && ability.spellColors !== undefined
                  ? [
                      ['Mode', 'SpellCast'],
                      [
                        'ValidCard',
                        ability.spellColors.map((color) => `Card.${FORGE_COLOR_PROPERTIES[color]}`).join(','),
                      ],
                      ['ValidActivatingPlayer', 'You'],
                      ['TriggerZones', 'Battlefield'],
                    ]
                  : ability.condition === 'youCastSpell' && ability.spellIsMulticolored === true
                    ? [
                        ['Mode', 'SpellCast'],
                        ['ValidCard', 'Card.MultiColor'],
                        ['ValidActivatingPlayer', 'You'],
                        ['TriggerZones', 'Battlefield'],
                      ]
                    : ability.condition === 'selfDealsCombatDamageToPlayer' &&
                        ability.includesNoncombatDamage === true
                      ? FORGE_TRIGGER_MODES.selfDealsCombatDamageToPlayer.filter(
                          ([key]) => key !== 'CombatDamage',
                        )
                      : FORGE_TRIGGER_MODES[ability.condition];
  const modes = [primaryMode, ...additional];
  // A `may` on a trigger is a parameter on the `T:` line rather than anything
  // in the effect body: 1,507 shipped cards write `OptionalDecider$ You` and
  // every one of them puts it ahead of `TriggerDescription$`. Without it the
  // exported card reads "you may" in its description and then does the thing
  // anyway, which is the one failure mode this package exists to rule out —
  // the parity oracle disagreeing with us about a card we exported wrong.
  const decider = ability.optional === true ? ['OptionalDecider$ You'] : [];
  const forgeDescription =
    ability.condition === 'selfEnters'
      ? description.replace(
          /^When this (?:creature|artifact|enchantment|permanent|land) enters/,
          'When CARDNAME enters',
        )
      : ability.castFromGraveyardByAnyPlayer === true
        ? description.replace('this creature', 'CARDNAME')
        : description;
  const hasInterveningCheck =
    ability.interveningIf !== undefined || ability.triggeringPlayerHandAtMost !== undefined;
  const manaBloomStyleCheck =
    ability.interveningIf?.kind === 'selfCounterCountBelow' &&
    ability.interveningIf.counter === 'charge' &&
    ability.interveningIf.fewerThan === 1;
  const triggerZoneFollowsExecute =
    (hasInterveningCheck && !manaBloomStyleCheck) || ability.castFromGraveyardByAnyPlayer === true;
  const lines = modes.map((mode, line) => {
    const secondary = mode.filter(([key]) => key === 'Secondary');
    const triggerZones = triggerZoneFollowsExecute ? mode.filter(([key]) => key === 'TriggerZones') : [];
    const primary = mode.filter(
      ([key]) => key !== 'Secondary' && (!triggerZoneFollowsExecute || key !== 'TriggerZones'),
    );
    const trigger = [
      ...primary.map(([key, value]) => `${key}$ ${value}`),
      ...intervening.params.map(([key, value]) => `${key}$ ${value}`),
      `Execute$ ${(perLineReferents === null ? first : (chains[line]?.[0] ?? first)).name}`,
      ...triggerZones.map(([key, value]) => `${key}$ ${value}`),
      ...secondary.map(([key, value]) => `${key}$ ${value}`),
      ...decider,
      `TriggerDescription$ ${forgeDescription}`,
    ].join(' | ');
    return `T:${trigger}`;
  });
  // Chained per chain, never over the flattened list: `SubAbility$` is what
  // sequences one line's effects, and running it across the boundary would make
  // the first line resolve the second line's body too.
  for (const chain of chains) lines.push(...renderNamedSubAbilityChain(chain));
  lines.push(...supportingLines);
  lines.push(...(FORGE_TRIGGER_SUPPORTING_LINES[ability.condition] ?? []));
  if (
    (FORGE_ADDITIONAL_TRIGGER_MODES[ability.condition] ?? []).some((mode) =>
      mode.some(([key, value]) => key === 'Mode' && value === 'Attacks'),
    )
  ) {
    lines.push('SVar:HasAttackEffect:TRUE');
  }
  return { ok: true, value: { lines, tokens } };
}

/** The exact Forge protocol shipped for Crosstown Courier's linked event data. */
export function isDamageLinkedMillAbility(ability: Ability): boolean {
  if (ability.kind !== 'triggered' || ability.condition !== 'selfDealsCombatDamageToPlayer') {
    return false;
  }
  const effect = ability.effects[0];
  return (
    ability.effects.length === 1 &&
    effect?.kind === 'millCards' &&
    typeof effect.count !== 'number' &&
    effect.count.kind === 'triggeringDamageAmount' &&
    effect.target.kind === 'triggeringPlayer'
  );
}

/** Reuses the ordinary trigger compiler for a trigger granted by an Aura. */
export function grantedTriggerScript(
  ability: TriggeredAbility,
  prefix: string,
  description: string,
  cardId: string,
  path: string,
): AbilityScriptResult {
  const built = triggerScript(ability, 0, description, cardId, path);
  if (!built.ok) return built;
  const [trigger, ...rest] = built.value.lines;
  if (trigger === undefined || !trigger.startsWith('T:')) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          cardId,
          path,
          'this granted ability has no ordinary Forge trigger form to embed in a continuous grant',
        ),
      ],
    };
  }
  const renamed = (line: string): string => line.replaceAll('Trig1', prefix);
  return {
    ok: true,
    value: {
      lines: [`SVar:${prefix}:${renamed(trigger.slice(2))}`, ...rest.map(renamed)],
      tokens: built.value.tokens,
    },
  };
}

/** Reuses the ordinary activation compiler for an ability granted by an Aura. */
export function grantedActivatedAbilityScript(
  ability: ActivatedAbility,
  prefix: string,
  description: string,
  cardId: string,
  path: string,
): AbilityScriptResult {
  const built = activatedScript(ability, 0, description, cardId, path, false, true);
  if (!built.ok) return built;
  const [activation, ...rest] = built.value.lines;
  if (activation === undefined || !activation.startsWith('A:')) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          cardId,
          path,
          'this granted ability has no ordinary Forge activation form to embed in a continuous grant',
        ),
      ],
    };
  }
  const renamed = (line: string): string => line.replaceAll('Act1', prefix);
  // Underworld Connections' shipped `AB$ Draw` relies on Draw's activating-
  // player default and omits `Defined$ You`. Keep that source-attested spelling
  // confined to Draw; other APIs may give `Defined` a different default.
  const embedded = activation.startsWith('A:AB$ Draw | ')
    ? activation.slice(2).replace(' | Defined$ You | ', ' | ')
    : activation.slice(2);
  return {
    ok: true,
    value: {
      lines: [`SVar:${prefix}:${renamed(embedded)}`, ...rest.map(renamed)],
      tokens: built.value.tokens,
    },
  };
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
/** Refusals for activation-cost fields whose Forge spelling is not source-proven. */
function activationCostRejections(
  cost: ActivationCost,
  cardId: string,
  path: string,
): readonly TranspileRejection[] {
  const found: TranspileRejection[] = [];
  if (cost.discardFilter !== undefined && forgeSearchType(cost.discardFilter) === null) {
    found.push(
      rejection(
        'UNMAPPED_ACTIVATION_COST_FILTER',
        cardId,
        `${path}.cost.discardFilter`,
        'this discard filter has no source-proven Forge Valid spelling; exporting it as an unrestricted discard would make Forge accept payments the kernel refuses',
      ),
    );
  }
  if (cost.sacrificeMatching !== undefined && forgeSacrificeMatching(cost.sacrificeMatching) === null) {
    found.push(
      rejection(
        'UNMAPPED_ACTIVATION_COST_FILTER',
        cardId,
        `${path}.cost.sacrificeMatching.filter`,
        'this sacrifice filter has no single source-proven Forge Sac spelling; exporting it as unrestricted would make Forge accept payments the kernel refuses',
      ),
    );
  }
  if (cost.tapMatching !== undefined && forgeSacrificeMatching(cost.tapMatching) === null) {
    found.push(
      rejection(
        'UNMAPPED_ACTIVATION_COST_FILTER',
        cardId,
        `${path}.cost.tapMatching.filter`,
        'this tap filter has no single source-proven Forge tapXType spelling; exporting it as unrestricted would make Forge accept payments the kernel refuses',
      ),
    );
  }
  if (cost.removeCounter !== undefined) {
    const counterTypes = FORGE_COUNTER_TYPES[cost.removeCounter.counter];
    if (counterTypes === null || counterTypes.length !== 1) {
      found.push(
        rejection(
          'UNMAPPED_ACTIVATION_COUNTER_COST',
          cardId,
          `${path}.cost.removeCounter`,
          'this removed counter has no single source-proven Forge counter type; exporting a partial decomposition would make Forge charge a different cost',
        ),
      );
    }
  }
  return found;
}

function forgeActivationCost(cost: ActivationCost): string {
  const mana = cost.mana.hasX || manaValue(cost.mana) > 0 ? [forgeActivationManaCost(cost)] : [];
  const sacrifice = cost.sacrificeOther;
  const sacrificeMatching =
    cost.sacrificeMatching === undefined ? null : forgeSacrificeMatching(cost.sacrificeMatching);
  const tapMatching = cost.tapMatching === undefined ? null : forgeSacrificeMatching(cost.tapMatching);
  const removedCounterTypes =
    cost.removeCounter === undefined ? null : FORGE_COUNTER_TYPES[cost.removeCounter.counter];
  const discardType =
    cost.discard === undefined
      ? null
      : cost.discardFilter === undefined
        ? 'Card'
        : forgeSearchType(cost.discardFilter);
  const parts = [
    ...mana,
    ...(cost.tapSelf ? ['T'] : []),
    ...(cost.payLife === undefined ? [] : [`PayLife<${cost.payLife}>`]),
    ...(cost.tapMatching === undefined || tapMatching === null
      ? []
      : [`tapXType<${cost.tapMatching.count}/${tapMatching}>`]),
    ...(cost.removeCounter === undefined || removedCounterTypes === null || removedCounterTypes.length !== 1
      ? []
      : [`SubCounter<${cost.removeCounter.count}/${removedCounterTypes[0]}>`]),
    ...(cost.sacrificeSelf ? ['Sac<1/CARDNAME>'] : []),
    ...(cost.exileSelf ? ['Exile<1/CARDNAME>'] : []),
    ...(cost.exileControlledInstantOrSorcerySpell === true
      ? ['ExileFromStack<1/Spell.Instant+YouCtrl;Spell.Sorcery+YouCtrl/instant or sorcery spell>']
      : []),
    ...(sacrifice === undefined ? [] : [`Sac<${sacrifice.count}/${sacrifice.subtype}>`]),
    ...(cost.sacrificeMatching === undefined || sacrificeMatching === null
      ? []
      : [`Sac<${cost.sacrificeMatching.count}/${sacrificeMatching}>`]),
    ...(cost.sacrificeLandSubtypePair === undefined
      ? []
      : cost.sacrificeLandSubtypePair.map((subtype) => `Sac<1/${subtype}>`)),
    ...(cost.discard === undefined || discardType === null
      ? []
      : [`Discard<${cost.discard}/${discardType}>`]),
    ...(cost.discardMatching === undefined
      ? []
      : ['Discard<2/Card.nonLand+WithSameName/nonland cards with the same name>']),
  ];
  return parts.join(' ');
}

/** Forge spelling of an activation's mana clause, with the same audited pip order as its face. */
export function forgeActivationManaCost(cost: ActivationCost): string {
  if (cost.printedManaPips === undefined) return forgeManaCost(cost.mana);
  return [
    ...(cost.mana.hasX ? ['X'] : []),
    ...(cost.mana.generic > 0 ? [String(cost.mana.generic)] : []),
    ...cost.printedManaPips.map((pip) => pip.replace('/', '')),
  ].join(' ');
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
 * `Ultimate$ True` is an AI preference hint rather than a rules parameter. The
 * card-level writer picks which ability carries it and passes that fact here,
 * so card-order policy stays out of the effect writer; the corpus census behind
 * the pick is in `card-script.ts`'s `ultimateAbilityIndex`.
 */
function loyaltyClause(
  ability: ActivatedAbility,
  printed: string,
  cardId: string,
  path: string,
): LoyaltyResult {
  const loyalty = ability.loyaltyCost;
  if (loyalty === undefined) return { ok: true, value: null };
  const cost = isVariableLoyaltyCost(loyalty)
    ? 'SubCounter<X/LOYALTY>'
    : loyalty < 0
      ? `SubCounter<${-loyalty}/LOYALTY>`
      : `AddCounter<${loyalty}/LOYALTY>`;
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
 * Forge renders `Cost$` itself, so `SpellDescription$` starts after the colon
 * in the DSL's full activated-ability line. Keeping the prefix would display
 * the same cost twice and disagree with every source script used by this
 * transpiler, including Ancient Hellkite and the two graveyard activations.
 */
function activationDescription(
  printed: string,
  cardId: string,
  path: string,
):
  | { readonly ok: true; readonly description: string }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] } {
  const separator = printed.indexOf(': ');
  if (separator !== -1) return { ok: true, description: printed.slice(separator + 2) };
  return {
    ok: false,
    rejections: [
      rejection(
        'UNSAFE_SCRIPT_TEXT',
        cardId,
        path,
        `an activated ability prints as "<cost>: ..." and this one printed ${JSON.stringify(printed)}, so the cost cannot be split from the sentence Forge writes beside Cost$`,
      ),
    ],
  };
}

/** Forge parameters for the two reusable activated-ability timing restrictions. */
function activationRestrictionParams(ability: ActivatedAbility): readonly ForgeParam[] {
  return params(
    ['IsPresent', ability.activateOnlyWhileAttacking === true ? 'Card.Self+attacking' : undefined],
    ['SorcerySpeed', ability.activateOnlyAsSorcery === true ? 'True' : undefined],
    ['ActivationLimit', ability.activateOnlyOnceEachTurn === true ? '1' : undefined],
  );
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
  isUltimate: boolean,
  preservePrintedSource = false,
): AbilityScriptResult {
  const loyalty = loyaltyClause(ability, printed, cardId, path);
  if (!loyalty.ok) return { ok: false, rejections: loyalty.rejections };
  const ordinaryDescription = loyalty.value === null ? activationDescription(printed, cardId, path) : null;
  if (ordinaryDescription !== null && !ordinaryDescription.ok) {
    return { ok: false, rejections: ordinaryDescription.rejections };
  }
  const costRejections = activationCostRejections(ability.cost, cardId, path);
  if (costRejections.length > 0) return { ok: false, rejections: costRejections };
  const description =
    loyalty.value?.description ??
    (ordinaryDescription?.ok === true ? ordinaryDescription.description : printed);
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

  // Ordinary Forge card scripts name their source as CARDNAME. Regenerate
  // retains its source-attested "this creature" text and therefore uses the
  // unmodified description below.
  const ordinaryForgeDescription = preservePrintedSource
    ? description
    : description
        .replaceAll('this permanent', 'CARDNAME')
        .replaceAll('this creature', 'CARDNAME')
        .replaceAll('this artifact', 'CARDNAME')
        .replaceAll('This artifact', 'CARDNAME');
  const forgeDescription = ability.effects.some(effectUsesPaidDiscardManaValue)
    ? ordinaryForgeDescription.replaceAll('This creature', 'CARDNAME')
    : ability.activateOnlyAsInstantReminder === true
      ? ordinaryForgeDescription.replace(' (Activate only as an instant.)', '')
      : ordinaryForgeDescription;

  if (ability.modes !== undefined) {
    return modalActivatedScript(ability, index, forgeDescription, cost, cardId, path, isUltimate);
  }

  if (isDamageTargetAndCreaturesWithSameNameAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `A:AB$ DealDamage | Cost$ ${cost} | ValidTgts$ Creature | NumDmg$ 1 | DamageMap$ True | SubAbility$ DamageSame | SpellDescription$ ${forgeDescription}`,
          'SVar:DamageSame:DB$ DamageAll | ValidCards$ Targeted.sameName+Other | ValidDescription$ each other creature with the same name as that creature. | NumDmg$ 1 | SubAbility$ DBDamageResolve',
          'SVar:DBDamageResolve:DB$ DamageResolve',
        ],
        tokens: [],
      },
    };
  }

  if (isCombatDamageRetaliationAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `A:AB$ Animate | Cost$ ${cost} | Planeswalker$ True | Defined$ Self | Triggers$ TrigVraska | Duration$ UntilYourNextTurn | AILogic$ EOT | SpellDescription$ ${forgeDescription} | StackDescription$ ${forgeDescription}`,
          `SVar:TrigVraska:Mode$ DamageDone | ValidSource$ Creature | ValidTarget$ Card.Self | TriggerZones$ Battlefield | CombatDamage$ True | Execute$ VraskaGaze | TriggerDescription$ ${forgeDescription}`,
          'SVar:VraskaGaze:DB$ Destroy | Defined$ TriggeredSourceLKICopy',
        ],
        tokens: [],
      },
    };
  }

  if (isJaceArchitectAttackDebuffAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `A:AB$ Effect | Cost$ ${cost} | Planeswalker$ True | Triggers$ TrigAttack | Duration$ UntilYourNextTurn | AILogic$ Main2 | SpellDescription$ ${forgeDescription}`,
          `SVar:TrigAttack:Mode$ Attacks | ValidCard$ Creature.OppCtrl | TriggerZones$ Command | Execute$ JacePump | TriggerDescription$ ${forgeDescription}`,
          'SVar:JacePump:DB$ Pump | Defined$ TriggeredAttackerLKICopy | NumAtt$ -1',
        ],
        tokens: [],
      },
    };
  }

  if (isJaceArchitectPilesAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `A:AB$ PeekAndReveal | Cost$ ${cost} | Planeswalker$ True | PeekAmount$ 3 | RememberRevealed$ True | NoPeek$ True | SubAbility$ DBTwoPiles | SpellDescription$ ${forgeDescription}`,
          'SVar:DBTwoPiles:DB$ TwoPiles | Defined$ You | DefinedCards$ Remembered | Separator$ Opponent | ChosenPile$ DBHand | UnchosenPile$ DBLibraryBottom',
          'SVar:DBHand:DB$ ChangeZone | Defined$ Remembered | Origin$ Library | Destination$ Hand',
          'SVar:DBLibraryBottom:DB$ ChangeZoneAll | ChangeType$ Card.IsRemembered | Origin$ Library | Destination$ Library | LibraryPosition$ -1',
        ],
        tokens: [],
      },
    };
  }

  if (isJaceArchitectSearchAndCastAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `A:AB$ ChangeZone | Cost$ ${cost} | Planeswalker$ True | Ultimate$ True | Origin$ Library | Destination$ Exile | DefinedPlayer$ Player | Chooser$ You | ChangeType$ Card.nonLand | ChangeNum$ 1 | Imprint$ True | Shuffle$ True | SubAbility$ DBPlayIt | SpellDescription$ ${forgeDescription}`,
          'SVar:DBPlayIt:DB$ Play | Defined$ Imprinted | Amount$ All | Controller$ You | WithoutManaCost$ True | ValidSA$ Spell | Optional$ True | SubAbility$ DBCleanup',
          'SVar:DBCleanup:DB$ Cleanup | ClearImprinted$ True',
        ],
        tokens: [],
      },
    };
  }

  if (isRegenerationAbility(ability)) {
    return {
      ok: true,
      value: {
        lines: [
          `A:${renderActivatedAbility({
            api: 'Regenerate',
            params: params(['Cost', cost], ...activationRestrictionParams(ability), [
              'SpellDescription',
              description,
            ]),
          })}`,
        ],
        tokens: [],
      },
    };
  }

  const rejections: TranspileRejection[] = [];
  const tokens: TokenSpec[] = [];
  const supportingLines: string[] = [...boardCountSvarLines(ability.effects)];
  const bodies: ForgeAbility[] = [];
  const spellings = withBoardCounts(
    ability.effects.some(
      (effect) =>
        effectUsesPaidSacrificePower(effect) ||
        effectUsesPaidSacrificeToughness(effect) ||
        effectUsesPaidDiscardManaValue(effect),
    )
      ? resolutionCountSpellings(ability.effects, false)
      : ability.effects.map(() => NO_COMPUTED_AMOUNTS),
    ability.effects,
  );
  for (const [position, effect] of ability.effects.entries()) {
    const result = transpileEffect(effect, cardId, `${path}.effects[${position}]`, spellings[position]);
    if (!result.ok) {
      rejections.push(...result.rejections);
      continue;
    }
    if (result.value.token !== undefined) tokens.push(result.value.token);
    for (const line of result.value.supportingLines ?? []) {
      if (!supportingLines.includes(line)) supportingLines.push(line);
    }
    bodies.push(result.value.ability);
    if (result.value.follow !== undefined) bodies.push(...result.value.follow);
  }
  if (rejections.length > 0) return { ok: false, rejections };

  const pumpThenGrantKeyword =
    ability.effects.length === 2 &&
    ability.effects[0]?.kind === 'pumpUntilEndOfTurn' &&
    ability.effects[0].target.kind === 'targetCreature' &&
    ability.effects[1]?.kind === 'grantKeywordUntilEndOfTurn' &&
    ability.effects[1].target.kind === 'thatCreature' &&
    bodies.length === 2 &&
    bodies[0]?.api === 'Pump' &&
    bodies[1]?.api === 'Pump' &&
    bodies[1].params.every(([name, value]) => (name === 'Defined' && value === 'Targeted') || name === 'KW');
  const graveyardExileThenMana =
    ability.effects.length === 2 &&
    ability.effects[0]?.kind === 'exileTarget' &&
    ability.effects[0].target.kind === 'targetCardInAGraveyard' &&
    ability.effects[1]?.kind === 'addMana' &&
    ability.effects[1].amount === 1;
  const exactBodies = graveyardExileThenMana
    ? bodies.map((body, position) =>
        position === 1 && body.api === 'Mana' && !body.params.some(([name]) => name === 'Amount')
          ? { ...body, params: [...body.params, ['Amount', '1'] as ForgeParam] }
          : body,
      )
    : bodies;
  const composedBodies = pumpThenGrantKeyword
    ? [
        {
          ...exactBodies[0]!,
          params: [
            ...exactBodies[0]!.params,
            ...exactBodies[1]!.params.filter(([name]) => name !== 'Defined'),
          ],
        },
      ]
    : exactBodies;
  const [primary, ...subs] = composedBodies;
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

  const conventionalPumpName =
    loyalty.value !== null &&
    primary.api === 'PutCounterAll' &&
    subs.length === 1 &&
    subs[0]?.api === 'PumpAll'
      ? 'DBPumpAll'
      : null;
  const targetControllerDamageNames =
    primary.api === 'DealDamage' &&
    primary.params.some(([name, value]) => name === 'DamageMap' && value === 'True') &&
    subs.length >= 2 &&
    subs[0]?.api === 'DamageAll' &&
    subs[1]?.api === 'DamageResolve';
  const activatedDrawThenDiscard =
    ability.effects.length === 2 &&
    ability.effects[0]?.kind === 'drawCards' &&
    ability.effects[0].count === 1 &&
    ability.effects[0].target.kind === 'noTarget' &&
    ability.effects[1]?.kind === 'discardCards' &&
    ability.effects[1].count === 1 &&
    ability.effects[1].target.kind === 'noTarget';
  const activatedSelfDraw =
    ability.effects.length === 1 &&
    ability.effects[0]?.kind === 'drawCards' &&
    ability.effects[0].target.kind === 'noTarget' &&
    ability.cost.sacrificeMatching === undefined &&
    ability.cost.sacrificeLandSubtypePair === undefined;
  const subName = (position: number): string =>
    activatedDrawThenDiscard
      ? 'DBDiscard'
      : targetControllerDamageNames
        ? position === 1
          ? 'DmgAll'
          : 'DBDamageResolve'
        : position === 1 && conventionalPumpName !== null
          ? conventionalPumpName
          : `Act${index + 1}Effect${position + 1}`;
  // Forge's activated PutCounter API defaults to the permanent carrying the
  // ability. Gobbling Ooze and Lotleth Troll both omit `Defined$ Self` in the
  // installed corpus; triggered PutCounter subabilities still name it.
  const activatedSelfCounter =
    primary.api === 'PutCounter' &&
    ability.effects[0]?.kind === 'putCounters' &&
    (ability.effects[0].target.kind === 'selfCreature' || ability.effects[0].target.kind === 'selfPermanent');
  const primaryEffectParams = primary.params.filter(
    ([name, value]) =>
      !(loyalty.value !== null && primary.api === 'GainLife' && name === 'Defined' && value === 'You') &&
      !(activatedSelfDraw && primary.api === 'Draw' && name === 'Defined' && value === 'You') &&
      !(activatedDrawThenDiscard && primary.api === 'Draw' && name === 'Defined' && value === 'You') &&
      !(activatedSelfCounter && name === 'Defined' && value === 'Self') &&
      !(targetControllerDamageNames && name === 'DamageMap' && value === 'True'),
  );
  const exactPrimaryEffectParams: readonly ForgeParam[] =
    ability.activateOnlyOnceEachTurn === true &&
    primary.api === 'Mana' &&
    !primaryEffectParams.some(([name]) => name === 'Amount')
      ? [...primaryEffectParams, ['Amount', '1']]
      : primaryEffectParams;
  const primaryParams: ForgeParam[] = [
    ['Cost', cost],
    ...(ability.cost.exileControlledInstantOrSorcerySpell === true
      ? ([['CostDesc', 'Exile an instant or sorcery spell you control:']] as readonly ForgeParam[])
      : []),
    ...exactPrimaryEffectParams,
    ...(ability.cost.discardMatching === undefined
      ? []
      : ([['CostDesc', 'Discard two nonland cards with the same name']] as readonly ForgeParam[])),
    ...activationRestrictionParams(ability),
    ...(ability.activationZone === 'graveyard'
      ? ([['ActivationZone', 'Graveyard']] as readonly ForgeParam[])
      : []),
    ...(loyalty.value === null ? [] : ([['Planeswalker', 'True']] as readonly ForgeParam[])),
    ...(isUltimate ? ([['Ultimate', 'True']] as readonly ForgeParam[]) : []),
    ...(activatedDrawThenDiscard ? ([['SpellDescription', forgeDescription]] as readonly ForgeParam[]) : []),
    ...(subs.length > 0 ? ([['SubAbility', subName(1)]] as readonly ForgeParam[]) : []),
    ...(targetControllerDamageNames ? ([['DamageMap', 'True']] as readonly ForgeParam[]) : []),
    ...(ability.counterTargetSpellUnless === undefined
      ? []
      : ([['UnlessCost', forgeManaCost(ability.counterTargetSpellUnless.cost)]] as readonly ForgeParam[])),
    ...(activatedDrawThenDiscard ? [] : ([['SpellDescription', forgeDescription]] as readonly ForgeParam[])),
  ];
  const lines = [`A:${renderActivatedAbility({ api: primary.api, params: primaryParams })}`];
  lines.push(
    ...renderNamedSubAbilityChain(
      subs.map((sub, position) => ({
        name: subName(position + 1),
        rendered: renderSubAbility(sub),
      })),
    ),
  );
  lines.push(...supportingLines);
  return { ok: true, value: { lines, tokens } };
}

const MODAL_TARGET_PARAMS = new Set(['ValidTgts', 'TgtPrompt', 'TargetMin', 'TargetMax', 'TargetUnique']);

/**
 * Forge's shared-target `GenericChoice` form for a modal activation.
 *
 * The bounded form here is deliberately the one attested by Liliana: every
 * mode has one effect, every effect uses the same API and target selector, and
 * only the mode body differs. The target remains on the root `A:` line while
 * each choice reads it back as `Defined$ Targeted`; accepting different target
 * spaces would make Forge ask its target before it knew which space the chosen
 * mode permits.
 */
function modalActivatedScript(
  ability: ActivatedAbility,
  index: number,
  description: string,
  cost: string,
  cardId: string,
  path: string,
  isUltimate: boolean,
): AbilityScriptResult {
  const modes = ability.modes;
  if (modes === undefined) throw new Error('modalActivatedScript received a fixed activated ability');
  const choiceName = `Act${String(index + 1)}Choice`;
  const modeNames = modes.map((_mode, modeIndex) => `Act${String(index + 1)}Mode${String(modeIndex + 1)}`);
  const built: Array<{
    readonly api: string;
    readonly target: readonly ForgeParam[];
    readonly body: readonly ForgeParam[];
    readonly description: string;
  }> = [];
  const supportingLines: string[] = [];
  const rejections: TranspileRejection[] = [];

  for (const [modeIndex, mode] of modes.entries()) {
    const effect = mode.effects[0];
    if (mode.effects.length !== 1 || effect === undefined) {
      rejections.push(
        rejection(
          'UNMAPPED_EFFECT_KIND',
          cardId,
          `${path}.modes[${String(modeIndex)}]`,
          'Forge GenericChoice export currently requires exactly one effect in each activated mode',
        ),
      );
      continue;
    }
    const computed = withBoardCounts([NO_COMPUTED_AMOUNTS], mode.effects)[0] ?? NO_COMPUTED_AMOUNTS;
    const result = transpileEffect(
      effect,
      cardId,
      `${path}.modes[${String(modeIndex)}].effects[0]`,
      computed,
    );
    if (!result.ok) {
      rejections.push(...result.rejections);
      continue;
    }
    if (result.value.follow !== undefined || result.value.token !== undefined) {
      rejections.push(
        rejection(
          'UNMAPPED_EFFECT_KIND',
          cardId,
          `${path}.modes[${String(modeIndex)}].effects[0]`,
          'Forge GenericChoice export does not yet support a mode body with a follow-up or token declaration',
        ),
      );
      continue;
    }
    const target = result.value.ability.params.filter(([name]) => MODAL_TARGET_PARAMS.has(name));
    const body = result.value.ability.params.filter(([name]) => !MODAL_TARGET_PARAMS.has(name));
    built.push({
      api: result.value.ability.api,
      target,
      body,
      description: renderEffectList(mode.effects, 'CARDNAME').join(' '),
    });
    for (const line of [...boardCountSvarLines(mode.effects), ...(result.value.supportingLines ?? [])]) {
      if (!supportingLines.includes(line)) supportingLines.push(line);
    }
  }
  if (rejections.length > 0) return { ok: false, rejections };
  const primary = built[0];
  if (primary === undefined || primary.target.length === 0) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          cardId,
          `${path}.modes`,
          'Forge GenericChoice activated modes currently require one shared target chosen on the root ability',
        ),
      ],
    };
  }
  if (
    built.some(
      (mode) => mode.api !== primary.api || JSON.stringify(mode.target) !== JSON.stringify(primary.target),
    )
  ) {
    return {
      ok: false,
      rejections: [
        rejection(
          'UNMAPPED_EFFECT_KIND',
          cardId,
          `${path}.modes`,
          'Forge GenericChoice activated modes must share one effect API and target selector',
        ),
      ],
    };
  }

  const rootParams: ForgeParam[] = [
    ['Cost', cost],
    ...primary.target,
    ...activationRestrictionParams(ability),
    ...(ability.loyaltyCost === undefined ? [] : ([['Planeswalker', 'True']] as const)),
    ...(isUltimate ? ([['Ultimate', 'True']] as const) : []),
    ['SubAbility', choiceName],
    ['SpellDescription', description],
  ];
  const lines = [
    `A:${renderActivatedAbility({ api: primary.api, params: rootParams })}`,
    `SVar:${choiceName}:${renderSubAbility({
      api: 'GenericChoice',
      params: params(['Defined', 'You'], ['Choices', modeNames.join(',')]),
    })}`,
    ...built.map((mode, modeIndex) => {
      const modeName = modeNames[modeIndex];
      if (modeName === undefined) throw new Error('modal ability lost a generated Forge mode name');
      return `SVar:${modeName}:${renderSubAbility({
        api: mode.api,
        params: [
          ...params(['Defined', 'Targeted']),
          ...mode.body,
          ...params(['SpellDescription', mode.description]),
        ],
      })}`;
    }),
    ...supportingLines,
  ];
  return { ok: true, value: { lines, tokens: [] } };
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
 * Forge writes its own text for the keyword, so the static clause becomes a
 * `Description$` while the attach cost becomes the `K:` line's cost. Some
 * Equipment grant no static clause at all; they still carry ordinary Equip and
 * therefore export only the keyword line.
 *
 * A combat restriction is a second Forge static machine, not another
 * `Continuous` parameter. Whispersilk Cloak therefore adds `Mode$ CantBlockBy`
 * beside its `AddKeyword$ Shroud` line, matching Forge's checked-in script;
 * only the continuous line carries the shared description.
 *
 * The text rejection below is unreachable from a DSL-valid card today, the
 * way `triggerScript`'s empty-`Execute$` one is: every word comes from a pinned
 * vocabulary. It remains the alarm for a clause that would break Forge syntax.
 */
function equipScript(ability: AttachingAbility, cardId: string, path: string): AbilityScriptResult {
  const granted = renderEquipModificationClause(ability.attach.modifications);
  if (granted.length > 0 && !isScriptSafe(granted)) {
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
  const layered = ability.attach.modifications.filter(isLayeredStaticModification);
  const layeredIndices = ability.attach.modifications.flatMap((modification, index) =>
    isLayeredStaticModification(modification) ? [index] : [],
  );
  const combat = ability.attach.modifications.filter(isEquipCombatModification);
  const body =
    layered.length === 0
      ? { ok: true as const, params: [] }
      : modificationsParams(
          layered,
          FORGE_EQUIPPED_AFFECTED,
          cardId,
          `${path}.attach.modifications`,
          layeredIndices,
        );
  if (!body.ok) return body;
  // Unreachable from a DSL-valid Equipment, the way the text rejection above
  // is: `checkEquipAbility` holds an equip cost to mana and an equip ability
  // prints no effect, so `checkActivationCost` refuses an `{X}` nothing reads
  // before a card can carry one here. It is the alarm for that pairing changing
  // under an exporter that would otherwise write `K:Equip:` with the symbol
  // silently gone.
  const costRejections = activationCostRejections(ability.cost, cardId, path);
  if (costRejections.length > 0) return { ok: false, rejections: costRejections };
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
  const lines = [`K:Equip:${cost}`];
  if (layered.length > 0) {
    lines.push(`S:${renderStaticAbility([...body.params, ...params(['Description', granted])])}`);
    lines.push(...(body.supportingLines ?? []));
  }
  for (const [index, modification] of combat.entries()) {
    const description = layered.length === 0 && index === 0 ? params(['Description', granted]) : [];
    lines.push(equipCombatLine(modification, description));
  }
  return { ok: true, value: { lines, tokens: [] } };
}

/**
 * The printed line, plus its reminder when the line is a word rather than a
 * sentence.
 *
 * `Description$` is what Forge shows on the stack, so a line that reads
 * `Flurry rush 2` and stops names a trigger without saying what it does. The
 * DSL already writes the sentence -- `abilityLineReminder` is what the card
 * face draws under the word -- so this is a description-side join and not new
 * vocabulary.
 *
 * The corpus writes it exactly this way, word then parenthesis and no period
 * between: `TriggerDescription$ Frenzy 1 (Whenever CARDNAME attacks and isn't
 * blocked, it gets +1/+0 until end of turn.)`, and `Oildying` and
 * `Squirrellink` the same. 1,670 of 18,243 shipped `TriggerDescription$`
 * values carry a parenthesized reminder, so this is a convention rather than
 * an exception. Forge's other spelling, `Landfall -- Whenever a land you
 * control enters, ...`, belongs to ability words whose whole sentence the card
 * prints; ours print the word and the reminder, which is the Frenzy shape.
 *
 * The gloss goes in exactly as the face prints it, "this creature" included,
 * which is the same rule the rendered line follows: the Forge card and the
 * oracle text may not disagree about what an ability says. Forge writes that
 * self-reference both ways and `Oildying` and `Squirrellink` write it this one.
 *
 * A line with no reminder is returned untouched, which is every line but the
 * ability words: over the flagship's 371 cards the reminder attaches to 21
 * abilities across three words and nothing else.
 */
function withReminder(line: string): string {
  const reminder = abilityLineReminder(line);
  return reminder === null ? line : `${line} ${reminder.gloss}`;
}

/**
 * The lines one printed ability contributes, `Description$` included.
 *
 * The description is the DSL's own printed line, so the Forge card and the
 * oracle text cannot disagree about what the ability says — the same rule
 * `abilityBlock` follows for spell effects. An Equip ability may add static
 * lines beside its keyword line, and it is answered before the rest for that
 * reason.
 */
export function transpileAbility(
  ability: Ability,
  index: number,
  cardId: string,
  path: string,
  sourceName = 'CARDNAME',
  isUltimate = false,
): AbilityScriptResult {
  if (isAttachingAbility(ability)) return equipScript(ability, cardId, path);
  if (isScavengeAbility(ability)) {
    return {
      ok: true,
      value: { lines: [`K:Scavenge:${forgeActivationManaCost(ability.cost)}`], tokens: [] },
    };
  }
  // Oracle's contemporary self-reference is "this card"; Forge script text
  // names the source through its CARDNAME macro. Keep executable descriptions
  // in Forge's grammar without changing the public Oracle renderer.
  const renderedDescription = withReminder(renderAbility(ability, sourceName)).replaceAll(
    'this card',
    sourceName,
  );
  const description =
    ability.kind === 'stateTriggered' ||
    (ability.kind === 'triggered' &&
      ability.effects.some((effect) => effect.kind === 'putDepartedSourceOnTopOfOwnerLibrary'))
      ? renderedDescription.replaceAll('this creature', sourceName).replaceAll('this permanent', sourceName)
      : renderedDescription;
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
    case 'staticActivationRule':
      return {
        ok: true,
        value: {
          lines: [
            `S:Mode$ CantBeActivated | ValidCard$ Card.NamedCard | ValidSA$ Activated.!ManaAbility | Description$ ${description}`,
          ],
          tokens: [],
        },
      };
    case 'static': {
      if (
        ability.modification.kind === 'grantAnyColorManaAbility' &&
        ability.scope === 'landsYouControl' &&
        ability.subtype === null &&
        ability.filter === undefined &&
        (ability.enabledWhile ?? null) === null
      ) {
        return {
          ok: true,
          value: {
            lines: [
              'S:Mode$ Continuous | Affected$ Land.YouCtrl | AddAbility$ AnyMana | Description$ Lands you control have "{T}: Add one mana of any color."',
              'SVar:AnyMana:AB$ Mana | Cost$ T | Produced$ Any | Amount$ 1 | SpellDescription$ Add one mana of any color.',
            ],
            tokens: [],
          },
        };
      }
      if (ability.modification.kind === 'preventCombatDamage') {
        if (
          ability.scope !== 'self' ||
          ability.subtype !== null ||
          ability.filter !== undefined ||
          ability.enabledWhile !== undefined
        ) {
          return {
            ok: false,
            rejections: [
              rejection(
                'UNMAPPED_EFFECT_KIND',
                cardId,
                path,
                'Forge keyword parity is proven only for an unconditional self-scoped combat-damage prevention ability',
              ),
            ],
          };
        }
        return {
          ok: true,
          value: {
            lines: [`K:Prevent all combat damage that would be dealt to and dealt by ${sourceName}.`],
            tokens: [],
          },
        };
      }
      if (
        ability.modification.kind === 'grantTriggeredAbility' &&
        isExaltedAbility(ability.modification.ability) &&
        ability.scope === 'otherCreaturesYouControl' &&
        ability.subtype === null &&
        ability.filter === undefined &&
        (ability.enabledWhile ?? null) === null
      ) {
        return {
          ok: true,
          value: {
            lines: [
              'S:Mode$ Continuous | Affected$ Creature.Other+YouCtrl | AddKeyword$ Exalted | Description$ Other creatures you control have Exalted.',
            ],
            tokens: [],
          },
        };
      }
      if (ability.modification.kind === 'cantAttackWithoutAnyOf') {
        const restrictions = ability.modification.anyOf.map((admission) => {
          switch (admission.kind) {
            case 'keyword':
              return `without${FORGE_KEYWORDS[admission.keyword]}`;
            case 'landwalk':
              return `!hasKeywordLandwalk:${admission.landType}`;
            default:
              return assertNever(admission, 'transpileAbility attack admission');
          }
        });
        return {
          ok: true,
          value: {
            lines: [
              `S:Mode$ CantAttack | ValidCard$ Creature.${restrictions.join('+')} | Description$ ${description}`,
            ],
            tokens: [],
          },
        };
      }
      if (ability.modification.kind === 'discardedByOpponentEntersBattlefield') {
        const forgeDescription =
          ability.printedSourceReference === 'thisCard'
            ? description.replace('discard this card', 'discard CARDNAME')
            : description;
        return {
          ok: true,
          value: {
            lines: [
              `R:Event$ Moved | ActiveZones$ Hand | ValidCard$ Card.Self | ValidCause$ SpellAbility.OppCtrl | Discard$ True | EffectOnly$ True | ReplaceWith$ SurpriseETB | Description$ ${forgeDescription}`,
              'SVar:SurpriseETB:DB$ ChangeZone | Defined$ ReplacedCard | Origin$ Hand | Destination$ Battlefield',
              'SVar:DiscardMeByOpp:2',
            ],
            tokens: [],
          },
        };
      }
      if (ability.modification.kind === 'damageCannotReduceControllerLifeBelow') {
        const minimum = String(ability.modification.minimum);
        return {
          ok: true,
          value: {
            lines: [
              `R:Event$ LifeReduced | ActiveZones$ Battlefield | ValidPlayer$ You.lifeGE${minimum} | Result$ LT${minimum} | IsDamage$ True | ReplaceWith$ ReduceLoss | Description$ ${description}`,
              'SVar:ReduceLoss:DB$ ReplaceEffect | VarName$ Amount | VarValue$ X',
              'SVar:X:ReplaceCount$Amount/LimitMax.Difference',
              `SVar:Difference:Count$YourLifeTotal/Minus.${minimum}`,
            ],
            tokens: [],
          },
        };
      }
      if (ability.modification.kind === 'doubleDamage' && ability.modification.sourceFilter !== undefined) {
        const filter = ability.modification.sourceFilter;
        const validSources = filter.cardTypes.flatMap((cardType) =>
          filter.colors.map(
            (color) => `${FORGE_CARD_TYPES[cardType]}.YouCtrl+${FORGE_COLOR_PROPERTIES[color]}`,
          ),
        );
        return {
          ok: true,
          value: {
            lines: [
              `R:Event$ DamageDone | ActiveZones$ Battlefield | ValidSource$ ${validSources.join(',')} | ReplaceWith$ DmgTwice | Description$ ${description}`,
              'SVar:DmgTwice:DB$ ReplaceEffect | VarName$ DamageAmount | VarValue$ X',
              'SVar:X:ReplaceCount$DamageAmount/Twice',
            ],
            tokens: [],
          },
        };
      }
      if (ability.modification.kind === 'doublePlusOnePlusOneCountersOnCreaturesYouControl') {
        return {
          ok: true,
          value: {
            lines: [
              `R:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Creature.YouCtrl+inZoneBattlefield | ValidCounterType$ P1P1 | ReplaceWith$ DoubleCounters | Description$ ${description}`,
              'SVar:DoubleCounters:DB$ ReplaceCounter | ValidCounterType$ P1P1 | Amount$ X',
              'SVar:X:ReplaceCount$CounterNum/Twice',
            ],
            tokens: [],
          },
        };
      }
      if (ability.modification.kind === 'preventDamageToSelfAndRemoveCounters') {
        const counterTypes = FORGE_COUNTER_TYPES[ability.modification.counter];
        if (counterTypes === null || counterTypes.length !== 1) {
          return {
            ok: false,
            rejections: [
              rejection(
                'UNMAPPED_EFFECT_KIND',
                cardId,
                `${path}.modification.counter`,
                'this prevention follow-up has no single exact Forge counter type',
              ),
            ],
          };
        }
        return {
          ok: true,
          value: {
            lines: [
              `R:Event$ DamageDone | ActiveZones$ Battlefield | ValidTarget$ Card.Self | ReplaceWith$ Counters | PreventionEffect$ True | AlwaysReplace$ True | Description$ ${description}`,
              `SVar:Counters:DB$ RemoveCounter | Defined$ ReplacedTarget | CounterType$ ${counterTypes[0]} | CounterNum$ Y`,
              'SVar:Y:ReplaceCount$DamageAmount',
            ],
            tokens: [],
          },
        };
      }
      if (
        ability.modification.kind === 'cantAttackOrBlockAlone' &&
        ability.scope === 'self' &&
        ability.subtype === null &&
        ability.filter === undefined &&
        (ability.enabledWhile ?? null) === null
      ) {
        return { ok: true, value: { lines: [`K:${description}`], tokens: [] } };
      }
      if (
        ability.modification.kind === 'canAttackAsThoughNoDefender' &&
        ability.scope === 'self' &&
        ability.subtype === null &&
        ability.filter === undefined &&
        ability.enabledWhile?.kind === 'controlsSubtype' &&
        ability.enabledWhile.atLeast === 1
      ) {
        const subtype = ability.enabledWhile.subtype;
        const forgeDescription =
          ability.printedSubjectReference === 'thisCreature'
            ? description.replace(/^This creature/, 'CARDNAME')
            : description;
        return {
          ok: true,
          value: {
            lines: [
              `S:Mode$ CanAttackDefender | ValidCard$ Card.Self | IsPresent$ ${subtype}.YouCtrl | Description$ ${forgeDescription}`,
              `SVar:BuffedBy:${subtype}`,
              `DeckNeeds:Type$${subtype}`,
            ],
            tokens: [],
          },
        };
      }
      const body = staticParams(ability, index, cardId, path);
      if (!body.ok) return body;
      const combat = combatRestriction(ability);
      const forgeDescription =
        ability.printedSubjectReference === 'thisCreature'
          ? description.replace(/^This creature/, 'CARDNAME')
          : description;
      const withDescription = [...body.params, ...params(['Description', forgeDescription])];
      const line =
        combat === null
          ? renderStaticAbility(withDescription)
          : renderModeAbility(combat.mode, withDescription);
      return {
        ok: true,
        value: { lines: [`S:${line}`, ...(body.supportingLines ?? [])], tokens: [] },
      };
    }
    case 'staticPlayerRule':
      return staticPlayerRuleScript(ability, description, cardId, path);
    case 'staticGameRule':
      return staticGameRuleScript(ability, description);
    case 'triggered':
      return triggerScript(ability, index, description, cardId, path);
    case 'activated':
      return activatedScript(ability, index, description, cardId, path, isUltimate);
    case 'stateTriggered':
      return stateTriggerScript(ability, index, description, cardId, path);
    case 'staticBundle':
      return staticBundleScript(ability, description, cardId, path);
    default:
      return assertNever(ability, 'transpileAbility');
  }
}
