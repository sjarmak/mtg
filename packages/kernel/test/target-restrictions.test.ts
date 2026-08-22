/**
 * A restriction printed on a target slot, enforced at the two moments CR asks:
 * when the targets are chosen (CR 601.2c, here `targetChoicesForEffects`), and
 * again as the spell resolves (CR 608.2b, here `isTargetStillLegal`).
 *
 * Both readings go through the layer system rather than the printed card, so a
 * creature that is 2/2 on cardboard and 5/5 on the battlefield is judged at 5.
 * The DSL half — that the restriction prints, and is refused on a slot with
 * nothing to narrow — is `packages/dsl/test/target-restrictions.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '@mtg/dsl';
import type { Target } from '@mtg/kernel';
import { onlyObject, satisfiesTargetRestriction, scenario, targetChoicesForEffects } from '@mtg/kernel';
import { isTargetStillLegal } from '../src/effects';
import { pump, withContinuous, withCounters } from './continuous-helpers';
import { creature } from './cards';

const SMITE: Effect = {
  kind: 'destroyPermanent',
  target: { kind: 'targetCreature', restriction: { kind: 'maxPower', power: 3 } },
};

/** A 2/2 and a 4/4 the opponent controls, and a tapped 1/1 this seat controls. */
function board() {
  const start = scenario({
    battlefield: [
      { card: creature('Ashen Rook', 2, 2), controller: 1 },
      { card: creature('Stone Colossus', 4, 4), controller: 1 },
      { card: creature('Weary Sentry', 1, 1, { keywords: ['flying'] }), controller: 0, tapped: true },
    ],
  });
  const [small, big, mine] = start.state.battlefield;
  if (small === undefined || big === undefined || mine === undefined) throw new Error('board is short');
  return { state: start.state, small, big, mine };
}

function oids(choices: readonly (readonly (Target | null)[])[]): readonly string[] {
  return (choices[0] ?? [])
    .filter((target): target is Extract<Target, { kind: 'permanent' }> => target?.kind === 'permanent')
    .map((target) => target.oid);
}

describe('choosing a target the restriction admits (CR 601.2c)', () => {
  it('omits the creature over the power bound, and keeps the one under it', () => {
    const { state, small, big, mine } = board();
    const offered = oids(targetChoicesForEffects(state, [SMITE], 0));
    expect(offered).toContain(small);
    expect(offered).toContain(mine);
    expect(offered).not.toContain(big);
  });

  it('offers every creature when the same slot prints no restriction', () => {
    const { state, small, big, mine } = board();
    const offered = oids(
      targetChoicesForEffects(state, [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], 0),
    );
    expect(offered).toEqual(expect.arrayContaining([small, big, mine]));
  });

  it('narrows on a state rather than a stat, and on a keyword', () => {
    const { state, small, mine } = board();
    const tappedOnly = oids(
      targetChoicesForEffects(
        state,
        [{ kind: 'destroyPermanent', target: { kind: 'targetCreature', restriction: { kind: 'tapped' } } }],
        0,
      ),
    );
    expect(tappedOnly).toEqual([mine]);

    const flyersOnly = oids(
      targetChoicesForEffects(
        state,
        [
          {
            kind: 'destroyPermanent',
            target: { kind: 'targetCreature', restriction: { kind: 'withKeyword', keyword: 'flying' } },
          },
        ],
        0,
      ),
    );
    expect(flyersOnly).toEqual([mine]);
    expect(flyersOnly).not.toContain(small);
  });

  it('narrows on a counter the permanent carries', () => {
    const { state, small, big, mine } = board();
    const gloomed = withCounters(state, big, 'gloom', 1);
    const offered = oids(
      targetChoicesForEffects(
        gloomed,
        [
          {
            kind: 'destroyPermanent',
            target: { kind: 'targetCreature', restriction: { kind: 'withCounter', counter: 'gloom' } },
          },
        ],
        0,
      ),
    );
    expect(offered).toEqual([big]);
    expect(offered).not.toContain(small);
    expect(offered).not.toContain(mine);
  });

  it('reads the counter rather than the stat line it produces', () => {
    // A gloom counter is -1/-1, so a 4/4 carrying one is a 3/3. A power bound
    // and a counter clause therefore answer differently about the same board,
    // which is the whole reason `withCounter` is not spelled as `maxPower`.
    const { state, small, big } = board();
    const gloomed = withCounters(state, big, 'gloom', 1);
    expect(satisfiesTargetRestriction(gloomed, big, { kind: 'withCounter', counter: 'gloom' })).toBe(true);
    expect(satisfiesTargetRestriction(gloomed, big, { kind: 'maxPower', power: 3 })).toBe(true);
    expect(satisfiesTargetRestriction(gloomed, small, { kind: 'withCounter', counter: 'gloom' })).toBe(false);
    expect(satisfiesTargetRestriction(gloomed, small, { kind: 'maxPower', power: 3 })).toBe(true);
  });
});

describe('rechecking on resolution (CR 608.2b)', () => {
  it('holds when the creature is still inside the bound', () => {
    const { state, small } = board();
    const targets: readonly Target[] = [{ kind: 'permanent', oid: small }];
    expect(isTargetStillLegal(state, SMITE, targets, 0, 0)).toBe(true);
  });

  it('fails once the creature has grown past it', () => {
    const { state, small } = board();
    const targets: readonly Target[] = [{ kind: 'permanent', oid: small }];
    const grown = withContinuous(state, [pump(onlyObject(small), 3, 3)]);

    // Non-vacuity: the pump is what moved the answer, and it moved it through
    // the layer system rather than the printed 2/2 on the card.
    expect(satisfiesTargetRestriction(state, small, { kind: 'maxPower', power: 3 })).toBe(true);
    expect(satisfiesTargetRestriction(grown, small, { kind: 'maxPower', power: 3 })).toBe(false);
    expect(isTargetStillLegal(grown, SMITE, targets, 0, 0)).toBe(false);
  });

  it('fizzles once the counter it named has left', () => {
    const { state, big } = board();
    const gloomed = withCounters(state, big, 'gloom', 1);
    const smother: Effect = {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', restriction: { kind: 'withCounter', counter: 'gloom' } },
    };
    const targets: readonly Target[] = [{ kind: 'permanent', oid: big }];

    expect(isTargetStillLegal(gloomed, smother, targets, 0, 0)).toBe(true);
    // The counter came off between cast and resolution; `state` is that board.
    expect(isTargetStillLegal(state, smother, targets, 0, 0)).toBe(false);
  });

  it('reads a keyword granted on the battlefield, not the one printed', () => {
    const { state, small } = board();
    expect(satisfiesTargetRestriction(state, small, { kind: 'withKeyword', keyword: 'flying' })).toBe(false);
    expect(satisfiesTargetRestriction(state, small, { kind: 'withoutKeyword', keyword: 'flying' })).toBe(
      true,
    );
  });
});
