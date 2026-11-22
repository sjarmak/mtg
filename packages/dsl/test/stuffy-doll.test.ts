/** Exact hand-authored vocabulary for M13 Stuffy Doll. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput, EffectInput } from '../src/index';
import {
  ComputedAmountSchema,
  MODEL_TARGET_KINDS,
  MODEL_TRIGGER_CONDITIONS,
  ModelEffectSchema,
  SharedComputedAmountSchema,
  SharedPermanentEntryReplacementSchema,
  TARGET_KINDS,
  TRIGGER_CONDITIONS,
  renderOracleText,
} from '../src/index';
import { parseCard } from '../src/parse';

const RETALIATE: EffectInput = {
  kind: 'dealDamage',
  amount: { kind: 'triggeringDamageAmount' },
  target: { kind: 'chosenPlayer' },
};

const ABILITIES: readonly AbilityInput[] = [
  {
    kind: 'triggered',
    condition: 'selfIsDealtDamage',
    effects: [RETALIATE],
  },
  {
    kind: 'activated',
    cost: { mana: {}, tapSelf: true },
    effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'selfPermanent' } }],
  },
];

export function stuffyDollInput(abilities: readonly AbilityInput[] = ABILITIES): CardInput {
  return {
    kind: 'creature',
    id: 'm13-218-stuffy-doll',
    name: 'Stuffy Doll',
    rarity: 'rare',
    set: { code: 'M13', collectorNumber: 218 },
    manaCost: { generic: 5 },
    colors: [],
    artifact: true,
    subtypes: ['Construct'],
    power: 0,
    toughness: 1,
    keywords: [],
    keywordAbilities: [{ kind: 'indestructible' }],
    entryReplacement: { kind: 'choosePlayer' },
    abilities: [...abilities],
  };
}

describe('Stuffy Doll vocabulary', () => {
  it('keeps its linked entry, trigger, amount, and referent outside generator schemas', () => {
    expect(TRIGGER_CONDITIONS).toContain('selfIsDealtDamage');
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain('selfIsDealtDamage');
    expect(TARGET_KINDS).toContain('chosenPlayer');
    expect(MODEL_TARGET_KINDS).not.toContain('chosenPlayer');
    expect(ComputedAmountSchema.parse({ kind: 'triggeringDamageAmount' })).toEqual({
      kind: 'triggeringDamageAmount',
    });
    expect(SharedComputedAmountSchema.safeParse({ kind: 'triggeringDamageAmount' }).success).toBe(false);
    expect(SharedPermanentEntryReplacementSchema.safeParse({ kind: 'choosePlayer' }).success).toBe(false);
    expect(ModelEffectSchema.safeParse(RETALIATE).success).toBe(false);
  });

  it('renders the current Oracle text exactly', () => {
    expect(renderOracleText(parseCard(stuffyDollInput()))).toBe(
      'Indestructible\nAs Stuffy Doll enters, choose a player.\nWhenever Stuffy Doll is dealt damage, it deals that much damage to the chosen player.\n{T}: Stuffy Doll deals 1 damage to itself.',
    );
  });

  it('refuses event-only vocabulary outside the matching trigger', () => {
    const wrong: AbilityInput = { kind: 'triggered', condition: 'selfEnters', effects: [RETALIATE] };
    expect(() => parseCard(stuffyDollInput([wrong]))).toThrow(/triggeringDamageAmount|chosenPlayer/u);

    const activation: AbilityInput = {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      effects: [RETALIATE],
    };
    expect(() => parseCard(stuffyDollInput([activation]))).toThrow(/triggeringDamageAmount|chosenPlayer/u);
  });

  it('confines the retained damage amount to the damage effect amount it can resolve', () => {
    const unsupported: AbilityInput = {
      kind: 'triggered',
      condition: 'selfIsDealtDamage',
      effects: [
        {
          kind: 'gainLife',
          amount: { kind: 'triggeringDamageAmount' },
          target: { kind: 'noTarget' },
        },
      ],
    };

    expect(() => parseCard(stuffyDollInput([unsupported]))).toThrow(/triggeringDamageAmount.*dealDamage/u);
  });

  it('refuses the linked trigger when the permanent has no entry-player writer', () => {
    expect(() => parseCard({ ...stuffyDollInput(), entryReplacement: undefined })).toThrow(
      /choose a player as it enters/u,
    );
  });
});
