import type { AdvisorModel, Confidence, Reason } from './evidence';
import { profileOf } from './evidence';
import type { ObservedDraft } from './state';

export interface Openness {
  readonly score: number;
  readonly label: 'Unknown' | 'Little evidence' | 'Some evidence' | 'Strong evidence' | 'Cooling';
  readonly confidence: Confidence;
  readonly observations: readonly Reason[];
}

/** Expert prior, not measured pick-order data. One physical card has one vote. */
export function inferOpenness(state: ObservedDraft, model: AdvisorModel, archetype: string): Openness {
  const currentRound = state.observations.at(-1)?.round ?? 1;
  const colors = model.archetypes.find((a) => a.id === archetype)?.colors ?? [];
  const latest = new Map<string, Reason>();
  for (const [index, seen] of state.observations.entries()) {
    for (const card of seen.cards) {
      const profile = profileOf(model, card);
      const member = profile.archetypes.find((a) => a.archetype === archetype);
      const colorFixing = member === undefined && profile.fixing.some((c) => colors.includes(c));
      const specificity = member?.signal ?? (colorFixing ? 0.12 : 0);
      if (specificity === 0) continue;
      const earlier = state.observations
        .slice(0, index)
        .find(
          (o) =>
            o.round === seen.round &&
            (o.pickNumber - 1) % state.seats === (seen.pickNumber - 1) % state.seats &&
            o.cards.some((c) => c.physicalId === card.physicalId),
        );
      const wheel = earlier !== undefined;
      const lateness = seen.pickNumber === 1 ? 0 : Math.max(0.1, (seen.pickNumber - 2) / 5);
      const weight =
        Math.min(2.4, specificity * (lateness + (wheel ? 1.5 : 0))) *
        (seen.round === currentRound ? 1 : 0.55);
      if (weight === 0) continue;
      latest.set(card.physicalId, {
        code: colorFixing ? 'color-fixing' : wheel ? 'wheel' : 'late-card',
        cards: [card.physicalId],
        archetype,
        polarity: 'positive',
        round: seen.round,
        pickNumber: seen.pickNumber,
        weight,
        text: `${card.name} ${wheel ? 'wheeled' : 'was available'} at pack ${String(seen.round)}, pick ${String(seen.pickNumber)}${colorFixing ? '; fixing is weak color evidence, not evidence for a specific engine' : specificity < 0.4 ? '; a broadly useful card is a weak lane signal' : ''}.`,
      });
    }
  }
  const observations = [...latest.values()];
  const byPack = new Map<string, number>();
  for (const observation of observations) {
    const key = `${String(observation.round)}/${String(((observation.pickNumber ?? 1) - 1) % state.seats)}`;
    byPack.set(key, Math.min(3, (byPack.get(key) ?? 0) + (observation.weight ?? 0)));
  }
  const score = [...byPack.values()].reduce((sum, v) => sum + v, 0);
  const independent = [...byPack.values()].filter((weight) => weight >= 0.5).length;
  const recent = state.observations.filter((o) => o.round === currentRound && o.pickNumber >= 5).slice(-4);
  const cooling =
    score >= 1 &&
    recent.length === 4 &&
    recent.every(
      (o) =>
        !o.cards.some((c) =>
          profileOf(model, c).archetypes.some((a) => a.archetype === archetype && a.signal >= 0.5),
        ),
    );
  return {
    score: cooling ? score * 0.5 : score,
    label: cooling
      ? 'Cooling'
      : score >= 3.5 && independent >= 2
        ? 'Strong evidence'
        : score >= 1
          ? 'Some evidence'
          : observations.length
            ? 'Little evidence'
            : 'Unknown',
    confidence: independent >= 4 ? 'High' : independent >= 2 ? 'Medium' : 'Low',
    observations: cooling
      ? [
          ...observations,
          {
            code: 'lane-cooling',
            polarity: 'negative',
            archetype,
            cards: [],
            text: 'The last four late packs offered no specific support. Earlier signals may no longer describe this direction.',
          },
        ]
      : observations,
  };
}
