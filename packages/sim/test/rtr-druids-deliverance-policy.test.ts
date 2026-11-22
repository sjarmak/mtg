/** Target-policy exhaustiveness for Druid's Deliverance's untargeted shield. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { scenario } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, scoreEffectTargets } from '@mtg/sim';

const CARD = parseCard({
  kind: 'instant',
  id: 'rtr-druids-deliverance-policy',
  name: "Druid's Deliverance",
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 123 },
  colors: ['G'],
  manaCost: { generic: 1, G: 1 },
  effects: [{ kind: 'preventCombatDamageToYou' }, { kind: 'populate' }],
});

describe("Druid's Deliverance target policy", () => {
  it('scores the controller-only shield without inventing a target', () => {
    const config = DEFAULT_GREEDY_CONFIG;
    expect(
      scoreEffectTargets(
        scenario({}).state,
        0,
        CARD.effects,
        [null, null],
        config.cast,
        config.target,
        config.race,
      ),
    ).toBe(0);
  });
});
