/** Seeded journeys through the actual cube and the human observation boundary. */
import { describe, expect, it } from 'vitest';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { evaluateDraft, LEGACY_CUBE_ADVISOR_MODEL, validateAdvisorMetadata } from '@mtg/draft-export';
import type { ObservedDraft } from '@mtg/draft-export';
import catalogJson from '../../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { runLegacyCubeDraft, LEGACY_CUBE_HUMAN_SEAT } from '../../src/routes/legacy-cube/model';

const catalog = parsePrintedCardCatalog(catalogJson);

describe('actual Legacy Cube strategic simulations', () => {
  it.each(['flexible', 'current', 'reanimator'])(
    'finishes a deterministic 45-pick %s journey with grounded explanations',
    (mode) => {
      expect(validateAdvisorMetadata(catalog).errors).toEqual([]);
      let picks: readonly string[] = [];
      let wheels = 0;
      for (let index = 0; index <= 45; index += 1) {
        const draft = runLegacyCubeDraft(catalog, `advisor-simulation/${mode}`, picks);
        const state: ObservedDraft = {
          seats: 8,
          rounds: 3,
          packSize: 15,
          picks,
          observations: draft.observations
            .filter((o) => o.seatId === LEGACY_CUBE_HUMAN_SEAT)
            .map((o) => ({ round: o.round, pickNumber: o.pickNumber, cards: o.cards.map((c) => c.payload) })),
        };
        const advice = evaluateDraft(state, LEGACY_CUBE_ADVISOR_MODEL, mode === 'reanimator' ? mode : null);
        const visible = new Set(state.observations.flatMap((o) => o.cards.map((c) => c.physicalId)));
        expect(advice.memory.pool.map((c) => c.physicalId)).toEqual(picks);
        for (const path of advice.archetypes) {
          for (const evidence of path.openness.observations) {
            expect(evidence.cards.every((id) => visible.has(id))).toBe(true);
            if (evidence.code === 'wheel') wheels += 1;
          }
        }
        if (index === 45) {
          expect(draft.result).not.toBeNull();
          expect(advice.recommendations).toEqual([]);
          expect(wheels).toBeGreaterThan(0);
          break;
        }
        const recommendation =
          advice.recommendations.find((r) => r.mode === (mode === 'reanimator' ? 'explore' : mode)) ??
          advice.recommendations[0]!;
        expect(recommendation.reasons.length).toBeGreaterThan(0);
        expect(
          recommendation.reasons.every((r) => r.text.length > 0 && r.cards.every((id) => visible.has(id))),
        ).toBe(true);
        expect(advice.cards.some((c) => c.card.physicalId === recommendation.card.physicalId)).toBe(true);
        picks = [...picks, recommendation.card.physicalId];
      }
    },
  );
});
