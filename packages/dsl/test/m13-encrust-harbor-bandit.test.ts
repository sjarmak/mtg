/** Exact engine-only vocabulary used by M13 Encrust and Harbor Bandit. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import {
  AuraSchema,
  ModelAuraSchema,
  legalTargetsFor,
  parseCard,
  renderOracleText,
  safeParseCard,
} from '@mtg/dsl';

const ENCRUST = {
  kind: 'enchantment',
  id: 'm13-encrust',
  name: 'Encrust',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 49 },
  manaCost: { generic: 1, U: 2 },
  colors: ['U'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'artifactOrCreature',
    modifications: [{ kind: 'doesNotUntap' }, { kind: 'cantActivateAbilities' }],
  },
} as const satisfies CardInput;

const HARBOR_BANDIT = {
  kind: 'creature',
  id: 'm13-harbor-bandit',
  name: 'Harbor Bandit',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 95 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'],
  subtypes: ['Human', 'Rogue'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
      enabledWhile: { kind: 'controlsSubtype', subtype: 'Island', atLeast: 1 },
    },
    {
      kind: 'activated',
      cost: { mana: { generic: 1, U: 1 }, tapSelf: false },
      effects: [{ kind: 'cantBeBlockedThisTurn', target: { kind: 'selfCreature' } }],
    },
  ],
} as const satisfies CardInput;

describe('Encrust Aura host vocabulary', () => {
  it('admits artifact-or-creature only in the engine schema and prints the exact host phrase', () => {
    expect(AuraSchema.safeParse(ENCRUST.aura).success).toBe(true);
    expect(ModelAuraSchema.safeParse(ENCRUST.aura).success).toBe(false);
    expect(renderOracleText(parseCard(ENCRUST))).toBe(
      "Enchant artifact or creature\nEnchanted permanent doesn't untap during its controller's untap step and its activated abilities can't be activated.",
    );
  });
});

describe('Harbor Bandit self referent', () => {
  it('admits selfCreature on the one-creature combat rule without making it a chosen target', () => {
    expect(legalTargetsFor('cantBeBlockedThisTurn')).toEqual([
      'targetCreature',
      'targetCreatureYouControl',
      'selfCreature',
      'thatCreature',
    ]);
    expect(renderOracleText(parseCard(HARBOR_BANDIT))).toBe(
      "As long as you control an Island, Harbor Bandit gets +1/+1.\n{1}{U}: This creature can't be blocked this turn.",
    );
  });

  it('still refuses that referent when a noncreature source tries to print it', () => {
    const result = safeParseCard({
      kind: 'artifact',
      id: 'tst-unblockable-relic',
      name: 'Unblockable Relic',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 2 },
      abilities: [HARBOR_BANDIT.abilities[1]],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map((violation) => violation.code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
    }
  });
});
