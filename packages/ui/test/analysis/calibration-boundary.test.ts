/** The browser package never owns the Node calibration producer or its dependencies. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI_ROOT = join(import.meta.dirname, '..', '..');

function typescriptFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? typescriptFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('@mtg/ui calibration boundary', () => {
  it('does not declare the data or set-generation packages', () => {
    const manifest = JSON.parse(readFileSync(join(UI_ROOT, 'package.json'), 'utf8')) as {
      readonly dependencies?: Readonly<Record<string, string>>;
    };
    expect(manifest.dependencies?.['@mtg/data']).toBeUndefined();
    expect(manifest.dependencies?.['@mtg/setgen']).toBeUndefined();
  });

  it('keeps direct data and set-generation imports out of browser source and UI tools', () => {
    const files = [...typescriptFiles(join(UI_ROOT, 'src')), ...typescriptFiles(join(UI_ROOT, 'tools'))];
    const offenders = files.filter((path) =>
      /['"]@mtg\/(?:data|setgen)(?:\/[^'"]*)?['"]/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
