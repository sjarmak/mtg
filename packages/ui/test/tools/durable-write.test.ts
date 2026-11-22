/**
 * The three promises `tools/durable-write.ts` makes, each pinned by the failure
 * it exists to refuse: a second exclusive write over the first's evidence, an
 * append that lands somewhere other than the end, and a directory fsync over
 * a path that is not a directory.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendDurably, fsyncDirectory, writeDurably } from '../../tools/durable-write';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-durable-write-test-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('writeDurably', () => {
  it('creates the file with exactly the body it was handed', () => {
    const path = join(root, 'one.json');
    writeDurably(path, '{"a":1}\n');
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}\n');
  });

  it('refuses to overwrite a file that already exists', () => {
    const path = join(root, 'one.json');
    writeDurably(path, 'first\n');
    expect(() => writeDurably(path, 'second\n')).toThrow(/EEXIST/);
    expect(readFileSync(path, 'utf8')).toBe('first\n');
  });

  it('leaves nothing behind when the parent directory is missing', () => {
    const path = join(root, 'missing', 'one.json');
    expect(() => writeDurably(path, 'body\n')).toThrow(/ENOENT/);
    expect(existsSync(path)).toBe(false);
  });
});

describe('appendDurably', () => {
  it('creates the file on the first append and extends it on every later one', () => {
    const path = join(root, 'index.jsonl');
    appendDurably(path, '{"row":1}\n');
    appendDurably(path, '{"row":2}\n');
    expect(readFileSync(path, 'utf8')).toBe('{"row":1}\n{"row":2}\n');
  });
});

describe('fsyncDirectory', () => {
  it('accepts a directory and refuses a path that is not one', () => {
    expect(() => fsyncDirectory(root)).not.toThrow();
    expect(() => fsyncDirectory(join(root, 'absent'))).toThrow(/ENOENT/);
  });
});
