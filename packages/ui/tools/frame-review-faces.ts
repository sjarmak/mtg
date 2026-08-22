/**
 * The two pure lookups `frame-review.ts` needs from a set document and an art
 * manifest document, split out so they are testable without touching disk.
 *
 * The tool used to hardcode `tideglass-reach.set.json` and read no art at all:
 * `faces()` closed over a constant instead of taking the parsed document as an
 * argument, so no test could tell it apart from the real thing without also
 * running the script's file writes and console output. Splitting the lookup
 * from the I/O is the same move `frame-review-args.ts` makes for the argv
 * parse, and `board-crowding.ts`'s `artFor` is the precedent for rebasing a
 * manifest's relative hrefs onto the manifest's own directory.
 */
import { dirname, resolve } from 'node:path';
import { parseCard } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { artResolver, readArtManifest } from '../src/lab/art-manifest';
import type { ArtResolver } from '../src/lab/art-manifest';
import { cardColorIdentity } from '../src/card/identity';
import type { ColorIdentity } from '../src/styles/tokens';

/** One card per identity, taken from `document`, creatures preferred. */
export function facesOf(document: unknown, setPath: string): ReadonlyMap<ColorIdentity, DslCard> {
  if (typeof document !== 'object' || document === null || !('cards' in document)) {
    throw new Error(`${setPath} has no "cards" array, so it is not a set document`);
  }
  const { cards } = document as { cards: unknown };
  if (!Array.isArray(cards)) throw new Error(`${setPath} has no "cards" array`);
  const chosen = new Map<ColorIdentity, DslCard>();
  for (const raw of cards) {
    const card = parseCard(raw);
    const identity = cardColorIdentity(card);
    const held = chosen.get(identity);
    if (held === undefined || (held.kind !== 'creature' && card.kind === 'creature')) {
      chosen.set(identity, card);
    }
  }
  // A monocolored set has no card to stand in for the gold frame. One is
  // written here rather than left out: `m` is a frame the palette declares
  // and the review is about frames.
  if (!chosen.has('m')) {
    chosen.set(
      'm',
      parseCard({
        id: 'frame-review-gold',
        name: 'Tideglass Envoy',
        rarity: 'rare',
        set: { code: 'TGR', collectorNumber: 999 },
        colors: ['W', 'U'],
        supertypes: [],
        subtypes: ['Merfolk', 'Scout'],
        keywords: ['flying'],
        effects: [],
        power: 2,
        toughness: 3,
        kind: 'creature',
        manaCost: { generic: 1, W: 1, U: 1, B: 0, R: 0, G: 0 },
        artifact: false,
        oracleText: 'Flying',
      }),
    );
  }
  return chosen;
}

/**
 * A resolver over `document`, with every href rebased to a `file://` path
 * beside `artPath` — the same rebasing `board-crowding.ts`'s `artFor` does,
 * so a relative href in the manifest resolves the way it would for that tool.
 */
export function artResolverFor(document: unknown, artPath: string): ArtResolver {
  const read = readArtManifest(document, artPath);
  if (!read.ok) throw new Error(read.message);
  const base = dirname(resolve(artPath));
  const resolver = artResolver(read.manifest);
  return (card, copy) => {
    const found = resolver(card, copy);
    return found === null ? null : { ...found, src: `file://${resolve(base, found.src)}` };
  };
}
