/** Exalted's retained attacker is a referent, never a painted target. */
import { describe, expect, it } from 'vitest';
import { exaltedAbility, parseCard, type Card } from '@mtg/dsl';
import { reduce, scenario } from '@mtg/kernel';
import { boardPosition } from '../../src/routes/play/position';

function creature(id: string, name: string, abilities: Card['abilities'] = []): Card {
  return parseCard({
    kind: 'creature',
    id,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: Number(id.slice(-1)) },
    manaCost: { generic: 1 },
    power: 2,
    toughness: 2,
    abilities,
  });
}

describe('exalted on the live table', () => {
  it('draws neither an arrow nor a reticle for its retained attacker', () => {
    const attacker = creature('live-exalted-1', 'Lone Attacker');
    const source = creature('live-exalted-2', 'Exalted Source', [exaltedAbility()]);
    const start = scenario({
      battlefield: [
        { card: attacker, controller: 0 },
        { card: source, controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attackerOid = start.battlefield.find((oid) => start.objects[oid]?.card.id === attacker.id);
    if (attackerOid === undefined) throw new Error('missing attacker');
    const declared = reduce(start, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attackerOid, defender: 1 }],
    }).state;

    const position = boardPosition(declared, 0, ['You', 'Bot']);
    expect(position.stack.entries).toHaveLength(1);
    expect(position.stack.entries[0]?.targetLabel).toBeUndefined();
    expect(position.stack.entries[0]?.onBoard).toBeUndefined();
    const attackerView = position.you.battlefield.permanents.find(
      (permanent) => permanent.key === attackerOid,
    );
    expect(attackerView?.targetedBy).toBeUndefined();
  });
});
