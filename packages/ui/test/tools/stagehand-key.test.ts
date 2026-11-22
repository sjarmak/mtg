/**
 * The Stagehand prototype path (`--max-usd` on `live-journey.ts`) must refuse
 * to start rather than fail mid-journey when the Jev key is absent, naming the
 * variable and the file it was given, and never a value or anything else the
 * file holds. Every env file here is written to a fresh temporary directory
 * and carries a made-up value.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  requireStagehandKey,
  StagehandKeyMissingError,
  STAGEHAND_KEY_VARIABLE,
} from '../../tools/stagehand-key';

const SECRET = 'made-up-DISTINCTIVE-value';
const NEIGHBOR = 'another-DISTINCTIVE-neighbor-value';

function envFile(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'stagehand-key-')), 'keys.env');
  writeFileSync(path, contents, 'utf8');
  return path;
}

function refusal(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a refusal');
}

describe('requireStagehandKey', () => {
  it('reads the direct Jev key, TYPESAFE_API_KEY', () => {
    expect(STAGEHAND_KEY_VARIABLE).toBe('TYPESAFE_API_KEY');
  });

  it('returns the key from the environment, trimmed, without opening a file', () => {
    const missing = join(tmpdir(), 'stagehand-key-never-created', 'keys.env');
    expect(requireStagehandKey({ TYPESAFE_API_KEY: `  ${SECRET}  ` }, missing)).toBe(SECRET);
  });

  it('reads the key out of the env file when the environment lacks it', () => {
    const path = envFile(`OTHER=${NEIGHBOR}\nexport TYPESAFE_API_KEY="${SECRET}"\n`);
    expect(requireStagehandKey({}, path)).toBe(SECRET);
  });

  it('refuses without a key or a file, naming the variable and the missing flag', () => {
    const error = refusal(() => requireStagehandKey({}, null));
    expect(error).toBeInstanceOf(StagehandKeyMissingError);
    expect(error.message).toMatch(/TYPESAFE_API_KEY/);
    expect(error.message).toMatch(/no --env-file/);
  });

  it('treats a blank value the same as an absent one', () => {
    expect(() => requireStagehandKey({ TYPESAFE_API_KEY: '   ' }, null)).toThrow(StagehandKeyMissingError);
  });

  it('names the file when it does not set the variable, and prints none of its contents', () => {
    const path = envFile(`AI_GATEWAY_API_KEY=${SECRET}\nOTHER=${NEIGHBOR}\n`);
    const error = refusal(() => requireStagehandKey({}, path));
    expect(error).toBeInstanceOf(StagehandKeyMissingError);
    expect(error.message).toContain('TYPESAFE_API_KEY');
    expect(error.message).toContain(path);
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain(NEIGHBOR);
    expect(error.message).not.toContain('AI_GATEWAY_API_KEY');
  });

  it('says so when the named file does not exist', () => {
    const missing = join(tmpdir(), 'stagehand-key-never-created', 'keys.env');
    const error = refusal(() => requireStagehandKey({}, missing));
    expect(error.message).toContain(`${missing} does not exist`);
  });
});
