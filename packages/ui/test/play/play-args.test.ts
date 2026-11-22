import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEB_PORT,
  portBusyMessage,
  readPlayArgs,
  readPort,
  viteArgsFor,
  takeFeedbackModelArg,
  vitePortArgs,
} from '../../tools/play-args';

describe('the set and port passed to npm run play', () => {
  it('reads --feedback-model as a switch that takes no place among the positionals', () => {
    expect(readPlayArgs(['--feedback-model', 'sets/current.json', '5273'])).toEqual({
      set: 'sets/current.json',
      port: 5273,
      artManifest: undefined,
      feedbackModel: true,
    });
    expect(takeFeedbackModelArg(['deck.json', '--feedback-model'])).toEqual({
      argv: ['deck.json'],
      feedbackModel: true,
    });
  });

  it('keeps the named set and an explicit positional port', () => {
    expect(readPlayArgs(['sets/current.json', '5273'])).toEqual({
      set: 'sets/current.json',
      port: 5273,
      artManifest: undefined,
      feedbackModel: false,
    });
  });

  it('leaves the port unstated when the caller only names a set', () => {
    expect(readPlayArgs(['sets/current.json'])).toEqual({
      set: 'sets/current.json',
      port: undefined,
      artManifest: undefined,
      feedbackModel: false,
    });
  });

  it('accepts one explicitly named art manifest without changing the positional interface', () => {
    expect(
      readPlayArgs(['sets/current.json', '5273', '--art-manifest', '/private/art/flagship-set/art.json']),
    ).toEqual({
      set: 'sets/current.json',
      port: 5273,
      artManifest: '/private/art/flagship-set/art.json',
      feedbackModel: false,
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

  // `lab.ts` opens on a route, and `--open` takes that route as its value, so it
  // builds its own argument list around the port rather than appending to one.
  // The two launchers therefore share the port half and nothing else.
  it('hands the port half over on its own, for a launcher that opens on a route', () => {
    expect(vitePortArgs(5280)).toEqual(['--port', '5280', '--strictPort']);
    expect(vitePortArgs(undefined)).toEqual([]);
    expect(['vite', '--open', '/#/deck', ...vitePortArgs(5280)]).toEqual([
      'vite',
      '--open',
      '/#/deck',
      '--port',
      '5280',
      '--strictPort',
    ]);
  });

  // The same refusal `readPlayArgs` makes, reached from `lab.ts` too: a port
  // that is not a port must stop the launcher rather than reach Vite, which
  // ignores it and listens somewhere the printed address does not name.
  it('refuses a port that is not one, and passes silence through', () => {
    expect(readPort(undefined)).toBeUndefined();
    expect(readPort('5280')).toBe(5280);
    for (const bad of ['chrome', '5280.5', '0', '70000', '']) {
      expect(() => readPort(bad)).toThrow(/is not a port/u);
    }
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
