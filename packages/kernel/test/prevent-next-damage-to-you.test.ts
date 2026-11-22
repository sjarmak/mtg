/** Numeric controller shields through the shared replacement pipeline. */
import { describe, expect, it } from 'vitest';
import { applyDamage, beginTrace, cleanupTurnEffects, scenario, type DamageInstance } from '@mtg/kernel';
import { artifact, creature } from './cards';
import { apply, oidOf } from './helpers';

const SHIELD = artifact('Fixed Shield Source', {}, [
  {
    kind: 'activated',
    cost: { mana: {}, tapSelf: true },
    effects: [
      {
        kind: 'preventNextDamageToYouAndRetaliate',
        amount: 1,
        target: { kind: 'noTarget' },
      },
    ],
  },
]);
const SOURCE = creature('Fixed Shield Damage Source', 2, 2);

function resolved() {
  const start = scenario({
    battlefield: [
      { card: SHIELD, controller: 0 },
      { card: SOURCE, controller: 1 },
    ],
  });
  const activated = apply(start, {
    type: 'activateAbility',
    player: 0,
    oid: oidOf(start.state, SHIELD.name),
    abilityIndex: 0,
    targets: [null],
    sacrifices: [],
  });
  return apply(apply(activated, { type: 'passPriority', player: 0 }), {
    type: 'passPriority',
    player: 1,
  });
}

function damage(state: ReturnType<typeof resolved>['state'], player: 0 | 1, amount: number): DamageInstance {
  return {
    sourceOid: oidOf(state, SOURCE.name),
    controller: 1,
    recipient: { kind: 'player', player },
    amount,
    deathtouch: false,
    lifelink: false,
    combat: false,
    preventable: true,
  };
}

describe('plain controller shield', () => {
  it('prevents only one point for its controller and then depletes', () => {
    const shielded = resolved();
    const hit = applyDamage(beginTrace(shielded.state), [damage(shielded.state, 0, 3)]);
    expect(hit.state.players[0].life).toBe(18);
    expect(hit.state.replacements).toEqual([]);
  });

  it('does not protect the opponent and expires at cleanup', () => {
    const shielded = resolved();
    const opponentHit = applyDamage(beginTrace(shielded.state), [damage(shielded.state, 1, 2)]);
    expect(opponentHit.state.players[1].life).toBe(18);
    expect(opponentHit.state.replacements).toHaveLength(1);
    const expired = cleanupTurnEffects(beginTrace(opponentHit.state));
    expect(expired.state.replacements).toEqual([]);
    const later = applyDamage(beginTrace(expired.state), [damage(expired.state, 0, 2)]);
    expect(later.state.players[0].life).toBe(18);
  });
});
