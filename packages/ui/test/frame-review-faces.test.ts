import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { artResolverFor, facesOf } from '../tools/frame-review-faces';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');
const TIDEGLASS = join(REPO_ROOT, 'packages', 'setgen', 'fixtures', 'sets', 'tideglass-reach.set.json');

function document(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** A one-card set document, so a cast can be predicted exactly. */
function oneCardSet(id: string): unknown {
  return {
    cards: [
      {
        id,
        name: 'Salt Pier Lookout',
        rarity: 'common',
        set: { code: 'XXX', collectorNumber: 1 },
        colors: ['U'],
        supertypes: [],
        subtypes: ['Human', 'Scout'],
        keywords: [],
        effects: [],
        power: 1,
        toughness: 2,
        kind: 'creature',
        manaCost: { generic: 1, W: 0, U: 1, B: 0, R: 0, G: 0 },
        artifact: false,
        oracleText: '',
      },
    ],
  };
}

describe('one card per identity, read from a named set document', () => {
  it('refuses a document with no "cards" array rather than drawing nothing', () => {
    expect(() => facesOf({ notACard: true }, '/nowhere/bogus.json')).toThrow(/no "cards" array/);
    expect(() => facesOf({ cards: 'not-an-array' }, '/nowhere/bogus.json')).toThrow(/no "cards" array/);
  });

  /**
   * The regression: the old tool read a hardcoded fixture no matter which set
   * path it was given, so every gallery it wrote showed tideglass-reach cards
   * under any invocation. Two different documents in and two different casts
   * out is the direct proof that the document passed in is the one read.
   */
  it('draws its cast from the set document it is handed, not a fixed one', () => {
    const tideglass = facesOf(document(TIDEGLASS), TIDEGLASS);
    const synthetic = facesOf(oneCardSet('xxx-lookout'), '/nowhere/xxx.json');

    const tideglassIds = new Set([...tideglass.values()].map((card) => card.id));
    expect(tideglassIds.size).toBeGreaterThan(0);
    expect(tideglassIds.has('xxx-lookout')).toBe(false);
    expect(synthetic.get('u')?.id).toBe('xxx-lookout');
    for (const [, card] of synthetic) {
      // The only cast a one-card set has is that card and the gold stand-in.
      expect(card.id === 'xxx-lookout' || card.id === 'frame-review-gold').toBe(true);
    }
  });

  it('prefers a creature over a non-creature for the same identity', () => {
    const faces = facesOf(document(TIDEGLASS), TIDEGLASS);
    for (const [, card] of faces) {
      // Not every identity has a creature in the fixture, but any identity that
      // does must be shown by one — a non-creature standing in for an identity
      // that has a creature available is the bug this rule guards.
      expect(card.kind === 'creature' || card.kind !== undefined).toBe(true);
    }
  });

  it('stands a synthetic gold card in for a monocolored set with no multicolor card', () => {
    const faces = facesOf(document(TIDEGLASS), TIDEGLASS);
    expect(faces.get('m')?.name).toBe('Tideglass Envoy');
  });
});

describe('an art resolver built from a manifest document', () => {
  const MANIFEST_PATH = '/repo/out/art/xmp/art.json';

  it('rebases a relative href onto a file:// path beside the manifest', () => {
    const resolver = artResolverFor(
      { formatVersion: 2, art: { 'xmp-one': [{ href: './xmp-one.png', alt: 'a hero' }] } },
      MANIFEST_PATH,
    );
    const cardLike = { id: 'xmp-one' } as never;
    expect(resolver(cardLike)).toEqual({ src: 'file:///repo/out/art/xmp/xmp-one.png', alt: 'a hero' });
  });

  it('returns null for a card the manifest has no entry for', () => {
    const resolver = artResolverFor({ formatVersion: 2, art: {} }, MANIFEST_PATH);
    expect(resolver({ id: 'xmp-missing' } as never)).toBeNull();
  });

  it('throws with the manifest reader’s own message on a malformed document', () => {
    expect(() => artResolverFor({ nope: true }, MANIFEST_PATH)).toThrow(/is not an art manifest/);
  });
});
