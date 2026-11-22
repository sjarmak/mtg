/** Native turn-rule proofs for M11 Autumn's Veil. */
import { parseCard, type Card, type CardInput, type InstantCard } from '@mtg/dsl';
import {
  beginTrace,
  canBeTargetedBy,
  cleanupTurnEffects,
  copySpellOnStack,
  eventsOfType,
  onlyObject,
  pendingDecision,
  resolveTop,
  scenario,
  stateFingerprint,
  targetChoicesFor,
  targetChoicesForEffects,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { FOREST, ISLAND, SWAMP } from './cards';
import { controlledBy } from './continuous-helpers';
import { apply, handOidOf, oidOf } from './helpers';

let collector = 1;

function creature(name: string, color: 'U' | 'G'): Card {
  collector += 1;
  return parseCard({
    kind: 'creature',
    id: `autumns-veil-${String(collector)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: collector },
    manaCost: { [color]: 1 },
    colors: [color],
    power: 2,
    toughness: 2,
  });
}

function targetedSpell(name: string, colors: readonly ('U' | 'B' | 'G')[]): InstantCard {
  collector += 1;
  const card = parseCard({
    kind: 'instant',
    id: `autumns-veil-${String(collector)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: collector },
    manaCost: colors.length === 0 ? { generic: 1 } : Object.fromEntries(colors.map((color) => [color, 1])),
    colors,
    effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
  });
  if (card.kind !== 'instant') throw new Error(`${name} did not parse as an instant`);
  return card;
}

function counterSpell(name: string, color: 'U' | 'B' | 'G'): InstantCard {
  collector += 1;
  const card = parseCard({
    kind: 'instant',
    id: `autumns-veil-${String(collector)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: collector },
    manaCost: { [color]: 1 },
    colors: [color],
    effects: [{ kind: 'counterSpell' }],
  });
  if (card.kind !== 'instant') throw new Error(`${name} did not parse as an instant`);
  return card;
}

const AUTUMNS_VEIL = parseCard({
  kind: 'instant',
  id: 'm11-162-autumns-veil-kernel',
  name: "Autumn's Veil",
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 162 },
  manaCost: { G: 1 },
  colors: ['G'],
  effects: [
    {
      kind: 'protectSpellsAndCreaturesFromSpellColorsThisTurn',
      colors: ['U', 'B'],
    },
  ],
} as unknown as CardInput);

const TEST_SPELL = parseCard({
  kind: 'instant',
  id: 'autumn-veil-victim',
  name: 'Autumn Veil Victim',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 100 },
  manaCost: { U: 1 },
  colors: ['U'],
  effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
});
const BLUE_COUNTER = counterSpell('Blue Autumn Counter', 'U');
const BLACK_COUNTER = counterSpell('Black Autumn Counter', 'B');
const GREEN_COUNTER = counterSpell('Green Autumn Counter', 'G');
const BLUE_TARGET = targetedSpell('Blue Autumn Target', ['U']);
const BLACK_TARGET = targetedSpell('Black Autumn Target', ['B']);
const GREEN_TARGET = targetedSpell('Green Autumn Target', ['G']);
const MULTICOLOR_TARGET = targetedSpell('Blue Green Autumn Target', ['U', 'G']);
const COLORLESS_TARGET = targetedSpell('Colorless Autumn Target', []);
const PROTECTED = creature('Autumn Protected Creature', 'G');
const OPPONENT_CREATURE = creature('Autumn Opponent Creature', 'G');
const BLUE_ABILITY_SOURCE = creature('Autumn Blue Ability Source', 'U');
const BLUE_COUNTER_ABILITY_SOURCE = parseCard({
  kind: 'creature',
  id: 'autumn-blue-counter-ability-source',
  name: 'Autumn Blue Counter Ability Source',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 101 },
  manaCost: { U: 1 },
  colors: ['U'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { U: 1 } },
      effects: [{ kind: 'counterSpell' }],
    },
  ],
});

function pass(current: ReduceResult): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'priority') throw new Error(`Autumn's Veil lost priority`);
  return apply(current, { type: 'passPriority', player: decision.player });
}

function settle(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 24; guard += 1) {
    if (walked.state.stack.length === 0) return walked;
    walked = pass(walked);
  }
  throw new Error(`Autumn's Veil stack did not settle`);
}

function cast(
  current: ReduceResult,
  player: 0 | 1,
  card: Card,
  targets: readonly ({ readonly kind: 'spell'; readonly oid: ObjectId } | null)[] = [],
): ReduceResult {
  return apply(current, {
    type: 'castSpell',
    player,
    oid: handOidOf(current.state, player, card.name),
    targets,
  });
}

function resolvedVeil(
  extra: {
    readonly battlefield?: readonly { readonly card: Card; readonly controller: 0 | 1 }[];
    readonly hands?: readonly [readonly Card[], readonly Card[]];
  } = {},
): ReduceResult {
  const start = scenario({
    battlefield: [{ card: FOREST, controller: 0 }, ...(extra.battlefield ?? [])],
    hands: [[AUTUMNS_VEIL, ...(extra.hands?.[0] ?? [])], [...(extra.hands?.[1] ?? [])]],
  });
  return settle(cast(start, 0, AUTUMNS_VEIL, [null]));
}

function counterRun(counter: InstantCard): ReduceResult {
  const land = counter.colors.includes('U') ? ISLAND : counter.colors.includes('B') ? SWAMP : FOREST;
  let current = resolvedVeil({
    battlefield: [
      { card: ISLAND, controller: 0 },
      { card: land, controller: 1 },
    ],
    hands: [[TEST_SPELL], [counter]],
  });
  current = cast(current, 0, TEST_SPELL, [null]);
  const victim = current.state.stack.at(-1)?.oid;
  if (victim === undefined) throw new Error('Autumn victim did not reach the stack');
  current = pass(current);
  current = cast(current, 1, counter, [{ kind: 'spell', oid: victim }]);
  return settle(current);
}

describe("Autumn's Veil turn-scoped player rules", () => {
  it('stores both rules in fingerprinted state and clears them at cleanup', () => {
    const resolved = resolvedVeil();
    expect(resolved.state.turnPlayerRules).toEqual([
      {
        rule: 'spellsCantBeCounteredBySpellColors',
        sourceOid: expect.any(String),
        player: 0,
        colors: ['U', 'B'],
      },
      {
        rule: 'creaturesCantBeTargetedBySpellColors',
        sourceOid: expect.any(String),
        player: 0,
        colors: ['U', 'B'],
      },
    ]);
    expect(stateFingerprint(resolved.state)).not.toBe(
      stateFingerprint({ ...resolved.state, turnPlayerRules: [] }),
    );

    const cleaned = cleanupTurnEffects({ state: resolved.state, events: [] });
    expect(cleaned.state.turnPlayerRules).toEqual([]);
  });

  it('blocks blue, black, multicolored, and copied spells but permits other spells and blue abilities', () => {
    const resolved = resolvedVeil({
      battlefield: [
        { card: PROTECTED, controller: 0 },
        { card: OPPONENT_CREATURE, controller: 1 },
        { card: BLUE_ABILITY_SOURCE, controller: 1 },
      ],
      hands: [[], [BLUE_TARGET, BLACK_TARGET, GREEN_TARGET, MULTICOLOR_TARGET, COLORLESS_TARGET]],
    });
    const target = oidOf(resolved.state, PROTECTED.name);
    const opponent = oidOf(resolved.state, OPPONENT_CREATURE.name);
    const choice = (card: InstantCard) =>
      targetChoicesFor(resolved.state, card, 1, handOidOf(resolved.state, 1, card.name))[0];

    expect(choice(BLUE_TARGET)).not.toContainEqual({ kind: 'permanent', oid: target });
    expect(choice(BLACK_TARGET)).not.toContainEqual({ kind: 'permanent', oid: target });
    expect(choice(MULTICOLOR_TARGET)).not.toContainEqual({ kind: 'permanent', oid: target });
    expect(choice(BLUE_TARGET)).toContainEqual({ kind: 'permanent', oid: opponent });
    expect(choice(GREEN_TARGET)).toContainEqual({ kind: 'permanent', oid: target });
    expect(choice(COLORLESS_TARGET)).toContainEqual({ kind: 'permanent', oid: target });

    const ability = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } } as const;
    expect(
      targetChoicesForEffects(
        resolved.state,
        [ability],
        1,
        oidOf(resolved.state, BLUE_ABILITY_SOURCE.name),
      )[0],
    ).toContainEqual({ kind: 'permanent', oid: target });

    const copiedEntry = {
      oid: 'cp-autumn-blue-target',
      controller: 1 as const,
      targets: [{ kind: 'permanent' as const, oid: target }],
      ability: null,
      mode: null,
      triggerContext: null,
      x: null,
      sourceCharacteristics: null,
      copiedSpell: {
        card: BLUE_TARGET,
        copiedFrom: 'o-autumn-blue-target',
        sourceOid: 'o-autumn-blue-target',
      },
    };
    const copied = resolveTop(beginTrace({ ...resolved.state, stack: [copiedEntry] }));
    expect(eventsOfType(copied.events, 'spellFizzled')).toHaveLength(1);
  });

  it('reads current control and protects creatures that enter after resolution', () => {
    const resolved = resolvedVeil({
      battlefield: [
        { card: PROTECTED, controller: 0 },
        { card: OPPONENT_CREATURE, controller: 1 },
      ],
    });
    const protectedOid = oidOf(resolved.state, PROTECTED.name);
    const opponentOid = oidOf(resolved.state, OPPONENT_CREATURE.name);
    const changed = {
      ...resolved.state,
      continuous: [controlledBy(onlyObject(protectedOid), 1), controlledBy(onlyObject(opponentOid), 0)],
    };

    expect(canBeTargetedBy(changed, protectedOid, BLUE_TARGET, 1)).toBe(true);
    expect(canBeTargetedBy(changed, opponentOid, BLUE_TARGET, 1)).toBe(false);

    let entered = resolvedVeil({
      battlefield: [
        { card: FOREST, controller: 0 },
        { card: ISLAND, controller: 1 },
      ],
      hands: [[PROTECTED], [BLUE_TARGET]],
    });
    entered = settle(cast(entered, 0, PROTECTED));
    const enteredOid = oidOf(entered.state, PROTECTED.name);
    const blueChoices = targetChoicesFor(
      entered.state,
      BLUE_TARGET,
      1,
      handOidOf(entered.state, 1, BLUE_TARGET.name),
    )[0];
    expect(blueChoices).not.toContainEqual({ kind: 'permanent', oid: enteredOid });
  });

  it('stops blue and black counterspells but lets a green counterspell work', () => {
    for (const counter of [BLUE_COUNTER, BLACK_COUNTER]) {
      const result = counterRun(counter);
      expect(eventsOfType(result.events, 'spellCountered')).toEqual([]);
      expect(result.state.players[0].life).toBe(21);
    }

    const green = counterRun(GREEN_COUNTER);
    expect(eventsOfType(green.events, 'spellCountered')).toHaveLength(1);
    expect(green.state.players[0].life).toBe(20);
  });

  it('uses copied-spell colors when a copied blue counterspell resolves', () => {
    let current = resolvedVeil({
      battlefield: [
        { card: ISLAND, controller: 0 },
        { card: ISLAND, controller: 1 },
      ],
      hands: [[TEST_SPELL], [BLUE_COUNTER]],
    });
    current = cast(current, 0, TEST_SPELL, [null]);
    const victim = current.state.stack.at(-1)?.oid;
    if (victim === undefined) throw new Error('Autumn victim did not reach the stack');
    current = pass(current);
    current = cast(current, 1, BLUE_COUNTER, [{ kind: 'spell', oid: victim }]);
    const originalCounter = current.state.stack.at(-1)?.oid;
    if (originalCounter === undefined) throw new Error('Autumn counter did not reach the stack');
    const copied = copySpellOnStack(beginTrace(current.state), originalCounter);
    const resolvedCopy = resolveTop(copied);

    expect(resolvedCopy.state.stack.some((entry) => entry.oid === victim)).toBe(true);
    expect(eventsOfType(resolvedCopy.events, 'spellCountered')).toEqual([]);
  });

  it('permits a blue ability to counter a protected spell', () => {
    let current = resolvedVeil({
      battlefield: [
        { card: ISLAND, controller: 0 },
        { card: ISLAND, controller: 1 },
        { card: BLUE_COUNTER_ABILITY_SOURCE, controller: 1 },
      ],
      hands: [[TEST_SPELL], []],
    });
    current = cast(current, 0, TEST_SPELL, [null]);
    const victim = current.state.stack.at(-1)?.oid;
    if (victim === undefined) throw new Error('Autumn victim did not reach the stack');
    current = pass(current);
    current = apply(current, {
      type: 'activateAbility',
      player: 1,
      oid: oidOf(current.state, BLUE_COUNTER_ABILITY_SOURCE.name),
      abilityIndex: 0,
      targets: [{ kind: 'spell', oid: victim }],
      sacrifices: [],
    });
    current = settle(current);

    expect(eventsOfType(current.events, 'spellCountered')).toHaveLength(1);
    expect(current.state.players[0].life).toBe(20);
  });
});
