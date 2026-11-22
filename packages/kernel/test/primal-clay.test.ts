import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  characteristicsOf,
  legalActions,
  moveObject,
  pendingDecision,
  powerOf,
  reduce,
  scenario,
  toughnessOf,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { handOidOf } from './helpers';

const MODES = [
  { power: 3, toughness: 3 },
  { power: 2, toughness: 2, addKeywords: ['flying'] },
  { power: 1, toughness: 6, addSubtypes: ['Wall'], addKeywordAbilities: [{ kind: 'defender' }] },
] as const;

const PRIMAL_CLAY = parseCard({
  kind: 'creature',
  id: 'm13-primal-clay',
  name: 'Primal Clay',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 210 },
  manaCost: { generic: 4 },
  artifact: true,
  subtypes: ['Shapeshifter'],
  power: 0,
  toughness: 0,
  entryReplacement: { kind: 'entersAsCharacteristicChoice', modes: MODES },
});

const CLONE = parseCard({
  kind: 'creature',
  id: 'm11-clone-probe',
  name: 'Clone Probe',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 3, U: 1 },
  colors: ['U'],
  subtypes: ['Shapeshifter'],
  power: 0,
  toughness: 0,
  entryReplacement: { kind: 'entersAsCopyOfCreature' },
});

function stopOnEntryChoice(
  card: Card = PRIMAL_CLAY,
  controller: 0 | 1 = 0,
): { state: GameState; oid: ObjectId } {
  const start = scenario({ hands: [[card], []] }).state;
  const oid = handOidOf(start, 0, card.name);
  return {
    state: moveObject(beginTrace(start), oid, 'battlefield', { controller }).state,
    oid,
  };
}

function chooseMode(state: GameState, mode: number): GameState {
  const action = legalActions(state).find(
    (candidate) => candidate.type === 'chooseEntryCharacteristics' && candidate.mode === mode,
  );
  if (action === undefined) throw new Error(`entry did not offer characteristic mode ${String(mode)}`);
  return reduce(state, action).state;
}

function chooseCopy(state: GameState, copyOf: ObjectId): GameState {
  const action = legalActions(state).find(
    (candidate) => candidate.type === 'chooseEntryCopy' && candidate.copyOf === copyOf,
  );
  if (action === undefined) throw new Error('Clone Probe did not offer Primal Clay');
  return reduce(state, action).state;
}

describe('Primal Clay entry replacement', () => {
  it('asks the entering controller before the object reaches the battlefield', () => {
    const stopped = stopOnEntryChoice(PRIMAL_CLAY, 1);

    expect(stopped.state.objects[stopped.oid]?.zone).toBe('hand');
    expect(stopped.state.battlefield).not.toContain(stopped.oid);
    expect(pendingDecision(stopped.state)).toMatchObject({
      kind: 'entryCharacteristics',
      player: 1,
      oid: stopped.oid,
      modes: MODES,
      options: [
        { type: 'chooseEntryCharacteristics', mode: 0 },
        { type: 'chooseEntryCharacteristics', mode: 1 },
        { type: 'chooseEntryCharacteristics', mode: 2 },
      ],
      complete: true,
    });
  });

  it.each([
    [0, 3, 3, ['Shapeshifter'], []],
    [1, 2, 2, ['Shapeshifter'], ['flying']],
    [2, 1, 6, ['Shapeshifter', 'Wall'], []],
  ] as const)(
    'materializes mode %i as one complete copiable form',
    (mode, power, toughness, subtypes, keywords) => {
      const stopped = stopOnEntryChoice();
      const entered = chooseMode(stopped.state, mode);

      expect([powerOf(entered, stopped.oid), toughnessOf(entered, stopped.oid)]).toEqual([power, toughness]);
      expect(characteristicsOf(entered, stopped.oid)).toMatchObject({
        cardTypes: ['creature', 'artifact'],
        subtypes,
        keywords,
      });
      expect(entered.objects[stopped.oid]?.copiableCard?.keywordAbilities ?? []).toEqual(
        mode === 2 ? [{ kind: 'defender' }] : [],
      );
    },
  );

  it('a copy sees the chosen form and its replacement, while blink clears the physical card', () => {
    const start = scenario({ hands: [[PRIMAL_CLAY, CLONE], []] }).state;
    const clay = handOidOf(start, 0, PRIMAL_CLAY.name);
    const stopped = moveObject(beginTrace(start), clay, 'battlefield').state;
    const air = chooseMode(stopped, 1);
    const clone = handOidOf(air, 0, CLONE.name);
    const copying = moveObject(beginTrace(air), clone, 'battlefield').state;
    const copied = chooseCopy(copying, clay);
    expect(pendingDecision(copied)).toMatchObject({ kind: 'entryCharacteristics', oid: clone });
    const groundCopy = chooseMode(copied, 0);
    expect(characteristicsOf(groundCopy, clone)).toMatchObject({
      name: 'Primal Clay',
      power: 3,
      toughness: 3,
      keywords: ['flying'],
    });

    const left = moveObject(beginTrace(groundCopy), clay, 'exile');
    const returning = moveObject(left, clay, 'battlefield').state;
    expect(pendingDecision(returning)).toMatchObject({ kind: 'entryCharacteristics', oid: clay });
    const wall = chooseMode(returning, 2);
    expect(characteristicsOf(wall, clay)).toMatchObject({
      subtypes: ['Shapeshifter', 'Wall'],
      keywords: [],
    });
    expect(wall.objects[clay]?.copiableCard?.keywordAbilities).toEqual([{ kind: 'defender' }]);
  });
});
