import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureRunner, parseBrief } from '@mtg/setgen';

const PACKAGE_ROOT = join(import.meta.dirname, '..');
const BRIEF_PATH = join(PACKAGE_ROOT, 'briefs', 'tideglass-reach.json');
const FIXTURE_DIR = join(PACKAGE_ROOT, 'fixtures', 'llm');
const MANIFEST_PATH = join(PACKAGE_ROOT, 'fixtures', 'runs', 'tideglass-reach-2026-08-09T22-30-10Z.json');

describe('the design surface recorded replay', () => {
  it('uses the run manifest semantics and never asks for an unrecorded retry', async () => {
    const brief = parseBrief(JSON.parse(readFileSync(BRIEF_PATH, 'utf8')) as unknown);
    const result = await fixtureRunner(FIXTURE_DIR, MANIFEST_PATH)(brief);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cards).toHaveLength(90);
    expect(result.enforceable).toBe(true);
  });
});
