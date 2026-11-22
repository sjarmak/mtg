/**
 * The four defects the design critique confirmed, pinned so they cannot return.
 *
 * Each was found by rendering a real surface rather than by reading source, and
 * each is asserted the same way: against markup or against the emitted
 * stylesheet, not against the intent of a component.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Shell, subsLabel } from '../src/app/Shell';
import { UI_MODES, UI_SUBS } from '../src/app/router';
import { uiStyleSheet } from '../src/styles/index';
import { MICRO_LABEL } from '../src/styles/number';
import { DARK_TOKENS, LIGHT_TOKENS } from '../src/styles/tokens';
import { contrastRatio, tokenColor } from './support/oklch';
import { readDeckArtifact } from '../src/lab/deck-artifact';
import { AnalysisRoute } from '../src/routes/AnalysisRoute';
import { PlayRoute } from '../src/routes/PlayRoute';
import { DeckRoute, listPhrase } from '../src/routes/DeckRoute';
import { deckOpenParam } from '../src/routes/deck/open';
import { DeckTile } from '../src/routes/deck/DeckTile';
import { deckViewStoreKey } from '../src/routes/deck/view-mode';
import type { DeckArtifactEntry } from '../src/lab/deck-artifact';

/**
 * The link that opens the staged artifact deck.
 *
 * Since `mtg-nuk3` the Decks tab lands on the library and an open deck takes the
 * whole route, so a render that means to describe a deck has to say which one.
 * A link rather than a click because these read the markup of one render: the
 * param is exactly what a person following a link to this deck arrives with.
 */
const OPEN_ARTIFACT = deckOpenParam({ kind: 'artifact' });

