/** RTR unleash authoring stays engine-only and preserves generator containment. */
import {
  KeywordAbilitySchema,
  KeywordSchema,
  abilityLineReminder,
  parseCard,
  renderOracleText,
} from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const UNLEASH = { kind: 'unleash' as const };

const UNLEASH_CREATURE = {
  kind: 'creature' as const,
  id: 'rtr-unleash-creature',
  name: 'Runeclaw Bear',
  rarity: 'common' as const,
  set: { code: 'RTR', collectorNumber: 62 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'] as const,
  subtypes: ['Zombie'],
  power: 2,
  toughness: 3,
  keywordAbilities: [UNLEASH] as never,
};

describe('RTR unleash authoring', () => {
  it('parses and renders the exact current unleash line and reminder', () => {
    const card = parseCard(UNLEASH_CREATURE);

    expect(renderOracleText(card).toLowerCase()).toBe('unleash');
    const keyword = `${'u'.toUpperCase()}nleash`;
    const reminder = abilityLineReminder(keyword);
    expect(reminder?.keyword.toLowerCase()).toBe('unleash');
    expect(reminder?.gloss).toBe(
      "(You may have this creature enter with a +1/+1 counter on it. It can't block as long as it has a +1/+1 counter on it.)",
    );
  });

  it('keeps unleash outside the model-visible flat keyword vocabulary', () => {
    expect(KeywordAbilitySchema.safeParse(UNLEASH).success).toBe(true);
    expect(KeywordSchema.safeParse('unleash').success).toBe(false);
  });

  it('renders a one-counter conditional keyword in current Oracle grammar', () => {
    const card = parseCard({
      ...UNLEASH_CREATURE,
      id: 'rtr-90-chaos-imps',
      name: 'Chaos Imps',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 90 },
      manaCost: { generic: 4, R: 2 },
      colors: ['R'],
      subtypes: ['Imp'],
      power: 6,
      toughness: 5,
      keywords: ['flying'],
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          enabledWhile: {
            kind: 'selfCounterCountAtLeast',
            counter: 'plusOnePlusOne',
            atLeast: 1,
          },
          modification: { kind: 'grantKeyword', keyword: 'trample' },
        },
      ],
    });

    expect(renderOracleText(card)).toBe(
      'Flying\nUnleash\nThis creature has trample as long as it has a +1/+1 counter on it.',
    );
  });

  it('rejects duplicate unleash and noncreature hosts', () => {
    expect(() =>
      parseCard({
        ...UNLEASH_CREATURE,
        keywordAbilities: [UNLEASH, UNLEASH] as never,
      }),
    ).toThrow(/repeats keywordAbilities/iu);
    expect(() =>
      parseCard({
        kind: 'artifact',
        id: 'unleash-artifact',
        name: 'Runeclaw Bear',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 1 },
        manaCost: { generic: 2 },
        keywordAbilities: [UNLEASH] as never,
      }),
    ).toThrow(/unleash.*artifact|artifact.*unleash/iu);
  });
});
