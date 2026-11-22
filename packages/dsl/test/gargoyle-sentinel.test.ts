/** Gargoyle Sentinel's one-turn layer-6 exchange, at the strict DSL boundary. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';

const GARGOYLE: CardInput = {
  kind: 'creature',
  id: 'm11-207',
  name: 'Gargoyle Sentinel',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 207 },
  colors: [],
  manaCost: { generic: 3 },
  artifact: true,
  subtypes: ['Gargoyle'],
  power: 3,
  toughness: 3,
  keywordAbilities: [{ kind: 'defender' }],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 3 } },
      effects: [
        {
          kind: 'grantKeywordUntilEndOfTurn',
          keyword: 'flying',
          removeKeywordAbility: 'defender',
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
} as CardInput;

describe('Gargoyle Sentinel at the DSL boundary', () => {
  it('prints the loss and grant as one change on one subject', () => {
    expect(renderOracleText(parseCard(GARGOYLE))).toBe(
      'Defender\n{3}: Until end of turn, this creature loses defender and gains flying.',
    );
  });

  it('keeps the temporary-removal rider outside the generator schema', () => {
    expect(
      ModelEffectSchema.safeParse({
        kind: 'grantKeywordUntilEndOfTurn',
        keyword: 'flying',
        removeKeywordAbility: 'defender',
        target: { kind: 'selfCreature' },
      }).success,
    ).toBe(false);
  });

  it('refuses a mass removal rider until a card and every executor prove that wider promise', () => {
    const result = safeParseCard({
      ...GARGOYLE,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 3 } },
          effects: [
            {
              kind: 'grantKeywordUntilEndOfTurn',
              keyword: 'flying',
              removeKeywordAbility: 'defender',
              scope: 'permanentsYouControl',
              scopeFilter: { cardTypes: ['creature'] },
              target: { kind: 'noTarget' },
            },
          ],
        },
      ],
    });
    expect(result.ok ? [] : result.violations.map((found) => found.code)).toContain('ILLEGAL_EFFECT_SCOPE');
  });
});
