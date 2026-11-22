/** The hand-authored replacement vocabulary required by Obstinate Baloth. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import { STATIC_MODIFICATION_KINDS, parseCard, renderOracleText, safeParseCard } from '../src/index';
import { ModelStaticModificationSchema } from '../src/ability-shape';

function baloth(scope: 'self' | 'creaturesYouControl' = 'self'): CardInput {
  return {
    kind: 'creature',
    id: 'm11-188-obstinate-baloth',
    name: 'Obstinate Baloth',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 188 },
    manaCost: { generic: 2, G: 2 },
    colors: ['G'],
    subtypes: ['Beast'],
    power: 4,
    toughness: 4,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [{ kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'static',
        scope,
        subtype: null,
        modification: { kind: 'discardedByOpponentEntersBattlefield' },
      },
    ],
  };
}

describe('Obstinate Baloth DSL', () => {
  it('renders both Oracle paragraphs exactly', () => {
    expect(renderOracleText(parseCard(baloth()))).toBe(
      [
        'When Obstinate Baloth enters the battlefield, you gain 4 life.',
        'If a spell or ability an opponent controls causes you to discard Obstinate Baloth, put it onto the battlefield instead of putting it into your graveyard.',
      ].join('\n'),
    );
  });

  it('keeps the replacement hand-authored and classifies it as self-scoped', () => {
    expect(STATIC_MODIFICATION_KINDS).toContain('discardedByOpponentEntersBattlefield');
    expect(
      ModelStaticModificationSchema.safeParse({ kind: 'discardedByOpponentEntersBattlefield' }).success,
    ).toBe(false);

    const parsed = safeParseCard(baloth('creaturesYouControl'));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((violation) => [violation.code, violation.path])).toContainEqual([
      'REPLACEMENT_MODIFICATION_ILLEGAL_ON_SCOPE',
      'abilities[1].scope',
    ]);
  });

  it('refuses a battlefield condition that the hand-active replacement cannot observe', () => {
    const input = baloth() as unknown as Record<string, unknown> & {
      readonly abilities: readonly Record<string, unknown>[];
    };
    const abilities = [...input.abilities];
    abilities[1] = {
      ...abilities[1],
      enabledWhile: { kind: 'controlsSubtype', subtype: 'Beast', atLeast: 1 },
    };
    const parsed = safeParseCard({ ...input, abilities });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((violation) => [violation.code, violation.path])).toContainEqual([
      'REPLACEMENT_CONDITION_UNSUPPORTED',
      'abilities[1].enabledWhile',
    ]);
  });
});
