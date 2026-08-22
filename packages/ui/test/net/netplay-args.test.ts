import { describe, expect, it } from 'vitest';
import { readNetplayArgs } from '../../tools/netplay-args';

describe('the netplay launcher arguments', () => {
  it('carries one explicitly named manifest beside the existing table options', () => {
    expect(
      readNetplayArgs([
        '--set',
        'sets/current.json',
        '--art-manifest',
        '/private/art/flagship-set/art.json',
        '--api-port',
        '5290',
        '--web-port',
        '5291',
      ]),
    ).toMatchObject({
      set: 'sets/current.json',
      artManifest: '/private/art/flagship-set/art.json',
      apiPort: 5290,
      webPort: 5291,
    });
  });

  /**
   * The two-machine half of the reshuffle lane (`mtg` precon seeding).
   *
   * `npm run table` asks for a seed and offers blank for a fresh game, and
   * blank means this default. It has to be different every time it is drawn, or
   * two people sitting down twice get the same shuffle and the field is a lie.
   * The old default was `netplay/${Date.now()}`, which is different per run in
   * practice and identical for two draws inside one millisecond — a launcher
   * never noticed it and a script starting two tables would.
   */
  it('draws a different seed every time no --seed is given', () => {
    const seeds = new Set(Array.from({ length: 64 }, () => readNetplayArgs([]).seed));
    expect(seeds.size).toBe(64);
  });

  it('says where the seed came from, so a printed one is recognizable', () => {
    expect(readNetplayArgs([]).seed.startsWith('netplay/')).toBe(true);
  });

  it('plays the seed it was given, unchanged', () => {
    expect(readNetplayArgs(['--seed', 'netplay/argued-about']).seed).toBe('netplay/argued-about');
  });

  it('leaves art discovery unchanged when the flag is absent', () => {
    expect(readNetplayArgs([]).artManifest).toBeUndefined();
  });

  it('anchors a relative manifest at the operator cwd before play changes directories', () => {
    expect(readNetplayArgs(['--art-manifest', 'paid/xmp/art.json'], { cwd: '/operator' }).artManifest).toBe(
      '/operator/paid/xmp/art.json',
    );
  });

  it('refuses missing and repeated manifest values', () => {
    expect(() => readNetplayArgs(['--art-manifest'])).toThrow('--art-manifest needs a value');
    expect(() =>
      readNetplayArgs(['--art-manifest', '/private/one.json', '--art-manifest', '/private/two.json']),
    ).toThrow('--art-manifest may be given only once');
  });
});
