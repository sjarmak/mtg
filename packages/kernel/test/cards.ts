/**
 * Test card factory.
 *
 * Every card goes through `parseCard`, so a fixture that stops being a legal
 * DSL card fails the test suite immediately rather than exercising the kernel
 * on something the generator could never emit.
 */
import type {
  AbilityInput,
  Card,
  CostReductionInput,
  Effect,
  Keyword,
  KeywordAbility,
  ManaCostInput,
} from '@mtg/dsl';
import { BASIC_LANDS, colorsFromCost, mana, parseCard } from '@mtg/dsl';

let counter = 0;

function nextId(): string {
  counter += 1;
  return `tst-${counter}`;
}

function nextCollector(): number {
  return (counter % 900) + 1;
}

export interface CreatureOptions {
  readonly cost?: ManaCostInput;
  readonly keywords?: readonly Keyword[];
  /**
   * The wider-consequence half of the keyword vocabulary (`KEYWORD_ABILITY_KINDS`),
   * which a card carries in its own list rather than in `keywords`.
   *
   * Here so a combat fixture can print double strike beside the flat keywords
   * it is compared against: `combat-keywords.test.ts` reads first strike off
   * `keywords` and double strike off this one, and a rig that could only reach
   * the first would have to build its own card to test the second.
   */
  readonly keywordAbilities?: readonly KeywordAbility[];
  readonly subtypes?: readonly string[];
  readonly abilities?: readonly AbilityInput[];
  /**
   * An artifact creature (CR 205.1a: the type line carries both words), which
   * `CardSchema` spells as `kind: 'creature'` with this flag rather than as a
   * second kind.
   *
   * Here because a filtered target that names the artifact type has to be able
   * to find one, and the only permanent in this file that is two card types at
   * once is this one (`mtg-6y4g`).
   */
  readonly artifact?: boolean;
}

export function creature(
  name: string,
  power: number,
  toughness: number,
  options: CreatureOptions = {},
): Card {
  const cost = mana(options.cost ?? { generic: 1 });
  return parseCard({
    kind: 'creature',
    id: nextId(),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextCollector() },
    manaCost: cost,
    colors: colorsFromCost(cost),
    subtypes: [...(options.subtypes ?? [])],
    keywords: [...(options.keywords ?? [])],
    keywordAbilities: [...(options.keywordAbilities ?? [])],
    abilities: [...(options.abilities ?? [])],
    artifact: options.artifact ?? false,
    power,
    toughness,
  });
}

/** A lord: "Other <subtype> creatures you control get +power/+toughness." */
export function tribalLord(
  name: string,
  subtype: string,
  bonus: { readonly power: number; readonly toughness: number },
  options: CreatureOptions = {},
): Card {
  return creature(name, 2, 2, {
    ...options,
    subtypes: [subtype, ...(options.subtypes ?? [])],
    abilities: [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype,
        modification: { kind: 'statBonus', power: bonus.power, toughness: bonus.toughness },
      },
    ],
  });
}

export function instant(
  name: string,
  effects: readonly Effect[],
  cost: ManaCostInput = { generic: 1 },
): Card {
  const manaCost = mana(cost);
  return parseCard({
    kind: 'instant',
    id: nextId(),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextCollector() },
    manaCost,
    colors: colorsFromCost(manaCost),
    effects: [...effects],
  });
}

export function sorcery(
  name: string,
  effects: readonly Effect[],
  cost: ManaCostInput = { generic: 1 },
): Card {
  const manaCost = mana(cost);
  return parseCard({
    kind: 'sorcery',
    id: nextId(),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextCollector() },
    manaCost,
    colors: colorsFromCost(manaCost),
    effects: [...effects],
  });
}

export function artifact(
  name: string,
  cost: ManaCostInput = { generic: 2 },
  abilities: readonly AbilityInput[] = [],
): Card {
  return parseCard({
    kind: 'artifact',
    id: nextId(),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextCollector() },
    manaCost: mana(cost),
    abilities: [...abilities],
  });
}

