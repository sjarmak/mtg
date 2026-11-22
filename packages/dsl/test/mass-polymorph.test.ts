/** The two reusable hand-authored clauses that make Mass Polymorph exact. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText } from '@mtg/dsl';

const INPUT = {
  kind: 'sorcery',
  id: 'm11-064',
  name: 'Mass Polymorph',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 64 },
  manaCost: { generic: 5, U: 1 },
  colors: ['U'],
  effects: [
    {
      kind: 'exileTarget',
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    },
    {
      kind: 'revealUntilCreatureCards',
      count: { kind: 'permanentsExiledThisResolution' },
    },
  ],
} as const;

describe('Mass Polymorph authoring', () => {
  it('composes a one-sided exile with a token-inclusive reveal count', () => {
    const card = parseCard(INPUT);

    expect(renderOracleText(card)).toBe(
      'Exile all creatures you control. Then reveal cards from the top of your library until you reveal that many creature cards. Put all creature cards revealed this way onto the battlefield, then shuffle the rest of the revealed cards into your library.',
    );
  });

  it('keeps both widened clauses outside model-generated output', () => {
    expect(ModelEffectSchema.safeParse(INPUT.effects[0]).success).toBe(false);
    expect(ModelEffectSchema.safeParse(INPUT.effects[1]).success).toBe(false);
  });
});
