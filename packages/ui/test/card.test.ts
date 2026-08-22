// @vitest-environment jsdom
/**
 * The card face over the whole DSL example set.
 *
 * Markup-level assertions go through `renderToStaticMarkup` rather than reading
 * DOM properties: the workspace tsconfig has no `lib: dom`, so `getAttribute`
 * and friends are not typed. Behavior and accessibility go through Testing
 * Library queries, which are the assertions worth making anyway.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Card as DslCard, Color } from '@mtg/dsl';
import { BASIC_LANDS, EXAMPLE_CARDS, mana, parseCard, renderOracleText, renderTypeLine } from '@mtg/dsl';
import { Card } from '../src/card/Card';
import {
  RULES_FIT_STEPS,
  collectorLine,
  faceAttributes,
  frameTreatment,
  rulesFitStep,
  textBoxBlocks,
} from '../src/card/anatomy';
import type { FrameTreatment } from '../src/card/anatomy';
import { ART_PENDING_LABEL } from '../src/card/ArtSlot';
import { cardColorIdentity } from '../src/card/identity';
import { ManaPips } from '../src/card/ManaPips';
import type { ManaPipsProps } from '../src/card/ManaPips';
import { GlobalStyles, uiStyleSheet } from '../src/styles/index';
import { COLOR_IDENTITIES, DARK_TOKENS, LIGHT_TOKENS, SCALE_TOKENS } from '../src/styles/tokens';
import type { ColorIdentity } from '../src/styles/tokens';
import { TITLE_PIP_TO_TEXT } from '../src/card/anatomy';

afterEach(cleanup);

/**
 * The OKLCH lightness a palette block declares for a token, or null when it
 * declares none. Lightness alone because it is the channel a 1px keyline reads
 * at: the pair this replaced differed only in hue, at a chroma of 0.01.
 */
function lightnessOf(block: string, token: string): number | null {
  const found = new RegExp(`${token}:\\s*oklch\\(([0-9.]+)`).exec(block);
  return found === null ? null : Number(found[1]);
}

interface StyleLike {
  readonly getPropertyValue: (property: string) => string;
}

interface ElementLike {
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => ArrayLike<ElementLike>;
  readonly getAttribute: (name: string) => string | null;
  readonly textContent: string | null;
}

interface WindowLike {
  readonly document: { readonly body: ElementLike };
  readonly getComputedStyle: (element: ElementLike) => StyleLike;
}

/**
 * The computed style of the one element matching `selector`, under the mounted
 * sheet. Shaped like `board.test.ts`'s, and for the same reason: the workspace
 * tsconfig has no `lib: dom`, so the window is reached through a narrow
 * structural interface rather than through the global types.
 */
function styleOf(selector: string): StyleLike {
  const candidate = globalThis as Partial<WindowLike>;
  const document = candidate.document;
  if (typeof candidate.getComputedStyle !== 'function' || document === undefined) {
    throw new Error('this test needs a jsdom window');
  }
  const element = document.body.querySelector(selector);
  if (element === null) throw new Error(`nothing rendered matched ${selector}`);
  return candidate.getComputedStyle(element);
}

const ALL_CARDS: readonly DslCard[] = [...EXAMPLE_CARDS, ...BASIC_LANDS];

/**
 * The rules lines a face printed, read off its markup.
 *
 * A brace token is painted rather than set (`../src/card/SymbolText.ts`), so a
 * line is a text node, an abbreviation carrying `{T}` as its own text, and
 * another text node. Testing Library's text queries compare a node's *direct*
 * text children, which a symbolized line no longer has in one piece — so the
 * line is put back together from the markup, where the token is still there to
 * put back.
 */
