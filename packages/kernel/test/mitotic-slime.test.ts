/**
 * Mitotic Slime proves that nested token data stays on the ordinary kernel
 * path: every created token is a real card object, so its own dies trigger is
 * discovered and resolved without a token-specific execution branch.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { Action, ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, reduce, scenario } from '@mtg/kernel';
import { instant, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf, oidsOf } from './helpers';

const MITOTIC_SLIME = parseCard({
  id: 'm11-185-mitotic-slime-kernel',
  kind: 'creature',
  name: 'Mitotic Slime',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 185 },
  manaCost: { generic: 4, G: 1 },
  power: 4,
  toughness: 4,
  colors: ['G'],
  subtypes: ['Ooze'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [
        {
          kind: 'createToken',
          count: 2,
          token: {
            identity: 'mitotic-ooze-2-2',
            quoteAbilities: true,
            name: 'Ooze',
            power: 2,
            toughness: 2,
            colors: ['G'],
            subtypes: ['Ooze'],
            abilities: [
              {
                kind: 'triggered',
                condition: 'selfDies',
                effects: [
                  {
                    kind: 'createToken',
                    count: 2,
                    token: {
                      identity: 'mitotic-ooze-1-1',
                      name: 'Ooze',
                      power: 1,
                      toughness: 1,
                      colors: ['G'],
                      subtypes: ['Ooze'],
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
});

const DOOM = instant('Mitotic Doom', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }]);

const PASSES: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function destroy(current: ReduceResult, target: ObjectId): ReduceResult {
  const cast = reduce(current.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(current.state, 0, DOOM.name),
    targets: [{ kind: 'permanent', oid: target }],
  });
  let settled: ReduceResult = { state: cast.state, events: [...current.events, ...cast.events] };
  for (const action of PASSES) settled = apply(settled, action);
  return settled;
}

describe('Mitotic Slime native execution', () => {
  it('runs both dies triggers and keeps both same-named token bodies distinct', () => {
    const start = scenario({
      battlefield: [
        { card: MITOTIC_SLIME, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[DOOM, DOOM], []],
    });

    const first = destroy({ state: start.state, events: [] }, oidOf(start.state, MITOTIC_SLIME.name));
    const senior = oidsOf(first.state, 'Ooze');
    expect(senior).toHaveLength(2);
    expect(senior.map((oid) => first.state.objects[oid]?.card.id)).toEqual([
      'token-mitotic-ooze-2-2',
      'token-mitotic-ooze-2-2',
    ]);
    expect(senior.map((oid) => first.state.objects[oid]?.card.power)).toEqual([2, 2]);

    const second = destroy(first, senior[0] ?? '');
    const survivors = oidsOf(second.state, 'Ooze');
    expect(survivors.map((oid) => second.state.objects[oid]?.card.id).sort()).toEqual([
      'token-mitotic-ooze-1-1',
      'token-mitotic-ooze-1-1',
      'token-mitotic-ooze-2-2',
    ]);
    expect(survivors.map((oid) => second.state.objects[oid]?.card.power).sort()).toEqual([1, 1, 2]);
    expect(second.state.stack).toEqual([]);

    const fired = eventsOfType(second.events, 'abilityTriggered').filter(
      (event) => event.condition === 'selfDies',
    );
    expect(fired).toHaveLength(2);
  });
});
