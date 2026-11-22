/**
 * Card record -> Forge card script.
 *
 * Line order follows the shipped corpus: `Name`, `ManaCost`, `Types`, `PT`,
 * `K:` keywords, the ability block (`A:` plus its `SVar:` sub-abilities),
 * `DeckHas`, `Oracle`.
 *
 * Multi-effect spells chain through Forge's sub-ability mechanism, the same
 * shape `Aang's Defense` and `Absorb` use: the primary `A:` line carries
 * `SubAbility$ DBEffect1` and the whole printed text in `SpellDescription$`,
 * and each `SVar:DBEffect<n>` carries the next link. Each DSL effect keeps its
 * own target clause, which matches the DSL's own oracle rendering — two
 * targeted effects on one card print as two independent targets.
 */
import type {
  Ability,
  Card,
  CreatureCard,
  Effect,
  KeywordAbility,
  Modes,
  TokenSpec,
  UnlessPayer,
} from '@mtg/dsl';
import {
  BASIC_LAND_TYPES,
  englishPlural,
  abilityLineReminder,
  describeCostReduction,
  hasAbilityEffects,
  counterPhrase,
  assertNever,
  isAuraCard,
  isCastable,
  isCreatureTokenSpec,
  isExaltedAbility,
  isEnchantedLandBecomesTappedMillAbility,
  isOptionalDiscardThenDrawAbility,
  isControllerDamageRemovesSourceCounterAbility,
  isPutCounterThenWinAtThresholdAbility,
  isVariableLoyaltyCost,
  openingHandActionOf,
  printedCardSurface,
  printedEntryReplacement,
  renderEffectList,
  renderAlternativeCost,
  renderCastingRestriction,
  renderOpponentLifeLossCastingRestriction,
  renderOracleText,
  renderTokenOracleText,
  referentSourceIndex,
  sortColors,
  sortKeywords,
  spellEffectsFor,
  tokenAbilities,
  transformedBackFaceOf,
  typeLineParts,
  withUnlessClause,
} from '@mtg/dsl';
import { isDamageLinkedMillAbility, transpileAbility } from './ability-script';
import {
  RESOLUTION_COUNT_CLEANUP,
  REVEALED_CARD_MANA_VALUE_SVAR_LINE,
  RESOLUTION_COUNT_SVAR_LINE,
  readsResolutionCount,
  resolutionCountSpellings,
} from './remember';
import { retainDepartedTargetController } from './retained-controller';
import { boardCountSvarLines, withBoardCounts } from './board-count';
import { auraScript } from './aura-script';
import type { ForgeAbility } from './script-text';
import {
  escapeNewlines,
  isScriptSafe,
  renderNamedSubAbilityChain,
  renderSpellAbility,
  renderSubAbility,
} from './script-text';
import type { TranspileRejection } from './rejection';
import { rejection, TranspileError } from './rejection';
import { FORGE_EFFECTS, transpileEffect } from './effect-script';
import {
  FORGE_COLOR_WORDS,
  FORGE_CARD_TYPES,
  FORGE_COUNTER_TYPES,
  FORGE_ENTRY_COUNTER_AI_LOGIC,
  FORGE_KEYWORDS,
  FORGE_MANA_PRODUCED,
} from './vocabulary-map';
import { forgeManaCost, forgeOverloadCost } from './mana-script';
import { forgeSacrificeMatching } from './sacrifice-script';

export { forgeManaCost } from './mana-script';
import { forgeTokenDisplayName, forgeTokenScriptName } from './naming';

/** `Basic Land Mountain`, `Legendary Artifact Creature Golem`. */
export function forgeTypeLine(card: Card): string {
  const parts = typeLineParts(card);
  return [...parts.supertypes, ...parts.types, ...parts.subtypes].join(' ');
}

export interface CardScriptBody {
  readonly lines: readonly string[];
  readonly tokens: readonly TokenSpec[];
}

export type CardScriptResult =
  | { readonly ok: true; readonly value: CardScriptBody }
  | { readonly ok: false; readonly rejections: readonly TranspileRejection[] };

function printsForgeOracleReminder(card: Card, line: string): boolean {
  if (line === 'Flash') return true;
  if (line !== 'Exalted' && line !== 'Other creatures you control have exalted.') return false;
  return card.abilities.some(
    (ability) =>
      ability.kind === 'static' &&
      ability.modification.kind === 'grantTriggeredAbility' &&
      isExaltedAbility(ability.modification.ability),
  );
}

function keywordLines(card: Card, rejections: TranspileRejection[]): string[] {
  const lines: string[] = [];
  const keywordAbilities = card.keywordAbilities ?? [];
  for (const ability of keywordAbilities.filter((candidate) => candidate.kind === 'flash')) {
    lines.push(`K:${forgeKeywordAbility(ability)}`);
  }
  for (const ability of keywordAbilities.filter((candidate) => candidate.kind === 'defender')) {
    lines.push(`K:${forgeKeywordAbility(ability)}`);
  }
  for (const [index, keyword] of sortKeywords(card.keywords).entries()) {
    const forgeKeyword = FORGE_KEYWORDS[keyword];
    if (forgeKeyword === undefined) {
      rejections.push(
        rejection(
          'UNMAPPED_KEYWORD',
          card.id,
          `keywords[${index}]`,
          `keyword "${keyword}" has no Forge K: mapping`,
        ),
      );
      continue;
    }
    lines.push(`K:${forgeKeyword}`);
  }
  for (const ability of keywordAbilities.filter(
    (candidate) => candidate.kind !== 'flash' && candidate.kind !== 'defender',
  )) {
    lines.push(`K:${forgeKeywordAbility(ability)}`);
  }
  if (card.deckConstruction?.kind === 'anyNumberOfThisCard') {
    lines.push('K:A deck can have any number of cards named CARDNAME.');
  }
  if ((card.kind === 'instant' || card.kind === 'sorcery') && card.overload !== undefined) {
    lines.push(`K:Overload:${forgeOverloadCost(card.overload)}`);
  }
  return lines;
}

/** Source-proven Forge lines for card-authored opening-hand actions. */
function openingHandActionLines(card: Card): readonly string[] {
  const action = openingHandActionOf(card);
  if (action === undefined) return [];
  switch (action.kind) {
    case 'beginOnBattlefield':
      return [
        'K:MayEffectFromOpeningHand:FromHand',
        'SVar:FromHand:DB$ ChangeZone | Defined$ Self | Origin$ Hand | Destination$ Battlefield | SpellDescription$ If CARDNAME is in your opening hand, you may begin the game with it on the battlefield.',
      ];
  }
}

function forgeKeywordAbility(ability: KeywordAbility): string {
  switch (ability.kind) {
    case 'defender':
      return 'Defender';
    case 'landwalk':
      // Forge's shipped Bog Raiders, Harbor Serpent, and Merfolk Spy sources
      // all use the parameterized keyword form rather than the display word.
      return `Landwalk:${ability.landType}`;
    case 'hexproof':
      return 'Hexproof';
    case 'indestructible':
      return 'Indestructible';
    case 'protection':
      return `Protection from ${ability.quality.kind === 'color' ? FORGE_COLOR_WORDS[ability.quality.color] : ability.quality.subtype}`;
    case 'doubleStrike':
      return 'Double Strike';
    case 'shroud':
      return 'Shroud';
    case 'flash':
      return 'Flash';
    case 'intimidate':
      return 'Intimidate';
    case 'unleash':
      return 'Unleash';
  }
}

/**
 * The index of the loyalty ability Forge marks `Ultimate$ True`, or `null` when
 * the card marks none.
 *
 * `Ultimate$ True` is an AI preference hint: it tells Forge's AI that this is
 * the ability worth holding loyalty for. It changes no rules behavior, which
 * is why the rule behind it has to be read off the corpus rather than derived.
 *
 * Read off `forge-gui/res/cardsfolder` at 2.0.15-SNAPSHOT. 348 planeswalker
 * scripts ship; 345 carry at least one `A:` line with `Planeswalker$ True`, and
 * 281 of those mark one. Two facts settle the rule between them:
 *
 *  - **The marked ability is the last one printed.** It holds for 279 of the
 *    281. The two exceptions are the same card, `Rowan, Scholar of Sparks //
 *    Will, Scholar of Frost` and its Alchemy rebalance, which mark one ability
 *    per half; the DSL has no split planeswalker, so the shape is unreachable.
 *  - **No marked ability gains loyalty.** Zero of the 281 mark a cost that adds
 *    counters. `AddCounter<0/LOYALTY>` is not gaining: `gideon_jura.txt`,
 *    `gideon_of_the_trials.txt`, `kytheon_hero_of_akros_gideon_battle_forged.txt`
 *    and `jace_mirror_mage.txt` all mark a zero-cost last ability, and
 *    `grand_master_of_flowers.txt` (`+1` then `+1`) is the one script whose last
 *    ability gains and it is unmarked.
 *
 * So: the last printed loyalty ability, unless its cost adds loyalty. That is
 * exact on 279 of the 281 marked scripts and marks 63 of the 64 unmarked ones,
 * which is the shape of the corpus rather than an error — omitting the hint is
 * a choice Forge's own editors made card by card, and a transpiler that emits
 * what the printed costs imply lands inside the corpus's range either way
 * (`mtg-bc2.153`).
 *
 * `mtg-9xz4`'s predecessor rule was the most negative fixed cost, which is
 * exact on 268 of the 281. It loses the eleven walkers whose ultimate is an
 * announced `-X` (`Chandra, Flamecaller` and `Jeska, Thrice Reborn` get no hint
 * at all under it, since a variable cost is excluded and `Math.min(0, ...)`
 * then yields 0) and the four whose ultimate costs zero.
 *
 * A variable loyalty cost always subtracts — `loyaltyClause` writes it
 * `SubCounter<X/LOYALTY>` — so it can never be the gaining cost this refuses.
 */
