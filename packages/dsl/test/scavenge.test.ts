/** Scavenge as one reusable graveyard-activation envelope. */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  isScavengeAbility,
  mana,
  ModelAbilitySchema,
  parseCard,
  renderAbility,
  renderOracleText,
  safeParseCard,
  scavengeAbility,
  type CardInput,
} from '@mtg/dsl';

function deadbridgeGoliath(): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-120-deadbridge-goliath',
    name: 'Deadbridge Goliath',
    rarity: 'rare',
    set: { code: 'RTR', collectorNumber: 120 },
    colors: ['G'],
    manaCost: { generic: 2, G: 2 },
    subtypes: ['Insect'],
    power: 5,
    toughness: 5,
    abilities: [scavengeAbility(mana({ generic: 4, G: 2 }), 5)],
  };
}

describe('scavenge DSL', () => {
  it('renders the exact keyword and reminder text from the executable envelope', () => {
    const card = parseCard(deadbridgeGoliath());
    expect(renderOracleText(card)).toBe(
      "Scavenge {4}{G}{G} ({4}{G}{G}, Exile this card from your graveyard: Put a number of +1/+1 counters equal to this card's power on target creature. Scavenge only as a sorcery.)",
    );
    expect(isScavengeAbility(card.abilities[0]!)).toBe(true);
  });

  it('builds the canonical engine-only graveyard, exile, timing, and counter shape', () => {
    const ability = scavengeAbility(mana({ generic: 2, B: 1 }), 2);
    expect(ability).toStrictEqual({
      kind: 'activated',
      activationZone: 'graveyard',
      activateOnlyAsSorcery: true,
      cost: {
        mana: mana({ generic: 2, B: 1 }),
        tapSelf: false,
        sacrificeSelf: false,
        exileSelf: true,
      },
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 2,
          target: { kind: 'targetCreature' },
        },
      ],
    });
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
  });

  it('rejects a nonpositive or fractional printed power', () => {
    for (const power of [0, -1, 1.5]) {
      expect(() => scavengeAbility(mana({ B: 1 }), power)).toThrow(RangeError);
    }
  });

  it('rejects a scavenge counter count that disagrees with the source fixed power', () => {
    const result = safeParseCard({
      ...deadbridgeGoliath(),
      power: 2,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path: 'abilities[0].effects[0].count',
      }),
    );
  });

  it('rejects scavenge on a creature whose power is characteristic-defined', () => {
    const result = safeParseCard({
      ...deadbridgeGoliath(),
      characteristicPowerToughness: { kind: 'controllerLifeTotal' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path: 'abilities[0].effects[0].count',
      }),
    );
  });

  it('recognizes only the plain target and counter effect the keyword promises', () => {
    const narrowed = AbilitySchema.parse({
      ...scavengeAbility(mana({ G: 1 }), 2),
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 2,
          target: { kind: 'targetCreature', filter: { colors: ['G'] } },
        },
      ],
    });
    expect(isScavengeAbility(narrowed)).toBe(false);
    expect(renderAbility(narrowed, 'CARDNAME', 'creature')).not.toContain('Scavenge');
  });

  it('names the graveyard source in a generic exile-self activation cost', () => {
    const ability = AbilitySchema.parse({
      kind: 'activated',
      activationZone: 'graveyard',
      activateOnlyAsSorcery: true,
      cost: { mana: { B: 1 }, exileSelf: true },
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    });
    expect(renderAbility(ability, 'CARDNAME', 'creature')).toBe(
      '{B}, Exile this card from your graveyard: You gain 2 life. Activate only as a sorcery.',
    );
  });

  it('preserves sorcery timing when regeneration takes its specialized renderer', () => {
    const ability = AbilitySchema.parse({
      kind: 'activated',
      activateOnlyAsSorcery: true,
      cost: { mana: { G: 1 } },
      regenerateSelf: true,
      effects: [],
    });
    expect(renderAbility(ability, 'CARDNAME', 'creature')).toBe(
      '{G}: Regenerate this creature. Activate only as a sorcery.',
    );
  });
});
