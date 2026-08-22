/**
 * A restricted target slot as Forge writes it.
 *
 * The kind opens the selector and the restriction narrows the same clause, so
 * the two are one string: Forge says `Creature.YouCtrl+counters_GE1_P1P1` and
 * has no second parameter to put half of it in. Until `mtg-bc2.157` the
 * transpiler built `ValidTgts$` from the kind alone and dropped the restriction
 * on the floor, which exported a strictly more permissive card into the one
 * artifact whose job is to disagree with us when we are wrong.
 *
 * Two things are asserted here, and they fail for different reasons. Totality
 * is a compile-time claim wearing a test's clothes: `SAMPLES` is a
 * `Record<TargetRestrictionKind, TargetRestriction>`, so a new union member is
 * a build error in this file before it is a red assertion. The spellings are a
 * runtime claim, and every one of them is read off 2.0.14's own
 * `res/cardsfolder` rather than guessed (`vocabulary-map.ts` carries the count
 * of shipped cards writing each).
 *
 * Everything here is read off `res/cardsfolder` rather than off a booted Forge,
 * which is the standing limit on the whole package (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, EffectInput, TargetRestriction, TargetRestrictionKind, TargetSpec } from '@mtg/dsl';
import { forgeRestrictedTarget, forgeTargetRestriction, transpileEffect } from '@mtg/forge-export';
import { mustTranspile, spell } from './helpers';

const SAMPLES: Readonly<Record<TargetRestrictionKind, TargetRestriction>> = {
  maxPower: { kind: 'maxPower', power: 3 },
  minPower: { kind: 'minPower', power: 4 },
  tapped: { kind: 'tapped' },
  untapped: { kind: 'untapped' },
  withKeyword: { kind: 'withKeyword', keyword: 'flying' },
  withoutKeyword: { kind: 'withoutKeyword', keyword: 'flying' },
  withCounter: { kind: 'withCounter', counter: 'plusOnePlusOne' },
};

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

function smite(target: TargetSpec): EffectInput {
  return { kind: 'destroyPermanent', target };
}

describe('every restriction the DSL can print', () => {
  it('has a Forge qualifier', () => {
    for (const [kind, restriction] of Object.entries(SAMPLES)) {
      expect(forgeTargetRestriction(restriction), kind).not.toBeNull();
    }
  });

  it('spells each one the way the shipped cards spell it', () => {
    expect(forgeTargetRestriction(SAMPLES.maxPower)).toBe('powerLE3');
    expect(forgeTargetRestriction(SAMPLES.minPower)).toBe('powerGE4');
    expect(forgeTargetRestriction(SAMPLES.tapped)).toBe('tapped');
    expect(forgeTargetRestriction(SAMPLES.untapped)).toBe('untapped');
    expect(forgeTargetRestriction(SAMPLES.withKeyword)).toBe('withFlying');
    expect(forgeTargetRestriction(SAMPLES.withoutKeyword)).toBe('withoutFlying');
    expect(forgeTargetRestriction(SAMPLES.withCounter)).toBe('counters_GE1_P1P1');
  });

  /**
   * The keyword half comes from `FORGE_KEYWORDS`, which keeps the space Forge
   * writes, so the qualifier is two words and this table does not spell a
   * keyword a second time.
   */
  it('carries the space Forge puts inside a two-word keyword', () => {
    expect(forgeTargetRestriction({ kind: 'withKeyword', keyword: 'firstStrike' })).toBe('withFirst Strike');
    expect(forgeTargetRestriction({ kind: 'withoutKeyword', keyword: 'firstStrike' })).toBe(
      'withoutFirst Strike',
    );
  });

  /**
   * A gloom counter has no Forge name; `FORGE_COUNTER_TYPES` records that it
   * *means* an `M1M1` there. Reading is the wider side of that identity gap —
   * `counters_GE1_M1M1` admits a creature carrying a -1/-1 counter and no
   * gloom counter — and the export is deliberately the superset, because a
   * Forge card legal on a superset makes the parity oracle say so out loud
   * where a refused export makes the card vanish and say nothing.
   */
  it('reads a gloom counter as the -1/-1 counter Forge knows', () => {
    expect(forgeTargetRestriction({ kind: 'withCounter', counter: 'gloom' })).toBe('counters_GE1_M1M1');
  });

  /** `horn` decomposes to two Forge counters, and `GE1` can only name one. */
  it('refuses a counter whose Forge meaning is more than one counter', () => {
    expect(forgeTargetRestriction({ kind: 'withCounter', counter: 'horn' })).toBeNull();
  });
});

describe('attaching the qualifier to the selector', () => {
  it('opens with a dot and continues with a plus', () => {
    expect(forgeRestrictedTarget('Creature', 'tapped')).toBe('Creature.tapped');
    expect(forgeRestrictedTarget('Creature.YouCtrl', 'counters_GE1_P1P1')).toBe(
      'Creature.YouCtrl+counters_GE1_P1P1',
    );
  });

  /**
   * `Artifact,Enchantment` is two selectors, and a qualifier written after the
   * comma would narrow only the second. The DSL refuses the combination at
   * validation (`restrictionFitsTargetKind` admits a restriction only on a kind
   * whose target space is exactly `['creature']`), so this is unreachable from
   * a parsed card; it is asserted here because the transpiler is a public seam
   * that takes an `Effect` directly.
   */
  it('refuses a selector that is already a list', () => {
    expect(forgeRestrictedTarget('Artifact,Enchantment', 'tapped')).toBeNull();
  });
});

describe('the exported script', () => {
  it('narrows the selector rather than exporting the wider card', () => {
    const line = lineFor('Cull the Weak', smite({ kind: 'targetCreature', restriction: SAMPLES.maxPower }));
    expect(line).toContain('ValidTgts$ Creature.powerLE3');
    expect(line).not.toContain('ValidTgts$ Creature |');
  });

  it('chains behind a selector that already carries a qualifier', () => {
    const line = lineFor('Redouble the Bloom', {
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: 1,
      target: { kind: 'targetCreatureYouControl', restriction: SAMPLES.withCounter },
    });
    expect(line).toContain('ValidTgts$ Creature.YouCtrl+counters_GE1_P1P1');
  });

  it('exports a gloom clause as the counter Forge knows', () => {
    const line = lineFor(
      'Finish the Wounded',
      smite({ kind: 'targetCreature', restriction: { kind: 'withCounter', counter: 'gloom' } }),
    );
    expect(line).toContain('ValidTgts$ Creature.counters_GE1_M1M1');
  });

  it('keeps "another" and the qualifier on the same selector', () => {
    // `distinct` needs an earlier slot to be distinct *from*, so the shock is
    // not decoration: it is what makes the second slot's "another" mean
    // anything, and the DSL refuses the flag without it.
    const script = mustTranspile(
      spell('Turn on the Herd', [
        { kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } },
        smite({ kind: 'targetCreature', distinct: true, restriction: SAMPLES.tapped }),
      ]),
    );
    expect(script).toContain('ValidTgts$ Creature.tapped');
    expect(script).toContain('TargetUnique$ True');
  });

  it('rejects by name rather than dropping a restriction it cannot spell', () => {
    const result = transpileEffect(
      {
        kind: 'destroyPermanent',
        target: { kind: 'targetCreature', restriction: { kind: 'withCounter', counter: 'horn' } },
      },
      'tst-unspellable',
      'effects[0]',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((reason) => reason.code)).toContain('UNMAPPED_TARGET_RESTRICTION');
  });
});
