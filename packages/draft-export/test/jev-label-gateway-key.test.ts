/**
 * Where the study's key comes from, and that no message this module writes
 * carries a value. The values below are placeholders that no gateway accepts.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GATEWAY_KEY_VARIABLE, readEnvFileVariable, readGatewayKey } from '../tools/jev-label/gateway-key';

describe('reading the gateway key', () => {
  let directory: string;
  let envFile: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'mtg-jev-key-'));
    envFile = join(directory, '.env');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('prefers the process environment over a file', () => {
    writeFileSync(envFile, `${GATEWAY_KEY_VARIABLE}=from-file\n`);
    expect(readGatewayKey({ [GATEWAY_KEY_VARIABLE]: ' from-env ' }, envFile)).toBe('from-env');
  });

  it('reads one named variable out of a dotenv file, unquoting it and skipping the rest', () => {
    writeFileSync(
      envFile,
      [
        '# a comment',
        'OTHER_SECRET=must-not-be-returned',
        `export ${GATEWAY_KEY_VARIABLE}="quoted-value"`,
        '',
      ].join('\n'),
    );
    expect(readEnvFileVariable(envFile, GATEWAY_KEY_VARIABLE)).toBe('quoted-value');
    expect(readEnvFileVariable(envFile, 'ABSENT')).toBeNull();
  });

  it('treats a missing file and an empty value as absent', () => {
    expect(readEnvFileVariable(join(directory, 'missing.env'), GATEWAY_KEY_VARIABLE)).toBeNull();
    writeFileSync(envFile, `${GATEWAY_KEY_VARIABLE}=\n`);
    expect(readEnvFileVariable(envFile, GATEWAY_KEY_VARIABLE)).toBeNull();
  });

  it('names the variable and the place it looked when the key is missing, and no value', () => {
    writeFileSync(envFile, 'OTHER_SECRET=placeholder-other-value\n');
    expect(() => readGatewayKey({}, envFile)).toThrow(new RegExp(`${GATEWAY_KEY_VARIABLE}.*${envFile}`));
    expect(() => readGatewayKey({}, envFile)).not.toThrow(/placeholder-other-value/);
    expect(() => readGatewayKey({}, undefined)).toThrow(/--env-file/);
  });
});
