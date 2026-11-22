// @vitest-environment jsdom
/**
 * The set icon: an official set's own symbol in the seal, still in rarity's ink.
 *
 * The playtester, 2026-09-14: "pull in the set icon as part of the frame so it
 * isn't just the three letter text showing the rarity and has the set symbol".
 * `../src/card/set-icon.ts` is the registry and the launcher's staging run is
 * what decides which codes have one; the page only ever paints a code the
 * launcher said it served. Three things are held here.
 *
 * First, the derivation: an href is a pure function of the code and the staged
 * list, and a code that was not staged is `null` rather than a guessed path,
 * because a guessed path is an empty seal.
 *
 * Second, the string the launcher writes reaches the page intact and no
 * further: uppercased, deduplicated, and a stray entry dropped rather than
 * refused.
 *
 * Third, the face: when the bundle was built with a staged code the seal is a
 * masked span carrying the icon and the rarity, and otherwise it is the drawn
 * mark the parity suite compares against. The build-time constant is stubbed
 * before the modules are loaded, which is why every import below is dynamic.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('where an icon is served from', () => {
  it('derives the href from the code and the staged list, uppercase on both sides', async () => {
    const { setIconHref } = await import('../src/card/set-icon');
    const staged = new Set(['M11', 'ISD']);
    expect(setIconHref('M11', staged)).toBe('set-icons/M11.svg');
    expect(setIconHref('isd', staged)).toBe('set-icons/ISD.svg');
  });

  it('answers null for a code the launcher did not stage, so the face draws its mark', async () => {
    const { setIconHref } = await import('../src/card/set-icon');
    expect(setIconHref('XMP', new Set(['M11']))).toBeNull();
    expect(setIconHref('M11', new Set())).toBeNull();
  });

  it('fetches from the lowercase path Scryfall serves and files under the uppercase code', async () => {
    const { setIconAssetName, setIconSourceUrl } = await import('../src/card/set-icon');
    expect(setIconSourceUrl('M11')).toBe('https://svgs.scryfall.io/sets/m11.svg');
    expect(setIconAssetName('m11')).toBe('M11.svg');
  });
});

describe('what the launcher wrote', () => {
  it('reads a comma-separated list, trimmed, uppercased and deduplicated', async () => {
    const { stagedSetIconsFrom } = await import('../src/card/set-icon');
    expect([...stagedSetIconsFrom(' m11, M13 ,rtr,M11')]).toEqual(['M11', 'M13', 'RTR']);
  });

  it('drops an entry that is not a set code rather than refusing the page', async () => {
    const { stagedSetIconsFrom } = await import('../src/card/set-icon');
    expect([...stagedSetIconsFrom('M11,,not a code,AKH')]).toEqual(['M11', 'AKH']);
    expect(stagedSetIconsFrom('').size).toBe(0);
  });

  it('is empty outside a launcher build, so a test render draws every mark', async () => {
    const { STAGED_SET_ICONS } = await import('../src/card/set-icon');
    expect(STAGED_SET_ICONS.size).toBe(0);
  });
});

describe('the seal on the face', () => {
  it('paints the staged icon as a mask over the rarity ink', async () => {
    const { EXAMPLE_CARDS } = await import('@mtg/dsl');
    const example = EXAMPLE_CARDS[0];
    if (example === undefined) throw new Error('the DSL ships no example card');
    vi.stubGlobal('__MTG_SET_ICONS__', example.set.code);
    const { Card } = await import('../src/card/Card');
    const html = renderToStaticMarkup(createElement(Card, { card: example }));
    expect(html).toMatch(/<span [^>]*class="mtg-card__seal mtg-card__seal--icon"/);
    expect(html).toContain(`--mtg-set-icon:url(&quot;set-icons/${example.set.code}.svg&quot;)`);
    expect(html).toMatch(new RegExp(`<span [^>]*data-rarity="${example.rarity}"[^>]*class="mtg-card__seal`));
    expect(html).not.toMatch(/<svg [^>]*class="mtg-card__seal"/);
  });

  it('draws the mark when nothing was staged, which is what the printed face prints', async () => {
    const { EXAMPLE_CARDS } = await import('@mtg/dsl');
    const example = EXAMPLE_CARDS[0];
    if (example === undefined) throw new Error('the DSL ships no example card');
    const { Card } = await import('../src/card/Card');
    const html = renderToStaticMarkup(createElement(Card, { card: example }));
    expect(html).toMatch(/<svg [^>]*class="mtg-card__seal"/);
    expect(html).not.toContain('mtg-card__seal--icon');
  });
});