function ultimateAbilityIndex(card: Card): number | null {
  if (card.kind !== 'planeswalker') return null;
  for (let index = card.abilities.length - 1; index >= 0; index -= 1) {
    const ability = card.abilities[index];
    if (ability === undefined) continue;
    if (ability.kind !== 'activated' || ability.loyaltyCost === undefined) continue;
    if (!isVariableLoyaltyCost(ability.loyaltyCost) && ability.loyaltyCost > 0) return null;
    return index;
  }
  return null;
}

/**
 * The printed abilities' lines — `S:` for a static, `T:` plus its `SVar:` chain
 * for a trigger — sitting between the `K:` keywords and the spell-ability
 * block, the order the shipped corpus uses for a permanent that has both. A
 * token-making trigger declares its token here, the same way a token-making
 * spell does.
 *
 * It collects `DeckHas` hints for the same reason `effectChain` does, and it
 * was not doing so until `mtg-nhyv.30`: the hint table is keyed by effect kind
 * and says nothing about where the effect sits, but only the spell chain read
 * it, so a life gain or a token hanging off a trigger exported without the
 * hint Forge's deck AI reads. `sacrificeSelf` is the kind that made the gap
 * unmissable rather than merely wrong -- its only legal targets are the two
 * retained referents, so it can never appear in `card.effects` at all, and a
 * hint reachable from nowhere is a hint that is not there. Triggered mill is
 * the one placement-sensitive hint in the pinned corpus: Jace's Erasure and
 * Hedron Crab carry `DeckHas:Ability$Mill`, while ordinary mill spells do not.
 * That distinction lives here, where the enclosing ability kind is known,
 * rather than widening `FORGE_EFFECTS.millCards` and changing every spell.
 *
 * A loyalty ability collects the same hints as any other ability. `06922b46`
 * narrowed the lookup to non-planeswalkers with no comment, and `mtg-9xz4`
 * went looking for the corpus line behind it. There is none. Read off
 * `forge-gui/res/cardsfolder` at 2.0.15-SNAPSHOT: 348 planeswalker scripts,
 * 158 of them carrying `DeckHas`, over the same vocabulary this table uses
 * (`Token` 40, `Counters` 17, `LifeGain` 9, `Graveyard` 6, `Discard` 4, plus
 * combinations). Every one of the ten M11/M13 walkers carries none, but that
 * is the era rather than the card kind: `obstinate_baloth.txt` and
 * `mitotic_slime.txt` are M11 creatures whose shipped scripts carry no
 * `DeckHas` either, while this transpiler exports `LifeGain` and `Token` for
 * them. Emitting what the effect table implies is the standing policy, so the
 * narrowing was the exception and it is gone.
 */
function abilityLines(
  card: Card,
  tokens: TokenSpec[],
  deckHas: string[],
  rejections: TranspileRejection[],
  include: (ability: Ability) => boolean = () => true,
): readonly string[] {
  const lines: string[] = [];
  const ultimate = ultimateAbilityIndex(card);
  for (const [index, ability] of card.abilities.entries()) {
    if (!include(ability)) continue;
    const isUltimate = index === ultimate;
    const result = transpileAbility(ability, index, card.id, `abilities[${index}]`, 'CARDNAME', isUltimate);
    if (!result.ok) {
      rejections.push(...result.rejections);
      continue;
    }
    rejections.push(...appendAbilityLines(lines, result.value.lines, card.id, `abilities[${index}]`));
    tokens.push(...result.value.tokens);
    if (!hasAbilityEffects(ability)) continue;
    for (const effect of ability.effects) {
      const sharedHint = FORGE_EFFECTS[effect.kind]?.deckHas;
      const hint =
        sharedHint ??
        (ability.kind === 'triggered' &&
        effect.kind === 'millCards' &&
        !isDamageLinkedMillAbility(ability) &&
        !isEnchantedLandBecomesTappedMillAbility(ability)
          ? 'Mill'
          : ability.kind === 'triggered' &&
              ability.condition === 'selfEnters' &&
              effect.kind === 'discardCards' &&
              isOptionalDiscardThenDrawAbility(ability)
            ? 'Discard'
            : null);
      if (hint !== undefined && hint !== null && !deckHas.includes(hint)) deckHas.push(hint);
    }
  }
  return lines;
}

/**
 * The name a `SVar:` line defines — the segment between the first two colons.
 *
 * A Forge SVar value carries `$` and `|` and spaces but never a colon, so the
 * second colon ends the name. A line with no second colon is malformed rather
 * than nameless; it is returned whole so the collision check compares it to
 * itself and nothing else.
 */
function svarName(line: string): string {
  const end = line.indexOf(':', 'SVar:'.length);
  return end === -1 ? line : line.slice('SVar:'.length, end);
}

/**
 * Appends one ability block, refusing two definitions of one Forge SVar name.
 *
 * An exact repeat is dropped: every line reaching here is either a named
 * `SVar:` definition or a declaration keyed by its own text, so writing one
 * twice says nothing the first did not. Different definitions of one name are
 * the real hazard, because independently composed abilities collide there even
 * though their executable lines differ.
 *
 * An identical repeat is dropped. A second, *different* definition of a name
 * already defined is refused by name, because Forge reads one definition per
 * name and would enforce whichever it read last. The rows pick their names off
 * `res/cardsfolder`, where a name is a per-card convention and not a registry:
 * `RPrevent` is what 89 shipped scripts call a prevention replacement and none
 * of them defines it twice, while three rows here emit a different definition
 * under it. Two prevention effects on one card is the reachable shape, and it
 * exported both definitions silently until `mtg-9111`.
 *
 * The check belongs here rather than in a row because no row can see what
 * another row already wrote, and the fix is not a rename: renaming would put
 * every colliding row off the corpus to fix a card that may never be printed,
 * while a refusal costs nothing until one is.
 */
function appendAbilityLines(
  lines: string[],
  additions: readonly string[],
  cardId: string,
  path: string,
): readonly TranspileRejection[] {
  const rejections: TranspileRejection[] = [];
  for (const line of additions) {
    if (lines.includes(line)) continue;
    if (!line.startsWith('SVar:')) {
      lines.push(line);
      continue;
    }
    const name = svarName(line);
    const conflict = lines.find((existing) => existing.startsWith('SVar:') && svarName(existing) === name);
    if (conflict !== undefined) {
      rejections.push(
        rejection(
          'COLLIDING_SVAR_DEFINITION',
          cardId,
          path,
          `two Forge SVar definitions of "${name}" on one card: ${JSON.stringify(conflict)} and ${JSON.stringify(line)}; Forge reads one definition per name, so the card would boot and enforce whichever it read last`,
        ),
      );
      continue;
    }
    lines.push(line);
  }
  return rejections;
}

/**
 * Forge's word for the player an `UnlessCost$` is charged to.
 *
 * Forge names the payer the same way the DSL does, off the spell's target
 * rather than by seat: `TargetedController` is the controller of the permanent
 * the spell targets and `Targeted` is the targeted player themselves. Both
 * spellings are in `res/cardsfolder` (27 and 20 lines in Forge 2.0.14), which
 * is what makes this a mapping rather than an approximation.
 */
const FORGE_UNLESS_PAYERS: Readonly<Record<UnlessPayer, string>> = {
  targetController: 'TargetedController',
  targetPlayer: 'Targeted',
};

/**
 * `UnlessCost$ 2 | UnlessPayer$ TargetedController` — the toll, as two params on
 * the spell ability itself.
 *
 * Forge applies these ahead of the API rather than inside it, so the same pair
 * works whatever the gated effect is, and `checkUnless` has already refused
 * every card shape that would make the payer ambiguous (modes, more than one
 * effect, a target the payer cannot be read off). `forgeManaCost` renders `{0}`
 * as the string `0`, which Forge would read as a free toll; `UNLESS_COST_IS_FREE`
 * is why no card reaches here carrying one.
 */
function unlessParams(card: Card): readonly (readonly [string, string])[] {
  const clause = card.unless;
  if (clause === undefined) return [];
  return [
    ['UnlessCost', forgeManaCost(clause.cost)],
    ['UnlessPayer', FORGE_UNLESS_PAYERS[clause.payer]],
  ];
}

