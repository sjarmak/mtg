import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  hasKeyword,
  moveObject,
  pendingDecision,
  powerOf,
  scenario,
  settle,
  toughnessOf,
  type ReduceResult,
} from '@mtg/kernel';
import { apply, handOidOf, oidOf, oidsOf } from './helpers';

const WORLDSPINE_WURM = parseCard({
  kind: 'creature',
  id: 'rtr-140-worldspine-wurm-kernel',
  name: 'Worldspine Wurm',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 140 },
  manaCost: { generic: 8, G: 3 },
  colors: ['G'],
  subtypes: ['Wurm'],
  power: 15,
  toughness: 15,
  keywords: ['trample'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'createToken',
          count: 3,
          token: {
            name: 'Wurm',
            power: 5,
            toughness: 5,
            colors: ['G'],
            subtypes: ['Wurm'],
            keywords: ['trample'],
          },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfPutIntoGraveyardFromAnywhere',
      effects: [{ kind: 'shuffleSourceIntoOwnerLibrary' }],
    },
  ],
} satisfies CardInput);

function pass(current: ReduceResult): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'priority') throw new Error('Worldspine Wurm test lost priority');
  return apply(current, { type: 'passPriority', player: decision.player });
}

function resolveStack(current: ReduceResult): ReduceResult {
  let resolved = current;
  for (let guard = 0; resolved.state.stack.length > 0 && guard < 4; guard += 1) {
    resolved = pass(pass(resolved));
  }
  if (resolved.state.stack.length > 0) throw new Error('Worldspine Wurm test left a trigger unresolved');
  return resolved;
}

describe('RTR #140 Worldspine Wurm', () => {
  it('fires both death triggers, creates three exact Wurms, and shuffles the source', () => {
    const opened = scenario({ battlefield: [{ card: WORLDSPINE_WURM, controller: 0 }] });
    const source = oidOf(opened.state, WORLDSPINE_WURM.name);
    const moved = settle(moveObject(beginTrace(opened.state), source, 'graveyard'));
    const fired = eventsOfType(moved.events, 'abilityTriggered');

    expect(fired.map((event) => event.condition).sort()).toEqual([
      'selfDies',
      'selfPutIntoGraveyardFromAnywhere',
    ]);
    expect(moved.state.stack).toHaveLength(2);

    const resolved = resolveStack({ state: moved.state, events: moved.events });
    const wurms = oidsOf(resolved.state, 'Wurm');
    expect(wurms).toHaveLength(3);
    for (const wurm of wurms) {
      expect(powerOf(resolved.state, wurm)).toBe(5);
      expect(toughnessOf(resolved.state, wurm)).toBe(5);
      expect(resolved.state.objects[wurm]?.card.colors).toEqual(['G']);
      expect(hasKeyword(resolved.state, wurm, 'trample')).toBe(true);
    }
    expect(resolved.state.players[0].library).toContain(source);
    expect(eventsOfType(resolved.events, 'libraryShuffled')).toHaveLength(1);
  });

  it('shuffles a nonbattlefield graveyard move without creating Wurm tokens', () => {
    const opened = scenario({ hands: [[WORLDSPINE_WURM], []] });
    const source = handOidOf(opened.state, 0, WORLDSPINE_WURM.name);
    const moved = settle(moveObject(beginTrace(opened.state), source, 'graveyard'));

    expect(eventsOfType(moved.events, 'abilityTriggered').map((event) => event.condition)).toEqual([
      'selfPutIntoGraveyardFromAnywhere',
    ]);
    expect(moved.state.stack).toHaveLength(1);

    const resolved = resolveStack({ state: moved.state, events: moved.events });
    expect(oidsOf(resolved.state, 'Wurm')).toEqual([]);
    expect(resolved.state.players[0].library).toContain(source);
  });
});
