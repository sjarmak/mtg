/**
 * Reading an art manifest.
 *
 * Two properties matter. A manifest that this build cannot read must say which
 * field is wrong, because the alternative — resolving to nothing — is
 * indistinguishable from a set whose art was never generated, and that is the
 * one failure the pending frame is designed to make impossible to hide. And a
 * card with no entry must resolve to `null` rather than to anything else, since
 * `null` is what the art slot turns into the labeled frame.
 */
import { describe, expect, it } from 'vitest';
import { basicLand, EXAMPLE_CARDS } from '@mtg/dsl';
import {
  ART_MANIFEST_VERSION,
  artResolver,
  readArtManifest,
  rotatesIllustrations,
  selectIllustration,
} from '../../src/lab/art-manifest';

const first = EXAMPLE_CARDS[0];
if (first === undefined) throw new Error('the DSL example set is empty');

function manifestOf(art: Readonly<Record<string, { href: string; alt: string }>>): unknown {
  const variants = Object.fromEntries(Object.entries(art).map(([id, entry]) => [id, [entry]]));
  return { formatVersion: ART_MANIFEST_VERSION, art: variants };
}

describe('reading an art manifest', () => {
  it('accepts one the pipeline would write', () => {
    const result = readArtManifest(
      manifestOf({ [first.id]: { href: './a.png', alt: 'a study' } }),
      'art.json',
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a set with no art at all, which is a real state', () => {
    const result = readArtManifest(manifestOf({}), 'art.json');
    expect(result.ok).toBe(true);
  });

  it('names the field when an entry is wrong', () => {
    const result = readArtManifest(manifestOf({ [first.id]: { href: '', alt: 'a study' } }), 'art.json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(`art.${first.id}.0.href`);
    expect(result.message).toContain('art.json');
  });

  it('rejects a version it does not know rather than resolving to nothing', () => {
    const result = readArtManifest({ formatVersion: 99, art: {} }, 'art.json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('formatVersion');
  });

  it('tells you how to rebuild it', () => {
    const result = readArtManifest({ nothing: true }, 'art.json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('npm run art');
  });
});

describe('resolving art for a card', () => {
  const parsed = readArtManifest(
    manifestOf({ [first.id]: { href: 'art/a.png', alt: 'a lantern on a pier' } }),
    'art.json',
  );
  if (!parsed.ok) throw new Error(parsed.message);
  const resolve = artResolver(parsed.manifest);

  it('maps the manifest’s href onto the img src the slot renders', () => {
    expect(resolve(first)).toEqual({ src: 'art/a.png', alt: 'a lantern on a pier' });
  });

  it('returns null for a card the manifest does not cover', () => {
    const other = EXAMPLE_CARDS.find((card) => card.id !== first.id);
    if (other === undefined) throw new Error('the DSL example set has one card');
    expect(resolve(other)).toBeNull();
  });
});

/**
 * The ruling this suite exists for: "the art for the cards shouldn't rotate,
 * there is a preferred art". A named card carrying three collated candidates
 * showed all three across one game, including ones already decided against.
 * Basic lands are the deliberate exception — a real set prints five Swamps.
 */
describe('rotation is for basic lands only', () => {
  const named = EXAMPLE_CARDS.find((card) => card.kind !== 'land');
  if (named === undefined) throw new Error('the DSL example set has no non-land card');
  const swamp = basicLand('Swamp', 'XMP', 1);
  const three = ['one', 'two', 'three'];

  it('gives a named card its first illustration for every copy', () => {
    for (const copy of [0, 1, 2, 5, 41]) {
      expect(selectIllustration(named, three, copy)).toBe('one');
    }
    expect(rotatesIllustrations(named)).toBe(false);
  });

  it('keeps round-robining a basic land, so five Swamps show three pictures', () => {
    expect(rotatesIllustrations(swamp)).toBe(true);
    expect([0, 1, 2, 3, 4].map((copy) => selectIllustration(swamp, three, copy))).toEqual([
      'one',
      'two',
      'three',
      'one',
      'two',
    ]);
  });

  it('resolves a named card to position zero through the manifest resolver', () => {
    const parsed = readArtManifest(
      {
        formatVersion: ART_MANIFEST_VERSION,
        art: {
          [named.id]: [
            { href: 'art/preferred.png', alt: 'the chosen one' },
            { href: 'art/other.png', alt: 'the one nobody picked' },
          ],
        },
      },
      'art.json',
    );
    if (!parsed.ok) throw new Error(parsed.message);
    const resolve = artResolver(parsed.manifest);
    for (const copy of [0, 1, 2, 3]) {
      expect(resolve(named, copy)?.src).toBe('art/preferred.png');
    }
  });

  it('still returns null when a card has no entry at all', () => {
    expect(selectIllustration(named, [], 0)).toBeNull();
    expect(selectIllustration(swamp, [], 3)).toBeNull();
  });
});
