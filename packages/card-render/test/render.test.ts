import { describe, expect, it } from 'vitest';
import { ART_PENDING_LABEL as UI_ART_PENDING_LABEL, TOKEN_CSS as UI_TOKEN_CSS } from '@mtg/ui';
import { parseCard, renderOracleText, renderTypeLine } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import {
  ART_PENDING_LABEL,
  CARD_HEIGHT_MM,
  CARD_WIDTH_MM,
  TOKEN_CSS,
  artRegistry,
  checkSvgOverflow,
  footerText,
  parseArtManifest,
  renderCardSvg,
} from '@mtg/card-render';
import { planeswalkerCards, stressCards } from './fixtures/cards';

const CARDS = stressCards();

function card(id: string): Card {
  const found = CARDS.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no stress card ${id}`);
  return found;
}

function onlyPlaneswalker(): Card {
  const [found] = planeswalkerCards();
  if (found === undefined) throw new Error('no planeswalker fixture');
  return found;
}

const PLANESWALKER = onlyPlaneswalker();

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The frame group alone: the layer the plate is painted on. */
function frameLayersOf(svg: string): string {
  const found = /<g class="frame-layers">[\s\S]*?<\/g>/.exec(svg);
  if (found === null) throw new Error('the rendered face drew no frame layers');
  return found[0];
}

describe('the document', () => {
  it('is a printable card at true size', () => {
    const { svg } = renderCardSvg(card('stress-all-keywords'));
    expect(svg).toContain(`width="${CARD_WIDTH_MM}mm"`);
    expect(svg).toContain(`height="${CARD_HEIGHT_MM}mm"`);
    expect(svg).toContain('viewBox="0 0 630 880"');
  });

  it('is byte-identical across renders, so a re-render diffs to nothing', () => {
    const target = card('stress-max-oracle');
    expect(renderCardSvg(target).svg).toBe(renderCardSvg(target).svg);
  });

  it('carries the card identity as data attributes', () => {
    const { svg } = renderCardSvg(card('stress-artifact-creature'));
    expect(svg).toContain('data-card-id="stress-artifact-creature"');
    expect(svg).toContain('data-identity="u"');
    expect(svg).toContain('data-artifact="true"');
    expect(svg).toContain('data-rarity="uncommon"');
  });

  it('names the card for assistive tech, cost and stats included', () => {
    const { svg } = renderCardSvg(card('stress-artifact-creature'));
    expect(svg).toContain('aria-label="Tideglass Automaton {3}{U}, Artifact Creature — Construct, 4/5"');
  });

  it('names a planeswalker for assistive tech, loyalty in place of stats', () => {
    const { svg } = renderCardSvg(PLANESWALKER);
    expect(svg).toContain(
      'aria-label="Warden of the Tideglass Vigil {2}{W}{G}, Planeswalker — Warden, Loyalty 5"',
    );
  });

  it('prints characteristic-defined stats as stars in the face and accessible name', () => {
    const crusader = parseCard({
      kind: 'creature',
      id: 'render-variable-crusader',
      name: 'Variable Crusader',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 901 },
      manaCost: { generic: 2, W: 1 },
      colors: ['W'],
      power: 0,
      toughness: 0,
      characteristicPowerToughness: { kind: 'creaturesYouControl' },
    });
    const { svg } = renderCardSvg(crusader);
    expect(svg).toContain('aria-label="Variable Crusader {2}{W}, Creature, */*"');
    expect(svg).toContain('>*/*</text>');
  });

  it('embeds the shared token sheet rather than a second palette', () => {
    const { svg } = renderCardSvg(card('stress-basic-land'));
    expect(TOKEN_CSS).toBe(UI_TOKEN_CSS);
    expect(svg).toContain('--mtg-frame-u:');
  });

  it('contains no color literal of its own', () => {
    const { svg } = renderCardSvg(card('stress-many-pips'));
    const withoutTokens = svg.replace(UI_TOKEN_CSS, '');
    expect(withoutTokens).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(withoutTokens).not.toMatch(/\b(?:rgb|hsl|oklch)\(/);
  });

  it('omits the stylesheet when the page already carries the tokens', () => {
    const { svg } = renderCardSvg(card('stress-basic-land'), { embedStyles: false });
    expect(svg).not.toContain('<style>');
    expect(svg).toContain('data-identity="u"');
  });

  it('pins a theme on the root element only when asked to', () => {
    // The token sheet mentions `data-theme` in its own selectors, so this has
    // to look at the root tag rather than at the file.
    const rootTag = (svg: string): string => svg.slice(0, svg.indexOf('>'));
    expect(rootTag(renderCardSvg(card('stress-basic-land')).svg)).not.toContain('data-theme');
    expect(rootTag(renderCardSvg(card('stress-basic-land'), { theme: 'auto' }).svg)).not.toContain(
      'data-theme',
    );
    expect(rootTag(renderCardSvg(card('stress-basic-land'), { theme: 'dark' }).svg)).toContain(
      'data-theme="dark"',
    );
  });

  it('namespaces its defs per card so many faces can share a page', () => {
    const a = renderCardSvg(card('stress-basic-land')).svg;
    const b = renderCardSvg(card('stress-many-pips')).svg;
    expect(a).toContain('id="stress-basic-land-art-clip"');
    expect(b).toContain('id="stress-many-pips-art-clip"');
  });
});

describe('the frame', () => {
  it('takes its identity from the DSL color, including for a land', () => {
    expect(renderCardSvg(card('stress-basic-land')).svg).toContain('data-identity="u"');
    expect(renderCardSvg(card('stress-colorless-artifact')).svg).toContain('data-identity="c"');
  });

  it('reads a multicolor card as gold with a ramp across its real colors', () => {
    const { svg } = renderCardSvg(card('stress-many-pips'));
    expect(svg).toContain('data-identity="m"');
    expect(svg).toContain('<linearGradient');
    for (const token of [
      '--mtg-color-w',
      '--mtg-color-u',
      '--mtg-color-b',
      '--mtg-color-r',
      '--mtg-color-g',
    ]) {
      expect(svg).toContain(`stop-color="var(${token})"`);
    }
  });

  it('draws no ramp for a single-color card', () => {
    expect(renderCardSvg(card('stress-all-keywords')).svg).not.toContain('<linearGradient');
  });

  it('hatches an artifact frame on top of its color identity, and hatches nothing else', () => {
    // Scoped to the frame group on purpose. `art.ts` fills a pending art window
    // from the same pattern, so a document-wide search for the id passes on
    // nineteen of the twenty-one non-artifact cards this package renders in
    // tests and the assertion says nothing. One pattern meaning two things is
    // its own defect; this test just refuses to be the thing that hides it.
    const artifactCreature = renderCardSvg(card('stress-artifact-creature')).svg;
    expect(frameLayersOf(artifactCreature)).toContain('url(#stress-artifact-creature-plate)');
    expect(artifactCreature).toContain('data-identity="u"');

    const plain = renderCardSvg(card('stress-all-keywords')).svg;
    expect(frameLayersOf(plain)).not.toContain('url(#stress-all-keywords-plate)');
    expect(plain).toContain('url(#stress-all-keywords-plate)');
  });
});

describe('the regions', () => {
  it('prints the DSL type line verbatim', () => {
    const target = card('stress-big-stats');
    const { svg } = renderCardSvg(target);
    expect(svg).toContain(`>${renderTypeLine(target)}<`);
  });

  it('prints the DSL oracle text, one run per wrapped line', () => {
    const target = card('stress-all-keywords');
    const { svg } = renderCardSvg(target);
    const runs = [...svg.matchAll(/<text[^>]*data-region="rules"[^>]*>([^<]*)</g)].map(
      (match) => match[1] ?? '',
    );
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.join(' ')).toBe(renderOracleText(target).replace(/\n/g, ' '));
  });

  it('gives a creature a P/T badge, a planeswalker a loyalty shield, everything else none', () => {
    // Two badges, not one badge printing two things. They were one region until
    // the walker face was drawn: a creature's P/T sits in the frame band at the
    // bottom right of the card, and a walker's loyalty sits *lower and larger*,
    // straddling the band rather than inside it, because it has to read as the
    // number the game changes rather than as the card's printed statistics. A
    // shared region would have had to be one shape or the other.
    const creature = renderCardSvg(card('stress-big-stats'));
    expect(creature.svg).toContain('data-region="powerToughness"');
    expect(creature.svg).not.toContain('data-region="loyalty"');
    const planeswalker = renderCardSvg(PLANESWALKER);
    expect(planeswalker.svg).toContain('data-region="loyalty"');
    expect(planeswalker.svg).not.toContain('data-region="powerToughness"');
    expect(planeswalker.svg).toContain('>5<');
    const land = renderCardSvg(card('stress-basic-land'));
    expect(land.svg).not.toContain('data-region="powerToughness"');
    expect(land.svg).not.toContain('data-region="loyalty"');
  });

  it('prints the collector line the set file already knows', () => {
    const target = card('stress-big-stats');
    expect(footerText(target)).toBe('STR 005 · rare · MV 15');
    expect(renderCardSvg(target).svg).toContain('>STR 005 · rare · MV 15<');
  });

  it('reports a fit for every region it drew', () => {
    const render = renderCardSvg(card('stress-max-oracle'));
    expect(render.fits.map((fit) => fit.region).sort()).toEqual(['footer', 'rules', 'title', 'type']);
    expect(render.ok).toBe(true);
    expect(render.failures).toEqual([]);
  });

  it('shrinks the rules box for long text rather than keeping one size', () => {
    const long = renderCardSvg(card('stress-max-oracle'));
    const short = renderCardSvg(card('stress-artifact-creature'));
    const size = (render: typeof long): number =>
      render.fits.find((fit) => fit.region === 'rules')?.fontSize ?? 0;
    expect(size(long)).toBeLessThan(size(short));
    expect(long.fits.find((fit) => fit.region === 'rules')?.lines).toBeGreaterThan(4);
  });

  it('wraps a title that will not shrink to a readable single line', () => {
    const render = renderCardSvg(card('stress-long-name'));
    expect(render.fits.find((fit) => fit.region === 'title')?.lines).toBeGreaterThan(1);
    expect(render.ok).toBe(true);
  });
});

describe('the art slot', () => {
  it('announces itself as pending, with the label @mtg/ui uses', () => {
    const { svg, hasArt } = renderCardSvg(card('stress-basic-land'));
    expect(ART_PENDING_LABEL).toBe(UI_ART_PENDING_LABEL);
    expect(hasArt).toBe(false);
    expect(svg).toContain('data-art-state="pending"');
    expect(svg).toContain('aria-label="Art pending for stress-basic-land"');
    expect(svg).toContain(`>${ART_PENDING_LABEL}<`);
    expect(svg).toContain('>stress-basic-land<');
  });

  it('composites an image from the registry when one exists', () => {
    const art = artRegistry(
      parseArtManifest({
        formatVersion: 2,
        art: { 'stress-basic-land': [{ href: PIXEL, alt: 'a flooded shelf at dusk' }] },
      }),
    );
    const { svg, hasArt } = renderCardSvg(card('stress-basic-land'), { art });
    expect(hasArt).toBe(true);
    expect(svg).toContain('data-art-state="ready"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(svg).toContain('clip-path="url(#stress-basic-land-art-clip)"');
    expect(svg).toContain('aria-label="a flooded shelf at dusk"');
  });

  it('leaves a card the registry does not cover pending', () => {
    const art = artRegistry(
      parseArtManifest({
        formatVersion: 2,
        art: { 'some-other-card': [{ href: PIXEL, alt: 'unrelated' }] },
      }),
    );
    expect(renderCardSvg(card('stress-basic-land'), { art }).hasArt).toBe(false);
  });

  it('refuses a manifest that is not one', () => {
    expect(() => parseArtManifest({ formatVersion: 1, art: {} })).toThrow();
    expect(() => parseArtManifest({ formatVersion: 2, art: { x: [{ href: '' }] } })).toThrow();
    // An empty list is refused too: absence already means "renders pending", and
    // a second spelling of one state is what the format was widened to avoid.
    expect(() => parseArtManifest({ formatVersion: 2, art: { x: [] } })).toThrow();
  });
});

describe('every stress card', () => {
  it('renders with no run leaving its box', () => {
    for (const entry of CARDS) {
      const render = renderCardSvg(entry);
      expect(checkSvgOverflow(render.svg), entry.id).toEqual([]);
      expect(render.failures, entry.id).toEqual([]);
    }
  });
});