/**
 * A blanket enchantment: a permanent whose text, if it has any, is an ability.
 *
 * No `aura` field, which is the whole difference from `enchantment-aura.test.ts`'s
 * local factory: an Aura is attached to something and a blanket enchantment
 * simply sits on the battlefield, and it is the sitting one that a Disenchant
 * has to be able to name.
 */
export function enchantment(
  name: string,
  cost: ManaCostInput = { generic: 2 },
  abilities: readonly AbilityInput[] = [],
): Card {
  const manaCost = mana(cost);
  return parseCard({
    kind: 'enchantment',
    id: nextId(),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextCollector() },
    manaCost,
    colors: colorsFromCost(manaCost),
    abilities: [...abilities],
  });
}

export function planeswalker(
  name: string,
  startingLoyalty: number,
  abilities: readonly AbilityInput[],
  cost: ManaCostInput = { generic: 3 },
): Card {
  const manaCost = mana(cost);
  return parseCard({
    kind: 'planeswalker',
    id: nextId(),
    name,
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: nextCollector() },
    manaCost,
    colors: colorsFromCost(manaCost),
    supertypes: ['legendary'],
    subtypes: ['Test'],
    startingLoyalty,
    abilities: [...abilities],
  });
}

/** An anthem: "Creatures you control have <keyword>." on a noncreature artifact. */
export function keywordAnthem(name: string, keyword: Keyword, cost: ManaCostInput = { generic: 2 }): Card {
  return artifact(name, cost, [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      modification: { kind: 'grantKeyword', keyword },
    },
  ]);
}

/**
 * A permanent printing CR 601.2f's cost reduction: "<class> you cast cost
 * {reduction.amount} less to cast." An artifact, like `keywordAnthem`, so the
 * fixture is legal under `checkCostReduction` (creatures and artifacts only)
 * without needing a body of its own.
 */
export function costReducer(
  name: string,
  reduction: CostReductionInput,
  cost: ManaCostInput = { generic: 2 },
): Card {
  return parseCard({
    kind: 'artifact',
    id: nextId(),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextCollector() },
    manaCost: mana(cost),
    costReduction: reduction,
  });
}

/**
 * `costReducer`'s creature twin: the same CR 601.2f reduction, printed on a
 * body instead of an artifact. It exists because a spell that names
 * `targetCreature` cannot destroy an artifact, and for a while that was the
 * only kind of spell this DSL could express — `TARGET_SPACES` drew every
 * target from `creature` and `player` alone. That is no longer true:
 * `targetArtifactOrEnchantment` reaches the artifact form directly, and
 * `cost-modification.test.ts` now destroys the reducer both ways. The twin
 * stays because the creature path is worth its own coverage, not because the
 * artifact path is unreachable.
 */
export function creatureCostReducer(
  name: string,
  reduction: CostReductionInput,
  cost: ManaCostInput = { generic: 2 },
): Card {
  return parseCard({
    kind: 'creature',
    id: nextId(),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextCollector() },
    manaCost: mana(cost),
    costReduction: reduction,
    power: 2,
    toughness: 2,
  });
}

const [plains, island, swamp, mountain, forest] = BASIC_LANDS;

function required(card: Card | undefined, name: string): Card {
  if (card === undefined) throw new Error(`missing basic land fixture: ${name}`);
  return card;
}

export const PLAINS = required(plains, 'Plains');
export const ISLAND = required(island, 'Island');
export const SWAMP = required(swamp, 'Swamp');
export const MOUNTAIN = required(mountain, 'Mountain');
export const FOREST = required(forest, 'Forest');

/** `count` copies of a basic land, for scenario battlefields and libraries. */
export function lands(card: Card, count: number): readonly Card[] {
  return Array.from({ length: count }, () => card);
}
