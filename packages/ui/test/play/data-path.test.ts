/**
 * The refusal that keeps recorded games under `data/<family>` and nowhere
 * else, the sibling of `./out-path.test.ts` for the directory evidence lives
 * in rather than the one a rig's frames go to.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DataPathError,
  GAMEPLAY_FAMILY,
  GAMEPLAY_INDEX_FILENAME,
  dayDirectory,
  gameplayDir,
  gameplayRecordPath,
  resolveDataDir,
} from '../../tools/data-path';

const ROOT = '/home/someone/projects/mtg';

describe('where a recorder may write', () => {
  it('takes exactly one family directory under data/', () => {
    expect(resolveDataDir(join(ROOT, 'data', 'gameplay'), ROOT)).toBe(join(ROOT, 'data', 'gameplay'));
    expect(gameplayDir(ROOT)).toBe(join(ROOT, 'data', GAMEPLAY_FAMILY));
    expect(resolveDataDir(gameplayDir(ROOT), ROOT)).toBe(gameplayDir(ROOT));
  });

  it('takes a temporary directory, because the tests write records and have nowhere else', () => {
    const scratch = join(tmpdir(), 'mtg-gameplay-test', 'deep');
    expect(resolveDataDir(scratch, ROOT)).toBe(scratch);
  });

  it('refuses bare data/, which would put records beside the card store', () => {
    expect(() => resolveDataDir(join(ROOT, 'data'), ROOT)).toThrow(DataPathError);
    expect(() => resolveDataDir(`${join(ROOT, 'data')}/`, ROOT)).toThrow(DataPathError);
  });

  it('refuses the repository root and any tracked directory in it', () => {
    expect(() => resolveDataDir(ROOT, ROOT)).toThrow(DataPathError);
    expect(() => resolveDataDir(join(ROOT, 'packages', 'ui', 'public'), ROOT)).toThrow(/refusing to record/);
    expect(() => resolveDataDir(join(ROOT, 'out', 'gameplay'), ROOT)).toThrow(DataPathError);
  });

  it('refuses a second segment under the family and a climb out of it', () => {
    expect(() => resolveDataDir(join(ROOT, 'data', 'gameplay', '20260916'), ROOT)).toThrow(DataPathError);
    expect(() => resolveDataDir(join(ROOT, 'data', 'gameplay', '..', '..', 'out'), ROOT)).toThrow(
      DataPathError,
    );
    expect(() => resolveDataDir(join(ROOT, 'data', 'gameplay', '..'), ROOT)).toThrow(DataPathError);
  });

  it('names the path and the directory it should have been under', () => {
    expect(() => resolveDataDir(join(ROOT, 'somewhere'), ROOT)).toThrow(
      new RegExp(`${join(ROOT, 'somewhere')}.*${join(ROOT, 'data')}/<family>`),
    );
  });
});

describe('the record layout', () => {
  it('files a record under its UTC day, by the id the server assigned', () => {
    const at = new Date('2026-09-16T23:59:30.000Z');
    expect(dayDirectory(at)).toBe('20260916');
    expect(gameplayRecordPath('/tmp/g', at, '20260916T235930Z-abc')).toBe(
      '/tmp/g/20260916/20260916T235930Z-abc.json',
    );
    expect(GAMEPLAY_INDEX_FILENAME).toBe('index.jsonl');
  });

  it('turns the day over at midnight UTC and not at local midnight', () => {
    expect(dayDirectory(new Date('2026-09-17T00:00:00.000Z'))).toBe('20260917');
  });

  it('refuses an id that is not a file name', () => {
    const at = new Date('2026-09-16T00:00:00.000Z');
    for (const id of ['', '.', '..', 'a/b', 'a\\b', '../escape']) {
      expect(() => gameplayRecordPath('/tmp/g', at, id), id).toThrow(DataPathError);
    }
  });
});
