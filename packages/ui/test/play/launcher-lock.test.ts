import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAIM_FILENAME,
  claimPublicDir,
  processAlive,
  readLauncherClaim,
  releaseLauncherClaim,
  writeLauncherClaim,
} from '../../tools/launcher-lock';

const NOW = '2026-08-29T19:00:00.000Z';
const made: string[] = [];

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'mtg-launcher-claim-'));
  made.push(path);
  return path;
}

afterEach(() => {
  while (made.length > 0) {
    const path = made.pop();
    if (path !== undefined) rmSync(path, { recursive: true, force: true });
  }
});

/** A sibling process, alive or not, that is never this one. */
const SIBLING = process.pid + 1;
const nobody = (): boolean => false;
const everybody = (): boolean => true;

describe('who owns the staged directory', () => {
  it('takes an unclaimed directory and records what a refusal would need', () => {
    const dir = directory();
    expect(claimPublicDir(dir, 'npm run play', 5273, NOW, nobody)).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(join(dir, CLAIM_FILENAME), 'utf8'))).toEqual({
      command: 'npm run play',
      pid: process.pid,
      port: 5273,
      at: NOW,
    });
  });

  it('refuses a directory a live sibling holds, naming its command, port and pid', () => {
    const dir = directory();
    writeLauncherClaim(dir, { command: 'npm run lab', pid: SIBLING, port: 5280, at: NOW });
    const claimed = claimPublicDir(dir, 'npm run play', 5281, NOW, everybody);
    expect(claimed.ok).toBe(false);
    if (claimed.ok) return;
    expect(claimed.message).toContain('`npm run lab` is already running on port 5280');
    expect(claimed.message).toContain(`pid ${String(SIBLING)}`);
    expect(claimed.message).toContain('`npm run play`');
    expect(claimed.message).toContain(join(dir, CLAIM_FILENAME));
  });

  it('leaves the sibling claim exactly as it found it when it refuses', () => {
    const dir = directory();
    const held = { command: 'npm run lab', pid: SIBLING, port: 5280, at: NOW };
    writeLauncherClaim(dir, held);
    claimPublicDir(dir, 'npm run play', 5281, NOW, everybody);
    expect(readLauncherClaim(dir, everybody)).toEqual(held);
  });

  it('takes a directory whose claimant is gone, which is what Ctrl-C leaves behind', () => {
    const dir = directory();
    writeLauncherClaim(dir, { command: 'npm run lab', pid: SIBLING, port: 5280, at: NOW });
    expect(readLauncherClaim(dir, nobody)).toBeNull();
    expect(claimPublicDir(dir, 'npm run play', 5273, NOW, nobody)).toEqual({ ok: true });
    expect(readLauncherClaim(dir, everybody)?.pid).toBe(process.pid);
  });

  it('does not refuse itself, so a launcher may restate its own claim', () => {
    const dir = directory();
    writeLauncherClaim(dir, { command: 'npm run play', pid: process.pid, port: 5273, at: NOW });
    expect(claimPublicDir(dir, 'npm run play', 5281, NOW, everybody)).toEqual({ ok: true });
    expect(readLauncherClaim(dir, everybody)?.port).toBe(5281);
  });
});

describe('a claim file that says nothing usable', () => {
  it('reads as no claim when the file is not there at all', () => {
    expect(readLauncherClaim(directory(), everybody)).toBeNull();
  });

  it('reads as no claim rather than throwing on bytes that are not JSON', () => {
    const dir = directory();
    writeFileSync(join(dir, CLAIM_FILENAME), '{"command": "npm run lab"', 'utf8');
    expect(readLauncherClaim(dir, everybody)).toBeNull();
    expect(claimPublicDir(dir, 'npm run play', 5273, NOW, everybody)).toEqual({ ok: true });
  });

  it('reads as no claim when a field is missing or the wrong shape', () => {
    const dir = directory();
    for (const written of [
      { command: 'npm run lab', port: 5280, at: NOW },
      { command: '', pid: SIBLING, port: 5280, at: NOW },
      { command: 'npm run lab', pid: '41234', port: 5280, at: NOW },
      { command: 'npm run lab', pid: SIBLING, port: '5280', at: NOW },
      { command: 'npm run lab', pid: 0, port: 5280, at: NOW },
      [{ command: 'npm run lab', pid: SIBLING, port: 5280, at: NOW }],
      null,
    ]) {
      writeFileSync(join(dir, CLAIM_FILENAME), JSON.stringify(written), 'utf8');
      expect(readLauncherClaim(dir, everybody)).toBeNull();
    }
  });
});

describe('giving the directory back', () => {
  it('removes the claim this run wrote', () => {
    const dir = directory();
    claimPublicDir(dir, 'npm run play', 5273, NOW, nobody);
    releaseLauncherClaim(dir, process.pid);
    expect(readLauncherClaim(dir, everybody)).toBeNull();
  });

  it('leaves a claim it does not hold, so a refused run cannot unlock the page it refused to disturb', () => {
    const dir = directory();
    const held = { command: 'npm run lab', pid: SIBLING, port: 5280, at: NOW };
    writeLauncherClaim(dir, held);
    releaseLauncherClaim(dir, process.pid);
    expect(readLauncherClaim(dir, everybody)).toEqual(held);
  });

  it('is a no-op on a directory that was never claimed', () => {
    const dir = directory();
    expect(() => {
      releaseLauncherClaim(dir, process.pid);
    }).not.toThrow();
  });
});

describe('the liveness test the whole scheme rests on', () => {
  it('says this process is alive and an unallocated pid is not', () => {
    expect(processAlive(process.pid)).toBe(true);
    // Above every pid Linux hands out by default and every macOS pid, so it
    // names nothing rather than naming something this test would then depend on.
    expect(processAlive(0x7fff_fffe)).toBe(false);
  });
});
