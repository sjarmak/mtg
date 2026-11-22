/** Time Reversal's atomic zone reset and resolving-spell disposition. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, validateCards } from '../src/index';

const EFFECTS = [
  { kind: 'shuffleHandsAndGraveyardsIntoLibraries' },
  { kind: 'drawCards', count: 7, players: 'eachPlayer', target: { kind: 'noTarget' } },
  { kind: 'exileThisSpell' },
] as const;

function timeReversalInput(): CardInput {
  return {
    kind: 'sorcery',
    id: 'm11-075',
    name: 'Time Reversal',
    rarity: 'mythic',
    set: { code: 'M11', collectorNumber: 75 },
    manaCost: { generic: 3, U: 2 },
    colors: ['U'],
    effects: [...EFFECTS],
  } as unknown as CardInput;
}

describe('the exact Time Reversal sentence', () => {
  it('parses, validates, and renders all three ordered actions', () => {
    const card = parseCard(timeReversalInput());
    expect(validateCards([card])).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Each player shuffles their hand and graveyard into their library, then draws seven cards. Exile Time Reversal.',
    );
  });

  it('keeps both machinery effects outside the generator vocabulary', () => {
    expect(ModelEffectSchema.safeParse(EFFECTS[0]).success).toBe(false);
    expect(ModelEffectSchema.safeParse(EFFECTS[2]).success).toBe(false);
  });

  it('admits seven only on the hand-authored each-player draw shape', () => {
    const ordinary = safeParseCard({
      ...timeReversalInput(),
      effects: [{ kind: 'drawCards', count: 7, target: { kind: 'noTarget' } }],
    });
    expect(ordinary.ok).toBe(false);
    if (ordinary.ok) throw new Error('an ordinary generated draw exceeded its ceiling');
    expect(ordinary.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'EFFECT_PARAM_OUT_OF_RANGE', path: 'effects[0].count' }),
      ]),
    );
  });

  it.each(['triggered', 'activated'] as const)('refuses exileThisSpell inside a %s ability', (kind) => {
    const ability =
      kind === 'triggered'
        ? { kind, condition: 'selfEnters', effects: [{ kind: 'exileThisSpell' }] }
        : {
            kind,
            cost: { mana: { generic: 1 } },
            effects: [{ kind: 'exileThisSpell' }],
          };
    const result = safeParseCard({
      kind: 'creature',
      id: `test-${kind}`,
      name: 'False Reversal',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: kind === 'triggered' ? 1 : 2 },
      manaCost: { generic: 1 },
      colors: [],
      subtypes: ['Wizard'],
      power: 1,
      toughness: 1,
      abilities: [ability],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('an ability exiled a spell that does not exist');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'EFFECT_ILLEGAL_ON_CARD_TYPE',
          path: 'abilities[0].effects[0]',
        }),
      ]),
    );
  });
});
