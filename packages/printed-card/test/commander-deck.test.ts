import { describe, expect, it } from 'vitest';
import { checkCommanderDeck } from '../src/commander-deck';
import type { PrintedCardCatalogEntry } from '../src/index';

const hash = 'a'.repeat(64);
let position = 0;
const entry = (
  name: string,
  typeLine: string,
  colorIdentity: readonly string[],
  oracleText: string | null = null,
): PrintedCardCatalogEntry => {
  position += 1;
  const face = {
    name,
    manaCost: '',
    typeLine,
    oracleText,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [...colorIdentity],
  };
  return {
    physicalId: `scd-printed-v1:${String(position).padStart(4, '0')}:${hash}`,
    position,
    sourceName: name,
    correctedName: name,
    name,
    oracleId: hash,
    scryfallId: hash,
    forgeScript: `${name[0]!.toLowerCase()}/${name.toLowerCase().replace(/[^a-z]+/gu, '_')}.txt`,
    forgeScriptSha256: hash,
    layout: 'normal',
    manaCost: '',
    manaValue: 0,
    typeLine,
    oracleText,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [...colorIdentity],
    colorIdentity: [...colorIdentity],
    producedMana: null,
    faces: [face],
    art: { status: 'pending', source: 'scryfall', scryfallId: hash, images: [] },
  } as unknown as PrintedCardCatalogEntry;
};
const kardur = entry('Kardur, Doomscourge', 'Legendary Creature — Demon Berserker', ['B', 'R']);
const signet = entry('Arcane Signet', 'Artifact', []);
const bolt = entry('Lightning Bolt', 'Instant', ['R']);
const counterspell = entry('Counterspell', 'Instant', ['U']);
const swamp = entry('Swamp', 'Basic Land — Swamp', []);
const mountain = entry('Mountain', 'Basic Land — Mountain', []);
const rats = entry(
  'Relentless Rats',
  'Creature — Rat',
  ['B'],
  'A deck can have any number of cards named Relentless Rats.',
);
const sword = entry('Sword of Truth', 'Legendary Artifact', []);
const vehicle = entry(
  'Shorikai, Genesis Engine',
  'Legendary Artifact — Vehicle',
  ['W', 'U'],
  'Shorikai, Genesis Engine can be your commander.',
);
const tymna = entry(
  'Tymna the Weaver',
  'Legendary Creature — Human Cleric',
  ['W', 'B'],
  'Partner (You can have two commanders if both have partner.)',
);
const thrasios = entry('Thrasios, Triton Hero', 'Legendary Creature — Merfolk Wizard', ['G', 'U'], 'Partner');
const printings = new Map(
  [kardur, signet, bolt, counterspell, swamp, mountain, rats, sword, vehicle, tymna, thrasios].map(
    (card) => [card.physicalId, card] as const,
  ),
);
const slot = (card: PrintedCardCatalogEntry, count = 1) => ({
  physicalId: card.physicalId,
  name: card.correctedName,
  count,
});
const legal = {
  id: 'chaos',
  name: 'Chaos',
  commanders: [slot(kardur)],
  cards: [slot(signet), slot(bolt), slot(swamp, 48), slot(mountain, 49)],
};

describe('Commander deck check', () => {
  it('passes a hundred-card singleton deck inside its commander’s identity', () => {
    expect(checkCommanderDeck(legal, printings)).toEqual({
      legal: true,
      colorIdentity: ['B', 'R'],
      cards: 100,
      findings: [],
    });
  });

  it('names every rule a list breaks, by card', () => {
    const verdict = checkCommanderDeck(
      {
        ...legal,
        cards: [slot(signet, 2), slot(counterspell), slot(rats, 3), slot(swamp, 45), slot(mountain, 49)],
      },
      printings,
    );
    expect(verdict.legal).toBe(false);
    expect(verdict.findings).toEqual([
      { kind: 'duplicate', detail: 'Arcane Signet appears 2 times' },
      {
        kind: 'off-color',
        detail: "Counterspell has identity {U}, outside the commander's {BR}",
      },
      { kind: 'deck-size', detail: '101 cards including the commander; a Commander deck is 100' },
    ]);
  });

  it('reads eligibility off the type line and the card’s own text, and partner off both commanders', () => {
    const with_ = (commanders: PrintedCardCatalogEntry[], cards = legal.cards) =>
      checkCommanderDeck({ ...legal, commanders: commanders.map((c) => slot(c)), cards }, printings);
    expect(with_([sword]).findings).toContainEqual({
      kind: 'commander-ineligible',
      detail: 'Sword of Truth is not a legendary creature and does not say it can be your commander',
    });
    expect(with_([vehicle]).findings).toEqual([
      { kind: 'off-color', detail: "Lightning Bolt has identity {R}, outside the commander's {WU}" },
    ]);
    expect(with_([]).findings[0]).toEqual({ kind: 'commander-count', detail: 'no commander' });
    expect(with_([kardur, tymna]).findings[0]).toEqual({
      kind: 'commander-count',
      detail: 'two commanders, and not both have partner: Kardur, Doomscourge, Tymna the Weaver',
    });
    const partners = with_([tymna, thrasios], [slot(signet), slot(swamp, 48), slot(mountain, 49)]);
    expect(partners.colorIdentity).toEqual(['W', 'U', 'B', 'G']);
    expect(partners.findings).toEqual([]);
    expect(partners.legal).toBe(true);
  });

  it('refuses a slot the catalog does not carry and a commander repeated in the deck', () => {
    const verdict = checkCommanderDeck(
      {
        ...legal,
        cards: [
          ...legal.cards.slice(0, 3),
          slot(mountain, 48),
          slot(kardur),
          { physicalId: 'x:0000:y', name: 'Ghost', count: 1 },
        ],
      },
      printings,
    );
    expect(verdict.findings).toEqual([
      { kind: 'unresolved', detail: 'Ghost is not a printing this catalog carries' },
      { kind: 'duplicate', detail: 'Kardur, Doomscourge is the commander and also in the deck' },
      { kind: 'deck-size', detail: '101 cards including the commander; a Commander deck is 100' },
    ]);
  });
});
