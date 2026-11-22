import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(`../../src/routes/play/${path}`, import.meta.url), 'utf8');
}

function legacyCubeRoute(): string {
  return readFileSync(new URL('../../src/routes/legacy-cube/LegacyCubeRoute.ts', import.meta.url), 'utf8');
}

describe('the live play-surface boundary', () => {
  it('makes kernel and observed sessions terminate in one interaction controller', () => {
    const kernel = source('PlayView.ts');
    const observed = source('BackendGame.ts');
    const shared = source('PlaySurface.ts');
    const selection = source('selection.ts');
    const projection = source('backend-position.ts');

    for (const adapter of [kernel, observed]) {
      expect(adapter).toMatch(/from '\.\/PlaySurface'/);
      expect(adapter).toMatch(/createElement\(PlaySurface/);
      expect(adapter).not.toMatch(/from '\.\/PlayFrame'/);
    }

    expect(shared).toMatch(/useAskCollapse\(\)/);
    expect(shared).toMatch(/useRailCollapse\(\)/);
    expect(shared).toMatch(/useHandSeam\(\)/);
    expect(shared).toMatch(/useInspection\(\)/);
    expect(kernel).toMatch(/useTableSelection/);
    expect(observed).toMatch(/useEnumeratedSelection/);
    expect(selection).toMatch(/function useTableSelection[\s\S]*useEnumeratedSelection/);
    expect(shared).toMatch(/from '\.\/table'/);
    expect(shared).toMatch(/playTable\(/);
    expect(kernel).not.toMatch(/playTable\(/);
    expect(observed).not.toMatch(/playTable\(/);
    expect(shared).not.toMatch(/renderTable/);
    expect(kernel).toMatch(/table:\s*\{/);
    expect(observed).toMatch(/table:\s*\{/);
    expect(observed).toMatch(/NO_STAGING/);
    expect(observed).not.toMatch(/position,\s*inspect:/);
    expect(projection).not.toMatch(
      /BackendBoardInteraction|onObjectSelect|onObjectActivate|onObjectMenu|pickerFor/,
    );

    for (const duplicate of [
      /useAskCollapse\(\)/,
      /useRailCollapse\(\)/,
      /useHandSeam\(\)/,
      /useInspection\(\)/,
      /createElement\(Board/,
      /useState<\{ readonly oid:/,
      /function objectPicker/,
    ]) {
      expect(observed).not.toMatch(duplicate);
    }
  });

  it('lets Legacy Cube reach play only through the observed adapter and shared controller', () => {
    const route = legacyCubeRoute();
    const observed = source('BackendGame.ts');

    expect(route).toMatch(/from '\.\.\/play\/BackendGame'/);
    expect(route.match(/createElement\(BackendGame/g)).toHaveLength(1);
    expect(observed).toMatch(/from '\.\/PlaySurface'/);
    expect(observed.match(/createElement\(PlaySurface/g)).toHaveLength(1);

    for (const alternateSurface of [
      /from '\.\.\/play\/PlayFrame'/,
      /from '\.\.\/play\/PlaySurface'/,
      /from '\.\.\/play\/table'/,
      /createElement\(PlayFrame/,
      /createElement\(PlaySurface/,
      /playTable\(/,
    ]) {
      expect(route).not.toMatch(alternateSurface);
    }
  });
});
