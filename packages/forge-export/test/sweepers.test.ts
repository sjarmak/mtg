/**
 * What the four sweepers export as, and the one parameter that decides whether
 * the Forge card is the DSL card.
 *
 * Forge splits acting on one object from acting on a group into two API names
 * (`Destroy`/`DestroyAll`, `Tap`/`TapAll`, and so on), and the DSL folds both
 * into one primitive plus a scope word, so the scope is what picks the API. The
 * group itself is named by an unqualified `ValidCards$ Creature` beside the
 * ability's own `ValidTgts$`, which is the arrangement 2.0.14's
 * `res/cardsfolder` uses on the four cards whose printed text is verbatim what
 * these four print:
 *
 *   Mogg Infestation   SP$ DestroyAll | ValidTgts$ Player | ValidCards$ Creature
 *   Arms of Hadar      SP$ PumpAll    | ValidTgts$ Player | ValidCards$ Creature | NumAtt$ -2 | NumDef$ -2
 *   Dawnglare Invoker  AB$ TapAll     | ValidTgts$ Player | ValidCards$ Creature
 *   Aggravate          SP$ DamageAll  | ValidTgts$ Player | ValidCards$ Creature | NumDmg$ 1
 *
 * The qualified spelling `Creature.TargetedPlayerCtrl` is a real property and
 * the wrong one here: it is for a sub-ability reading a target some *earlier*
 * ability in the chain chose, and this transpiler gives every effect its own
 * target slot. That was the guess this file's mapping carried before, and the
 * corpus settles it the other way.
 *
 * Everything here is read off `res/cardsfolder` rather than off a booted Forge,
 * which is the standing limit on the whole package (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, EffectInput } from '@mtg/dsl';
import { mustTranspile, spell } from './helpers';

function abilityLine(card: Card): string {
  const line = mustTranspile(card)
    .split('\n')
    .find((text) => text.startsWith('A:'));
  if (line === undefined) throw new Error('no A: line');
  return line;
}

function lineFor(name: string, effect: EffectInput): string {
  return abilityLine(spell(name, [effect]));
}

const SWEEP = 'creaturesThatPlayerControls' as const;

describe('a scoped effect on the four priced primitives', () => {
  it('destroys a group with DestroyAll and one creature with Destroy', () => {
    const sweep = lineFor('Calamity Below', {
      kind: 'destroyPermanent',
      scope: SWEEP,
      target: { kind: 'targetPlayer' },
    });
    expect(sweep).toContain('SP$ DestroyAll');
    expect(sweep).toContain('ValidTgts$ Player');
    expect(sweep).toContain('ValidCards$ Creature');

    const single = lineFor('Single Below', {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature' },
    });
    expect(single).toContain('SP$ Destroy');
    expect(single).not.toContain('DestroyAll');
    expect(single).not.toContain('ValidCards$');
  });

  it('taps a group with TapAll and one creature with Tap', () => {
    const sweep = lineFor('Slack Tide', {
      kind: 'tapPermanent',
      scope: SWEEP,
      target: { kind: 'targetOpponent' },
    });
    expect(sweep).toContain('SP$ TapAll');
    expect(sweep).toContain('ValidTgts$ Player.Opponent');
    expect(sweep).toContain('ValidCards$ Creature');

    expect(lineFor('Single Tide', { kind: 'tapPermanent', target: { kind: 'targetCreature' } })).toContain(
      'SP$ Tap |',
    );
  });

  /** The deltas ride along unchanged; only the API and the selector move. */
  it('pumps a group with PumpAll and keeps both deltas', () => {
    const sweep = lineFor('Rally the Vale', {
      kind: 'pumpUntilEndOfTurn',
      power: 2,
      toughness: 2,
      scope: SWEEP,
      target: { kind: 'targetPlayer' },
    });
    expect(sweep).toContain('SP$ PumpAll');
    expect(sweep).toContain('ValidCards$ Creature');
    expect(sweep).toContain('NumAtt$ +2');
    expect(sweep).toContain('NumDef$ +2');
  });

  /**
   * The parameter that would make the Forge card a different card. Aggravate's
   * own line carries `ValidPlayers$ Targeted` on the sweeps that burn the
   * player as well as their board; the DSL scope reads "each creature that
   * player controls" and stops there, and the kernel deals the targeted player
   * no damage at all. Emitting the key would be a Forge card that hits for
   * damage the kernel never deals.
   */
  it('damages a group with DamageAll and leaves the targeted player out of it', () => {
    const sweep = lineFor('Ember Rain', {
      kind: 'dealDamage',
      amount: 2,
      scope: SWEEP,
      target: { kind: 'targetOpponent' },
    });
    expect(sweep).toContain('SP$ DamageAll');
    expect(sweep).toContain('ValidCards$ Creature');
    expect(sweep).toContain('NumDmg$ 2');
    expect(sweep).not.toContain('ValidPlayers$');

    const single = lineFor('Single Ember', {
      kind: 'dealDamage',
      amount: 2,
      target: { kind: 'targetCreature' },
    });
    expect(single).toContain('SP$ DealDamage');
    expect(single).toContain('NumDmg$ 2');
    expect(single).not.toContain('ValidCards$');
  });

  /**
   * The selector carries no controller qualifier, on any scoped primitive.
   * `putCounters` and `exileTarget` were writing the qualified spelling before
   * the corpus was read, so they are asserted here beside the four that were
   * added after it.
   */
  it('names the group without a controller qualifier, on every scoped primitive', () => {
    const counters = lineFor('Gloomfall', {
      kind: 'putCounters',
      counter: 'gloom',
      count: 1,
      scope: SWEEP,
      target: { kind: 'targetOpponent' },
    });
    expect(counters).toContain('SP$ PutCounterAll');
    expect(counters).toContain('ValidCards$ Creature |');
    expect(counters).not.toContain('TargetedPlayerCtrl');

    const exile = lineFor('Void Reckoning', {
      kind: 'exileTarget',
      scope: SWEEP,
      target: { kind: 'targetOpponent' },
    });
    expect(exile).toContain('SP$ ChangeZoneAll');
    expect(exile).toContain('ChangeType$ Creature |');
    expect(exile).toContain('Origin$ Battlefield');
    expect(exile).toContain('Destination$ Exile');
    expect(exile).not.toContain('TargetedPlayerCtrl');
  });
});