/** Forge's `Cost$` override for a spell with a non-mana payment in its total cost. */
function additionalCostParams(
  card: Card,
  rejections: TranspileRejection[],
): readonly (readonly [string, string])[] {
  if ((card.kind !== 'instant' && card.kind !== 'sorcery') || card.additionalCost === undefined) {
    return [];
  }
  if ('discard' in card.additionalCost) {
    return [
      ['Cost', `${forgeManaCost(card.manaCost)} Discard<1/Card/card>`],
      ['CostDesc', 'As an additional cost to cast this spell, discard a card.'],
    ];
  }
  const sacrifice = card.additionalCost.sacrificeMatching;
  const matching = forgeSacrificeMatching(sacrifice);
  if (matching === null) {
    rejections.push(
      rejection(
        'UNMAPPED_SPELL_ADDITIONAL_COST_FILTER',
        card.id,
        'additionalCost.sacrificeMatching.filter',
        'this sacrifice filter has no single source-proven Forge Sac spelling; exporting it as unrestricted would make Forge accept payments the kernel refuses',
      ),
    );
    return [];
  }
  return [['Cost', `${forgeManaCost(card.manaCost)} Sac<${sacrifice.count}/${matching}>`]];
}

/** Forge's source-proven `AlternativeCost` static for the typed CR 118.9 price. */
function alternativeCostLines(card: Card, rejections: TranspileRejection[]): readonly string[] {
  if (!isCastable(card) || card.alternativeCost === undefined) return [];
  const cost = card.alternativeCost;
  const matching = forgeSacrificeMatching(cost.sacrificeMatching);
  if (matching === null) {
    rejections.push(
      rejection(
        'UNMAPPED_SPELL_ALTERNATIVE_COST_FILTER',
        card.id,
        'alternativeCost.sacrificeMatching.filter',
        'this sacrifice filter has no single source-proven Forge Sac spelling; exporting it as unrestricted would make Forge accept payments the kernel refuses',
      ),
    );
    return [];
  }
  return [
    `S:Mode$ AlternativeCost | ValidSA$ Spell.Self | EffectZone$ All | Cost$ PayLife<${String(cost.payLife)}> Sac<${String(cost.sacrificeMatching.count)}/${matching}> | Description$ ${renderAlternativeCost(cost)}`,
  ];
}

/** Forge's native per-caster turn counter for contiguous early-turn restrictions. */
function castingRestrictionLines(card: Card, rejections: TranspileRejection[]): readonly string[] {
  if (!isCastable(card) || card.castingRestriction === undefined) return [];
  const restriction = card.castingRestriction;
  const contiguous = restriction.turns.every((turn, index) => turn === index + 1);
  if (!contiguous) {
    rejections.push(
      rejection(
        'UNMAPPED_CASTING_RESTRICTION',
        card.id,
        'castingRestriction.turns',
        'Forge native Count$YourTurns export supports only a contiguous prefix of player turns',
      ),
    );
    return [];
  }
  const last = restriction.turns.at(-1);
  if (last === undefined) return [];
  return [
    `S:Mode$ CantBeCast | ValidCard$ Card.Self | EffectZone$ All | Caster$ Player.Active | CheckSVar$ X | SVarCompare$ LE${String(last)} | Description$ ${renderCastingRestriction(restriction, 'this spell')}`,
    'SVar:X:Count$YourTurns',
  ];
}

/** Forge's relative cost-raiser for one generic mana per additional target. */
function targetCostIncreaseLines(
  card: Card,
  rejections: TranspileRejection[],
): {
  readonly staticLines: readonly string[];
  readonly supportingLines: readonly string[];
} {
  const increase = card.kind === 'instant' || card.kind === 'sorcery' ? card.targetCostIncrease : undefined;
  if (increase === undefined) return { staticLines: [], supportingLines: [] };
  if (increase.genericPerTargetBeyondFirst !== 1) {
    rejections.push(
      rejection(
        'UNMAPPED_TARGET_COST_INCREASE',
        card.id,
        'targetCostIncrease.genericPerTargetBeyondFirst',
        "only Fireball's source-proven one-generic relative increase is mapped; exporting a larger multiplier would guess at Forge arithmetic syntax",
      ),
    );
    return { staticLines: [], supportingLines: [] };
  }
  return {
    staticLines: [
      'S:Mode$ RaiseCost | ValidCard$ Card.Self | Type$ Spell | Amount$ IncreaseCost | Relative$ True | EffectZone$ All | Description$ This spell costs {1} more to cast for each target beyond the first.',
    ],
    supportingLines: ['SVar:IncreaseCost:TargetedObjects$Amount/Minus.1'],
  };
}

interface AbilityBlock {
  readonly lines: readonly string[];
  readonly tokens: readonly TokenSpec[];
  readonly deckHas: readonly string[];
}

/**
 * Carries a pump's exact subject set into a later retained-creature effect.
 *
 * Forge's Teleportal script records the bodies actually pumped rather than
 * rereading the original target slot. That distinction is load-bearing under
 * Overload, where the one target becomes a whole cohort. The leaf effect can
 * express the ordinary `Targeted` bridge on its own; only this list-level pass
 * can see that its unique referent source is a pump and upgrade both ends of
 * the bridge without teaching either effect about its sibling.
 */
function retainPumpedSubjects(
  effects: readonly Effect[],
  abilities: readonly ForgeAbility[],
  abilityIndexByEffect: readonly (number | null)[],
): { readonly abilities: readonly ForgeAbility[]; readonly cleansRemembered: boolean } {
  let retained = abilities;
  let cleansRemembered = false;
  for (const [effectIndex, effect] of effects.entries()) {
    if (
      effect.kind !== 'grantKeywordUntilEndOfTurn' &&
      effect.kind !== 'cantBeBlockedThisTurn' &&
      effect.kind !== 'attacksThisTurnIfAble'
    ) {
      continue;
    }
    if (effect.target.kind !== 'thatCreature') {
      continue;
    }
    const sourceIndex = referentSourceIndex(effects, effectIndex);
    if (sourceIndex === null || effects[sourceIndex]?.kind !== 'pumpUntilEndOfTurn') continue;
    const sourceAbilityIndex = abilityIndexByEffect[sourceIndex];
    const readerAbilityIndex = abilityIndexByEffect[effectIndex];
    if (sourceAbilityIndex === null || sourceAbilityIndex === undefined) continue;
    if (readerAbilityIndex === null || readerAbilityIndex === undefined) continue;
    if (effect.kind === 'grantKeywordUntilEndOfTurn' || effect.kind === 'attacksThisTurnIfAble') {
      cleansRemembered = true;
    }
    retained = retained.map((ability, abilityIndex) => {
      if (abilityIndex === sourceAbilityIndex) {
        return { ...ability, params: [...ability.params, ['RememberPumped', 'True']] };
      }
      if (abilityIndex !== readerAbilityIndex) return ability;
      return {
        ...ability,
        params: ability.params.map(([name, value]) =>
          effect.kind === 'grantKeywordUntilEndOfTurn' && name === 'Defined' && value === 'Targeted'
            ? (['Defined', 'Remembered'] as const)
            : name === 'RememberObjects' && value === 'Targeted'
              ? (['RememberObjects', 'Remembered'] as const)
              : ([name, value] as const),
        ),
      };
    });
  }
  return {
    abilities: cleansRemembered ? [...retained, RESOLUTION_COUNT_CLEANUP] : retained,
    cleansRemembered,
  };
}

/**
 * Transpiles the spell's effects into one chain of Forge abilities.
 *
 * Split out because the chain is built twice for a card whose later clause
 * counts what an earlier one exiled: the first pass answers whether anything
 * reads the count at all, and only then does the second make the exiles
 * remember (`remember.ts` argues why that question cannot be asked before the
 * chain exists). Both passes see identical effects, so the second's rejections
 * are the first's and are collected once.
 *
 * `effects` is passed rather than read off the card because a modal spell has
 * one chain per mode and no printed `card.effects` at all: `modal.ts` makes the
 * two fields mutually exclusive, so a function that reached for `card.effects`
 * would build an empty chain for every card that says "Choose one".
 */
