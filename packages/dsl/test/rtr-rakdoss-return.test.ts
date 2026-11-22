/** Rakdos's Return's exact opponent-or-planeswalker routing and X linkage. */
import { describe, expect, it } from 'vitest';
import {
  MODEL_TARGET_KINDS,
  ModelEffectSchema,
  renderOracleText,
  safeParseCard,
  TARGET_KINDS,
} from '../src/index';
import { parseCard } from '../src/parse';

const RAKDOSS_RETURN = {
  kind: 'sorcery',
  id: 'rtr-188-rakdoss-return',
  name: "Rakdos's Return",
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 188 },
  manaCost: { hasX: true, B: 1, R: 1 },
  colors: ['B', 'R'],
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'chosenX' },
      target: { kind: 'targetPlayerOrPlaneswalker' },
      opponentPlayerOrPlaneswalkerOnly: true,
    },
    {
      kind: 'discardCards',
      count: 1,
      countFrom: 'chosenX',
      target: { kind: 'thatPlayerOrPlaneswalkerController' },
    },
  ],
} as const;

describe("Rakdos's Return DSL", () => {
  it('renders the exact current Oracle text', () => {
    expect(renderOracleText(parseCard(RAKDOSS_RETURN))).toBe(
      "Rakdos's Return deals X damage to target opponent or planeswalker. That player or that planeswalker's controller discards X cards.",
    );
  });

  it('keeps the routing refinement outside the model and global target vocabularies', () => {
    expect(TARGET_KINDS).not.toContain('targetOpponentOrPlaneswalker');
    expect(MODEL_TARGET_KINDS).not.toContain('targetOpponentOrPlaneswalker');
    expect(ModelEffectSchema.safeParse(RAKDOSS_RETURN.effects[0]).success).toBe(false);
  });

  it('refuses the refinement on a target space that cannot enforce both halves', () => {
    const result = safeParseCard({
      ...RAKDOSS_RETURN,
      effects: [
        {
          ...RAKDOSS_RETURN.effects[0],
          target: { kind: 'anyTarget' },
        },
        RAKDOSS_RETURN.effects[1],
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('opponent-only routing escaped its player-or-planeswalker slot');
    expect(result.violations.map((violation) => violation.message).join('\n')).toMatch(
      /opponentPlayerOrPlaneswalkerOnly.*targetPlayerOrPlaneswalker/u,
    );
  });
});
