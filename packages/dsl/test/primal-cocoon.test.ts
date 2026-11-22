/** Primal Cocoon's engine-only Aura and attached-host trigger vocabulary. */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  AuraSchema,
  HAND_AUTHORED_TARGETS,
  LEGAL_TARGETS,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  ModelAuraSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
} from '@mtg/dsl';

const ATTACHED_HOST_COMBAT = 'enchantedCreatureAttacksOrBlocks';

const PRIMAL_COCOON = {
  kind: 'enchantment',
  id: 'm11-primal-cocoon',
  name: 'Primal Cocoon',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 191 },
  manaCost: { G: 1 },
  colors: ['G'],
  subtypes: ['Aura'],
  aura: { enchant: 'creature', modifications: [] },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'enchantedCreature' },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: ATTACHED_HOST_COMBAT,
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfPermanent' } }],
    },
  ],
} as const;

describe('Primal Cocoon DSL vocabulary', () => {
  it('admits a zero-modification Aura only in the engine schema', () => {
    const aura = { enchant: 'creature', modifications: [] };
    expect(AuraSchema.safeParse(aura).success).toBe(true);
    expect(ModelAuraSchema.safeParse(aura).success).toBe(false);
    expect(safeParseCard({ ...PRIMAL_COCOON, abilities: [] }).ok).toBe(false);
  });

  it('keeps both new words hand-authored', () => {
    expect(TRIGGER_CONDITIONS as readonly string[]).toContain(ATTACHED_HOST_COMBAT);
    expect(MODEL_TRIGGER_CONDITIONS as readonly string[]).not.toContain(ATTACHED_HOST_COMBAT);
    expect(LEGAL_TARGETS.putCounters).not.toContain('enchantedCreature');
    expect(HAND_AUTHORED_TARGETS.putCounters).toContain('enchantedCreature');

    const trigger = {
      kind: 'triggered',
      condition: ATTACHED_HOST_COMBAT,
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    };
    expect(AbilitySchema.safeParse(trigger).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(trigger).success).toBe(false);
    expect(ModelAbilitySchema.safeParse({ ...trigger, condition: 'selfEnters' }).success).toBe(true);
  });

  it('parses and renders the current Oracle text exactly', () => {
    const card = parseCard(PRIMAL_COCOON);
    expect(renderOracleText(card)).toBe(
      'Enchant creature\n' +
        'At the beginning of your upkeep, put a +1/+1 counter on enchanted creature.\n' +
        'When enchanted creature attacks or blocks, sacrifice Primal Cocoon.',
    );
    expect(TRIGGER_PRINT_TEMPLATES[ATTACHED_HOST_COMBAT as keyof typeof TRIGGER_PRINT_TEMPLATES]).toBe(
      'When enchanted creature attacks or blocks,',
    );
  });

  it('refuses the attached-host condition on a non-Aura', () => {
    const result = safeParseCard({
      ...PRIMAL_COCOON,
      id: 'tst-blanket-cocoon',
      name: 'Blanket Cocoon',
      subtypes: [],
      aura: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map(({ code }) => code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
    }
  });
});
