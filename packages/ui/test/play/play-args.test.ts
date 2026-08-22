import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_PORT, portBusyMessage, readPlayArgs, viteArgsFor } from '../../tools/play-args';

describe('the set and port passed to npm run play', () => {
  it('keeps the named set and an explicit positional port', () => {
    expect(readPlayArgs(['sets/current.json', '5273'])).toEqual({
      set: 'sets/current.json',
      port: 5273,
      artManifest: undefined,
    });
  });

  it('leaves the port unstated when the caller only names a set', () => {
    expect(readPlayArgs(['sets/current.json'])).toEqual({
      set: 'sets/current.json',
      port: undefined,
      artManifest: undefined,
    });
  });

  it('accepts one explicitly named art manifest without changing the positional interface', () => {
    expect(
      readPlayArgs(['sets/current.json', '5273', '--art-manifest', '/private/art/flagship-set/art.json']),
    ).toEqual({
      set: 'sets/current.json',
      port: 5273,
      artManifest: '/private/art/flagship-set/art.json',
    });
  });

  it('refuses a missing or repeated explicit manifest value', () => {
    expect(() => readPlayArgs(['sets/current.json', '--art-manifest'])).toThrow(
      '--art-manifest needs a value',
    );
    expect(() =>
      readPlayArgs([
        'sets/current.json',
        '--art-manifest',
        '/private/one/art.json',
        '--art-manifest',
        '/private/two/art.json',
      ]),
    ).toThrow('--art-manifest may be given only once');
  });

  it.each(['0', '65536', '5273.5', 'not-a-port'])('rejects invalid port %s', (port) => {
    expect(() => readPlayArgs(['sets/current.json', port])).toThrow(`${port} is not a port`);
  });

  it('rejects extra positional arguments instead of ignoring a typo', () => {
    expect(() => readPlayArgs(['sets/current.json', '5273', 'ignored'])).toThrow(
      /at most a set path and port/,
    );
  });

  it('makes a stated port strict so Vite cannot drift to an old game address', () => {
    expect(viteArgsFor(5273)).toEqual(['vite', '--open', '--port', '5273', '--strictPort']);
    expect(viteArgsFor(undefined)).toEqual(['vite', '--open']);
  });

  it('states the port vite.config.ts actually serves on, rather than a second guess at it', () => {
    const config = readFileSync(fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), 'utf8');
    expect(config).toContain(`port: ${String(DEFAULT_WEB_PORT)},`);
    expect(config).toContain('strictPort: true');
  });

  it('reads a busy port as a lab already running, and names the address it is running at', () => {
    const message = portBusyMessage(DEFAULT_WEB_PORT);
    expect(message).toContain('http://localhost:5273/');
    expect(message).toContain('Ctrl-C');
    expect(message).not.toContain('failed');
  });
});
