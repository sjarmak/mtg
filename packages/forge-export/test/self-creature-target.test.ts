/**
 * What the second retained referent exports as.
 *
 * `selfCreature` (`packages/dsl/src/targets.ts`) names an ability's own
 * source — CR 115.6a, "this creature" — and Forge spells that as
 * `Defined$ Self` rather than a `ValidTgts$` clause, the same escape from
 * real targeting that `triggering-creature.test.ts` documents for
 * `triggeringCreature`. The two kinds diverge on one point that test's
 * "two legality tables" describe block calls out: `triggeringCreature`'s
 * legality is a property of the enclosing trigger, so it is kept out of both
 * `FORGE_EFFECTS[..].targets` and `legalTargetsFor`; `selfCreature`'s
 * legality is hand-authored directly onto `pumpUntilEndOfTurn`
 * (`dsl/src/validate/effects.ts`), so it belongs in both tables and
 * `conformance.test.ts`'s drift alarm enforces that they agree.
 *
 * `Self` needs no enclosing trigger to have a referent — it is the object
 * whose card script is running, on an activated ability exactly as much as a
 * triggered one — so both ability kinds are asserted here, the same split
 * the DSL- and kernel-level `selfCreature` suites already drive.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { legalTargetsFor, parseCard } from '@mtg/dsl';
import { FORGE_EFFECTS } from '../src/effect-script';
import { mustTranspile, slugId } from './helpers';

/** "{R}: This creature gets +1/+0 until end of turn." — Fiery Hellhound (M11). */
function activatedSelfPump(name: string): Card {
  return parseCard({
    kind: 'creature',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['R'],
    power: 2,
    toughness: 1,
    manaCost: { generic: 0, W: 0, U: 0, B: 0, R: 1, G: 0 },
    keywords: [],
    effects: [],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { R: 1 }, tapSelf: false },
        effects: [
          {
            kind: 'pumpUntilEndOfTurn',
            power: 1,
            toughness: 0,
            target: { kind: 'selfCreature' },
          },
        ],
      },
    ],
  });
}

/** "Whenever CARDNAME attacks, this creature gets +1/+1 until end of turn." — Griffin Protector's shape (M13). */
function triggeredSelfPump(name: string): Card {
  return parseCard({
    kind: 'creature',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 2 },
    colors: ['W'],
    power: 2,
    toughness: 2,
    manaCost: { generic: 3, W: 1, U: 0, B: 0, R: 0, G: 0 },
    keywords: [],
    effects: [],
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfAttacks',
        effects: [
          {
            kind: 'pumpUntilEndOfTurn',
            power: 1,
            toughness: 1,
            target: { kind: 'selfCreature' },
          },
        ],
      },
    ],
  });
}

describe('an activated ability that pumps its own source', () => {
  const script = mustTranspile(activatedSelfPump('Probe Hellhound'));

  it('names the source with Defined$ Self, not a ValidTgts clause', () => {
    expect(script).toContain('Defined$ Self');
    expect(script).not.toContain('ValidTgts$');
  });

  it('still writes the activation cost as an ability line', () => {
    expect(script).toContain('A:AB$ Pump');
    expect(script).toContain('Cost$ R');
  });
});

describe('a triggered ability that pumps its own source', () => {
  const script = mustTranspile(triggeredSelfPump('Probe Griffin'));

  it('names the source with Defined$ Self, not a ValidTgts clause', () => {
    expect(script).toContain('Defined$ Self');
    expect(script).not.toContain('ValidTgts$');
  });

  it('hangs it off the Attacks trigger the mapping table writes', () => {
    expect(script).toContain('Mode$ Attacks');
    expect(script).toContain('ValidCard$ Card.Self');
  });
});

/**
 * The opposite relationship from `triggeringCreature`'s. That kind is kept
 * out of both legality tables because a retained event referent is not a
 * property of the effect it feeds; `selfCreature` is hand-authored directly
 * onto `pumpUntilEndOfTurn` in the DSL, so Forge's row for that effect must
 * list it too, or `conformance.test.ts`'s unconditional parity check between
 * `FORGE_EFFECTS[..].targets` and `legalTargetsFor` fails.
 */
describe('the two legality tables, which must agree about this kind', () => {
  it('lists the retained referent on the one effect row that hand-authors it', () => {
    expect([...FORGE_EFFECTS.pumpUntilEndOfTurn.targets]).toContain('selfCreature');
    expect([...legalTargetsFor('pumpUntilEndOfTurn')]).toContain('selfCreature');
  });
});