function effectChain(
  card: Card,
  effects: readonly Effect[],
  basePath: string,
  remembering: boolean,
  rejections: TranspileRejection[],
): {
  readonly abilities: readonly ForgeAbility[];
  readonly tokens: readonly TokenSpec[];
  readonly deckHas: readonly string[];
  readonly supportingLines: readonly string[];
  readonly readsResolutionCount: boolean;
  readonly needsResolutionCountSvar: boolean;
  readonly cleansRemembered: boolean;
} {
  const abilities: ForgeAbility[] = [];
  const tokens: TokenSpec[] = [];
  const deckHas: string[] = [];
  const supportingLines: string[] = [];
  let cleansRemembered = false;
  const abilityIndexByEffect: (number | null)[] = [];
  const spellings = withBoardCounts(resolutionCountSpellings(effects, remembering), effects);
  for (const [index, effect] of effects.entries()) {
    const result = transpileEffect(effect, card.id, `${basePath}[${index}]`, spellings[index]);
    if (!result.ok) {
      abilityIndexByEffect.push(null);
      rejections.push(...result.rejections);
      continue;
    }
    abilityIndexByEffect.push(abilities.length);
    abilities.push(result.value.ability);
    if (result.value.follow !== undefined) abilities.push(...result.value.follow);
    if (result.value.cleansRemembered === true) cleansRemembered = true;
    if (result.value.token !== undefined) tokens.push(result.value.token);
    rejections.push(
      ...appendAbilityLines(
        supportingLines,
        result.value.supportingLines ?? [],
        card.id,
        `${basePath}[${index}]`,
      ),
    );
    const hint = FORGE_EFFECTS[effect.kind]?.deckHas;
    if (hint !== undefined && hint !== null && !deckHas.includes(hint)) deckHas.push(hint);
  }
  const pumpedSubjects = retainPumpedSubjects(effects, abilities, abilityIndexByEffect);
  const retainedController = retainDepartedTargetController(
    effects,
    pumpedSubjects.abilities,
    abilityIndexByEffect,
  );
  return {
    abilities: retainedController.abilities,
    tokens,
    deckHas,
    supportingLines,
    readsResolutionCount: readsResolutionCount(spellings),
    needsResolutionCountSvar: spellings.some((spelling) => spelling.needsResolutionCountSvar),
    cleansRemembered:
      cleansRemembered || pumpedSubjects.cleansRemembered || retainedController.cleansRemembered,
  };
}

/**
 * The installed Forge corpus represents this ordered hidden-zone search as
 * three independently optional ChangeZone abilities. A single `EACH` search
 * is not equivalent: it asks one combined question and cannot preserve the
 * printed 3, then 2, then 1 sequence when one value has no match.
 */
function isDescendingInstantManaValueQuotaSearch(effect: Effect): boolean {
  if (
    effect.kind !== 'searchLibrary' ||
    effect.destination !== 'hand' ||
    effect.reveal !== true ||
    effect.filterQuotas?.length !== 3
  ) {
    return false;
  }
  return effect.filterQuotas.every((quota, index) => {
    const expectedManaValue = 3 - index;
    const filter = quota.filter;
    return (
      quota.count === 1 &&
      filter.manaValue === expectedManaValue &&
      filter.cardTypes?.length === 1 &&
      filter.cardTypes[0] === 'instant' &&
      Object.keys(filter).every((field) => field === 'cardTypes' || field === 'manaValue')
    );
  });
}

function descendingInstantManaValueQuotaBlock(effects: readonly Effect[]): AbilityBlock | null {
  if (
    effects.length !== 1 ||
    effects[0] === undefined ||
    !isDescendingInstantManaValueQuotaSearch(effects[0])
  ) {
    return null;
  }
  return {
    lines: [
      'A:SP$ ChangeZone | ChangeType$ Instant.cmcEQ3 | ChangeNum$ 1 | Origin$ Library | Destination$ Hand | NoShuffle$ True | SubAbility$ FindCMC2 | StackDescription$ Search your library for an instant card with mana value 3, reveal it, and put it into your hand. | SpellDescription$ Search your library for an instant card with mana value 3, reveal it, and put it into your hand. Then repeat this process for instant cards with mana values 2 and 1. Then shuffle.',
      'SVar:FindCMC2:DB$ ChangeZone | ChangeType$ Instant.cmcEQ2 | ChangeNum$ 1 | Origin$ Library | Destination$ Hand | NoShuffle$ True | SubAbility$ FindCMC1 | StackDescription$ Then repeat this process for instant cards with mana value 2 and 1.',
      'SVar:FindCMC1:DB$ ChangeZone | ChangeType$ Instant.cmcEQ1 | ChangeNum$ 1 | Origin$ Library | Destination$ Hand | Shuffle$ True | StackDescription$ Then shuffle.',
    ],
    tokens: [],
    deckHas: [],
  };
}

/** One effect list built into the Forge abilities that run it, plus their supporting lines. */
interface BuiltChain {
  readonly abilities: readonly ForgeAbility[];
  readonly tokens: readonly TokenSpec[];
  readonly deckHas: readonly string[];
  readonly supportingLines: readonly string[];
  readonly needsResolutionCountSvar: boolean;
}

/** Runs the two `effectChain` passes and appends the cleanup link the second one may earn. */
function buildChain(
  card: Card,
  effects: readonly Effect[],
  basePath: string,
  rejections: TranspileRejection[],
): BuiltChain {
  const first = effectChain(card, effects, basePath, false, rejections);
  const counted = first.readsResolutionCount;
  const {
    abilities: built,
    tokens,
    deckHas,
    supportingLines,
    cleansRemembered,
    needsResolutionCountSvar,
  } = counted ? effectChain(card, effects, basePath, true, []) : first;
  // The link that empties the remembered list rides at the end of the chain as
  // an ordinary `SVar:DBEffect<n>`. Forge resolves a sub-ability by its SVar
  // name and the corpus's own `DBCleanup` is only a convention, so one naming
  // scheme for every link of a chain this transpiler writes beats two.
  const abilities: readonly ForgeAbility[] =
    counted && !cleansRemembered ? [...built, RESOLUTION_COUNT_CLEANUP] : built;
  return { abilities, tokens, deckHas, supportingLines, needsResolutionCountSvar };
}

/**
 * What the links of one chain are called, under a prefix that keeps two chains apart.
 *
 * The names are this transpiler's own and Forge reads none of them as a word:
 * a sub-ability is found by the `SubAbility$` that names it, so `DBEffect2` and
 * `DBMode3Effect2` are equally good as long as one card never defines either
 * twice. `res/cardsfolder` treats them the same way, which is why
 * `abzan_charm.txt` calls its three modes `DBExile`, `DBDraw` and `DBCounters`
 * and `academic_probation.txt` calls one of its links `DBEffect` outright.
 *
 * The damage pair is the exception, and it is named for what it does because
 * the shape is legible in a way `DBEffect1` is not: a `DealDamage` that also
 * hits every creature one player controls resolves as three links, and reading
 * `DmgAll` in the middle of the chain says which.
 *
 * `prefix` is empty for a card's one printed chain, so every non-modal card
 * keeps the names it exported before modes existed, and `DBMode<n>` for a
 * modal card's, where several chains are written side by side and each of them
 * may want a first link.
 */
function chainLinkName(
  primary: ForgeAbility,
  subs: readonly ForgeAbility[],
  prefix: string,
): { readonly damagePair: boolean; readonly nameOf: (index: number) => string } {
  const damagePair =
    primary.api === 'DealDamage' &&
    primary.params.some(([name, value]) => name === 'DamageMap' && value === 'True') &&
    subs.length >= 2 &&
    subs[0]?.api === 'DamageAll' &&
    subs[1]?.api === 'DamageResolve';
  const nameOf = (index: number): string => {
    if (damagePair && index === 0) return `${prefix}DmgAll`;
    if (damagePair && index === 1) return `${prefix}DBDamageResolve`;
    return prefix === '' ? `DBEffect${index + 1}` : `${prefix}Effect${index + 1}`;
  };
  return { damagePair, nameOf };
}

/**
 * The `SpellDescription$` one effect list prints, or null when it would break the grammar.
 */
function chainDescription(
  card: Card,
  effects: readonly Effect[],
  unless: boolean,
  path: string,
  rejections: TranspileRejection[],
): string | null {
  const sentences = renderEffectList(effects, 'CARDNAME').join(' ');
  const description =
    !unless || card.unless === undefined ? sentences : withUnlessClause(sentences, card.unless);
  if (isScriptSafe(description)) return description;
  rejections.push(
    rejection(
      'UNSAFE_SCRIPT_TEXT',
      card.id,
      path,
      'rendered spell description contains a newline or "|", which would break the ability line',
    ),
  );
  return null;
}

