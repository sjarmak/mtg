/**
 * The printed-card deck path must stay below both card representations. A type
 * import would be enough to couple it, so scan source and the manifest rather
 * than relying on a runtime module graph.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PACKAGE = new URL('../', import.meta.url);

describe('@mtg/limited package boundary', () => {
  it('declares only the backend-neutral engine contract', () => {
    const manifest = JSON.parse(readFileSync(new URL('package.json', PACKAGE), 'utf8')) as {
      readonly dependencies?: Readonly<Record<string, string>>;
    };
    expect(manifest.dependencies).toEqual({ '@mtg/engine': '*' });
  });

  it('has no source import from DSL or data', () => {
    const sources = readdirSync(new URL('src/', PACKAGE)).filter((name) => name.endsWith('.ts'));
    for (const source of sources) {
      const text = readFileSync(new URL(`src/${source}`, PACKAGE), 'utf8');
      expect(text, source).not.toMatch(/from ['"]@mtg\/(?:dsl|data)(?:['"/])/);
    }
  });
});
