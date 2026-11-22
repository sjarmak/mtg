/** Avenging Arrow reads source-incarnation damage history from the current turn. */
import { parseCard } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  eventsOfType,
  moveObject,
  reduce,
  resolveTop,
  scenario,
  targetChoicesFor,
  type DamageRecipient,
  type DamageInstance,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { beginTurn } from '../src/turn';
import { creature, lands, PLAINS, planeswalker } from './cards';
import { damageToPlayer, replacement, withReplacements } from './continuous-helpers';
import { handOidOf, oidOf } from './helpers';

const AVENGING_ARROW = parseCard({
  kind: 'instant',
  id: 'rtr-4-avenging-arrow-kernel',
  name: 'Avenging Arrow',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 4 },
  colors: ['W'],
  manaCost: { generic: 2, W: 1 },
  effects: [
    {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', filter: { dealtDamageThisTurn: true } },
    },
  ],
});

const SOURCE = creature('Avenging Arrow Damage Source', 2, 3);
const CONTROL = creature('Avenging Arrow Untouched Control', 2, 3);
const WALKER = planeswalker('Avenging Arrow Walker', 5, []);
const BATTLE = parseCard({
  kind: 'battle',
  id: 'rtr-avenging-arrow-battle',
  name: 'Avenging Arrow Battle',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 404 },
  manaCost: { generic: 3 },
  colors: [],
  defense: 5,
});

function opening(): GameState {
  return scenario({
    battlefield: [
      ...lands(PLAINS, 3).map((card) => ({ card, controller: 0 as const })),
      { card: SOURCE, controller: 1 },
      { card: CONTROL, controller: 1 },
      { card: WALKER, controller: 0 },
      { card: BATTLE, controller: 0 },
    ],
    hands: [[AVENGING_ARROW], []],
  }).state;
}

function damage(
  sourceOid: ObjectId,
  amount = 1,
  recipient: DamageRecipient = { kind: 'player', player: 0 },
  combat = false,
  sourceIncarnation = 0,
): DamageInstance {
  return {
    sourceOid,
    sourceIncarnation,
    controller: 1,
    recipient,
    amount,
    deathtouch: false,
    lifelink: false,
    combat,
    preventable: true,
  };
}

function choices(state: GameState): readonly ObjectId[] {
  const spell = handOidOf(state, 0, AVENGING_ARROW.name);
  return (targetChoicesFor(state, AVENGING_ARROW, 0, spell)[0] ?? []).flatMap((target) =>
    target?.kind === 'permanent' ? [target.oid] : [],
  );
}

describe('Avenging Arrow damage-history targeting', () => {
  it('offers only a creature that actually dealt nonzero damage this turn', () => {
    const start = opening();
    const source = oidOf(start, SOURCE.name);
    const control = oidOf(start, CONTROL.name);
    const zero = applyDamage(beginTrace(start), [damage(control, 0)]);
    const dealt = applyDamage(zero, [damage(source)]);

    expect(choices(dealt.state)).toEqual([source]);
  });

  it('normalizes a legacy damage record that predates source incarnations', () => {
    const start = opening();
    const source = oidOf(start, SOURCE.name);
    const { sourceIncarnation: _legacyField, ...legacy } = damage(source);
    const dealt = applyDamage(beginTrace(start), [legacy]);

    expect(choices(dealt.state)).toEqual([source]);
  });

  it('records combat and noncombat damage to every supported recipient kind', () => {
    const start = opening();
    const source = oidOf(start, SOURCE.name);
    const recipients: readonly DamageRecipient[] = [
      { kind: 'player', player: 0 },
      { kind: 'permanent', oid: oidOf(start, CONTROL.name) },
      { kind: 'permanent', oid: oidOf(start, WALKER.name) },
      { kind: 'permanent', oid: oidOf(start, BATTLE.name) },
    ];

    for (const [index, recipient] of recipients.entries()) {
      const dealt = applyDamage(beginTrace(start), [damage(source, 1, recipient, index % 2 === 0)]);
      expect(choices(dealt.state)).toEqual([source]);
    }
  });

  it('does not record fully prevented damage', () => {
    const start = opening();
    const source = oidOf(start, SOURCE.name);
    const shielded = withReplacements(start, [
      replacement(damageToPlayer(0), { kind: 'preventDamage', amount: 'all' }),
    ]);
    const prevented = applyDamage(beginTrace(shielded), [damage(source)]);

    expect(choices(prevented.state)).toEqual([]);
    expect(eventsOfType(prevented.events, 'damagePrevented')).toHaveLength(1);
  });

  it('does not transfer qualification to a new incarnation and clears it next turn', () => {
    const start = opening();
    const source = oidOf(start, SOURCE.name);
    const dealt = applyDamage(beginTrace(start), [damage(source)]);
    const departed = moveObject(dealt, source, 'exile');
    const returned = moveObject(departed, source, 'battlefield', { controller: 1 });

    expect(choices(returned.state)).toEqual([]);

    const nextTurn = beginTurn(beginTrace(dealt.state), 1);
    expect(choices(nextTurn.state)).toEqual([]);
  });

  it('does not credit delayed damage from an earlier incarnation to the returned creature', () => {
    const start = opening();
    const source = oidOf(start, SOURCE.name);
    const oldIncarnation = start.objects[source]?.incarnation ?? 0;
    const departed = moveObject(beginTrace(start), source, 'exile');
    const returned = moveObject(departed, source, 'battlefield', { controller: 1 });
    const dealt = applyDamage(returned, [damage(source, 1, undefined, false, oldIncarnation)]);

    expect(choices(dealt.state)).toEqual([]);
  });

  it('rechecks the qualifying incarnation at resolution', () => {
    const start = opening();
    const source = oidOf(start, SOURCE.name);
    const dealt = applyDamage(beginTrace(start), [damage(source)]);
    const cast = reduce(dealt.state, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(dealt.state, 0, AVENGING_ARROW.name),
      targets: [{ kind: 'permanent', oid: source }],
    });
    const departed = moveObject(beginTrace(cast.state), source, 'exile');
    const returned = moveObject(departed, source, 'battlefield', { controller: 1 });
    const resolved = resolveTop(returned);

    expect(resolved.state.objects[source]?.zone).toBe('battlefield');
    expect(eventsOfType(resolved.events, 'spellFizzled')).toHaveLength(1);
  });
});
