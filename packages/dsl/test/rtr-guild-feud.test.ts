/** RTR #97's closed two-library creature contest. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '../src/index';

export const GUILD_FEUD_INPUT = {
  kind: 'enchantment',
  id: 'rtr-97-guild-feud',
  name: 'Guild Feud',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 97 },
  manaCost: { generic: 5, R: 1 },
  colors: ['R'],
  subtypes: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [],
      guildFeudContest: true,
    },
  ],
} as const;

describe('Guild Feud authoring', () => {
  it('parses and renders current Oracle as one ordered contest', () => {
    const card = parseCard(GUILD_FEUD_INPUT as unknown as CardInput);
    expect(renderOracleText(card)).toBe(
      'At the beginning of your upkeep, target opponent reveals the top three cards of their library, may put a creature card from among them onto the battlefield, then puts the rest into their graveyard. You do the same with the top three cards of your library. If two creatures are put onto the battlefield this way, those creatures fight each other.',
    );
    expect(ModelEffectSchema.safeParse({ kind: 'guildFeudContest' }).success).toBe(false);
  });

  it('refuses the effect outside its exact enchantment upkeep envelope', () => {
    const changed = structuredClone(GUILD_FEUD_INPUT) as unknown as CardInput;
    const ability = changed.abilities?.[0];
    if (ability?.kind !== 'triggered') throw new Error('Guild Feud trigger disappeared');
    ability.condition = 'beginningOfYourEndStep';
    const parsed = safeParseCard(changed);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('widened Guild Feud unexpectedly parsed');
    expect(parsed.violations).toContainEqual(
      expect.objectContaining({ code: 'ABILITY_ILLEGAL_ON_CARD_TYPE', path: 'abilities' }),
    );
  });
});
