/** Exact authored shape for a subtype-filtered trigger that functions from a graveyard. */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  TRIGGER_CONDITIONS,
  type CardInput,
  type TriggerCondition,
} from '@mtg/dsl';

const CONDITION = 'controlledLandSubtypeEnters' as TriggerCondition;

function veilborn(overrides: Record<string, unknown> = {}): CardInput {
  return {
    kind: 'creature',
    id: 'm13-114-veilborn-ghoul',
    name: 'Veilborn Ghoul',
    rarity: 'uncommon',
    set: { code: 'M13', collectorNumber: 114 },
    colors: ['B'],
    manaCost: { generic: 4, B: 1 },
    subtypes: ['Zombie'],
    power: 4,
    toughness: 1,
    abilities: [
      { kind: 'static', scope: 'self', modification: { kind: 'cantBlock' } },
      {
        kind: 'triggered',
        condition: CONDITION,
        landSubtype: 'Swamp',
        triggerZone: 'graveyard',
        optional: true,
        effects: [{ kind: 'returnSourceFromGraveyard', destination: 'hand' }],
        ...overrides,
      },
    ],
  } as CardInput;
}

describe('Veilborn Ghoul DSL', () => {
  it('prints the current Oracle text from reusable subtype and source-zone declarations', () => {
    expect(renderOracleText(parseCard(veilborn()))).toBe(
      "This creature can't block.\n" +
        'Whenever a Swamp you control enters, you may return this card from your graveyard to your hand.',
    );
  });

  it('keeps the condition and both engine-only declarations outside the generator contract', () => {
    const ability = veilborn().abilities?.[1];
    if (ability === undefined) throw new Error('fixture lost the graveyard trigger');
    expect(TRIGGER_CONDITIONS).toContain(CONDITION);
    expect(MODEL_TRIGGER_CONDITIONS as readonly TriggerCondition[]).not.toContain(CONDITION);
    expect(AbilitySchema.safeParse(ability).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
  });

  it('requires the subtype and graveyard zone on the exact self-return envelope', () => {
    for (const overrides of [
      { landSubtype: undefined },
      { triggerZone: undefined },
      { condition: 'selfEnters' },
    ]) {
      const parsed = safeParseCard(veilborn(overrides));
      expect(parsed.ok).toBe(false);
    }
  });
});
