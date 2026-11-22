/**
 * The staged evidence snapshot's reader in
 * `../../src/routes/analysis/evidence-record.ts`: a well-formed snapshot of
 * every strength parses, a malformed one is one sentence naming the source and
 * the field, and the shape keeps a game count off a judgment record.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_FAMILIES,
  FAMILY_LABELS,
  readEvidenceSnapshot,
  recordsFor,
  summarizeEpisode,
} from '../../src/routes/analysis/evidence-record';
import {
  evidenceSnapshot,
  GAMES_RECORD,
  JUDGMENT_RECORD,
  RECORDED_GAMES_RECORD,
} from './support/evidence-fixtures';

describe('readEvidenceSnapshot', () => {
  it('parses a snapshot carrying every strength, and every family has a label', () => {
    const read = readEvidenceSnapshot(
      JSON.parse(JSON.stringify(evidenceSnapshot())),
      'analysis-evidence.json',
    );
    if (!read.ok) throw new Error(read.message);
    expect(read.snapshot).toEqual(evidenceSnapshot());
    for (const family of EVIDENCE_FAMILIES) expect(FAMILY_LABELS[family]).not.toBe('');
  });

  it('names the source, the field and the repair when the version is another build', () => {
    const stale: unknown = { ...evidenceSnapshot(), formatVersion: 'mtg-ui/analysis-evidence/0' };
    const read = readEvidenceSnapshot(stale, 'analysis-evidence.json');
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.message).toMatch(
      /^analysis-evidence\.json is not a staged evidence snapshot this build can read at `formatVersion`: /,
    );
    expect(read.message).toContain('Re-run `npm run play`.');
  });

  it('refuses a judgment record that carries a game count', () => {
    const judgment: unknown = {
      ...JUDGMENT_RECORD,
      evidence: { ...JUDGMENT_RECORD.evidence, trials: { attempted: 1, completed: 1 } },
    };
    const read = readEvidenceSnapshot({ ...evidenceSnapshot(), records: [judgment] }, 'snapshot');
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.message).toContain('at `records.0.evidence');
  });

  it('refuses a value that is not an object without naming a field', () => {
    const read = readEvidenceSnapshot('nope', 'snapshot');
    expect(read.ok).toBe(false);
    if (!read.ok)
      expect(read.message).toMatch(/^snapshot is not a staged evidence snapshot this build can read: /);
  });
});

describe('recordsFor', () => {
  it('matches the join key exactly, and lists everything when there is no selection', () => {
    expect(recordsFor(evidenceSnapshot(), 'isd').map((record) => record.path)).toEqual([GAMES_RECORD.path]);
    expect(recordsFor(evidenceSnapshot(), 'xmp')).toEqual([]);
    expect(recordsFor(evidenceSnapshot(), 'XMP')).toEqual([RECORDED_GAMES_RECORD]);
    expect(recordsFor(evidenceSnapshot(), null)).toHaveLength(4);
  });
});

describe('summarizeEpisode', () => {
  it('keeps the four identity fields of a wider episode and nothing else', () => {
    const episode = {
      id: 'game-1',
      stage: 'draft' as const,
      runtime: { kind: 'forge' as const, version: 'forge/1.6', buildSha256: 'a'.repeat(64) },
      subject: { formatId: 'akh-hou', formatSha256: 'a'.repeat(64), cardsSha256: 'a'.repeat(64) },
    };
    expect(summarizeEpisode(episode)).toEqual({
      id: 'game-1',
      stage: 'draft',
      runtime: 'forge',
      formatId: 'akh-hou',
    });
  });
});

describe('the module', () => {
  it('imports nothing from the bot-evidence package, and the scanner checks the projection instead', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'src', 'routes', 'analysis', 'evidence-record.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/^import .*'@mtg\/bot-evidence'/m);
    const scanner = readFileSync(join(__dirname, '..', '..', 'tools', 'stage-strength-family.ts'), 'utf8');
    expect(scanner).toMatch(/^import \{ BotEvidenceEpisodeSchema \} from '@mtg\/bot-evidence';$/m);
    expect(scanner).toContain('summarizeEpisode(row.episode.episode)');
  });
});
