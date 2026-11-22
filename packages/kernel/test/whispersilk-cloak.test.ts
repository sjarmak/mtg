/** Native targeting, combat, and attachment-lifetime proof for Whispersilk Cloak. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  attachmentOf,
  beginTrace,
  canBlock,
  legalActions,
  moveObject,
  reduce,
  reduceAll,
  scenario,
  targetChoicesFor,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, instant, lands, PLAINS } from './cards';

const CLOAK: Card = parseCard({
  kind: 'artifact',
  id: 'm11-whispersilk-cloak',
  name: 'Whispersilk Cloak',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 221 },
  manaCost: { generic: 3 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      attach: {
        modifications: [{ kind: 'cantBeBlocked' }, { kind: 'grantKeyword', keyword: 'shroud' }],
      },
      effects: [],
    },
  ],
});

const SECOND_EQUIPMENT: Card = parseCard({
  kind: 'artifact',
  id: 'test-second-equipment',
  name: 'Second Equipment',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 221 },
  manaCost: { generic: 1 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      attach: { modifications: [{ kind: 'statBonus', power: 1, toughness: 0 }] },
      effects: [],
    },
  ],
});

const BEAR = creature('Cloaked Bear', 2, 2);
const LION = creature('Cloaked Lion', 2, 2);
const BLOCKER = creature('Waiting Blocker', 2, 2);
const TARGETING_SPELL = instant(
  'Targeting Spell',
  [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
  { W: 1 },
);
const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function named(state: GameState, name: string): ObjectId {
  const oid = state.battlefield.find((candidate) => state.objects[candidate]?.card.name === name);
  if (oid === undefined) throw new Error(`no battlefield object named ${name}`);
  return oid;
}

function equip(state: GameState, equipment: ObjectId, host: ObjectId): GameState {
  const action = legalActions(state).find(
    (candidate) =>
      candidate.type === 'activateAbility' &&
      candidate.oid === equipment &&
      candidate.targets.some((target) => target?.kind === 'permanent' && target.oid === host),
  );
  if (action?.type !== 'activateAbility') throw new Error(`no equip action for ${host}`);
  return reduceAll(reduce(state, action).state, PASS).state;
}

function creatureTargets(state: GameState, controller: 0 | 1): readonly ObjectId[] {
  return (
    targetChoicesFor(state, TARGETING_SPELL, controller)[0]
      ?.filter((target) => target?.kind === 'permanent')
      .map((target) => target.oid) ?? []
  );
}

describe('Whispersilk Cloak in the kernel', () => {
  it('moves unblockability and shroud together and restores both when the source leaves', () => {
    const start = scenario({
      battlefield: [
        { card: CLOAK, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: LION, controller: 0 },
        { card: BLOCKER, controller: 1 },
        ...lands(PLAINS, 4).map((card) => ({ card, controller: 0 as const })),
      ],
    }).state;
    const cloak = named(start, CLOAK.name);
    const bear = named(start, BEAR.name);
    const lion = named(start, LION.name);
    const blocker = named(start, BLOCKER.name);

    expect(canBlock(start, blocker, bear)).toBe(true);
    expect(creatureTargets(start, 0)).toContain(bear);
    expect(creatureTargets(start, 1)).toContain(bear);

    const onBear = equip(start, cloak, bear);
    expect(attachmentOf(onBear, cloak)).toBe(bear);
    expect(canBlock(onBear, blocker, bear)).toBe(false);
    expect(creatureTargets(onBear, 0)).not.toContain(bear);
    expect(creatureTargets(onBear, 1)).not.toContain(bear);

    const onLion = equip(onBear, cloak, lion);
    expect(attachmentOf(onLion, cloak)).toBe(lion);
    expect(canBlock(onLion, blocker, bear)).toBe(true);
    expect(canBlock(onLion, blocker, lion)).toBe(false);
    expect(creatureTargets(onLion, 0)).toContain(bear);
    expect(creatureTargets(onLion, 1)).toContain(bear);
    expect(creatureTargets(onLion, 0)).not.toContain(lion);
    expect(creatureTargets(onLion, 1)).not.toContain(lion);

    const gone = moveObject(beginTrace(onLion), cloak, 'graveyard').state;
    expect(canBlock(gone, blocker, lion)).toBe(true);
    expect(creatureTargets(gone, 0)).toContain(lion);
    expect(creatureTargets(gone, 1)).toContain(lion);
  });

  it('prevents either player from targeting the shrouded host with another Equip ability', () => {
    const start = scenario({
      battlefield: [
        { card: CLOAK, controller: 0 },
        { card: SECOND_EQUIPMENT, controller: 0 },
        { card: BEAR, controller: 0 },
        ...lands(PLAINS, 3).map((card) => ({ card, controller: 0 as const })),
      ],
    }).state;
    const cloak = named(start, CLOAK.name);
    const second = named(start, SECOND_EQUIPMENT.name);
    const bear = named(start, BEAR.name);
    const equipped = equip(start, cloak, bear);

    expect(
      legalActions(equipped).some(
        (candidate) =>
          candidate.type === 'activateAbility' &&
          candidate.oid === second &&
          candidate.targets.some((target) => target?.kind === 'permanent' && target.oid === bear),
      ),
    ).toBe(false);
  });
});