function abilityBlock(card: Card, rejections: TranspileRejection[]): AbilityBlock {
  if (card.modes !== undefined) return modalBlock(card, card.modes, rejections);
  const effects = spellEffectsFor(card, null, 'ordinary');
  const descendingQuotaBlock = descendingInstantManaValueQuotaBlock(effects);
  if (descendingQuotaBlock !== null) return descendingQuotaBlock;
  const { abilities, tokens, deckHas, supportingLines, needsResolutionCountSvar } = buildChain(
    card,
    effects,
    'effects',
    rejections,
  );
  if (abilities.length === 0) return { lines: [], tokens, deckHas };

  const description = chainDescription(card, effects, true, 'effects', rejections);
  if (description === null) return { lines: [], tokens, deckHas };

  const lines: string[] = [];
  const [builtPrimary, ...subs] = abilities;
  if (builtPrimary === undefined) return { lines: [], tokens, deckHas };
  const opponentDamageThenRandomDiscard =
    effects.length === 2 &&
    effects[0]?.kind === 'dealDamage' &&
    effects[0].players === 'eachOpponent' &&
    effects[1]?.kind === 'discardCards' &&
    effects[1].players === 'eachOpponent' &&
    effects[1].random === true;
  const targetedHandRevealThenGain =
    effects.length === 2 &&
    effects[0]?.kind === 'revealHand' &&
    effects[0].target.kind === 'targetPlayer' &&
    effects[1]?.kind === 'gainLife' &&
    effects[1].target.kind === 'noTarget' &&
    effects[1].amountFrom === 'thatPlayersHandSize';
  const primary: ForgeAbility = opponentDamageThenRandomDiscard
    ? {
        api: 'DealDamage',
        params: builtPrimary.params.map(([name, value]) =>
          name === 'ValidPlayers' ? (['Defined', value] as const) : ([name, value] as const),
        ),
      }
    : builtPrimary;
  const linked = chainLinkName(primary, subs, '');
  const damagePair = linked.damagePair;
  const nameOf = (index: number): string => {
    if (opponentDamageThenRandomDiscard) return `Effect${index + 1}`;
    if (targetedHandRevealThenGain && index === 0) return 'DBGainLife';
    return linked.nameOf(index);
  };
  const primaryEffectParams = primary.params.filter(
    ([name, value]) => !(damagePair && name === 'DamageMap' && value === 'True'),
  );
  const primaryParams = [
    ...additionalCostParams(card, rejections),
    ...primaryEffectParams,
    ...unlessParams(card),
    ...(subs.length > 0 ? ([['SubAbility', nameOf(0)]] as const) : []),
    ...(damagePair ? ([['DamageMap', 'True']] as const) : []),
    ['SpellDescription', description] as const,
  ];
  lines.push(`A:${renderSpellAbility({ api: primary.api, params: primaryParams })}`);
  lines.push(
    ...renderNamedSubAbilityChain(
      subs.map((sub, index) => ({
        name: nameOf(index),
        rendered: renderSubAbility(sub),
      })),
    ),
  );
  if (needsResolutionCountSvar && !supportingLines.includes(REVEALED_CARD_MANA_VALUE_SVAR_LINE)) {
    lines.push(RESOLUTION_COUNT_SVAR_LINE);
  }
  lines.push(...boardCountSvarLines(effects));
  lines.push(...supportingLines);
  return {
    lines,
    tokens,
    deckHas: targetedHandRevealThenGain ? deckHas.filter((hint) => hint !== 'LifeGain') : deckHas,
  };
}

/**
 * A modal spell, written the way `res/cardsfolder` writes one.
 *
 * `A:SP$ Charm | Choices$ DBMode1,DBMode2` names one SVar per mode, and a mode
 * is an ordinary sub-ability carrying its own `SpellDescription$` — the bullet
 * the player reads when choosing. `abzan_charm.txt` is the shape whole, down to
 * a mode whose second sentence rides on a `SubAbility$` of its own, which is
 * the same chain a non-modal card's effect list already writes here.
 *
 * No `CharmNum$`: `CharmEffect.java` defaults it to `1` and 348 of the 523
 * shipped `SP$ Charm` scripts leave it off. That is not a simplification, it is
 * the whole of what this DSL can say — `ModesSchema` is a list of modes with no
 * choose-count beside it, so every modal card that reaches here is choose-one.
 *
 * The modes share one supporting-line list rather than one apiece, because a
 * shared name is exactly the hazard `appendAbilityLines` was written for: two
 * modes that both want `SVar:Unblockable` write the identical line and dedupe,
 * two that want it to mean different things collide and the card is refused.
 */
function modalBlock(card: Card, modes: Modes, rejections: TranspileRejection[]): AbilityBlock {
  const tokens: TokenSpec[] = [];
  const deckHas: string[] = [];
  const supportingLines: string[] = [];
  const choices: string[] = [];
  const modeLines: string[] = [];
  const boardCountLines: string[] = [];
  let needsResolutionCountSvar = false;
  for (const [index, mode] of modes.entries()) {
    const basePath = `modes[${index}].effects`;
    const chain = buildChain(card, mode.effects, basePath, rejections);
    tokens.push(...chain.tokens);
    for (const hint of chain.deckHas) if (!deckHas.includes(hint)) deckHas.push(hint);
    if (chain.needsResolutionCountSvar) needsResolutionCountSvar = true;
    rejections.push(...appendAbilityLines(supportingLines, chain.supportingLines, card.id, basePath));
    for (const line of boardCountSvarLines(mode.effects)) {
      if (!boardCountLines.includes(line)) boardCountLines.push(line);
    }
    const [primary, ...subs] = chain.abilities;
    if (primary === undefined) continue;
    const description = chainDescription(card, mode.effects, false, basePath, rejections);
    if (description === null) continue;
    const root = `Mode${index + 1}`;
    const { damagePair, nameOf } = chainLinkName(primary, subs, root);
    const effectParams = primary.params.filter(
      ([name, value]) => !(damagePair && name === 'DamageMap' && value === 'True'),
    );
    const modeParams = [
      ...effectParams,
      ...(subs.length > 0 ? ([['SubAbility', nameOf(0)]] as const) : []),
      ...(damagePair ? ([['DamageMap', 'True']] as const) : []),
      ['SpellDescription', description] as const,
    ];
    choices.push(root);
    rejections.push(
      ...appendAbilityLines(
        modeLines,
        [
          `SVar:${root}:${renderSubAbility({ api: primary.api, params: modeParams })}`,
          ...renderNamedSubAbilityChain(
            subs.map((sub, position) => ({ name: nameOf(position), rendered: renderSubAbility(sub) })),
          ),
        ],
        card.id,
        basePath,
      ),
    );
  }
  if (choices.length !== modes.length) return { lines: [], tokens, deckHas };

  const charmParams = [
    ...additionalCostParams(card, rejections),
    ['Choices', choices.join(',')] as const,
    ...unlessParams(card),
  ];
  const lines = [`A:${renderSpellAbility({ api: 'Charm', params: charmParams })}`, ...modeLines];
  if (needsResolutionCountSvar && !supportingLines.includes(REVEALED_CARD_MANA_VALUE_SVAR_LINE)) {
    lines.push(RESOLUTION_COUNT_SVAR_LINE);
  }
  lines.push(...boardCountLines);
  lines.push(...supportingLines);
  return { lines, tokens, deckHas };
}

function nameRejections(card: Card): TranspileRejection[] {
  if (isScriptSafe(card.name)) return [];
  return [
    rejection(
      'UNSAFE_SCRIPT_TEXT',
      card.id,
      'name',
      `card name ${JSON.stringify(card.name)} contains a newline or "|", which would break Forge's script grammar`,
    ),
  ];
}

