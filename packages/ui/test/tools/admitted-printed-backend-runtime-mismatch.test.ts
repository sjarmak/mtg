/**
 * A script-qualification receipt is measured against a Forge runtime at the
 * moment it is built; a later admission run measures the runtime again and
 * refuses to trust a receipt that no longer matches. That refusal used to be
 * a thrown Error, which `npm run play` never caught: one stale admission took
 * every other printed and generated route down with it. This exercises the
 * verifier's real throw shape (`PrintedAdmissionRuntimeMismatchError`) so the
 * test would fail if the exact type it withholds on ever stopped being thrown.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as PrintedCardNode from '@mtg/printed-card/node';
import { parsePrintedLimitedFormat } from '@mtg/printed-card';
import { admitPrintedBackend } from '../../tools/admitted-printed-backend';

vi.mock('@mtg/printed-card/node', async (importOriginal) => {
  const actual = await importOriginal<typeof PrintedCardNode>();
  return {
    ...actual,
    verifyPrintedFormatPlayAdmission: vi.fn(() => {
      throw new actual.PrintedAdmissionRuntimeMismatchError(
        'Printed admission script qualification runtime mismatch',
      );
    }),
  };
});

const read = (name: string): unknown =>
  JSON.parse(readFileSync(`packages/data/data/akh-hou/${name}`, 'utf8'));
const format = parsePrintedLimitedFormat(read('akh-hou-limited-format-v1.json'));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-admitted-backend-runtime-mismatch-test-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('withholds a format whose evidence was measured against a different Forge runtime instead of crashing the service', async () => {
  const source = join(root, 'source');
  mkdirSync(join(source, 'res/cardsfolder'), { recursive: true });
  mkdirSync(join(source, 'classes'));
  const outputParent = join(root, 'snapshots');
  mkdirSync(outputParent);
  writeFileSync(join(source, 'forge-gui-desktop-2.0.14-jar-with-dependencies.jar'), 'fixture jar');
  writeFileSync(join(source, 'res/cardsfolder/cardsfolder.zip'), 'fixture scripts');
  writeFileSync(join(source, 'classes/ForgeBridge.class'), 'fixture class');
  writeFileSync(join(source, 'adapter.mjs'), 'throw new Error("must not import");');
  const runtime = {
    forgeHome: source,
    bridge: { kind: 'compiled' as const, path: join(source, 'classes') },
    adapterBundlePath: join(source, 'adapter.mjs'),
  };
  const result = await admitPrintedBackend({
    runtime,
    format,
    catalogs: [],
    outputParent,
    evidence: {
      body: readFileSync('packages/data/data/akh-hou/play-admission/admission.json', 'utf8'),
      read: () => {
        throw new Error('the mocked verifier must not read evidence');
      },
    },
  });
  expect(result).toEqual({
    admitted: false,
    reasons: [
      { code: 'runtime-mismatch', detail: 'Printed admission script qualification runtime mismatch' },
    ],
  });
  // The refused snapshot is cleaned up exactly like every other admitted:false path.
  expect(readdirSync(outputParent)).toEqual([]);
});