function printedLines(card: DslCard, size?: 'compact' | 'board'): readonly string[] {
  const markup = renderToStaticMarkup(h(Card, { card, ...(size === undefined ? {} : { size }) }));
  // The opening tag carries `data-fit` after `data-region`, and a creature's
  // out-of-flow P/T badge follows the box, so neither end is a fixed string.
  const open = /<span class="mtg-card__text"[^>]*>/.exec(markup);
  if (open === null) return [];
  const rest = markup.slice(open.index + open[0].length);
  const after = /<span class="mtg-card__(?:stats|foot)"/.exec(rest);
  const box = after === null ? rest : rest.slice(0, after.index);
  return box
    .split('<span class="mtg-card__line')
    .slice(1)
    .map((line) =>
      line
        .replace(/^[^>]*>/, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'),
    );
}

/**
 * The type line a face printed, read off its markup for the reason above.
 *
 * The bar sets its line in three spans — supertypes, card types, subtypes — so
 * that a crowded board face can drop a whole phrase instead of cutting one
 * (`mtg-mq81`, `../src/card/type-line.ts`). That leaves the element without its
 * line as a single direct text child, which is exactly what Testing Library's
 * text queries compare, so the line is put back together here.
 */
function printedTypeLine(card: DslCard): string {
  const markup = renderToStaticMarkup(h(Card, { card }));
  const open = /<span class="mtg-card__type"[^>]*>/.exec(markup);
  if (open === null) return '';
  const rest = markup.slice(open.index + open[0].length);
  // The bar closes after the rarity seal, which is an `<svg>` carrying no text.
  const seal = rest.indexOf('<svg');
  const end = seal === -1 ? rest.indexOf('</span></span>') : seal;
  return rest
    .slice(0, end === -1 ? rest.length : end)
    .replace(/<[^>]*>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function baseCreature(): DslCard {
  const creature = EXAMPLE_CARDS.find((card) => card.kind === 'creature');
  if (creature === undefined) throw new Error('the DSL example set has no creature');
  return creature;
}

/**
 * A planeswalker, whose corner badge prints a starting loyalty rather than a
 * power/toughness. The DSL example set carries none — `xmp-vessari-hero-of-hours`
 * is the flagship's first — so this is hand-authored, the way `TROPHY_HORN` is
 * in `card-face-a11y.test.ts`, and shaped the same way `@mtg/card-render`'s
 * parity fixture of the same name is.
 */
const WARDEN: DslCard = parseCard({
  id: 'planeswalker-loyalty-badge',
  name: 'Warden of the Tideglass Vigil',
  kind: 'planeswalker',
  rarity: 'mythic',
  set: { code: 'PWK', collectorNumber: 1 },
  colors: ['G', 'W'],
  subtypes: ['Warden'],
  manaCost: { generic: 2, G: 1, W: 1 },
  startingLoyalty: 5,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'targetCreatureYouControl' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -2,
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

/** One card per frame identity, built off a real example card. */
function cardForIdentity(identity: ColorIdentity): DslCard {
  const base = baseCreature();
  if (base.kind !== 'creature') throw new Error('expected a creature');
  switch (identity) {
    case 'c':
      return { ...base, colors: [], artifact: true, manaCost: mana({ generic: 3 }) };
    case 'm':
      return { ...base, colors: ['W', 'U'], manaCost: mana({ W: 1, U: 1 }) };
    default: {
      const color = identity.toUpperCase() as Color;
      return { ...base, colors: [color], manaCost: mana({ generic: 1, [color]: 1 }) };
    }
  }
}

describe('Card', () => {
  it('renders every example card in the DSL set', () => {
    expect(ALL_CARDS.length).toBeGreaterThan(15);
    for (const card of ALL_CARDS) {
      const view = render(h(Card, { card }));
      expect(screen.getByText(card.name)).toBeTruthy();
      expect(printedTypeLine(card), `${card.id} type line`).toBe(renderTypeLine(card));
      // The box's own first line rather than `renderOracleText`'s, because the
      // two differ on a card whose keywords print reminder text (`mtg-6mx`):
      // Skywatch Sentinel's oracle string opens `Flying, vigilance` and its box
      // opens `Flying` with vigilance on a reminded line under it.
      const firstLine = textBoxBlocks(card)[0]?.text ?? '';
      if (firstLine.length > 0) expect(printedLines(card)[0], card.id).toBe(firstLine);
      view.unmount();
    }
  });

  it('prints power and toughness for creatures only', () => {
    for (const card of ALL_CARDS) {
      const view = render(h(Card, { card }));
      if (card.kind === 'creature') {
        expect(screen.getByText(`${card.power}/${card.toughness}`)).toBeTruthy();
      } else {
        expect(screen.queryByText(/^\d+\/\d+$/)).toBeNull();
      }
      view.unmount();
    }
  });

  /**
   * A planeswalker's starting loyalty draws in the corner a creature's
   * power/toughness draws in (`statBadge`, `../src/card/Card.ts`), at every size
   * that draws one — but not in the same badge. It is a shield, and the element
   * says so, because the sheet keys a whole face's worth of rules off
   * `:has(.mtg-card__shield)`: the shorter art window, the band the box gives up
   * under its last row, and where the badge hangs. `art` size draws neither
   * badge — its overlay is the land pip, for creature and planeswalker alike —
   * so it is not asserted here.
   */
  it("prints starting loyalty in the corner a creature's stats use, at every size that has one", () => {
    for (const size of ['full', 'board', 'compact'] as const) {
      const view = render(h(Card, { card: WARDEN, size }));
      const container = view.container as unknown as ElementLike;
      const badge = container.querySelector('.mtg-card__shield');
      expect(badge, size).toBeTruthy();
      expect(badge?.textContent, size).toBe('5');
      // And not through the creature badge, which is what those rules would
      // otherwise match on every creature in the set.
      expect(container.querySelector('.mtg-card__pt'), size).toBeNull();
      view.unmount();
    }
  });

  /**
   * The other side of the split: a creature's badge is untouched by any of it.
   * `.mtg-card__pt` is read by the board face, the land tile and the combat
   * zone as well as by this one, so the planeswalker shield had to be a second
   * element rather than the same one with a different silhouette.
   */
  it('leaves a creature drawing the power/toughness badge and no shield', () => {
    for (const size of ['full', 'board', 'compact'] as const) {
      const view = render(h(Card, { card: baseCreature(), size }));
      const container = view.container as unknown as ElementLike;
      expect(container.querySelector('.mtg-card__pt'), size).toBeTruthy();
      expect(container.querySelector('.mtg-card__shield'), size).toBeNull();
      view.unmount();
    }
  });

  /**
   * The rows of a planeswalker's text box, as structure rather than as a
   * string. Each loyalty ability is its own row carrying its cost in its own
   * element, so the sheet can rule one row off from the next and wrap the
   * ability in a column the badge does not enter; `[+1]:` is not written into
   * the words anywhere. The minus is U+2212, which is the character a printed
   * card sets and the one `loyaltyCostText` produces.
   */
  it('draws each loyalty ability as its own row with its cost in its own element', () => {
    const view = render(h(Card, { card: WARDEN }));
    const container = view.container as unknown as ElementLike;
    const rows = Array.from(container.querySelectorAll('.mtg-card__line'));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute('data-loyalty'))).toStrictEqual(['+1', '\u22122']);
    for (const row of rows) {
      const badges = Array.from(row.querySelectorAll('.mtg-card__loyalty'));
      expect(badges).toHaveLength(1);
      expect(badges[0]?.textContent).toBe(row.getAttribute('data-loyalty'));
      expect(row.textContent ?? '').not.toContain('[');
    }
    expect(container.textContent ?? '').toContain('Put a +1/+1 counter on target creature you control.');
    view.unmount();
  });

  /**
   * A row with no cost on it, which is a real row of a planeswalker's box and
   * not a missing one: it draws no badge and states no `data-loyalty`, and the
   * sheet's two-column rule is keyed off that attribute so the row sets across
   * the whole box. Flavor text is the reachable case today — @mtg/dsl refuses a
   * static or triggered ability on a planeswalker — and it is the same shape
   * the printed card's uncosted ability would arrive in.
   */
  it('draws an uncosted row across the box with no badge on it', () => {
    const flavored: DslCard = { ...WARDEN, flavorText: 'The vigil keeps what tides lose.' };
    const view = render(h(Card, { card: flavored }));
    const container = view.container as unknown as ElementLike;
    const rows = Array.from(container.querySelectorAll('.mtg-card__line'));
    const uncosted = rows.filter((row) => row.getAttribute('data-loyalty') === null);
    expect(uncosted).toHaveLength(1);
    expect(uncosted[0]?.textContent).toBe('The vigil keeps what tides lose.');
    expect(Array.from(uncosted[0]?.querySelectorAll('.mtg-card__loyalty') ?? [])).toHaveLength(0);
    view.unmount();
  });

  it('renders every color identity', () => {
    for (const identity of COLOR_IDENTITIES) {
      const card = cardForIdentity(identity);
      expect(cardColorIdentity(card)).toBe(identity);
      const markup = renderToStaticMarkup(h(Card, { card }));
      expect(markup).toContain(`data-identity="${identity}"`);
      const view = render(h(Card, { card }));
      expect(screen.getByText(card.name)).toBeTruthy();
      view.unmount();
    }
  });

  it('publishes what the face is made of, not just its identity', () => {
    // The colorless fixture above has been an artifact creature since this
    // file was written and nothing ever read that back off the face. The
    // printed face marked it; the DOM face did not, and the parity suite could
    // not see the difference because neither side was asked.
    const plate = cardForIdentity('c');
    const markup = renderToStaticMarkup(h(Card, { card: plate }));
    expect(markup).toContain('data-artifact="true"');
    expect(markup).toContain('data-colors=""');
    expect(markup).toContain(`data-rarity="${plate.rarity}"`);

    const colored = cardForIdentity('m');
    const goldMarkup = renderToStaticMarkup(h(Card, { card: colored }));
    expect(goldMarkup).toContain('data-identity="m"');
    expect(goldMarkup).toContain('data-colors="wu"');
    expect(goldMarkup).toContain('data-artifact="false"');
  });

  /**
   * The treatment is an argument, not a hint. `faceAttributes` used to derive
   * its own, so a caller that had already derived one — both renderers have —
   * paid for the derivation twice and could not have published anything else if
   * it wanted to. The card below is a red non-artifact and the treatment handed
   * in says green plate, so an implementation that re-derives fails all three
   * lines rather than passing whatever it happened to compute.
   */
  it('publishes the treatment it is handed rather than deriving its own', () => {
    const card = cardForIdentity('r');
    const derived = frameTreatment(card);
    const handed: FrameTreatment = { identity: 'g', colors: ['G'], artifact: true };
    expect(derived).not.toEqual(handed);

    const attributes = faceAttributes(card, handed);
    expect(attributes['data-identity']).toBe('g');
    expect(attributes['data-colors']).toBe('g');
    expect(attributes['data-artifact']).toBe('true');
    // The two facts that are the card's own, not the treatment's, still are.
    expect(attributes['data-rarity']).toBe(card.rarity);
    expect(attributes['data-card-id']).toBe(card.id);
  });

  it('gives an artifact face a keyline its identity does not supply', () => {
    // Read out of the cascade rather than off the rule, because what decides
    // this is source order between two selectors of equal weight: the artifact
    // declaration has to come after the identity block or it silently loses.
    const base = baseCreature();
    if (base.kind !== 'creature') throw new Error('expected a creature');
    const plain: DslCard = { ...base, colors: ['U'], manaCost: mana({ generic: 1, U: 1 }) };
    const plate: DslCard = { ...plain, id: `${base.id}-plate`, artifact: true };
    render(h('div', {}, h(GlobalStyles, {}), h(Card, { card: plain }), h(Card, { card: plate })));

    expect(styleOf(".mtg-card[data-artifact='false']").getPropertyValue('--edge')).toBe(
      'var(--mtg-frame-u-edge)',
    );
    expect(styleOf(".mtg-card[data-artifact='true']").getPropertyValue('--edge')).not.toBe(
      'var(--mtg-frame-u-edge)',
    );
  });

  /**
   * The keyline has to be a different color, not merely a different token.
   *
   * The first artifact rule pointed `--edge` at `--mtg-line-strong`, whose
   * lightness sits within 0.005 of the colorless edge on paper and 0.010 in the
   * dark, so it painted nothing anyone could see. The test above could not catch
   * that: jsdom does not resolve a `var()` chain, so comparing what `--edge`
   * holds compares token names. This resolves both tokens out of the shipped
   * palettes and compares the values.
   *
   * Every identity is swept rather than the one a fixture happens to carry.
   * Colorless is the case that matters — `packages/dsl/src/validate/cost.ts`
   * forces every noncreature artifact to a colorless cost, so identity `c` is
   * where most artifacts land — and it was the one the original test did not
   * exercise.
   */
  it('separates that keyline from every identity edge, in both palettes', () => {
    const artifactEdge = /--edge:\s*var\((--mtg-[a-z0-9-]+)\)/.exec(
      new RegExp(`\\.mtg-card\\[data-artifact='true'\\][^}]*}`).exec(uiStyleSheet())?.[0] ?? '',
    )?.[1];
    expect(artifactEdge).toBeTruthy();

    for (const [palette, block] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const plateLightness = lightnessOf(block, artifactEdge ?? '');
      expect(plateLightness, `${artifactEdge} is undeclared in ${palette}`).not.toBeNull();

      for (const identity of COLOR_IDENTITIES) {
        const edgeLightness = lightnessOf(block, `--mtg-frame-${identity}-edge`);
        expect(edgeLightness, `--mtg-frame-${identity}-edge is undeclared in ${palette}`).not.toBeNull();
        // 0.05 in OKLCH lightness is comfortably above the just-noticeable
        // difference on a 1px keyline; the shipped pair clears 0.19 everywhere.
        expect(
          Math.abs((plateLightness ?? 0) - (edgeLightness ?? 0)),
          `${palette}: the artifact keyline is invisible against identity ${identity}`,
        ).toBeGreaterThan(0.05);
      }
    }
  });

  /**
   * Direction B's one claim about the face: a hand of six reads as six colors.
   *
   * What makes that true is *where* the identity is painted, not which oklch
   * value it resolves to, so this asserts the arrangement rather than any of the
   * colors involved — `./card-surfaces.test.ts` holds those.
   *
   * The border half of the arrangement is direction B's and does not move: a
   * printed edge carries the whole outline of the card and reads at thumbnail
   * size, where a 1px keyline is a hairline. What did move is the sentence this
   * test used to end on, "the ground is the same neutral for all seven". That was
   * not a decision about neutral grounds; it was the conclusion of an argument
   * whose premise was that a tint under the face survives only in the gutter,
   * because every child repaints `surface-raised` over it. The children no longer
   * do. `--panel` and `--well` carry the identity into the bars, the rules box,
   * the badge and the window, so the ground is free to be the card's own color
   * again — and the reason a card read as white first was that ground and
   * children were both paper, not that the border was doing too little.
   */
  it('paints the identity on the border and through the whole interior', () => {
    const sheet = uiStyleSheet();
    for (const identity of COLOR_IDENTITIES) {
      const rule = new RegExp(`\\.mtg-card\\[data-identity='${identity}'\\][^}]*}`).exec(sheet)?.[0] ?? '';
      expect(rule, `identity ${identity} has no rule`).not.toBe('');
      expect(rule, `identity ${identity} paints no identity channel`).toContain(
        `--identity: var(--mtg-color-${identity})`,
      );
      expect(rule, `identity ${identity} paints no ground channel`).toContain(
        `--frame: var(--mtg-frame-${identity})`,
      );
    }

    const face = /\n\.mtg-card \{[^}]*\}/.exec(sheet)?.[0] ?? '';
    expect(face).not.toBe('');
    expect(face, 'the face does not spend the identity channel on its border').toContain(
      'border: var(--frame-band) solid var(--identity)',
    );
    // A printed edge, not a keyline, and a *share* of the card rather than a
    // pixel count (mtg-iqyc): the band is FRAME_BAND_MM of the trim's width, so
    // the same face reads the same at 88px in the combat band and at 320 in the
    // hover zoom. Above a fiftieth of the card, because under that the identity
    // is a hairline again at every size rather than only at the small ones.
    const band = /--frame-band: calc\(var\(--card-w\) \* ([\d.]+)\)/.exec(face);
    expect(band, 'the border width is not a share of the card').not.toBeNull();
    expect(Number(band?.[1] ?? 0)).toBeGreaterThan(0.02);
    expect(face, 'the ground is neutral paper again').toContain('background: var(--frame)');
  });

  it('labels the pending art state', () => {
    const card = baseCreature();
    render(h(Card, { card }));
    expect(screen.getByText(ART_PENDING_LABEL)).toBeTruthy();
    expect(screen.getByLabelText(`${ART_PENDING_LABEL} for ${card.id}`)).toBeTruthy();
    expect(screen.getByText(card.id)).toBeTruthy();
  });

  it('renders supplied art instead of the pending frame', () => {
    const card = baseCreature();
    render(h(Card, { card, art: { src: 'art/sentinel.png', alt: 'a sentinel over a cliff' } }));
    expect(screen.getByAltText('a sentinel over a cliff')).toBeTruthy();
    expect(screen.queryByText(ART_PENDING_LABEL)).toBeNull();
  });

  it('names the mana cost for assistive technology', () => {
    const card = baseCreature();
    if (card.kind === 'land') throw new Error('expected a castable card');
    render(h(Card, { card }));
    expect(screen.getByRole('img', { name: /^Mana cost \{/ })).toBeTruthy();
  });

  it('keeps the set and the rarity readable with no collector line on any face', () => {
    // The line used to print both as words, which is why the seal was
    // decoration and hid itself; it has left the face entirely
    // (`../src/card/anatomy.ts`, FACE_REGIONS) and the seal speaks at every
    // size. A footnote displaces nothing now — it is the foot's only text.
    //
    // Both words, in the order the line printed them: the mark is the set's and
    // the ink is the rarity's, so a reader who cannot see the seal is told the
    // two facts it is made of rather than the one that used to be drawable.
    const card = baseCreature();
    const spoken = `${card.set.code} ${card.rarity}`;
    const plain = render(h(Card, { card }));
    expect(screen.queryByText(collectorLine(card))).toBeNull();
    expect(screen.getByRole('img', { name: spoken })).toBeTruthy();
    plain.unmount();

    render(h(Card, { card, size: 'compact', footnote: 'unplayable' }));
    expect(screen.getByText('unplayable')).toBeTruthy();
    expect(screen.queryByText(collectorLine(card))).toBeNull();
    expect(screen.getByRole('img', { name: spoken })).toBeTruthy();
  });

  it('drops art and rules text in the compact size', () => {
    const card = baseCreature();
    render(h(Card, { card, size: 'compact' }));
    expect(screen.getByText(card.name)).toBeTruthy();
    expect(screen.queryByText(ART_PENDING_LABEL)).toBeNull();
    const firstLine = renderOracleText(card).split('\n')[0] ?? '';
    if (firstLine.length > 0) expect(screen.queryByText(firstLine)).toBeNull();
  });

  it('becomes a button when a selection handler is given', () => {
    const card = baseCreature();
    const picked: string[] = [];
    render(
      h(Card, {
        card,
        onSelect: (selected: DslCard) => {
          picked.push(selected.id);
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: new RegExp(card.name) }));
    expect(picked).toEqual([card.id]);
  });

  it('renders a land with its tap ability', () => {
    const land = BASIC_LANDS[0];
    if (land === undefined) throw new Error('no basic lands in the DSL set');
    render(h(Card, { card: land }));
    expect(printedLines(land)).toEqual([renderOracleText(land)]);
    expect(screen.queryByRole('img', { name: /^Mana cost/ })).toBeNull();
  });
});

/** The pips a run of markup declares, in document order. */
function pipRun(markup: string): readonly string[] {
  return [...markup.matchAll(/data-pip="([a-z]+)"/g)].map((match) => match[1] ?? '');
}

/** The numeral inside the generic pip, or null when no generic pip was drawn. */
function genericNumeral(markup: string): string | null {
  return /data-pip="generic"[^>]*>(\d+)</.exec(markup)?.[1] ?? null;
}

/**
 * A free cost prints `{0}`, and nothing may switch that off.
 *
 * `costPips` emits the generic pip when the cost carries a generic amount *or*
 * has no colored pip at all, so `mana()` is one numeral rather than an empty
 * run — a free spell says it is free. `ManaPipsProps` used to carry a `showZero`
 * flag that suppressed precisely that pip. It defaulted on, no caller in any
 * package ever set it, and `@mtg/card-render` draws the same run from the same
 * `costPips` with no such switch — ADR-0002 §2.2 puts the generic pip on the
 * shared side of the split, "both faces print the same numeral" — so the only
 * effect the flag could ever have had was to make the two renderers disagree.
 * It is deleted, and these two tests stand where it was.
 */
describe('ManaPips', () => {
  it('prints a free cost as a {0} pip', () => {
    const markup = renderToStaticMarkup(h(ManaPips, { cost: mana() }));
    expect(pipRun(markup)).toEqual(['generic']);
    expect(genericNumeral(markup)).toBe('0');

    render(h(ManaPips, { cost: mana() }));
    expect(screen.getByRole('img', { name: 'Mana cost {0}' })).toBeTruthy();
  });

  /**
   * A compile-time assertion, so `npm run typecheck` is where it runs and it
   * fails the build the moment the property type-checks again. The runtime half
   * matters too: it is what the flag actually did, and it has to be dead even
   * for a JavaScript caller who never saw the type.
   */
  it('has no prop that could hide that pip', () => {
    // @ts-expect-error the switch is gone; a caller still passing it must not compile
    const props: ManaPipsProps = { cost: mana(), showZero: false };
    expect(genericNumeral(renderToStaticMarkup(h(ManaPips, props)))).toBe('0');
  });
});

/**
 * The title pip's diameter is drawn two ways: the DOM face sets `--pip-box`
 * to `calc(var(--mtg-text-sm) * var(--mtg-leading-tight))`
 * (`../src/styles/card.ts`), so the pip is always exactly the name's own line
 * box; the printed face has no CSS `calc` to lean on, so `TITLE_PIP_TO_TEXT`
 * in `../src/card/anatomy` (re-exported from `@mtg/card-geometry`) is its own
 * copy of the same multiplier, applied to `TITLE_MAX_SIZE` in
 * `packages/card-render/src/geometry.ts`.
 *
 * Two independent numbers standing for one ratio is exactly the shape that
 * drifts silently, so this reads `--mtg-leading-tight`'s own declared value
 * out of the shipped token sheet and checks it against `TITLE_PIP_TO_TEXT`
 * directly, rather than asserting either one's literal value. That is the
 * property the agreement is supposed to produce — a pip that lines up with
 * the text it sits beside — as far as it is observable without a layout
 * engine: jsdom performs no layout, so this cannot measure the rendered pixel
 * size of either face's pip, only that the two numbers a real browser would
 * multiply through are still the same number.
 */
describe('the title pip stays sized off the same leading as the name', () => {
  it('keeps TITLE_PIP_TO_TEXT equal to --mtg-leading-tight', () => {
    const declared = /--mtg-leading-tight:\s*([0-9.]+);/.exec(SCALE_TOKENS)?.[1];
    if (declared === undefined) throw new Error('--mtg-leading-tight is not declared in SCALE_TOKENS');
    expect(TITLE_PIP_TO_TEXT).toBe(Number(declared));
  });
});

/**
 * A card is the printed trim, and the rules box is what gives.
 *
 * The playtester, 2026-08-13: "the cards also seem to be different sizes based on
 * the amount of text in the textbox, and when hovering over to see the full
 * card while playing it shows a border that extends further vertically". One
 * line was both symptoms. `.mtg-card[data-size='full']` carried a `min-height`
 * at the trim, which is a floor and not a shape: a card could never be shorter
 * than 63:88 and could be as much taller as its rules box wanted. So a gallery
 * row was a row of different heights, and the hover zoom — a full face with no
 * neighbor to be measured against — drew its 7px identity border down whatever
 * box the text had grown to.
 *
 * `aspect-ratio` at the same trim is the fix, with `min-height: 0` beside it,
 * and the second half is not housekeeping: a box with a preferred aspect ratio
 * takes its content as its automatic minimum size, so the ratio alone changed
 * nothing measurable. Measured in chrome-headless-shell over the 80-card
 * flagship set at the designed 15.25rem width, the faces came out at 340.8,
 * 343.3 and 388.9px before, and at 340.8 for all 80 after — one height and one
 * trim, 0.716 against the printed 63:88.
 *
 * A fixed box then has to answer which region gives, and **the text gives
 * before the picture does**. That reverses what this file used to assert.
 * The playtester, the same day: "the dimensions of the card art should be consistent
 * across cards but we can adjust the text size within the box." Re-measured
 * under the old `flex: 100 100 auto` bias, the window came out at thirteen
 * heights between 64.1px and 197.7px across the flagship set plus its five
 * basics, because the bias carried `flex-grow` as well as `flex-shrink`: a
 * laconic card blew the picture up and a talkative one crushed it. The window
 * is `flex: none` now and measures 214 x 140.7px on all 80 faces.
 *
 * What gives instead is the type size, by a ladder shared with the printed face
 * (`../src/card/anatomy.ts`, `rulesFitStep`) and published as `data-fit` so it
 * can be read without a layout engine. There is no scrollbar under it: the box
 * is `overflow-y: clip`, because the zoom is `pointer-events: none` and cannot
 * be scrolled anyway, and because a scrollbar would hide a card past the
 * ladder's floor rather than show it. The floor's answer is the zoom, which
 * draws the whole face larger and sets its rules box back at step 0.
 */
describe('the full face is the trim', () => {
  const SHEET_TRIM = uiStyleSheet();

  it('shapes the card rather than flooring it', () => {
    const full = /\.mtg-card\[data-size='full'\] \{([^}]*)\}/.exec(SHEET_TRIM)?.[1];
    expect(full, 'the full face declares nothing of its own').toBeDefined();
    expect(full).toMatch(/aspect-ratio: 63 \/ 88/);
    // Both, or neither works: an aspect ratio takes the content as its own
    // automatic minimum size, so the ratio without this floor is inert.
    expect(full, 'the ratio is left to lose to the content-based minimum').toContain('min-height: 0');
    // And no floor at the trim anywhere, which is what let a card grow past it.
    expect(SHEET_TRIM).not.toMatch(/\.mtg-card\[data-size='full'\][^{]*\{[^}]*min-height: calc/);
  });

  it('makes the words give before the picture does, with no scroll under either', () => {
    expect(SHEET_TRIM).toMatch(/\.mtg-card\[data-size='full'\] > \* \{ flex: none; \}/);
    // The window is not nominated to give at all, which is the reversal: it
    // takes the height its shared ratio gives it and no other.
    expect(SHEET_TRIM, 'the window is still allowed to grow or shrink').not.toMatch(
      /\.mtg-card\[data-size='full'\] > \[data-region='art'\]/,
    );

    const rules = /\.mtg-card\[data-size='full'\] > \[data-region='rules'\] \{([^}]*)\}/.exec(
      SHEET_TRIM,
    )?.[1];
    expect(rules, 'no region is nominated to take the residual').toBeDefined();
    expect(rules, 'the rules box does not take the residual').toContain('flex: 1 1 auto');
    // The floor that would otherwise add to more than the face.
    expect(rules).toContain('min-height: 0');
    // Clip rather than auto: a scrollbar the zoom cannot use would hide a card
    // past the ladder's floor instead of showing it.
    expect(rules).toContain('overflow-y: clip');
    expect(rules, 'a scrollbar came back').not.toContain('overflow-y: auto');
  });

  /**
   * The ladder's shape in the sheet: a rule per step, descending, with a stated
   * floor. Which card lands on which step is `./card-fit.test.ts`, over a real
   * set; this is the half the stylesheet owns.
   */
  it('declares a descending rule for every step of the shared ladder', () => {
    expect(RULES_FIT_STEPS[0], 'the ladder does not start at full size').toBe(1);
    for (const [step, scale] of RULES_FIT_STEPS.entries()) {
      expect(SHEET_TRIM, `no rule for step ${String(step)}`).toContain(
        `.mtg-card__text[data-fit='${String(step)}'] { font-size: calc(var(--mtg-text-sm) * ${String(scale)}); }`,
      );
      if (step > 0) {
        const previous = RULES_FIT_STEPS[step - 1];
        if (previous === undefined) throw new Error('the ladder has a hole in it');
        expect(scale, 'the ladder does not descend').toBeLessThan(previous);
      }
    }
    // The floor: `--mtg-text-sm` is 0.8125rem, so the last step is 10.1px at a
    // 16px root. Below that text stops being text, and the answer to a card
    // that would need it is the zoom rather than another rung.
    const floor = RULES_FIT_STEPS[RULES_FIT_STEPS.length - 1];
    if (floor === undefined) throw new Error('the ladder is empty');
    expect(floor * 0.8125 * 16).toBeGreaterThanOrEqual(10);
    // And every face publishes the step it is on, which is what the rules key
    // off: a face that stopped writing the attribute would take step 0's size
    // from no rule at all.
    for (const card of ALL_CARDS) {
      expect(renderToStaticMarkup(h(Card, { card })), card.id).toContain(
        `data-fit="${String(rulesFitStep(card))}"`,
      );
    }
  });

  /**
   * The zoom is the floor's answer, so it has to be bigger and it has to stop
   * obeying the ladder. Both halves, because either alone is no answer: a
   * larger panel that still shrank its text would be a bigger picture of the
   * same unreadable box, and full-size text in a panel the size of the face
   * would not fit.
   */
  it('draws the zoom larger and sets its rules text back to full size', () => {
    const zoom = /\.mtg-zoom > \.mtg-card \{ --card-w: ([\d.]+)rem;/.exec(SHEET_TRIM)?.[1];
    const face = /\.mtg-card \{[^}]*--card-w: ([\d.]+)rem;/.exec(SHEET_TRIM)?.[1];
    const floor = RULES_FIT_STEPS[RULES_FIT_STEPS.length - 1];
    if (zoom === undefined) throw new Error('the zoom declares no width');
    if (face === undefined) throw new Error('the full face declares no width');
    if (floor === undefined) throw new Error('the ladder is empty');
    expect(Number(zoom), 'the zoom is no larger than the face').toBeGreaterThan(Number(face));
    // Room enough to undo the ladder: the panel has to be at least as much
    // wider than the face as the floor is smaller than full size.
    expect(Number(zoom)).toBeGreaterThanOrEqual(Number(face) / floor);
    expect(SHEET_TRIM).toContain('.mtg-zoom > .mtg-card .mtg-card__text { font-size: var(--mtg-text-sm); }');
  });

  /**
   * The words stay in the tree whatever the box does. A scrolled rules box is
   * still read in full by a screen reader, and the sizes that drop the box
   * carry the same lines in `faceDetailText`; this pins the first half, which
   * is the one a height change could silently break.
   */
  it('keeps every printed line in the face at full size', () => {
    const talkative = [...EXAMPLE_CARDS].sort(
      (left, right) => renderOracleText(right).length - renderOracleText(left).length,
    )[0];
    if (talkative === undefined) throw new Error('the DSL example set is empty');
    render(h(Card, { card: talkative }));
    for (const line of renderOracleText(talkative).split('\n')) {
      expect(screen.getByText(line, { exact: false })).toBeTruthy();
    }
  });
});
