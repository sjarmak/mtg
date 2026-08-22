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
import { uiStyleSheet } from '../src/styles/index';
import { readDeckArtifact } from '../src/lab/deck-artifact';
import { AnalysisRoute } from '../src/routes/AnalysisRoute';
import { PlayRoute } from '../src/routes/PlayRoute';
import { ReplayRoute } from '../src/routes/ReplayRoute';
import { DeckRoute, listPhrase } from '../src/routes/DeckRoute';
import { DeckTile } from '../src/routes/deck/DeckTile';
import type { DeckArtifactEntry } from '../src/lab/deck-artifact';
import type { UiRoute } from '../src/app/router';

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
    // .mtg-filters__label, .mtg-zone__label, .mtg-shell__subtitle and
    // .mtg-deck__section-title sat at 0.08em; .mtg-art__pending-label, the
    // art-pending pill drawn inside the hatched frame, sat at 0.10em. Rendered
    // at 0.06em it stayed legible and centered in its pill, so it converges
    // rather than becoming a DESIGN.md exception.
    const drifted = [
      '.mtg-filters__label',
      '.mtg-zone__label',
      '.mtg-shell__subtitle',
      '.mtg-deck__section-title',
      '.mtg-art__pending-label',
    ];
    for (const selector of drifted) {
      const found = rule(selector);
      expect(found).not.toBe('');
      expect(found).toContain('letter-spacing: 0.06em');
    }
  });
});

describe('the micro-label weight and ink converge, with one named exception', () => {
  // The other two axes of the same rule. Seven of the ten sites did not declare
  // 600: three said 700 outright and four said nothing at all, which inherits
  // roughly 400 — so the same role was being drawn at three weights. The ink
  // axis has exactly one divergence and DESIGN.md now names it: the art-pending
  // pill is `--mtg-pending`, because amber is this lab's semantic for withheld
  // and unfinished and that slot exists to announce itself.
  const blocks = CSS.match(/[^{}]*\{[^{}]*\}/g) ?? [];
  const uppercaseBlocks = blocks.filter((block) => block.includes('text-transform: uppercase'));

  it('gives every uppercase rule 600 weight', () => {
    for (const block of uppercaseBlocks) {
      expect(block).toContain('font-weight: 600');
    }
  });

  it('gives every uppercase rule faint or muted ink, bar the art-pending pill', () => {
    for (const block of uppercaseBlocks) {
      if (block.includes('.mtg-art__pending-label')) continue;
      expect(block).toMatch(/--mtg-ink-(faint|muted)/);
    }
  });

  it('lets exactly one uppercase rule carry the pending amber', () => {
    const amber = uppercaseBlocks.filter((block) => block.includes('--mtg-pending'));
    expect(amber).toHaveLength(1);
    expect(amber.join('')).toContain('.mtg-art__pending-label');
  });

  it('pins the seven selectors that did not declare 600', () => {
    const drifted = [
      '.mtg-art__pending-label',
      '.mtg-zone__label',
      '.mtg-deck__section-title',
      '.mtg-turn__owner',
      '.mtg-choices__group-title',
      '.mtg-status__count-label',
      '.mtg-shell__subtitle',
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

describe('route headings stay singular', () => {
  const REPLAY: UiRoute = { mode: 'replay', params: {} } as UiRoute;

  const states: readonly (readonly [string, string])[] = [
    ['analysis, empty', renderToStaticMarkup(h(AnalysisRoute, { state: { status: 'absent' } }))],
    [
      'replay, empty',
      renderToStaticMarkup(h(ReplayRoute, { log: null, route: REPLAY, onSetParams: () => undefined })),
    ],
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
      h(DeckTile, { entry: entry('Bolt', ['format', 'budget']), omit: ['format'] }),
    );
    expect(html).toContain('>budget<');
    expect(html).not.toContain('>format<');
  });

  it('keeps every criterion when nothing is shared', () => {
    const html = renderToStaticMarkup(h(DeckTile, { entry: entry('Bolt', ['format', 'budget']) }));
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

    const html = renderToStaticMarkup(h(DeckRoute, { state: { status: 'ready', deck: read.deck } }));
    const text = html.replace(/<[^>]+>/g, ' ');

    expect(text).toContain('Every card here satisfies format, colors, budget and archetype.');
    // The four shared ids are named once in prose and never again as citations.
    for (const id of ['format', 'colors', 'budget', 'archetype']) {
      expect(html).not.toContain(`mtg-deck-card__cite">${id}<`);
    }
  });

  it('leaves a card its own criterion when only that card cites it', () => {
    const html = renderToStaticMarkup(
      h(DeckTile, { entry: entry('Helix', ['format', 'colors']), omit: ['format'] }),
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
