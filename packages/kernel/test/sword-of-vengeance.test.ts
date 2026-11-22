/** Native layer and lifetime proof for Sword of Vengeance. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import {
  attachmentOf,
  beginTrace,
  effectsApplyingTo,
  getObject,
  hasKeyword,
  legalActions,
  moveObject,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { creature, FOREST, lands } from './cards';

const SWORD: Card = parseCard({
  kind: 'artifact',
  id: 'm11-sword-of-vengeance',
  name: 'Sword of Vengeance',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 216 },
  manaCost: { generic: 3 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 3 } },
      attach: {
        modifications: [
          { kind: 'statBonus', power: 2, toughness: 0 },
          { kind: 'grantKeyword', keyword: 'firstStrike' },
          { kind: 'grantKeyword', keyword: 'vigilance' },
          { kind: 'grantKeyword', keyword: 'trample' },
          { kind: 'grantKeyword', keyword: 'haste' },
        ],
      },
      effects: [],
    },
  ],
});

const BEAR = creature('Runeclaw Bear', 2, 2, { cost: { generic: 2 } });
const LION = creature('Silvercoat Lion', 2, 2, { cost: { generic: 1, W: 1 } });
const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];
const KEYWORDS = ['firstStrike', 'vigilance', 'trample', 'haste'] as const;

function named(state: GameState, name: string): ObjectId {
  const oid = state.battlefield.find((candidate) => state.objects[candidate]?.card.name === name);
  if (oid === undefined) throw new Error(`no battlefield object named ${name}`);
  return oid;
}

function equip(state: GameState, weapon: ObjectId, host: ObjectId): GameState {
  const action = legalActions(state).find(
    (candidate) =>
      candidate.type === 'activateAbility' &&
      candidate.oid === weapon &&
      candidate.targets.some((target) => target?.kind === 'permanent' && target.oid === host),
  );
  if (action?.type !== 'activateAbility') throw new Error(`no equip action for ${host}`);
  return reduceAll(reduce(state, action).state, PASS).state;
}

function expectPrintedModifiers(state: GameState, host: ObjectId, present: boolean): void {
  expect(powerOf(state, host)).toBe(present ? 4 : 2);
  expect(toughnessOf(state, host)).toBe(2);
  for (const keyword of KEYWORDS) expect(hasKeyword(state, host, keyword), keyword).toBe(present);
}

describe('Sword of Vengeance in the kernel', () => {
  it('moves all five layer effects together and expires them with the source', () => {
    const start = scenario({
      battlefield: [
        { card: SWORD, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: LION, controller: 0 },
        ...lands(FOREST, 6).map((card) => ({ card, controller: 0 as const })),
      ],
    }).state;
    const sword = named(start, SWORD.name);
    const bear = named(start, BEAR.name);
    const lion = named(start, LION.name);

    const onBear = equip(start, sword, bear);
    expect(attachmentOf(onBear, sword)).toBe(bear);
    expectPrintedModifiers(onBear, bear, true);
    expectPrintedModifiers(onBear, lion, false);
    expect(effectsApplyingTo(onBear, bear).map((effect) => effect.layer)).toEqual(['6', '6', '6', '6', '7c']);

    const onLion = equip(onBear, sword, lion);
    expect(attachmentOf(onLion, sword)).toBe(lion);
    expectPrintedModifiers(onLion, bear, false);
    expectPrintedModifiers(onLion, lion, true);
    expect(onLion.continuous.filter((effect) => effect.sourceOid === sword)).toHaveLength(5);

    const gone = moveObject(beginTrace(onLion), sword, 'graveyard').state;
    expect(getObject(gone, sword).zone).toBe('graveyard');
    expectPrintedModifiers(gone, lion, false);
    expect(gone.continuous.filter((effect) => effect.sourceOid === sword)).toEqual([]);
  });
});
