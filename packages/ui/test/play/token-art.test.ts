/**
 * A token on the battlefield resolves its art from the manifest.
 *
 * The board already asked for it — `permanentProps` calls `artFor(object.card)`
 * on every permanent, and the kernel puts a real `Card` on the battlefield for a
 * token — so nothing here is a new seam. What was missing was the *answer*: no
 * manifest ever carried a `token-<slug>` key, because the art plan was composed
 * over a set's cards and a token is not one. This test is the join, stated from
 * the renderer's end: a manifest keyed the way the art pipeline now keys it, a board
 * with tokens on it, and the assertion that they come back with art rather than
 * with the pending frame.
 */
import { describe, expect, it } from 'vitest';
import { setTokenCards, tokenCard, TokenSpecSchema } from '@mtg/dsl';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCards } from '@mtg/dsl';
import { scenario } from '@mtg/kernel';
import { artResolver, readArtManifest } from '../../src/lab/art-manifest';
import { boardPosition } from '../../src/routes/play/position';

const KEY = TokenSpecSchema.parse({ name: 'Key', power: 0, toughness: 1, subtypes: ['Key'] });
const PART = TokenSpecSchema.parse({ name: 'Part', power: 0, toughness: 1, subtypes: ['Part'] });

/** A card that creates both tokens, so the enumerator has something to walk. */
const HAULER: CardInput = {
  kind: 'creature',
  id: 'xmp-brigand-chest-hauler',
  name: 'Brigand Chest Hauler',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 25 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  subtypes: ['Goblin'],
  power: 3,
  toughness: 3,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1, B: 1 }, sacrificeSelf: true },
      effects: [
        { kind: 'createToken', count: 1, token: PART },
        { kind: 'createToken', count: 1, token: KEY },
      ],
    },
  ],
};

function manifestOver(cards: readonly Card[]): unknown {
  return {
    formatVersion: 2,
    art: Object.fromEntries(
      cards.map((card) => [
        card.id,
        [{ href: `art/${card.id}.png`, alt: `an illustration of ${card.name}` }],
      ]),
    ),
  };
}

function boardWith(tokens: readonly Card[], artFor: ReturnType<typeof artResolver> | null) {
  const state = scenario({
    battlefield: tokens.map((card) => ({ card, controller: 0 as const, token: true })),
  }).state;
  return boardPosition(state, 0, ['You', 'Opponent'], artFor);
}

describe('a token on the battlefield', () => {
  const tokens = setTokenCards(parseCards([HAULER]));

  it('is keyed in the manifest by the id tokenCard gives it', () => {
    expect(tokens.map((token) => token.id)).toEqual(['token-part', 'token-key']);
    expect(tokens[0]).toEqual(tokenCard(PART));
  });

  it('draws its illustration when the manifest covers it', () => {
    const parsed = readArtManifest(manifestOver(tokens), 'test');
    if (!parsed.ok) throw new Error(parsed.message);
    const board = boardWith(tokens, artResolver(parsed.manifest));
    const drawn = board.you.battlefield.permanents;
    expect(drawn).toHaveLength(tokens.length);
    expect(drawn.map((permanent) => permanent.art?.src)).toEqual(['art/token-part.png', 'art/token-key.png']);
  });

  /** The state this closed: every token, every game, with nothing tracking it. */
  it('falls back to the pending frame when the manifest covers only the cards', () => {
    const parsed = readArtManifest(manifestOver(parseCards([HAULER])), 'test');
    if (!parsed.ok) throw new Error(parsed.message);
    const board = boardWith(tokens, artResolver(parsed.manifest));
    expect(board.you.battlefield.permanents.map((permanent) => permanent.art)).toEqual([null, null]);
  });
});
