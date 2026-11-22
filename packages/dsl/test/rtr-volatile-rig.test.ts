/** Exact authored shape for RTR Volatile Rig's two loss-only coin branches. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';

const DAMAGE_EVERYTHING = {
  kind: 'dealDamage',
  amount: 4,
  scope: 'allPermanents',
  scopeFilter: { cardTypes: ['creature'] },
  players: 'eachPlayer',
  target: { kind: 'noTarget' },
} as const;

function volatileRig(): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-236-volatile-rig-dsl',
    name: 'Volatile Rig',
    rarity: 'rare',
    set: { code: 'RTR', collectorNumber: 236 },
    manaCost: { generic: 4 },
    colors: [],
    artifact: true,
    subtypes: ['Construct'],
    keywords: ['trample'],
    power: 4,
    toughness: 4,
    abilities: [
      {
        kind: 'static',
        scope: 'self',
        modification: { kind: 'attacksEachCombatIfAble' },
        printedSubjectReference: 'thisCreature',
      },
      {
        kind: 'triggered',
        condition: 'selfIsDealtDamage',
        printedSourceReference: 'thisCreature',
        effects: [
          {
            kind: 'flipCoin',
            loseEffects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
          },
        ],
      },
      {
        kind: 'triggered',
        condition: 'selfDies',
        printedSourceReference: 'thisCreature',
        effects: [{ kind: 'flipCoin', loseEffects: [DAMAGE_EVERYTHING] }],
      },
    ],
  } as CardInput;
}

describe('Volatile Rig DSL', () => {
  it('parses and renders current Oracle ordering exactly', () => {
    expect(renderOracleText(parseCard(volatileRig()))).toBe(
      'Trample\n' +
        'This creature attacks each combat if able.\n' +
        'Whenever this creature is dealt damage, flip a coin. If you lose the flip, sacrifice this creature.\n' +
        'When this creature dies, flip a coin. If you lose the flip, it deals 4 damage to each creature and each player.',
    );
  });

  it('keeps both coin branching and the player sweep outside the generator contract', () => {
    const effects = parseCard(volatileRig()).abilities.flatMap((ability) =>
      ability.kind === 'triggered' ? ability.effects : [],
    );
    expect(effects.every((effect) => !ModelEffectSchema.safeParse(effect).success)).toBe(true);
  });

  it('still refuses a triggered coin branch that owes an unrepresented target choice', () => {
    const input = volatileRig();
    const abilities = [...(input.abilities ?? [])];
    abilities[1] = {
      kind: 'triggered',
      condition: 'selfIsDealtDamage',
      effects: [
        {
          kind: 'flipCoin',
          loseEffects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
        },
      ],
    };
    const result = safeParseCard({ ...input, abilities });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'RANDOM_BRANCH_INVALID',
        path: 'abilities[1].effects[0].loseEffects[0]',
      }),
    );
  });
});
