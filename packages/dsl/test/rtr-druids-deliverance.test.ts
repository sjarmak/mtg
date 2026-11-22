/** Druid's Deliverance's one-sided combat-damage prevention vocabulary. */
import { describe, expect, it } from 'vitest';
import {
  ALL_EFFECT_KINDS,
  legalTargetsFor,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  UNPRICED_EFFECT_KINDS,
} from '@mtg/dsl';

const EFFECT = { kind: 'preventCombatDamageToYou' as const };

const DRUIDS_DELIVERANCE = {
  kind: 'instant' as const,
  id: 'rtr-druids-deliverance',
  name: "Druid's Deliverance",
  rarity: 'common' as const,
  set: { code: 'RTR', collectorNumber: 123 },
  colors: ['G'] as const,
  manaCost: { generic: 1, G: 1 },
  effects: [EFFECT, { kind: 'populate' as const }],
};

describe("Druid's Deliverance authoring", () => {
  it('prints the protected player without turning that player into a target', () => {
    const card = parseCard(DRUIDS_DELIVERANCE);
    expect(renderOracleText(card)).toBe(
      'Prevent all combat damage that would be dealt to you this turn. Populate.',
    );
    expect([...legalTargetsFor(EFFECT.kind)]).toEqual([]);
  });

  it('is reachable by hand while remaining outside model output', () => {
    expect(ALL_EFFECT_KINDS).toContain(EFFECT.kind);
    expect(UNPRICED_EFFECT_KINDS).toContain(EFFECT.kind);
    expect(ModelEffectSchema.safeParse(EFFECT).success).toBe(false);
  });
});
