import { describe, expect, it } from 'vitest';
import { readUiProbeArgs } from '../../tools/ui-probe-args';

describe('ui probe arguments', () => {
  it('requires an output directory', () => {
    expect(readUiProbeArgs([])).toBe('--out is required: the directory for probe artifacts');
  });

  it('refuses an unknown named viewport', () => {
    expect(readUiProbeArgs(['--out', 'out/probe', '--viewport', 'watch'])).toBe(
      'unknown viewport watch; expected desktop, tablet, phone-portrait, phone-landscape, or WxH',
    );
  });

  it.each([['--click'], ['--type'], ['--wait-text'], ['--measure']])(
    'refuses %s with no step value',
    (flag) => {
      expect(readUiProbeArgs(['--out', 'out/probe', flag])).toBe(`${flag} needs a nonempty value`);
    },
  );

  it('refuses a running URL together with a staged set', () => {
    expect(
      readUiProbeArgs(['--out', 'out/probe', '--url', 'http://127.0.0.1:5273', '--set', 'out/XMP/set.json']),
    ).toBe('--url cannot be combined with --set or --source because an attached lab is already staged');
  });

  it('keeps repeated steps in command-line order', () => {
    const parsed = readUiProbeArgs([
      '--out',
      'out/probe',
      '--click',
      'Draft',
      '--wait-text',
      'Eight seats',
      '--type',
      'Seed=first-pick',
      '--measure',
      '.mtg-source-choice',
    ]);
    expect(parsed).not.toBeTypeOf('string');
    if (typeof parsed === 'string') return;
    expect(parsed.steps).toEqual([
      { kind: 'click', name: 'Draft' },
      { kind: 'wait-text', text: 'Eight seats' },
      { kind: 'type', name: 'Seed', text: 'first-pick' },
      { kind: 'measure', selector: '.mtg-source-choice' },
    ]);
  });

  it('parses every supported viewport into positive dimensions', () => {
    for (const viewport of ['desktop', 'tablet', 'phone-portrait', 'phone-landscape', '801x603']) {
      const parsed = readUiProbeArgs(['--out', 'out/probe', '--viewport', viewport]);
      expect(parsed).not.toBeTypeOf('string');
      if (typeof parsed === 'string') continue;
      expect(parsed.viewport.width).toBeGreaterThan(0);
      expect(parsed.viewport.height).toBeGreaterThan(0);
    }
  });
});
