import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
  type CardInput,
} from '@mtg/dsl';

const CREATURES_DEAL_TO_CONTROLLERS = {
  kind: 'dealDamage',
  amount: 1,
  target: { kind: 'noTarget' },
  scope: 'allPermanents',
  scopeFilter: { cardTypes: ['creature'] },
  eachScopedPermanentDealsToItsController: true,
} as const;

const RAKDOS_CHARM_INPUT = {
  kind: 'instant',
  id: 'rtr-184-rakdos-charm-dsl',
  name: 'Rakdos Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 184 },
  manaCost: { B: 1, R: 1 },
  colors: ['B', 'R'],
  effects: [],
  modes: [
    { effects: [{ kind: 'exileGraveyard', target: { kind: 'targetPlayer' } }] },
    {
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { cardTypes: ['artifact'] } },
        },
      ],
    },
    { effects: [CREATURES_DEAL_TO_CONTROLLERS] },
  ],
} as unknown as CardInput;

describe('RTR #184 Rakdos Charm', () => {
  it('renders all three source-attested modes in exact current Oracle order', () => {
    const card = parseCard(RAKDOS_CHARM_INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      [
        'Choose one —',
        "• Exile target player's graveyard.",
        '• Destroy target artifact.',
        '• Each creature deals 1 damage to its controller.',
      ].join('\n'),
    );
  });

  it('keeps cohort-source damage hand-authored and refuses ambiguous carriers', () => {
    expect(ModelEffectSchema.safeParse(CREATURES_DEAL_TO_CONTROLLERS).success).toBe(false);
    for (const effect of [
      { ...CREATURES_DEAL_TO_CONTROLLERS, scope: undefined },
      { ...CREATURES_DEAL_TO_CONTROLLERS, target: { kind: 'targetPlayer' } },
      { ...CREATURES_DEAL_TO_CONTROLLERS, players: 'eachPlayer' },
    ]) {
      const parsed = CardEffectSchema.safeParse(effect);
      if (!parsed.success) continue;
      expect(() => parseCard({ ...RAKDOS_CHARM_INPUT, modes: undefined, effects: [effect] })).toThrow(
        'cohort-source damage requires',
      );
    }
  });
});