/** Builds the script body for one card, or the reasons it cannot be built. */
export function transpileCardScript(card: Card): CardScriptResult {
  const rejections: TranspileRejection[] = [...nameRejections(card)];
  if (card.may !== undefined) {
    rejections.push(
      rejection(
        'UNMAPPED_MAY_SPELL',
        card.id,
        'may',
        'a spell\'s "You may" is written per effect API in Forge, and this transpiler has no row for it',
      ),
    );
  }
  if (
    card.kind === 'land' &&
    card.basicLandType === undefined &&
    printedEntryReplacement(card) !== undefined &&
    printedEntryReplacement(card)?.kind !== 'payLifeOrEntersTapped' &&
    printedEntryReplacement(card)?.kind !== 'entersTapped'
  ) {
    rejections.push(
      rejection(
        'UNMAPPED_NONBASIC_LAND',
        card.id,
        'entryReplacement',
        'this nonbasic land entry replacement needs an exact Forge mapping before the card can be exported',
      ),
    );
  }
  const lines: string[] = [`Name:${card.name}`];
  const abilityTokens: TokenSpec[] = [];
  const abilityDeckHas: string[] = [];
  const characteristicSupportingLines: string[] = [];

  lines.push(`ManaCost:${isCastable(card) ? forgeManaCost(card.manaCost) : 'no cost'}`);
  lines.push(`Types:${forgeTypeLine(card)}`);
  if (card.kind === 'land') {
    lines.push(
      ...abilityLines(
        card,
        abilityTokens,
        abilityDeckHas,
        rejections,
        (ability) => ability.kind !== 'activated',
      ),
    );
  }
  const intrinsicMana = nonbasicLandManaLine(card);
  if (intrinsicMana !== null) lines.push(intrinsicMana);
  // Starting loyalty is a line of its own and never a `PT:`, which is the same
  // separation `PlaneswalkerCardSchema` makes: loyalty is source state, not a
  // characteristic. Forge reads it from `Loyalty:` and puts the counters on the
  // permanent as it enters.
  if (card.kind === 'planeswalker') lines.push(`Loyalty:${card.startingLoyalty}`);
  if (card.kind === 'battle') lines.push(`Defense:${card.defense}`);
  if (card.kind === 'creature') {
    if (card.characteristicPowerToughness?.kind === 'controllerLifeTotal') {
      lines.push('PT:*/*');
      lines.push(
        "S:Mode$ Continuous | CharacteristicDefining$ True | SetPower$ X | SetToughness$ X | Description$ CARDNAME's power and toughness are each equal to your life total.",
      );
      lines.push('SVar:X:Count$YourLifeTotal');
    } else if (card.characteristicPowerToughness?.kind === 'controlledSubtype') {
      const subtype = card.characteristicPowerToughness.subtype;
      lines.push('PT:*/*');
      lines.push(
        `S:Mode$ Continuous | CharacteristicDefining$ True | SetPower$ X | SetToughness$ X | Description$ CARDNAME's power and toughness are each equal to the number of ${englishPlural(subtype)} you control.`,
      );
      characteristicSupportingLines.push(
        `SVar:X:Count$Valid ${subtype}.YouCtrl`,
        `SVar:BuffedBy:${subtype}`,
        'SVar:NoZeroToughnessAI:True',
        `DeckHints:Type$${subtype}`,
      );
    } else {
      if (card.characteristicPowerToughness !== undefined) {
        rejections.push(
          rejection(
            'UNMAPPED_CHARACTERISTIC_VALUE',
            card.id,
            'characteristicPowerToughness',
            'this creature has a characteristic-defining P/T value, and exporting its 0/0 storage sentinel would change the card',
          ),
        );
      }
      lines.push(`PT:${creaturePT(card)}`);
    }
  }
  if (card.cannotBeCountered === true) {
    lines.push(
      "R:Event$ Counter | ValidCard$ Card.Self | ValidSA$ Spell | Layer$ CantHappen | Description$ This spell can't be countered.",
    );
  }
  if (card.kind === 'creature' && card.redirectControllerAndOtherPermanentsDamageToSelf === true) {
    lines.push(
      'R:Event$ DamageDone | ActiveZones$ Battlefield | ValidTarget$ You,Permanent.Other+YouCtrl | DamageTarget$ Self | ReplaceWith$ DmgMe | Description$ All damage that would be dealt to you and other permanents you control is dealt to CARDNAME instead.',
      'SVar:DmgMe:DB$ ReplaceEffect | VarName$ Affected | VarValue$ Self | VarType$ Card',
    );
  }
  lines.push(...keywordLines(card, rejections));
  if (card.kind === 'creature' && card.opponentsLifeLostThisTurnCasting === true) {
    lines.push(
      "S:Mode$ CantBeCast | ValidCard$ Card.Self | CheckSVar$ X | SVarCompare$ EQ0 | EffectZone$ All | Description$ You can't cast this spell unless an opponent lost life this turn.",
      'S:Mode$ ReduceCost | ValidCard$ Creature | Type$ Spell | Activator$ You | Amount$ X | Description$ Creature spells you cast cost {1} less to cast for each 1 life your opponents have lost this turn.',
      'SVar:X:Count$LifeOppsLostThisTurn',
    );
  }
  if (card.costReduction !== null) {
    const cardTypes =
      'cardTypes' in card.costReduction
        ? card.costReduction.cardTypes
        : card.costReduction.cardType === null
          ? null
          : [card.costReduction.cardType];
    const validCard = cardTypes === null ? 'Card' : cardTypes.map((kind) => FORGE_CARD_TYPES[kind]).join(',');
    lines.push(
      `S:Mode$ ReduceCost | ValidCard$ ${validCard} | Type$ Spell | Activator$ You | Amount$ ${String(card.costReduction.amount)} | Description$ ${describeCostReduction(card.costReduction)}`,
    );
    if (cardTypes !== null)
      lines.push(`DeckHints:Type$${cardTypes.map((kind) => FORGE_CARD_TYPES[kind]).join('|')}`);
  }
  lines.push(...openingHandActionLines(card));
  lines.push(...castingRestrictionLines(card, rejections));
  lines.push(...alternativeCostLines(card, rejections));
  const targetIncrease = targetCostIncreaseLines(card, rejections);
  lines.push(...targetIncrease.staticLines);
  for (const restriction of card.targetingRestrictions ?? []) {
    switch (restriction.kind) {
      case 'sourceLacksColor': {
        const color = FORGE_COLOR_WORDS[restriction.color];
        const sourceColor = `${color.slice(0, 1).toUpperCase()}${color.slice(1)}`;
        lines.push(
          `S:Mode$ CantTarget | ValidTarget$ Card.Self | ValidSource$ Card.non${sourceColor} | Description$ CARDNAME can't be the target of non${color} spells or abilities from non${color} sources.`,
        );
        break;
      }
      default:
        assertNever(restriction.kind, 'targeting restriction Forge export');
    }
  }
  const entryReplacement = printedEntryReplacement(card);
  if (entryReplacement?.kind === 'entersTapped') {
    lines.push(
      'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped | Description$ CARDNAME enters tapped.',
    );
    lines.push('SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True');
  }
  if (entryReplacement?.kind === 'payLifeOrEntersTapped') {
    lines.push(
      `R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplaceWith$ DBTap | ReplacementResult$ Updated | Description$ As CARDNAME enters, you may pay ${String(entryReplacement.life)} life. If you don't, it enters tapped.`,
    );
    lines.push(
      `SVar:DBTap:DB$ Tap | ETB$ True | Defined$ Self | UnlessCost$ PayLife<${String(entryReplacement.life)}> | UnlessPayer$ You | StackDescription$ enters tapped.`,
    );
  }
  if (entryReplacement?.kind === 'entersAsCopyOfCreature') {
    lines.push('K:ETBReplacement:Copy:DBCopy:Optional');
    lines.push(
      'SVar:DBCopy:DB$ Clone | Choices$ Creature.Other | SpellDescription$ You may have CARDNAME enter as a copy of any creature on the battlefield.',
    );
  }
  if (entryReplacement?.kind === 'choosePlayer') {
    lines.push('K:ETBReplacement:Other:ChooseP');
    lines.push(
      'SVar:ChooseP:DB$ ChoosePlayer | Defined$ You | Choices$ Player | AILogic$ Curse | SpellDescription$ As CARDNAME enters, choose a player.',
    );
  }
  if (entryReplacement?.kind === 'chooseTwoColors') {
    lines.push('K:ETBReplacement:Other:ChooseColors');
    lines.push(
      'SVar:ChooseColors:DB$ ChooseColor | Defined$ You | TwoColors$ True | AILogic$ MostProminentDualInComputerDeck | SpellDescription$ As CARDNAME enters, choose two colors.',
    );
  }
  if (entryReplacement?.kind === 'chooseCardName') {
    lines.push('K:ETBReplacement:Other:DBNameCard');
    lines.push(
      'SVar:DBNameCard:DB$ NameCard | Defined$ You | AILogic$ PithingNeedle | SpellDescription$ As CARDNAME enters, choose a card name.',
    );
  }
  if (entryReplacement?.kind === 'entersAsCharacteristicChoice') {
    const description = renderOracleText(card)
      .split(' (')[0]
      ?.replace('As this creature enters', 'As CARDNAME enters');
    const names = entryReplacement.modes.map((_, index) => `EntryCharacteristics${String(index + 1)}`);
    lines.push(
      `R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | Layer$ Copy | ReplacementResult$ Updated | ReplaceWith$ EntryCharacteristicsChoice | Description$ ${description ?? ''}`,
    );
    lines.push(
      `SVar:EntryCharacteristicsChoice:DB$ GenericChoice | Defined$ You | Choices$ ${names.join(',')}`,
    );
    for (const [index, mode] of entryReplacement.modes.entries()) {
      const params = [
        `SVar:${names[index] ?? ''}:DB$ Clone`,
        'Defined$ Self',
        `SetPower$ ${String(mode.power)}`,
        `SetToughness$ ${String(mode.toughness)}`,
      ];
      if (mode.addSubtypes !== undefined) params.push(`AddTypes$ ${mode.addSubtypes.join(' & ')}`);
      const addedKeywords = [
        ...(mode.addKeywords ?? []).map((keyword) => FORGE_KEYWORDS[keyword]),
        ...(mode.addKeywordAbilities ?? []).map(forgeKeywordAbility),
      ];
      if (addedKeywords.length > 0) params.push(`AddKeywords$ ${addedKeywords.join(' & ')}`);
      const keywordDescription =
        addedKeywords.length === 0
          ? ''
          : ` with ${addedKeywords.map((word) => word.toLowerCase()).join(' and ')}`;
      const typeDescription =
        mode.addSubtypes === undefined
          ? ''
          : ` and is a ${mode.addSubtypes.join(' ')} in addition to its other types`;
      params.push(
        `SpellDescription$ CARDNAME is ${String(mode.power)}/${String(mode.toughness)}${keywordDescription}${typeDescription}.`,
      );
      lines.push(params.join(' | '));
    }
  }
  if (entryReplacement?.kind === 'entersWithCounters') {
    const counterTypes = FORGE_COUNTER_TYPES[entryReplacement.counter];
    if (counterTypes === null || counterTypes.length !== 1) {
      rejections.push(
        rejection(
          'UNMAPPED_ENTRY_REPLACEMENT',
          card.id,
          'entryReplacement.counter',
          'this entry counter has no single source-proven Forge counter type; exporting a partial decomposition would make the permanent enter differently',
        ),
      );
    } else {
      const count = typeof entryReplacement.count === 'number' ? String(entryReplacement.count) : 'X';
      if (
        typeof entryReplacement.count !== 'number' &&
        entryReplacement.count.kind === 'opponentsLifeLostThisTurn'
      ) {
        const printedCounter = entryReplacement.counter === 'plusOnePlusOne' ? '+1/+1' : '-1/-1';
        lines.push(
          `K:etbCounter:${counterTypes[0]}:${count}:no Condition:CARDNAME enters with X ${printedCounter} counters on it, where X is the total life lost by your opponents this turn.`,
        );
        lines.push('SVar:X:Count$LifeOppsLostThisTurn');
        lines.push('SVar:NeedsToPlayVar:X GE3');
      } else {
        lines.push(`K:etbCounter:${counterTypes[0]}:${count}`);
        if (typeof entryReplacement.count !== 'number') lines.push('SVar:X:Count$xPaid');
      }
    }
  }
  if (entryReplacement?.kind === 'putCounterOnControlledPermanent') {
    const counterTypes = FORGE_COUNTER_TYPES[entryReplacement.counter];
    if (counterTypes === null || counterTypes.length !== 1) {
      rejections.push(
        rejection(
          'UNMAPPED_ENTRY_REPLACEMENT',
          card.id,
          'entryReplacement.counter',
          'this chosen entry counter has no single source-proven Forge counter type',
        ),
      );
    } else {
      const forgeType = FORGE_CARD_TYPES[entryReplacement.permanentType];
      const aiLogic = FORGE_ENTRY_COUNTER_AI_LOGIC[entryReplacement.counter];
      const article =
        entryReplacement.permanentType === 'artifact' || entryReplacement.permanentType === 'enchantment'
          ? 'an'
          : 'a';
      lines.push('K:ETBReplacement:Other:EntryCounterChoice');
      lines.push(
        `SVar:EntryCounterChoice:DB$ ChooseCard | Choices$ ${forgeType}.YouCtrl | Mandatory$ True | SubAbility$ EntryPutCounter${aiLogic === undefined ? '' : ` | AILogic$ ${aiLogic}`} | SpellDescription$ As CARDNAME enters, put ${counterPhrase(entryReplacement.counter, entryReplacement.count)} on ${article} ${entryReplacement.permanentType} you control.`,
      );
      lines.push(
        `SVar:EntryPutCounter:DB$ PutCounter | CounterType$ ${counterTypes[0]} | CounterNum$ ${String(entryReplacement.count)} | Defined$ ChosenCard | SubAbility$ EntryCounterCleanup`,
      );
      lines.push('SVar:EntryCounterCleanup:DB$ Cleanup | ClearChosenCard$ True');
    }
  }
  if (isAuraCard(card)) {
    const aura = auraScript(card, card.id, 'aura');
    if (aura.ok) lines.push(...aura.value.lines);
    else rejections.push(...aura.rejections);
  }
  const renderedOracle = renderOracleText(card);
  const putCounterThenWin = card.abilities.find(isPutCounterThenWinAtThresholdAbility);
  const controllerDamageRemovesCounter = card.abilities.find(isControllerDamageRemovesSourceCounterAbility);
  if (putCounterThenWin !== undefined && controllerDamageRemovesCounter !== undefined) {
    const counterType = FORGE_COUNTER_TYPES[putCounterThenWin.putCounterThenWinAtThreshold.counter];
    const removalCounterType =
      FORGE_COUNTER_TYPES[controllerDamageRemovesCounter.controllerDamageRemovesSourceCounter.counter];
    if (
      counterType === null ||
      counterType.length !== 1 ||
      removalCounterType === null ||
      removalCounterType.length !== 1 ||
      counterType[0] !== removalCounterType[0]
    ) {
      rejections.push(
        rejection(
          'UNMAPPED_EFFECT_KIND',
          card.id,
          'abilities',
          'the counter-race capability requires one shared Forge counter spelling',
        ),
      );
    } else {
      const threshold = String(putCounterThenWin.putCounterThenWinAtThreshold.atLeast);
      const oracleLines = renderedOracle.split('\n');
      const upkeepDescription = oracleLines
        .find((line) => line.startsWith('At the beginning of your upkeep, put '))
        ?.replaceAll('this creature', 'CARDNAME')
        .replaceAll('This creature', 'CARDNAME');
      const damageDescription = oracleLines
        .find((line) => line.startsWith('Whenever a source deals damage to you, remove '))
        ?.replaceAll('this creature', 'CARDNAME')
        .replaceAll('This creature', 'CARDNAME');
      if (upkeepDescription === undefined || damageDescription === undefined) {
        rejections.push(
          rejection(
            'UNMAPPED_EFFECT_KIND',
            card.id,
            'abilities',
            'the counter-race capability did not render both source-attested Forge trigger descriptions',
          ),
        );
      } else {
        lines.push(
          `T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ PutCounter | TriggerDescription$ ${upkeepDescription}`,
          `SVar:PutCounter:DB$ PutCounter | Defined$ Self | CounterType$ ${counterType[0]} | CounterNum$ 1 | SubAbility$ WinGame`,
          `SVar:WinGame:DB$ WinsGame | Defined$ You | ConditionCheckSVar$ TalkedEnough | ConditionSVarCompare$ GE${threshold}`,
          `SVar:TalkedEnough:Count$CardCounters.${counterType[0]}`,
          `T:Mode$ DamageDone | ValidTarget$ You | TriggerZones$ Battlefield | Execute$ RemoveCounter | TriggerDescription$ ${damageDescription}`,
          `SVar:RemoveCounter:DB$ RemoveCounter | Defined$ Self | CounterType$ ${counterType[0]} | CounterNum$ 1`,
          'SVar:AIEvaluationModifier:30',
        );
      }
    }
  }
  const includeAbility = (ability: Ability): boolean => {
    if (
      isPutCounterThenWinAtThresholdAbility(ability) ||
      isControllerDamageRemovesSourceCounterAbility(ability)
    ) {
      return false;
    }
    if (card.kind === 'land') return ability.kind === 'activated';
    if (card.kind !== 'creature' || card.redirectControllerAndOtherPermanentsDamageToSelf !== true) {
      return true;
    }
    return !(
      ability.kind === 'static' &&
      ability.scope === 'self' &&
      ability.modification.kind === 'preventCombatDamage'
    );
  };
  lines.push(...abilityLines(card, abilityTokens, abilityDeckHas, rejections, includeAbility));
  lines.push(...characteristicSupportingLines);

  const block = abilityBlock(card, rejections);
  lines.push(...block.lines);
  lines.push(...targetIncrease.supportingLines);
  const deckHas = [...abilityDeckHas, ...block.deckHas.filter((hint) => !abilityDeckHas.includes(hint))];
  if (deckHas.length > 0) lines.push(`DeckHas:Ability$${deckHas.join('|')}`);
  const conditionSubtypes = [
    ...new Set(
      card.abilities.flatMap((ability) =>
        ability.kind === 'static' &&
        ability.enabledWhile?.kind === 'controlsSubtype' &&
        ability.modification.kind !== 'canAttackAsThoughNoDefender'
          ? [ability.enabledWhile.subtype]
          : [],
      ),
    ),
  ];
  for (const subtype of conditionSubtypes) lines.push(`DeckHints:Type$${subtype}`);
  if (card.abilities.some((ability) => ability.kind === 'static' && ability.filter?.token === true)) {
    lines.push('DeckHints:Ability$Token');
  }
  const controlledCopyTypes = card.abilities.flatMap((ability) =>
    ability.kind === 'activated'
      ? ability.effects.flatMap((effect) =>
          effect.kind === 'copySpell' && effect.spellSelection === 'targetSpellYouControl'
            ? (effect.spellFilter?.cardTypes ?? [])
            : [],
        )
      : [],
  );
  if (controlledCopyTypes.length > 0) {
    lines.push(`DeckHints:Type$${controlledCopyTypes.map((kind) => FORGE_CARD_TYPES[kind]).join('|')}`);
  }
  if (
    card.modes === undefined &&
    spellEffectsFor(card, null, 'ordinary').some(isDescendingInstantManaValueQuotaSearch)
  ) {
    lines.push('DeckHints:Type$Instant');
  }
  const back = card.kind === 'battle' ? transformedBackFaceOf(card) : null;
  if (back !== null) lines.push('AlternateMode:DoubleFaced');
  const volatileRigComposition =
    card.abilities.some(
      (ability) =>
        ability.kind === 'triggered' &&
        ability.condition === 'selfIsDealtDamage' &&
        ability.effects[0]?.kind === 'flipCoin' &&
        ability.effects[0].loseEffects?.[0]?.kind === 'sacrificeSelf',
    ) &&
    card.abilities.some(
      (ability) =>
        ability.kind === 'triggered' &&
        ability.condition === 'selfDies' &&
        ability.effects[0]?.kind === 'flipCoin' &&
        ability.effects[0].loseEffects?.[0]?.kind === 'dealDamage' &&
        ability.effects[0].loseEffects[0].players === 'eachPlayer',
    );
  const forgeOracleBase =
    putCounterThenWin !== undefined && controllerDamageRemovesCounter !== undefined
      ? renderedOracle.replaceAll('this creature', card.name).replaceAll('This creature', card.name)
      : card.kind === 'creature' && card.opponentsLifeLostThisTurnCasting === true
        ? renderedOracle.replace(
            renderOpponentLifeLossCastingRestriction(card.name),
            renderOpponentLifeLossCastingRestriction('this spell'),
          )
        : card.abilities.some(
              (ability) =>
                ability.kind === 'static' &&
                ability.modification.kind === 'discardedByOpponentEntersBattlefield' &&
                ability.printedSourceReference === 'thisCard',
            )
          ? renderedOracle.replace('discard this card', `discard ${card.name}`)
          : volatileRigComposition
            ? renderedOracle.replaceAll('this creature', card.name).replaceAll('This creature', card.name)
            : card.abilities.some(isDamageLinkedMillAbility)
              ? renderedOracle.replace(
                  /^Whenever this creature deals combat damage to a player/,
                  `Whenever ${card.name} deals combat damage to a player`,
                )
              : card.abilities.some(
                    (ability) =>
                      ability.kind === 'triggered' &&
                      ability.condition === 'selfEnters' &&
                      isOptionalDiscardThenDrawAbility(ability),
                  )
                ? renderedOracle.replace(/^When this creature enters/, `When ${card.name} enters`)
                : renderedOracle;
  const forgeOracle = card.abilities.some(
    (ability) => ability.kind === 'activated' && ability.activateOnlyAsInstantReminder === true,
  )
    ? forgeOracleBase.replaceAll(' (Activate only as an instant.)', '')
    : forgeOracleBase;
  const printedOracle = escapeNewlines(
    forgeOracle
      .split('\n')
      .map((line) => {
        if (!printsForgeOracleReminder(card, line)) return line;
        const reminder = abilityLineReminder(line, card.kind);
        return reminder === null ? line : `${reminder.keyword} ${reminder.gloss}`;
      })
      .join('\n'),
  ).replaceAll('−', '-');
  const siegeReminder =
    card.kind === 'battle' && card.subtypes.includes('Siege')
      ? "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)"
      : '';
  lines.push(`Oracle:${[siegeReminder, printedOracle].filter((part) => part.length > 0).join('\\n')}`);

  if (back !== null) {
    const exportedBack = transpileCardScript(back);
    if (!exportedBack.ok) {
      rejections.push(
        ...exportedBack.rejections.map((found) => ({
          ...found,
          path: found.path.length === 0 ? 'backFace' : `backFace.${found.path}`,
        })),
      );
    } else {
      const [name, _manaCost, ...rest] = exportedBack.value.lines;
      if (name === undefined) throw new Error('a transformed face exported without a name');
      const colors = back.colors.map((color) => FORGE_COLOR_WORDS[color]);
      lines.push(
        '',
        'ALTERNATE',
        '',
        name,
        'ManaCost:no cost',
        ...(colors.length === 0 ? [] : [`Colors:${colors.join(',')}`]),
        ...rest,
      );
    }
  }

  if (rejections.length > 0) return { ok: false, rejections };
  return {
    ok: true,
    value: { lines, tokens: printedCardSurface(card).tokens },
  };
}

