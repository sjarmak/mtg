/** Incite's two linked, hand-authored turn-scoped effects. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard } from '@mtg/dsl';

function incite(
  effects: readonly unknown[] = [
    { kind: 'setColorsUntilEndOfTurn', colors: ['R'], target: { kind: 'targetCreature' } },
    { kind: 'attacksThisTurnIfAble', target: { kind: 'thatCreature' } },
  ],
) {
  return {
    kind: 'instant',
    id: 'tst-incite',
    name: 'Incite',
    rarity: 'common',
    set: { code: 'M11', collectorNumber: 145 },
    colors: ['R'],
    manaCost: { R: 1 },
    effects,
  };
}

describe('Incite authoring', () => {
  it('renders the one shared-target sentence the printing carries', () => {
    expect(renderOracleText(parseCard(incite()))).toBe(
      'Target creature becomes red until end of turn and attacks this turn if able.',
    );
  });

  it('keeps both context-heavy primitives outside generator output', () => {
    for (const effect of incite().effects) {
      expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
    }
  });

  it('requires a nonempty color set and an earlier creature target for the attack referent', () => {
    const colorless = safeParseCard(
      incite([
        { kind: 'setColorsUntilEndOfTurn', colors: [], target: { kind: 'targetCreature' } },
        { kind: 'attacksThisTurnIfAble', target: { kind: 'thatCreature' } },
      ]),
    );
    expect(colorless.ok).toBe(false);

    const unbound = safeParseCard(
      incite([{ kind: 'attacksThisTurnIfAble', target: { kind: 'thatCreature' } }]),
    );
    expect(unbound.ok ? [] : unbound.violations.map((found) => found.code)).toContain(
      'ILLEGAL_REFERENT_TARGET',
    );
  });
});
