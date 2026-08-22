/**
 * What the three back-reference targeting modes export as.
 *
 * This is the one place in the transpiler where the mapping was not invented:
 * Forge's own card corpus already spells both referents, and the DSL kinds
 * were named after what it needed rather than the other way around.
 * `Defined$ Targeted` — the sub-ability reads the parent ability's target
 * instead of choosing its own — appears on 1,188 lines across 1,025 cards, and
 * `Defined$ TargetedController` on 175 lines across 167 cards. Stabbing Pain
 * (M11) is `DB$ Tap | Defined$ Targeted` hung off a `Pump` with `ValidTgts$
 * Creature`; Chandra's Outrage (M11) is `DB$ DealDamage | Defined$
 * TargetedController` hung off a `DealDamage` with the same; Sign in Blood
 * (M11, M13) is `DB$ LoseLife | Defined$ Targeted` hung off a `Draw` with
 * `ValidTgts$ Player`.
 *
 * That parent/sub-ability chain is exactly the shape `card-script.ts` already
 * emits for a multi-effect spell — effect 0 becomes the `A:` line and the rest
 * become `SVar:DBEffectN` links — so the referent needs no new structure, only
 * the `Defined$` clause in place of a `ValidTgts$` one. A referent that
 * emitted `ValidTgts$` would export a card Forge lets the caster re-aim, which
 * is the very bug these kinds exist to close on our own kernel.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { legalTargetsFor, parseCard } from '@mtg/dsl';
import { FORGE_EFFECTS } from '../src/effect-script';
import { mustTranspile, slugId } from './helpers';

function spellCard(name: string, input: Partial<CardInput>): Card {
  return parseCard({
    kind: 'instant',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, R: 2 },
    colors: ['R'],
    effects: [],
    ...input,
  } as CardInput);
}

describe('a spell that damages a creature and then its controller', () => {
  const script = mustTranspile(
    spellCard('Probe Strike', {
      effects: [
        { kind: 'dealDamage', amount: 4, target: { kind: 'targetCreature' } },
        { kind: 'dealDamage', amount: 2, target: { kind: 'thatCreaturesController' } },
      ],
    }),
  );

  it("derives the player with Defined$ TargetedController, Chandra's Outrage's own clause", () => {
    expect(script).toContain('SVar:DBEffect1:DB$ DealDamage | Defined$ TargetedController | NumDmg$ 2');
  });

  it('leaves the one real target on the parent ability, where Forge makes the choice', () => {
    expect(script).toContain('A:SP$ DealDamage | ValidTgts$ Creature | NumDmg$ 4');
    expect(script.match(/ValidTgts\$/g)?.length).toBe(1);
  });
});

describe('a spell that shrinks a creature and then taps that creature', () => {
  const script = mustTranspile(
    spellCard('Probe Pain', {
      manaCost: { B: 1 },
      colors: ['B'],
      effects: [
        { kind: 'pumpUntilEndOfTurn', power: -1, toughness: -1, target: { kind: 'targetCreature' } },
        { kind: 'tapPermanent', target: { kind: 'thatCreature' } },
      ],
    }),
  );

  it("reuses the chosen object with Defined$ Targeted, Stabbing Pain's own clause", () => {
    expect(script).toContain('SVar:DBEffect1:DB$ Tap | Defined$ Targeted');
  });

  it('taps what the pump shrank rather than offering a second creature', () => {
    expect(script).toContain('A:SP$ Pump | ValidTgts$ Creature | NumAtt$ -1 | NumDef$ -1');
    expect(script.match(/ValidTgts\$/g)?.length).toBe(1);
  });
});

describe('a spell that makes a player draw and then lose life', () => {
  const script = mustTranspile(
    parseCard({
      kind: 'sorcery',
      id: slugId('Probe Bargain'),
      name: 'Probe Bargain',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { B: 2 },
      colors: ['B'],
      effects: [
        { kind: 'drawCards', count: 2, target: { kind: 'targetPlayer' } },
        { kind: 'loseLife', amount: 2, target: { kind: 'thatPlayer' } },
      ],
    } as CardInput),
  );

  it("charges the same player with Defined$ Targeted, Sign in Blood's own clause", () => {
    expect(script).toContain('SVar:DBEffect1:DB$ LoseLife | Defined$ Targeted | LifeAmount$ 2');
  });

  it('shows that the player referent needs no clause of its own', () => {
    // `thatPlayer` and `thatCreature` both export as `Defined$ Targeted`
    // because Forge's clause names the parent's target without saying what
    // kind of object it is. Only the *derived* referent needs a second
    // spelling, which is why the DSL has three kinds and Forge has two words.
    expect(script).toContain('A:SP$ Draw | ValidTgts$ Player | NumCards$ 2');
    expect(script.match(/ValidTgts\$/g)?.length).toBe(1);
  });
});

/**
 * `conformance.test.ts` compares `FORGE_EFFECTS[..].targets` against
 * `legalTargetsFor` unconditionally, so a referent hand-authored onto a DSL
 * effect row must appear in Forge's row for the same effect or the drift alarm
 * fires. Asserting it here as well names the three rows the alarm would
 * otherwise report as an anonymous mismatch.
 */
describe('the two legality tables, which must agree about these kinds', () => {
  it('lists each referent on the effect row that hand-authors it', () => {
    expect([...FORGE_EFFECTS.dealDamage.targets]).toContain('thatCreaturesController');
    expect([...legalTargetsFor('dealDamage')]).toContain('thatCreaturesController');
    expect([...FORGE_EFFECTS.tapPermanent.targets]).toContain('thatCreature');
    expect([...legalTargetsFor('tapPermanent')]).toContain('thatCreature');
    expect([...FORGE_EFFECTS.loseLife.targets]).toContain('thatPlayer');
    expect([...legalTargetsFor('loseLife')]).toContain('thatPlayer');
  });
});
