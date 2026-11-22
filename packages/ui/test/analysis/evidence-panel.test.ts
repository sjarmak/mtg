/**
 * The `evidence` section in `../../src/routes/analysis/evidence-panel.ts`,
 * rendered to markup: each of its four states says what it is, the ready
 * state states its scope, a judgment row prints no game count, and every
 * refusal is printed with the scanner's own sentence.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_SECTION_LABEL,
  EvidencePanel,
  gamesLabel,
  producedDay,
  STAGE_EVIDENCE_COMMAND,
  strengthLabel,
} from '../../src/routes/analysis/evidence-panel';
import type { EvidenceState, EvidenceStrength } from '../../src/routes/analysis/evidence-record';
import {
  evidenceSnapshot,
  GAMES_RECORD,
  JUDGMENT_RECORD,
  STATISTICS_RECORD,
} from './support/evidence-fixtures';

function markup(state: EvidenceState, subjectKey: string | null = null): string {
  return renderToStaticMarkup(h(EvidencePanel, { state, subjectKey }));
}

const READY: EvidenceState = { status: 'ready', snapshot: evidenceSnapshot() };
const ARMLESS: EvidenceStrength = {
  strength: 'games',
  trials: { attempted: 3, completed: 2 },
  arms: null,
  source: 'report',
  episode: null,
  status: null,
};

describe('the four states', () => {
  it('names the section, and says it is reading while it loads', () => {
    const html = markup({ status: 'loading' });
    expect(html).toContain(`aria-label="${EVIDENCE_SECTION_LABEL}"`);
    expect(html).toContain('Reading the staged evidence');
  });

  it('names both commands that stage the file when there is none', () => {
    const html = markup({ status: 'absent' });
    expect(html).toContain('Nothing staged');
    expect(html).toContain('<code class="mtg-code">npm run play</code>');
    expect(html).toContain(`<code class="mtg-code">${STAGE_EVIDENCE_COMMAND}</code>`);
    expect(STAGE_EVIDENCE_COMMAND).toBe('npx tsx packages/ui/tools/stage-evidence.ts');
  });

  it('prints the reader sentence when the file could not be read', () => {
    const html = markup({
      status: 'failed',
      message: 'analysis-evidence.json is not a staged evidence snapshot',
    });
    expect(html).toContain('That evidence snapshot could not be read');
    expect(html).toContain('analysis-evidence.json is not a staged evidence snapshot');
  });

  it('writes no em dash in any state', () => {
    for (const state of [{ status: 'loading' }, { status: 'absent' }, READY] as const) {
      expect(markup(state)).not.toContain('\u2014');
    }
    expect(markup(READY, 'isd')).not.toContain('\u2014');
    expect(markup(READY, 'nothing')).not.toContain('\u2014');
  });
});

describe('the ready state', () => {
  it('lists every record and says so when nothing is selected', () => {
    const html = markup(READY);
    expect(html).toContain('No set is selected, so this lists every staged record: 4 in all.');
    expect(html).toContain('Scanned 2026-09-16 over /repo/out.');
    expect(html).toContain('akh-hou (AKH+HOU)');
    expect(html).toContain('Gloom (kernel-bot) vs The Sky Islands (human)');
  });

  it('scopes to the selected subject through the join key', () => {
    const html = markup(READY, 'isd');
    expect(html).toContain('1 of 4 staged records are about isd.');
    expect(html).toContain('learned/v3 vs greedy/v0');
    expect(html).toContain('games, retain-baseline');
    expect(html).toContain('2 of 3 finished (baseline 3/3, candidate 2/3)');
    expect(html).toContain('2026-09-12');
    expect(html).not.toContain('Gloom (kernel-bot)');
  });

  it('says plainly when nothing staged is about the selection, and draws no table', () => {
    const html = markup(READY, 'nothing');
    expect(html).toContain('Nothing staged is about nothing. 4 records are about other subjects.');
    expect(html).not.toContain('<table');
  });

  it('prints a judgment row with no game count and a note on its provenance', () => {
    const html = markup(READY, 'legacy-cube-2021-08');
    expect(html).toContain('judgment (model-authored)');
    expect(html).toContain('no game count');
    expect(html).toContain('aria-label="Model-authored evidence"');
    expect(html).toContain(
      `${JUDGMENT_RECORD.path}: written by model; independent human evidence no; adoption eligible not stated.`,
    );
  });

  it('prints a statistics row as summary only, with what it does not state', () => {
    const html = markup(READY, 'akh-hou');
    expect(html).toContain('summary only, no game rows');
    expect(html).toContain('<td>not stated</td>');
    expect(html).not.toContain('aria-label="Model-authored evidence"');
  });

  it('prints every refusal verbatim, and the flag that lifts the byte budget', () => {
    const html = markup(READY);
    expect(html).toContain('aria-label="Ledgers not read"');
    expect(html).toContain('out/legacy-cube-bot-plan-20260910: has no report.json');
    expect(html).toContain('out/native-gameplay-tuning-v3: 2048.0 MB is over this run');
    expect(html).toContain('512.0 MB budget.');
    expect(html).toContain(`<code class="mtg-code">${STAGE_EVIDENCE_COMMAND} --budget 2147483648</code>`);
  });

  it('says what to do when the scan found nothing at all', () => {
    const html = markup({
      status: 'ready',
      snapshot: evidenceSnapshot({ records: [], skipped: [], truncated: [] }),
    });
    expect(html).toContain('No set is selected, so this lists every staged record: 0 in all.');
    expect(html).toContain(
      'Play or measure something, then run <code class="mtg-code">npm run play</code> again.',
    );
    expect(html).not.toContain('aria-label="Ledgers not read"');
  });
});

describe('the column helpers', () => {
  it('spell strength, games and the produced day', () => {
    expect(strengthLabel(GAMES_RECORD.evidence)).toBe('games');
    expect(strengthLabel(STATISTICS_RECORD.evidence)).toBe('statistics');
    expect(strengthLabel(JUDGMENT_RECORD.evidence)).toBe('judgment (model-authored)');
    expect(gamesLabel(GAMES_RECORD.evidence)).toBe('2 of 3 finished (baseline 3/3, candidate 2/3)');
    expect(gamesLabel(ARMLESS)).toBe('2 of 3 finished');
    expect(gamesLabel(STATISTICS_RECORD.evidence)).toBe('summary only, no game rows');
    expect(gamesLabel(JUDGMENT_RECORD.evidence)).toBe('no game count');
    expect(producedDay('2026-09-12T08:00:00.000Z')).toBe('2026-09-12');
    expect(producedDay('yesterday')).toBe('yesterday');
    expect(producedDay(null)).toBe('not stated');
  });
});
