import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ScryfallCardSchema } from '../src/scryfall/schemas';
import { printedCardEntry } from '../src/printed-card/entry';
import { FIXTURES, VALID_FIXTURE_CARDS } from './helpers';

const cards = readFileSync(FIXTURES.oracleCards, 'utf8')
  .trim()
  .split('\n')
  .slice(0, VALID_FIXTURE_CARDS)
  .map((line) => ScryfallCardSchema.parse(JSON.parse(line)));
const card = cards[0]!;
const identity = {
  position: 1,
  sourceName: card.name,
  correctedName: card.name,
  forgeScript: 'l/lightning_bolt.txt',
};
const script = new TextEncoder().encode(`Name:${card.name}\n`);

describe('shared printed-card presentation entry', () => {
  it('preserves exact printings and source identity even for the same Oracle card', () => {
    const first = printedCardEntry('akh', identity, card, script);
    const otherPrinting = { ...card, id: '00000000-0000-0000-0000-000000000002' };
    const second = printedCardEntry('hou', identity, otherPrinting, script);
    expect(first.physicalId).toBe(`akh:0001:${card.id}`);
    expect(second.physicalId).toBe(`hou:0001:${otherPrinting.id}`);
    expect(first.oracleId).toBe(second.oracleId);
    expect(first.scryfallId).not.toBe(second.scryfallId);
    expect(first.forgeScriptSha256).toBe(createHash('sha256').update(script).digest('hex'));
    expect(card.id).not.toBe(otherPrinting.id);
  });

  it('retains both faces and rejects an incomplete face rather than inventing its type', () => {
    const split = cards.find((entry) => entry.card_faces !== undefined)!;
    const entry = printedCardEntry('akh', identity, split, script);
    expect(entry.faces.map((face) => face.name)).toEqual(split.card_faces!.map((face) => face.name));
    const { type_line: _type, ...faceWithoutType } = split.card_faces![0]!;
    expect(() =>
      printedCardEntry('akh', identity, { ...split, card_faces: [faceWithoutType] }, script),
    ).toThrow(/has no type line/);
  });

  it('validates position and format-bound output at the shared seam', () => {
    expect(() => printedCardEntry('akh', { ...identity, position: 0 }, card, script)).toThrow();
  });
});
