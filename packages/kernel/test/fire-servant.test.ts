/** Fire Servant through the source-filtered damage replacement pipeline. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  controllerOf,
  eventsOfType,
  reduce,
  reduceAll,
  scenario,
  type DamageInstance,
  type ObjectId,
  type ReduceResult,
  type Target,
} from '@mtg/kernel';
import { creature, instant, MOUNTAIN, sorcery } from './cards';
import {
  controlledBy,
  damageToPlayer,
  onlyObject,
  replacement,
  withContinuous,
  withReplacements,
} from './continuous-helpers';
import { handOidOf, oidOf } from './helpers';

const FIRE_SERVANT: Card = creature('Fire Servant', 4, 3, {
  cost: { generic: 3, R: 2 },
  subtypes: ['Elemental'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: {
        kind: 'doubleDamage',
        sourceFilter: { controller: 'you', cardTypes: ['instant', 'sorcery'], colors: ['R'] },
      },
    },
  ],
});

const RED_BOLT: Card = sorcery(
  'Fire Servant Red Bolt',
  [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetPlayer' } }],
  { R: 1 },
);

const RED_INSTANT: Card = instant(
  'Fire Servant Red Instant',
  [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetPlayer' } }],
  { R: 1 },
);

const BLUE_BOLT: Card = sorcery(
  'Fire Servant Blue Bolt',
  [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetPlayer' } }],
  { U: 1 },
);

const PASSES = [
  { type: 'passPriority' as const, player: 0 as const },
  { type: 'passPriority' as const, player: 1 as const },
];

function castAndResolve(start: ReduceResult, card: Card, targets: readonly (Target | null)[]): ReduceResult {
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, card.name),
    targets,
  });
  const resolved = reduceAll(cast.state, PASSES);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function spellDamage(
  sourceOid: ObjectId,
  sourceCard: Card,
  controller: 0 | 1,
  player: 0 | 1,
): DamageInstance {
  return {
    sourceOid,
    sourceCard,
    controller,
    recipient: { kind: 'player', player },
    amount: 2,
    deathtouch: false,
    lifelink: false,
    preventable: true,
    combat: false,
  };
}

describe('Fire Servant in the kernel', () => {
  it.each([
    ['instant', RED_INSTANT],
    ['sorcery', RED_BOLT],
  ] as const)('doubles a red %s its controller actually casts', (_kind, spell) => {
    const start = scenario({
      battlefield: [
        { card: FIRE_SERVANT, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[spell], []],
    });
    const done = castAndResolve(start, spell, [{ kind: 'player', player: 1 }]);

    expect(done.state.players[1].life).toBe(16);
    expect(eventsOfType(done.events, 'damageDealt')[0]?.amount).toBe(4);
  });

  it('rejects nonred spells, opponent spells, and red permanents while retaining copied-spell characteristics', () => {
    const redPermanent = creature('Fire Servant Red Permanent', 1, 1, { cost: { R: 1 } });
    const start = scenario({
      battlefield: [
        { card: FIRE_SERVANT, controller: 0 },
        { card: redPermanent, controller: 0 },
      ],
    });
    const redPermanentOid = oidOf(start.state, redPermanent.name);
    const done = applyDamage(beginTrace(start.state), [
      spellDamage('copied-red-spell', RED_BOLT, 0, 1),
      spellDamage('copied-blue-spell', BLUE_BOLT, 0, 1),
      spellDamage('opponent-red-spell', RED_BOLT, 1, 0),
      {
        sourceOid: redPermanentOid,
        controller: 0,
        recipient: { kind: 'player', player: 1 },
        amount: 2,
        deathtouch: false,
        lifelink: false,
        preventable: true,
        combat: false,
      },
    ]);

    expect(done.state.players.map((player) => player.life)).toEqual([18, 12]);
    expect(eventsOfType(done.events, 'damageDealt').map((event) => event.amount)).toEqual([4, 2, 2, 2]);
  });

  it('reads Fire Servant current controller instead of freezing its entry controller', () => {
    const start = scenario({ battlefield: [{ card: FIRE_SERVANT, controller: 1 }] });
    const servant = oidOf(start.state, FIRE_SERVANT.name);
    const changed = withContinuous(start.state, [controlledBy(onlyObject(servant), 0)]);
    expect(controllerOf(changed, servant)).toBe(0);

    const done = applyDamage(beginTrace(changed), [spellDamage('controlled-red-spell', RED_BOLT, 0, 1)]);
    expect(done.state.players[1].life).toBe(16);
  });

  it('rechecks after doubling and still lets a later prevention effect stop the event', () => {
    const start = scenario({ battlefield: [{ card: FIRE_SERVANT, controller: 0 }] });
    const doubler = start.state.replacements.find(
      (effect) => effect.trigger.kind === 'damage' && effect.trigger.fromSpellSource !== null,
    );
    if (doubler === undefined) throw new Error('Fire Servant did not register its replacement');
    const prevented = withReplacements(start.state, [
      replacement(
        damageToPlayer(1),
        { kind: 'preventDamage', amount: 'all' },
        { id: 'fire-shield', ts: Number.MAX_SAFE_INTEGER },
      ),
    ]);
    const done = applyDamage(beginTrace(prevented), [spellDamage('prevented-red-spell', RED_BOLT, 0, 1)]);

    expect(done.state.players[1].life).toBe(20);
    expect(eventsOfType(done.events, 'replacementApplied').map((event) => event.id)).toEqual([
      doubler.id,
      'fire-shield',
    ]);
  });
});
