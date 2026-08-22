/**
 * A target slot that names fewer creatures than its kind allows.
 *
 * The restriction is a field on `TargetSpec` beside `distinct` rather than six
 * new target kinds, so the two questions to ask of it here are the two a field
 * has to answer: does it print, and is it refused where it has nothing to
 * narrow. Whether it is *enforced* is the kernel's question and lives in
 * `packages/kernel/test/target-restrictions.test.ts`; a printed condition
 * nothing checks is the failure this pair of files exists to prevent.
 */
import { describe, expect, it } from 'vitest';
import type { Card, TargetSpec } from '../src/index';
import { CardSchema, mana, renderOracleText, validateCard, withRenderedOracleText } from '../src/index';

function sorcery(target: TargetSpec): Card {
  return withRenderedOracleText(
    CardSchema.parse({
      id: 'tst-spell',
      name: 'Test Spell',
      set: { code: 'TST', collectorNumber: 1 },
      kind: 'sorcery',
      rarity: 'common',
      colors: ['B'],
      manaCost: mana({ generic: 1, B: 1 }),
      effects: [{ kind: 'destroyPermanent', target }],
      oracleText: '',
    } satisfies unknown),
  );
}

function textOf(card: Card): string {
  return renderOracleText(card);
}

describe('a restricted target slot', () => {
  it('prints a power bound as a clause behind the noun', () => {
    expect(textOf(sorcery({ kind: 'targetCreature', restriction: { kind: 'maxPower', power: 3 } }))).toBe(
      'Destroy target creature with power 3 or less.',
    );
    expect(textOf(sorcery({ kind: 'targetCreature', restriction: { kind: 'minPower', power: 4 } }))).toBe(
      'Destroy target creature with power 4 or greater.',
    );
  });

  it('prints a state as an adjective in front of the noun', () => {
    expect(textOf(sorcery({ kind: 'targetCreature', restriction: { kind: 'tapped' } }))).toBe(
      'Destroy target tapped creature.',
    );
    expect(textOf(sorcery({ kind: 'targetCreature', restriction: { kind: 'untapped' } }))).toBe(
      'Destroy target untapped creature.',
    );
  });

  it('prints a keyword clause, and its negation', () => {
    expect(
      textOf(sorcery({ kind: 'targetCreature', restriction: { kind: 'withKeyword', keyword: 'flying' } })),
    ).toBe('Destroy target creature with flying.');
    expect(
      textOf(
        sorcery({ kind: 'targetCreature', restriction: { kind: 'withoutKeyword', keyword: 'firstStrike' } }),
      ),
    ).toBe('Destroy target creature without first strike.');
  });

  it('prints a counter as something the creature carries, not as a bare noun', () => {
    expect(
      textOf(sorcery({ kind: 'targetCreature', restriction: { kind: 'withCounter', counter: 'gloom' } })),
    ).toBe('Destroy target creature with a gloom counter on it.');
  });

  it('puts the clause behind "you control", where English puts it', () => {
    expect(
      textOf(sorcery({ kind: 'targetCreatureYouControl', restriction: { kind: 'maxPower', power: 2 } })),
    ).toBe('Destroy target creature you control with power 2 or less.');
    expect(
      textOf(
        sorcery({
          kind: 'targetCreatureYouControl',
          restriction: { kind: 'withCounter', counter: 'plusOnePlusOne' },
        }),
      ),
    ).toBe('Destroy target creature you control with a +1/+1 counter on it.');
  });

  it('keeps the adjective inside "another target", not in front of it', () => {
    expect(textOf(sorcery({ kind: 'targetCreature', distinct: true, restriction: { kind: 'tapped' } }))).toBe(
      'Destroy another target tapped creature.',
    );
  });

  it('leaves an unrestricted slot printing exactly what it printed before', () => {
    expect(textOf(sorcery({ kind: 'targetCreature' }))).toBe('Destroy target creature.');
  });
});

describe('where a restriction may be named', () => {
  it('refuses a slot that names a player, which has no power to bound', () => {
    // `dealDamage` legally names a player, so the only thing wrong with this
    // card is the restriction; on `destroyPermanent` the kind itself is
    // illegal and the earlier check would answer first.
    const card = withRenderedOracleText(
      CardSchema.parse({
        id: 'tst-bolt',
        name: 'Test Bolt',
        set: { code: 'TST', collectorNumber: 2 },
        kind: 'sorcery',
        rarity: 'common',
        colors: ['R'],
        manaCost: mana({ R: 1 }),
        effects: [
          {
            kind: 'dealDamage',
            amount: 3,
            target: { kind: 'targetPlayer', restriction: { kind: 'maxPower', power: 3 } },
          },
        ],
        oracleText: '',
      }),
    );
    const codes = validateCard(card).map((violation) => violation.code);
    expect(codes).toContain('ILLEGAL_TARGET_RESTRICTION');
  });

  it('refuses a counter clause on a slot that names a player, which carries none', () => {
    const card = withRenderedOracleText(
      CardSchema.parse({
        id: 'tst-drain',
        name: 'Test Drain',
        set: { code: 'TST', collectorNumber: 3 },
        kind: 'sorcery',
        rarity: 'common',
        colors: ['B'],
        manaCost: mana({ B: 1 }),
        effects: [
          {
            kind: 'dealDamage',
            amount: 2,
            target: { kind: 'targetPlayer', restriction: { kind: 'withCounter', counter: 'gloom' } },
          },
        ],
        oracleText: '',
      }),
    );
    const codes = validateCard(card).map((violation) => violation.code);
    expect(codes).toContain('ILLEGAL_TARGET_RESTRICTION');
  });

  it('accepts a counter clause on a creature slot, which is a real narrowing', () => {
    expect(
      validateCard(
        sorcery({ kind: 'targetCreature', restriction: { kind: 'withCounter', counter: 'gloom' } }),
      ),
    ).toEqual([]);
  });

  it('refuses a power of 0 on minPower, because that is every creature', () => {
    expect(() => sorcery({ kind: 'targetCreature', restriction: { kind: 'minPower', power: 0 } })).toThrow();
  });

  it('accepts a power of 0 on maxPower, because that is a real narrowing', () => {
    expect(
      validateCard(sorcery({ kind: 'targetCreature', restriction: { kind: 'maxPower', power: 0 } })),
    ).toEqual([]);
  });
});