/** Forge's explicit mana line for a nonbasic land's intrinsic tap ability. */
function nonbasicLandManaLine(card: Card): string | null {
  if (card.kind !== 'land' || card.basicLandType !== undefined) return null;
  if (card.subtypes.some((subtype) => BASIC_LAND_TYPES.some((basic) => basic === subtype))) return null;
  const choices = card.producesMana.map((color) => FORGE_MANA_PRODUCED[color]);
  if (choices.length === 0) return null;
  const producedColors = new Set<string>(card.producesMana);
  const anyColor =
    producedColors.size === 5 && ['W', 'U', 'B', 'R', 'G'].every((color) => producedColors.has(color));
  const produced = anyColor ? 'Any' : choices.length === 1 ? choices[0] : `Combo ${choices.join(' ')}`;
  if (produced === undefined) return null;
  const symbols = choices.map((choice) => `{${choice}}`);
  const description = anyColor ? 'Add one mana of any color.' : `Add ${joinManaChoices(symbols)}.`;
  return `A:AB$ Mana | Cost$ T | Produced$ ${produced} | SpellDescription$ ${description}`;
}

function joinManaChoices(symbols: readonly string[]): string {
  if (symbols.length === 1) return symbols[0] ?? '';
  if (symbols.length === 2) return `${symbols[0]} or ${symbols[1]}`;
  return `${symbols.slice(0, -1).join(', ')}, or ${symbols.at(-1)}`;
}

