/** Demon of Death's Gate's two casting routes on the human play surface. */
import { describe, expect, it } from 'vitest';
import { basicLand, parseCard, type CardInput } from '@mtg/dsl';
import { pendingDecision, scenario } from '@mtg/kernel';
import { castPlansFor } from '../../src/routes/play/cast';
import { buildPrompt, playableFromHand } from '../../src/routes/play/prompt';

const DEMON = parseCard({
  kind: 'creature',
  id: 'm11-92-demon-play-surface',
  name: "Demon of Death's Gate",
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 92 },
  colors: ['B'],
  manaCost: { generic: 6, B: 3 },
  subtypes: ['Demon'],
  power: 9,
  toughness: 9,
  keywords: ['flying', 'trample'],
  alternativeCost: {
    payLife: 6,
    sacrificeMatching: { count: 3, filter: { cardTypes: ['creature'], colors: ['B'] } },
  },
} as CardInput);

function offering(name: string, collectorNumber: number, power: number) {
  return parseCard({
    kind: 'creature',
    id: `demon-play-offering-${String(collectorNumber)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    colors: ['B'],
    manaCost: { B: 1 },
    power,
    toughness: 1,
  });
}

describe("Demon of Death's Gate play choices", () => {
  it('keeps the card clickable and names each exact printed or alternative payment', () => {
    const offerings = [
      offering('First Offering', 1, 1),
      offering('Second Offering', 2, 2),
      offering('Third Offering', 3, 3),
      offering('Fourth Offering', 4, 4),
    ];
    const state = scenario({
      battlefield: [
        ...offerings.map((card) => ({ card, controller: 0 as const })),
        ...Array.from({ length: 9 }, (_unused, index) => ({
          card: basicLand('Swamp', 'TST', 10 + index),
          controller: 0 as const,
        })),
      ],
      hands: [[DEMON], []],
    }).state;
    const decision = pendingDecision(state);
    if (decision?.kind !== 'priority') throw new Error('play surface found no priority decision');
    const prompt = buildPrompt(state, decision, ['You', 'Bot']);
    const casts = prompt.choices.filter((choice) => choice.kind === 'castSpell');
    const demonOid = state.players[0].hand[0];
    if (demonOid === undefined) throw new Error('play surface lost Demon from hand');

    expect(casts).toHaveLength(5);
    expect(casts.filter((choice) => choice.detail === 'Pay {6}{B}{B}{B}')).toHaveLength(1);
    expect(casts.filter((choice) => choice.detail?.startsWith('Pay 6 life · Sacrifice '))).toHaveLength(4);
    expect(new Set(casts.map((choice) => `${choice.label}|${choice.detail}`)).size).toBe(5);
    expect(playableFromHand(prompt)).toContain(demonOid);
    expect(castPlansFor(state, decision).has(demonOid)).toBe(false);
  });
});
