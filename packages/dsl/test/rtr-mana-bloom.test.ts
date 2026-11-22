/** Mana Bloom's engine-only charge-counter mana bundle. */
import { describe, expect, it } from 'vitest';
import { MODEL_COUNTER_KINDS, ModelAbilitySchema, renderOracleText } from '../src/index';
import { parseCard } from '../src/parse';

export const MANA_BLOOM = {
  kind: 'enchantment',
  id: 'rtr-130-mana-bloom',
  name: 'Mana Bloom',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 130 },
  manaCost: { hasX: true, G: 1 },
  colors: ['G'],
  entryReplacement: {
    kind: 'entersWithCounters',
    counter: 'charge',
    count: { kind: 'chosenX' },
  },
  printedEntryReference: 'thisEnchantment',
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, removeCounter: { counter: 'charge', count: 1 } },
      activateOnlyOnceEachTurn: true,
      printedSourceReference: 'thisEnchantment',
      effects: [{ kind: 'addMana', produces: ['W', 'U', 'B', 'R', 'G'], amount: 1 }],
    },
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      interveningIf: { kind: 'selfCounterCountBelow', counter: 'charge', fewerThan: 1 },
      printedSourceReference: 'thisEnchantment',
      effects: [{ kind: 'returnToHand', target: { kind: 'selfPermanent' } }],
    },
  ],
} as const;

describe('Mana Bloom DSL', () => {
  it('renders the exact current Oracle paragraphs', () => {
    expect(renderOracleText(parseCard(MANA_BLOOM))).toBe(
      "This enchantment enters with X charge counters on it.\nRemove a charge counter from this enchantment: Add one mana of any color. Activate only once each turn.\nAt the beginning of your upkeep, if this enchantment has no charge counters on it, return it to its owner's hand.",
    );
  });

  it('keeps charge and the limited activation outside the model vocabulary', () => {
    const card = parseCard(MANA_BLOOM);
    expect(MODEL_COUNTER_KINDS).not.toContain('charge');
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
  });
});
