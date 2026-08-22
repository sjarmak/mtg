/**
 * Boot-gate degradation tests.
 *
 * The single most dangerous failure mode for a conformance gate is a false
 * pass: reporting green for a check that never ran. These tests pin the gate's
 * behavior when Forge is absent and when the set itself is unmappable, and
 * they are hermetic — `forgeHome` points at an empty directory, so no Forge is
 * required and none is started.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { EXAMPLE_SET } from '@mtg/dsl';
import { bootGate, findForgeInstall } from '@mtg/forge-export';
import { creature } from './helpers';

function emptyForgeHome(): string {
  return mkdtempSync(join(tmpdir(), 'mtg-no-forge-'));
}

describe('bootGate without Forge installed', () => {
  it('reports skipped, never passed', async () => {
    const result = await bootGate(EXAMPLE_SET, { forgeHome: emptyForgeHome() });
    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('Forge is not installed');
    expect(result.forgeVersion).toBeNull();
    expect(result.games).toEqual([]);
  });

  it('still reports the set it was asked to check', async () => {
    const result = await bootGate(EXAMPLE_SET, { forgeHome: emptyForgeHome() });
    expect(result.setCode).toBe('SLC');
    expect(result.cardCount).toBe(EXAMPLE_SET.length);
  });
});

describe('bootGate with unmappable cards', () => {
  it('fails before consulting Forge, because the defect is in the set', async () => {
    // DSL-legal (any non-empty name parses) but unrepresentable in Forge's
    // pipe-delimited script grammar.
    const rogue = { ...creature('Rogue Name'), name: 'Bad | Name' } as Card;
    const result = await bootGate([rogue], { forgeHome: emptyForgeHome() });
    expect(result.status).toBe('failed');
    expect(result.rejections.map((r) => r.code)).toContain('UNSAFE_SCRIPT_TEXT');
    expect(result.reason).toContain('no Forge mapping');
  });

  it('fails on a card outside the pinned vocabulary', async () => {
    const rogue = { ...creature('Rogue Keyword'), keywords: ['shroud'] } as unknown as Card;
    const result = await bootGate([rogue], { forgeHome: emptyForgeHome() });
    expect(result.status).toBe('failed');
    expect(result.rejections.map((r) => r.code)).toContain('DSL_VIOLATION');
  });

  it('fails on an empty card list rather than passing vacuously', async () => {
    const result = await bootGate([], { forgeHome: emptyForgeHome() });
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('empty');
  });
});

describe('findForgeInstall', () => {
  it('returns null for a directory with no Forge jar', () => {
    expect(findForgeInstall({ forgeHome: emptyForgeHome() })).toBeNull();
  });

  it('returns null for a path that does not exist', () => {
    expect(findForgeInstall({ forgeHome: join(tmpdir(), 'definitely-not-here-12345') })).toBeNull();
  });
});