function creaturePT(card: CreatureCard): string {
  return `${card.power}/${card.toughness}`;
}

/**
 * Token spec -> Forge token script, matching `res/tokenscripts` exactly.
 *
 * The type line and the `PT:` line follow the token's body: stats mean a
 * creature token, no stats mean an artifact token, and `tokenCard` is where
 * that rule lives so this function reads it rather than restating it. A part
 * token in the flagship set is the second kind, and it writes no `PT:` at all
 * rather than `PT:0/0`.
 *
 * Printed abilities take the same `S:`, `T:` and `A:` lines a card's do, from
 * the same `transpileAbility`. `printedCardSurface` gives the set exporter the
 * nested token list separately, so a token-making token both writes this
 * trigger and causes the child token script to be emitted.
 *
 * Unmapped keywords and untranspilable abilities are both impossible here —
 * `transpileEffect` rejects the token before it reaches this function — so
 * reaching either state is a broken invariant and throws rather than emitting a
 * token missing half its text.
 */
export function transpileTokenScript(token: TokenSpec): string {
  const lines = [`Name:${forgeTokenDisplayName(token)}`, 'ManaCost:no cost'];
  const colors = sortColors(token.colors);
  if (colors.length > 0) {
    lines.push(`Colors:${colors.map((color) => FORGE_COLOR_WORDS[color]).join(',')}`);
  }
  const subtypes = token.subtypes.length > 0 ? ` ${token.subtypes.join(' ')}` : '';
  const creature = isCreatureTokenSpec(token);
  lines.push(`Types:${creature ? 'Creature' : 'Artifact'}${subtypes}`);
  if (creature) {
    if (token.creationPowerToughness !== undefined) {
      lines.push('PT:0/0');
    } else if (token.characteristicPowerToughness?.kind === 'controllerLifeTotal') {
      lines.push('PT:*/*');
      lines.push(
        "S:Mode$ Continuous | SetPower$ X | SetToughness$ X | CharacteristicDefining$ True | Description$ This creature's power and toughness are each equal to your life total.",
      );
      lines.push('SVar:X:Count$YourLifeTotal');
    } else if (token.characteristicPowerToughness !== undefined) {
      throw new TranspileError(
        [
          rejection(
            'UNMAPPED_CHARACTERISTIC_VALUE',
            forgeTokenScriptName(token),
            'characteristicPowerToughness',
            'this token CDA has no source-proven Forge Count$ spelling; exporting its 0/0 storage sentinel would change the token',
          ),
        ],
        'token script',
      );
    } else {
      lines.push(`PT:${token.power}/${token.toughness}`);
    }
  }
  for (const keyword of sortKeywords(token.keywords)) {
    const forgeKeyword = FORGE_KEYWORDS[keyword];
    if (forgeKeyword === undefined) {
      throw new TranspileError(
        [
          rejection(
            'UNMAPPED_KEYWORD',
            forgeTokenScriptName(token),
            'keywords',
            `token keyword "${keyword}" has no Forge K: mapping`,
          ),
        ],
        'token script',
      );
    }
    lines.push(`K:${forgeKeyword}`);
  }
  for (const [index, ability] of tokenAbilities(token).entries()) {
    const result = transpileAbility(
      ability,
      index,
      forgeTokenScriptName(token),
      `abilities[${index}]`,
      token.quoteAbilities === true ? 'this token' : 'CARDNAME',
    );
    if (!result.ok) throw new TranspileError(result.rejections, 'token script');
    const collisions = appendAbilityLines(
      lines,
      result.value.lines,
      forgeTokenScriptName(token),
      `abilities[${index}]`,
    );
    if (collisions.length > 0) throw new TranspileError(collisions, 'token script');
  }
  lines.push(`Oracle:${escapeNewlines(renderTokenOracleText(token))}`);
  return `${lines.join('\n')}\n`;
}

/** File name of a token script, without the `.txt` extension. */
export { forgeTokenScriptName };