const CSS = uiStyleSheet();
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function rule(selector: string): string {
  const found = CSS.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`));
  return found === null ? '' : found[0];
}

describe('a disabled choice looks disabled', () => {
  // The legal-move list disables a choice the kernel will not accept. Before
  // this rule existed the button kept full contrast and still washed accent on
  // hover, so the action looked live while doing nothing.
  it('declares a disabled rule', () => {
    const disabled = rule('.mtg-choice:disabled');
    expect(disabled).toContain('--mtg-ink-faint');
    expect(disabled).toContain('not-allowed');
  });

  it('does not light up on hover while disabled', () => {
    expect(CSS).toContain('.mtg-choice:hover:not(:disabled)');
    expect(CSS).not.toMatch(/\.mtg-choice:hover\s*\{/);
  });

  it('is declared after the kind rules, so a disabled concede reads disabled', () => {
    expect(CSS.indexOf('.mtg-choice:disabled')).toBeGreaterThan(
      CSS.indexOf(".mtg-choice[data-kind='concede']"),
    );
  });
});

describe('the sealed controls are buttons, and a disabled one looks disabled', () => {
  // .mtg-choice is the legal-move row and sets width: 100% on purpose. The
  // sealed builder borrowed it for three toolbar controls, so they rendered as
  // full-width stacked bars with no disabled affordance.
  const builderSource = readFileSync(join(REPO_ROOT, 'packages/ui/src/routes/play/SealedBuilder.ts'), 'utf8');

  // Asserted against the className expression rather than the bare selector, so
  // a comment naming the class it moved off does not fail the build.
  it('styles the sealed builder controls as buttons rather than moves', () => {
    expect(builderSource).not.toContain("className: 'mtg-choice'");
    expect(builderSource).toContain("className: 'mtg-btn'");
  });

  it('marks the commit action primary', () => {
    expect(builderSource).toContain("'data-variant': 'primary'");
  });

  it('declares a disabled rule for the button', () => {
    const disabled = rule('.mtg-btn:disabled');
    expect(disabled).toContain('--mtg-ink-faint');
    expect(disabled).toContain('not-allowed');
  });

  it('declares it after the variant rules, so a disabled primary reads disabled', () => {
    expect(CSS.indexOf('.mtg-btn:disabled')).toBeGreaterThan(CSS.indexOf(".mtg-btn[data-variant='primary']"));
  });

  it('does not light the button up on hover while disabled', () => {
    expect(CSS).toContain('.mtg-btn:hover:not(:disabled)');
    expect(CSS).not.toMatch(/\.mtg-btn:hover\s*\{/);
  });
});

describe('the micro-label tracking converges on 0.06em', () => {
  // DESIGN.md's Micro-Label Rule names one tracking value, 0.06em. Ten uppercase
  // selectors carried this role across three values (0.06em, 0.08em, 0.10em)
  // before this test existed; every uppercase rule in the sheet is swept so a
  // new selector cannot reintroduce drift undetected.
  const blocks = CSS.match(/[^{}]*\{[^{}]*\}/g) ?? [];
  const uppercaseBlocks = blocks.filter((block) => block.includes('text-transform: uppercase'));

  it('finds the ten known uppercase micro-label rules', () => {
    expect(uppercaseBlocks.length).toBeGreaterThanOrEqual(10);
  });

  it('gives every uppercase rule 0.06em tracking and none other', () => {
    for (const block of uppercaseBlocks) {
      expect(block).toContain('letter-spacing: 0.06em');
    }
    expect(CSS).not.toMatch(/text-transform:\s*uppercase[^{}]*letter-spacing:\s*(?!0\.06em)0\.\d+em/);
    expect(CSS).not.toMatch(/letter-spacing:\s*(?!0\.06em)0\.\d+em[^{}]*text-transform:\s*uppercase/);
  });

  it('pins the five selectors that previously drifted to 0.08em or 0.10em', () => {
    // .mtg-filters__label, .mtg-zone__label, .mtg-shell__subtitle and the deck
    // pane's title sat at 0.08em; .mtg-art__pending-label, the
    // art-pending pill drawn inside the hatched frame, sat at 0.10em. Rendered
    // at 0.06em it stayed legible and centered in its pill, so it converges
    // rather than becoming a DESIGN.md exception.
    //
    // `.mtg-shell__subtitle` is off the list because it is off the app: the
    // header carried `PLAY, ANALYZE, REPLAY` under the mark and the UI pass
    // removed it. `.mtg-group__title`, the small-caps label over a group of rows
    // on More, is the micro-label that took its place in the same sheet.
    //
    // `.mtg-deck__pane-title` is off it for the other reason: it is no longer a
    // micro label. `mtg-pmpu` merged the deck panes, and the two it merged
    // disagreed -- a built artifact's pane titled itself in small uppercase and
    // a builder's in ordinary type. The capture writes `Main Deck: 42` in the
    // same size as the rest of the interface, so that is what the one pane does,
    // and a rule with no `text-transform` has nothing for this case to pin.
    const drifted = [
      '.mtg-filters__label',
      '.mtg-zone__label',
      '.mtg-group__title',
      '.mtg-art__pending-label',
    ];
    for (const selector of drifted) {
      const found = rule(selector);
      expect(found).not.toBe('');
      expect(found).toContain('letter-spacing: 0.06em');
    }
  });
});

/**
 * Every uppercase rule in a sheet, found without depending on the formatter.
 *
 * `mtg-bc2.110`: this filter read `includes('text-transform: uppercase')`, a
 * literal that needs exactly one space after the colon. A micro-label written
 * `text-transform:uppercase` escaped the whole rule silently, and the bead
 * proved it by shipping a 700-weight raw-hex uppercase label past a green
 * suite. Prettier normalizes the spacing today, which is why no such rule is
 * in the tree; a guard that only holds while the formatter runs is a guard
 * about the formatter. The same reasoning applies to what the rule then
 * asserts, so the weight and the ink are matched loosely too.
 */
export function uppercaseRules(css: string): readonly string[] {
  return (css.match(/[^{}]*\{[^{}]*\}/g) ?? []).filter((block) => /text-transform:\s*uppercase/.test(block));
}

/** Where an uppercase rule breaks the micro-label rule, in the sheet's words. */
export function microLabelFaults(css: string): readonly string[] {
  const faults: string[] = [];
  const amber: string[] = [];
  for (const block of uppercaseRules(css)) {
    const selector = (block.split('{')[0] ?? '').trim();
    if (!/font-weight:\s*600/.test(block)) faults.push(`${selector} is not 600 weight`);
    if (block.includes('--mtg-pending')) amber.push(selector);
    else if (!/--mtg-ink-(faint|muted)/.test(block)) faults.push(`${selector} is neither faint nor muted`);
  }
  // DESIGN.md names exactly one exception, and names it by selector: amber is
  // this lab's semantic for withheld work, so a second rule reaching for it is
  // a second slot claiming to be unfinished.
  for (const selector of amber) {
    if (!selector.includes('.mtg-art__pending-label')) faults.push(`${selector} carries the pending amber`);
  }
  if (!amber.some((selector) => selector.includes('.mtg-art__pending-label'))) {
    faults.push('no rule carries the pending amber');
  }
  return faults;
}

/**
 * The class names the sheet has declared to be micro-labels.
 *
 * A micro-label's class is whatever a block carrying `text-transform: uppercase`
 * puts in its selector, and one selector list may name several. Taken as class
 * tokens rather than as whole selectors, because the blocks this is for are
 * size- and state-scoped *overrides* of those classes, and their selectors are
 * longer than the ones that declared the role.
 */
export function microLabelClasses(css: string): ReadonlySet<string> {
  const classes = new Set<string>();
  for (const block of uppercaseRules(css)) {
    for (const name of (block.split('{')[0] ?? '').match(/\.[A-Za-z0-9_-]+/g) ?? []) classes.add(name);
  }
  return classes;
}

/**
 * Where a rule retracks a micro-label from somewhere the uppercase sweep cannot
 * see it.
 *
 * `mtg-bc2.155`. Every check above filters the sheet to blocks that themselves
 * declare `text-transform: uppercase`, and a scoped override does not restate
 * it — it inherits the role from the base rule and changes one thing. So
 * `.mtg-card[data-size='art'] .mtg-art__pending-label` set the art tile's
 * pending pill to `0.03em`, half the value DESIGN.md names, and every sweep in
 * this file read straight past it: it declares no `text-transform`, so it is not
 * an uppercase rule, and both negative regexes require one in the same block.
 * The board's own override of the same label sits one rule away and is invisible
 * for the same reason, and so would any future one.
 *
 * The fix is inheritance, approximated the way a check on emitted bytes can: a
 * block whose selector names a class the sheet has already declared to be a
 * micro-label is held to the tracking, whether or not it restates the role. It
 * is only asked about `letter-spacing`, because that is the property an override
 * is entitled to leave alone — the board's override changes the size, the
 * padding and the margin and says nothing about tracking, which is exactly
 * right.
 */
export function microLabelRetracking(css: string): readonly string[] {
  const classes = microLabelClasses(css);
  const faults: string[] = [];
  for (const block of css.match(/[^{}]*\{[^{}]*\}/g) ?? []) {
    if (/text-transform:\s*uppercase/.test(block)) continue;
    const selector = (block.split('{')[0] ?? '').trim();
    const names = selector.match(/\.[A-Za-z0-9_-]+/g) ?? [];
    if (!names.some((name) => classes.has(name))) continue;
    const tracking = /letter-spacing:\s*([^;}]+)/.exec(block);
    if (tracking === null) continue;
    const value = (tracking[1] ?? '').trim();
    if (value !== '0.06em') faults.push(`${selector} retracks a micro-label to ${value}`);
  }
  return faults;
}

/** Uppercase rules that restate the micro-label instead of interpolating it. */
export function restatedMicroLabels(css: string): readonly string[] {
  return uppercaseRules(css)
    .filter((block) => !block.includes(MICRO_LABEL))
    .map((block) => (block.split('{')[0] ?? '').trim());
}

describe('the micro-label is one declaration, not twenty-one agreements', () => {
  // What this replaces: the four values were restated at every site, in four
  // different declaration orders, split across one line or two. The sweep below
  // could only ask whether each copy happened to agree; it could not stop a
  // twenty-second copy from disagreeing. Now the sheet has one source for the
  // rule and this asserts nothing else reaches the emitted bytes.
  it('finds every uppercase rule in the shipped sheet came from MICRO_LABEL', () => {
    expect(restatedMicroLabels(CSS)).toEqual([]);
  });

  it('names a rule that spells the four values out by hand', () => {
    // The order this used to be written in at board/log.ts, which is one of the
    // four orders the sites had drifted into. A copy that happens to reproduce
    // MICRO_LABEL character for character is invisible here, and that is the
    // limit of a check on emitted bytes: it catches drift, not a clone.
    const restated =
      '.mtg-shell__handmade { font-size: var(--mtg-text-xs); font-weight: 600;' +
      ' letter-spacing: 0.06em; text-transform: uppercase; color: var(--mtg-ink-faint); }';
    expect(restatedMicroLabels(CSS + restated)).toEqual(['.mtg-shell__handmade']);
  });

  it('holds the four properties the rule is made of', () => {
    expect(MICRO_LABEL).toContain('font-size: var(--mtg-text-xs)');
    expect(MICRO_LABEL).toContain('font-weight: 600');
    expect(MICRO_LABEL).toContain('text-transform: uppercase');
    expect(MICRO_LABEL).toContain('letter-spacing: 0.06em');
    // No ink: the ink is the part each site still decides.
    expect(MICRO_LABEL).not.toContain('color:');
  });
});

describe('the micro-label weight and ink converge, with one named exception', () => {
  // The other two axes of the same rule. Seven of the ten sites did not declare
  // 600: three said 700 outright and four said nothing at all, which inherits
  // roughly 400 — so the same role was being drawn at three weights. The ink
  // axis has exactly one divergence and DESIGN.md now names it: the art-pending
  // pill is `--mtg-pending`, because amber is this lab's semantic for withheld
  // and unfinished and that slot exists to announce itself.

  it('finds no fault in the sheet the app ships', () => {
    expect(microLabelFaults(CSS)).toEqual([]);
  });

  it('finds the uppercase rules whatever the formatter did to the spacing', () => {
    const spaced = '.a { text-transform: uppercase; }';
    const tight = '.b{text-transform:uppercase}';
    expect(uppercaseRules(`${spaced}${tight}`)).toHaveLength(2);
  });

  it('catches the unspaced micro-label the literal filter shipped past a green suite', () => {
    // mtg-bc2.110's own payload, verbatim in shape: 700 weight, a raw hex
    // color, and the one space that used to make it invisible.
    const sneaky =
      '.mtg-shell__sneaky { font-size: var(--mtg-text-xs); font-weight: 700; color: #bada55;' +
      ' text-transform:uppercase; letter-spacing: 0.06em; }';
    expect(microLabelFaults(CSS + sneaky)).toEqual([
      '.mtg-shell__sneaky is not 600 weight',
      '.mtg-shell__sneaky is neither faint nor muted',
    ]);
  });

  it('refuses a second rule reaching for the pending amber, and a sheet with none', () => {
    const second =
      '.mtg-x__label { text-transform: uppercase; font-weight: 600; color: var(--mtg-pending); }';
    expect(microLabelFaults(CSS + second)).toEqual(['.mtg-x__label carries the pending amber']);
    expect(
      microLabelFaults('.y { text-transform: uppercase; font-weight: 600; color: var(--mtg-ink-faint); }'),
    ).toEqual(['no rule carries the pending amber']);
  });

  it('keeps the amber worth its exception: never less contrast than the ink it departs from', () => {
    // `mtg-bc2.104` rendered the pill three ways before the exception stayed
    // (`../tools/pending-ink.ts` carries the report). The finding that decided
    // it: on the pill's own raised ground the amber reads 3.33:1 where faint
    // ink reads 3.07:1, so the exception is not costing a reader contrast. That
    // is the whole of its footing, and a retune of either token could take it
    // away silently — the sheet would still be green, the sweep above would
    // still find exactly one rule carrying the amber, and DESIGN.md would still
    // claim a number nobody re-measured. So the ordering is the assertion.
    //
    // Tokens rather than pixels here on purpose. The render settled what a
    // reader gets at 8px and 11px, and the answer was that the type size costs
    // nothing: the strokes reach the declared color at both. What is left is
    // arithmetic over two token values, and arithmetic belongs in the unit
    // suite rather than behind a 90-second browser rig.
    for (const [palette, block] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      // The pill declares `background: var(--mtg-surface-raised)`, so that is
      // the ground both inks are read against. Both palettes, though every
      // registered route pins paper: `SCOPED_PALETTES` is what makes the dark
      // half unreachable inside `.mtg-shell`, and it is not this rule's job to
      // depend on that staying true.
      const ground = tokenColor(block, '--mtg-surface-raised');
      const pending = contrastRatio(tokenColor(block, '--mtg-pending'), ground);
      const faint = contrastRatio(tokenColor(block, '--mtg-ink-faint'), ground);
      expect(pending, `${palette}: the pending amber is dimmer than faint ink`).toBeGreaterThanOrEqual(faint);
    }
  });

  it('holds DESIGN.md to the two ratios it quotes', () => {
    // The rule states both numbers in as many words, which is the thing that
    // rots: a token moves, the paragraph keeps its old figure, and the next
    // person reads a measurement that was true once. So the paragraph is the
    // subject and the tokens are the answer key.
    //
    // A twentieth of a ratio point of slack, because the two are not computed
    // the same way and should not be. The quoted figures are the render's, read
    // back off painted pixels through 8-bit sRGB; these are OKLCH arithmetic at
    // full precision. That gap is 3.33 against 3.348 and it is the quantization,
    // not a drift worth a red suite.
    const design = readFileSync(join(REPO_ROOT, 'DESIGN.md'), 'utf8');
    const quoted = /the amber reads ([\d.]+):1 and faint ink ([\d.]+):1/.exec(design);
    expect(quoted, 'the Micro-Label Rule no longer quotes both ratios').not.toBeNull();
    const ground = tokenColor(LIGHT_TOKENS, '--mtg-surface-raised');
    const pairs = [
      ['--mtg-pending', quoted?.[1]],
      ['--mtg-ink-faint', quoted?.[2]],
    ] as const;
    for (const [token, claim] of pairs) {
      expect(Number(claim), `${token} is quoted as ${String(claim)}`).toBeCloseTo(
        contrastRatio(tokenColor(LIGHT_TOKENS, token), ground),
        1,
      );
    }
  });

  it('pins the six selectors that did not declare 600', () => {
    const drifted = [
      '.mtg-art__pending-label',
      '.mtg-zone__label',
      '.mtg-turn__owner',
      '.mtg-choices__group-title',
      '.mtg-status__count-label',
      '.mtg-group__title',
    ];
    for (const selector of drifted) {
      const found = rule(selector);
      expect(found).not.toBe('');
      expect(found).toContain('font-weight: 600');
    }
  });
});

describe('an artifact face keeps its keyline after the identity block', () => {
  // Same weight as the seven generated identity rules, so source order is the
  // whole mechanism. Declared first it would lose the tie and an artifact
  // creature would be indistinguishable from a plain one, silently.
  it('declares the artifact rule after the last identity rule', () => {
    expect(CSS.indexOf(".mtg-card[data-artifact='true']")).toBeGreaterThan(
      CSS.indexOf(".mtg-card[data-identity='m']"),
    );
  });

  it('reaches the card face and not the deck tile', () => {
    // A deck tile renders a decklab entry, which carries a color identity and
    // no artifact flag at all.
    expect(CSS).toContain(".mtg-card[data-artifact='true']");
    expect(CSS).not.toContain('.mtg-deck-card[data-artifact');
  });
});

describe('no colored side-stripe survives', () => {
  // The shared design laws' first absolute ban. Both callouts that used one
  // already sit on their own ground, so the stripe was carrying nothing.
  it('has no border-left or border-right above 1px anywhere in the sheet', () => {
    const stripes = CSS.match(/border-(left|right):\s*(?!1px)\d+px[^;]*/g);
    expect(stripes).toBe(null);
  });

  it('states the play error as a failure rather than a caution', () => {
    const warning = rule('.mtg-prompt__warning');
    expect(warning).toContain('--mtg-negative');
    expect(warning).not.toContain('--mtg-pending');
  });
});

describe('the shell names four modes and a row of sections', () => {
  // `mtg-a982g.1`. The bar used to hold seven peers and the routes drew their
  // own second-level controls in seven different shapes; the shell now draws
  // one row of sections under the bar, in the same shape as the modes.
  const html = renderToStaticMarkup(
    h(Shell, { mode: 'play', sub: 'draft', onSelectMode: () => undefined, children: 'body' }),
  );

  it('draws the mode row and the section row as two navs', () => {
    expect(UI_MODES).toEqual(['play', 'customize', 'cards', 'analysis']);
    expect(html.match(/class="mtg-modes__item"/g)).toHaveLength(UI_MODES.length);
    expect(html).toContain(`aria-label="${subsLabel('play')}"`);
    expect(html.match(/class="mtg-subs__item"/g)).toHaveLength(UI_SUBS.play.length);
  });

  it('gives the section row a rule of its own, in the sheet', () => {
    expect(rule('.mtg-subs')).toContain('display: flex');
    expect(CSS).toContain(".mtg-subs__item[aria-current='page'] {");
  });
});

describe('route headings stay singular', () => {
  const states: readonly (readonly [string, string])[] = [
    ['analysis, empty', renderToStaticMarkup(h(AnalysisRoute, { state: { status: 'absent' } }))],
    // No replay entry. The Replay tab mounts `ReplayViewer`, which draws no h1
    // at all on purpose: its caption is the frame you are looking at and it
    // changes every step, so the tab names the page. The entry that used to be
    // here rendered `ReplayRoute` over the statistics log, and that route is
    // gone (`mtg-2ayr`); its per-game walk is a panel under Analysis now, which
    // is the surface whose single h1 the entry above already checks.
    ['deck, absent', renderToStaticMarkup(h(DeckRoute, { state: { status: 'absent' } }))],
    ['deck, failed', renderToStaticMarkup(h(DeckRoute, { state: { status: 'failed', message: 'bad' } }))],
  ];

  for (const [name, html] of states) {
    it(`renders exactly one h1: ${name}`, () => {
      expect(html.match(/<h1/g)).toHaveLength(1);
    });
  }

  const playStates = [
    renderToStaticMarkup(h(PlayRoute, { set: null })),
    renderToStaticMarkup(h(PlayRoute, { set: { status: 'loading' } })),
    renderToStaticMarkup(h(PlayRoute, { set: { status: 'failed', message: 'bad set' } })),
  ];

  it('lets the shell name Play instead of repeating it inside the route', () => {
    for (const html of playStates) expect(html.match(/<h1/g) ?? []).toHaveLength(0);
  });
});

// Every tile here names `mode: 'full'`, because a citation is drawn in the
// tile's foot and compact — which is what a pane opens in since `mtg-ljda` —
// has no foot. These are tests about the full tile, so they say so.
describe('deck tiles cite only what distinguishes them', () => {
  const entry = (name: string, criteria: readonly string[]): DeckArtifactEntry =>
    ({
      name,
      count: 4,
      manaCost: '{R}',
      typeLine: 'Creature',
      colorIdentity: 'R',
      reason: 'because',
      criteria,
      priceUsd: 1,
      art: null,
    }) as DeckArtifactEntry;

  it('drops a criterion the whole deck shares', () => {
    const html = renderToStaticMarkup(
      h(DeckTile, { entry: entry('Bolt', ['format', 'budget']), omit: ['format'], mode: 'full' }),
    );
    expect(html).toContain('>budget<');
    expect(html).not.toContain('>format<');
  });

  it('keeps every criterion when nothing is shared', () => {
    const html = renderToStaticMarkup(
      h(DeckTile, { entry: entry('Bolt', ['format', 'budget']), mode: 'full' }),
    );
    expect(html).toContain('>format<');
    expect(html).toContain('>budget<');
  });

  it('states the shared set once above the cards instead of on each tile', () => {
    // The committed deck is the real case: all forty of its cards cite the same
    // four criteria, which is exactly the repetition this replaces.
    const raw: unknown = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/decklab/fixtures/decks/boros-aggro.deck.json'), 'utf8'),
    );
    const read = readDeckArtifact(raw, 'boros-aggro');
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    // Full, and installed rather than clicked: this file runs under node with no
    // jsdom, so `../src/routes/deck/local-store.ts` finds no store and every
    // pane draws the default. Since `mtg-ljda` that default is compact, which
    // draws no tile foot and therefore no citation at all — the negative
    // assertion below would pass over an empty page and measure nothing.
    const host = globalThis as { localStorage?: unknown };
    const kept = new Map<string, string>();
    host.localStorage = {
      getItem: (key: string): string | null => kept.get(key) ?? null,
      setItem: (key: string, value: string): void => void kept.set(key, value),
    };
    for (const pane of ['main-deck', 'sideboard']) kept.set(deckViewStoreKey(pane), 'full');

    const html = renderToStaticMarkup(
      h(DeckRoute, { state: { status: 'ready', deck: read.deck }, open: OPEN_ARTIFACT }),
    );
    delete host.localStorage;
    // The page is drawing tiles at all, which is what makes the four negatives
    // below a measurement rather than an empty document passing.
    expect(html).toContain('mtg-deck-card__foot');
    const text = html.replace(/<[^>]+>/g, ' ');

    // The sentence itself moved behind the head's button in `mtg-z4q6` and is
    // asserted where a click is possible (`lab/deck-route.test.ts`, "shows each
    // inclusion's reason and the criteria it cited"). What a static render can
    // still measure is the half this test is named for: the page offers the
    // panel, and no tile repeats a shared id.
    expect(text).toContain('Deck details');
    for (const id of ['format', 'colors', 'budget', 'archetype']) {
      expect(html).not.toContain(`mtg-deck-card__cite">${id}<`);
    }
  });

  it('leaves a card its own criterion when only that card cites it', () => {
    const html = renderToStaticMarkup(
      h(DeckTile, { entry: entry('Helix', ['format', 'colors']), omit: ['format'], mode: 'full' }),
    );
    expect(html).toContain('mtg-deck-card__cite">colors<');
  });

  it('names nothing shared when only one card cites anything', () => {
    expect(listPhrase([])).toBe('');
    expect(listPhrase(['one'])).toBe('one');
    expect(listPhrase(['a', 'b'])).toBe('a and b');
    expect(listPhrase(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('a scoped override of a micro-label is swept too', () => {
  it('finds no rule retracking a micro-label in the sheet the app ships', () => {
    expect(microLabelRetracking(CSS)).toEqual([]);
  });

  it('catches the art tile override that every other sweep in this file read past', () => {
    // The declaration `mtg-bc2.155` filed, verbatim in shape. It carries no
    // `text-transform`, which is what made it invisible: it inherits the role
    // from `.mtg-art__pending-label` and changes one property.
    const scoped =
      ".mtg-card[data-size='art'] .mtg-art__pending-label { width: min-content;" +
      ' padding: 1px 3px; letter-spacing: 0.03em; }';
    expect(microLabelRetracking(CSS + scoped)).toEqual([
      ".mtg-card[data-size='art'] .mtg-art__pending-label retracks a micro-label to 0.03em",
    ]);
    // And the sweeps that exist say nothing about it, which is the hole.
    expect(uppercaseRules(scoped)).toEqual([]);
    expect(microLabelFaults(CSS + scoped)).toEqual([]);
  });

  it('leaves an override that changes something other than the tracking alone', () => {
    // The board face's own override of the same label: a smaller size, a
    // tighter pad and a margin, and no opinion about tracking. That is what an
    // override is for.
    const board =
      ".mtg-card[data-size='board'] .mtg-art__pending-label { font-size: 0.5rem;" + ' padding: 1px 2px; }';
    expect(microLabelRetracking(CSS + board)).toEqual([]);
  });

  it('knows which classes the sheet made micro-labels', () => {
    const classes = microLabelClasses(CSS);
    expect(classes.has('.mtg-art__pending-label')).toBe(true);
    expect(classes.has('.mtg-zone__label')).toBe(true);
    expect(classes.has('.mtg-card__name')).toBe(false);
  });
});
