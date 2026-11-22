/** Exact authored DSL and generator containment for RTR Jace, Architect of Thought. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '../src/index';

export const JACE_ARCHITECT_INPUT = {
  kind: 'planeswalker',
  id: 'rtr-44-jace-architect-of-thought',
  name: 'Jace, Architect of Thought',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 44 },
  manaCost: { generic: 2, U: 2 },
  colors: ['U'],
  supertypes: ['legendary'],
  subtypes: ['Jace'],
  startingLoyalty: 4,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [],
      jaceArchitectProfile: 'attackDebuff',
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -2,
      effects: [],
      jaceArchitectProfile: 'piles',
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -8,
      effects: [],
      jaceArchitectProfile: 'searchAndCast',
    },
  ],
} as const;

describe('Jace, Architect of Thought authoring', () => {
  it('parses and renders all three current Oracle abilities in printed order', () => {
    const card = parseCard(JACE_ARCHITECT_INPUT as unknown as CardInput);
    expect(renderOracleText(card)).toBe(
      '[+1]: Until your next turn, whenever a creature an opponent controls attacks, it gets -1/-0 until end of turn.\n' +
        '[−2]: Reveal the top three cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other on the bottom of your library in any order.\n' +
        "[−8]: For each player, search that player's library for a nonland card and exile it, then that player shuffles. You may cast those cards without paying their mana costs.",
    );
  });

  it('keeps every profile outside model output', () => {
    for (const ability of JACE_ARCHITECT_INPUT.abilities) {
      expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
    }
  });

  it('refuses a profile detached from its exact loyalty cost', () => {
    const malformed = structuredClone(JACE_ARCHITECT_INPUT) as unknown as CardInput;
    const second = malformed.abilities?.[1];
    if (second?.kind !== 'activated') throw new Error('Jace pile ability disappeared');
    second.loyaltyCost = -3;
    const parsed = safeParseCard(malformed);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('malformed Jace profile unexpectedly parsed');
    expect(parsed.violations).toContainEqual(
      expect.objectContaining({ code: 'ABILITY_COST_INVALID', path: 'abilities[1]' }),
    );
  });
});
