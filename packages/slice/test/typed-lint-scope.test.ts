/**
 * The type-aware eslint block lints exactly the files the TypeScript project holds.
 *
 * `eslint.config.js`'s last block turns on `projectService`, which is what lets
 * `switch-exhaustiveness-check` ask the compiler what a union contains. That
 * block names its own globs, and they have to be `tsconfig.json`'s `include`.
 * Measured 2026-08-28 both ways, by putting a switch over a two-case union
 * missing one case into `packages/kernel/bench`: named in both lists, eslint
 * reports `Switch is not exhaustive. Cases not matched: "b"`; named in the
 * eslint block but absent from `include`, it reports `Parsing error: ... was
 * not found by the project service`.
 *
 * The parse error is loud and names its own fix, so it is not why this exists.
 * The other direction is — a directory inside the TypeScript project and
 * outside this block, where the rule never runs, prints nothing, and the files
 * read as clean. `packages/*` + `/bench` sat outside both lists for as long as
 * the benches existed and nobody saw it until `mtg-lr6r`; adding it to one and
 * not the other would have been the same silence with a green typecheck on top.
 *
 * It lives in `@mtg/slice` beside the other checks that read the repository
 * rather than a package, and it reads the checkout it runs in, so a worktree
 * checks its own tree.
 */
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Every string in an array-valued field, refusing anything else rather than skipping it. */
function stringList(value: unknown, what: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not an array`);
  return value.map((entry, index) => {
    if (typeof entry !== 'string') throw new Error(`${what}[${index}] is not a string`);
    return entry;
  });
}

/**
 * `tsconfig.json`'s `include` as written, globs intact.
 *
 * Read through the compiler's own jsonc reader rather than `JSON.parse`, since
 * a tsconfig may carry comments and this one is edited by hand. The *parsed*
 * config is the wrong document here: it expands the globs against the disk, and
 * the question is whether two hand-maintained lists match, not which files exist
 * today.
 */
function tsconfigInclude(): readonly string[] {
  const path = new URL('tsconfig.json', ROOT).pathname;
  const read = ts.readConfigFile(path, ts.sys.readFile);
  if (read.error !== undefined) {
    throw new Error(`tsconfig.json: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
  }
  if (!isRecord(read.config)) throw new Error('tsconfig.json is not an object');
  return stringList(read.config['include'], 'tsconfig.json include');
}

/**
 * The `files` of every block that turns on the project service, as node loads them.
 *
 * Loaded in a child `node`, not by importing the config here, because Vite
 * transforms anything this file imports and it refuses `eslint.config.js` with
 * `Failed to parse source for import analysis` — a bundler complaint about a
 * file no bundler has any business reading. A child process runs the same ESM
 * loader eslint runs, so this reads the config eslint reads rather than a
 * regex's guess at it.
 *
 * The filtering happens in the child so only strings cross the pipe. The whole
 * config does not survive `JSON.stringify`: the blocks `tseslint.configs`
 * contributes carry plugin objects full of rule implementations.
 */
function typedBlockFiles(): readonly (readonly unknown[] | null)[] {
  const script = [
    `const { default: blocks } = await import(${JSON.stringify(new URL('eslint.config.js', ROOT).href)});`,
    'const typed = blocks.filter((b) => b?.languageOptions?.parserOptions?.projectService === true);',
    'process.stdout.write(JSON.stringify(typed.map((b) => b.files ?? null)));',
  ].join('\n');
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT.pathname,
    encoding: 'utf8',
  });
  const parsed: unknown = JSON.parse(out);
  if (!Array.isArray(parsed)) throw new Error('eslint.config.js probe did not return an array');
  return parsed.map((files) => {
    if (files === null) return null;
    if (!Array.isArray(files)) throw new Error('a type-aware block has a non-array `files`');
    return files;
  });
}

describe('type-aware lint scope', () => {
  it('lints the same globs the TypeScript project includes', () => {
    const typed = typedBlockFiles();

    // One block, because the docblock in eslint.config.js argues for one set of
    // globs. A second type-aware block is not a bug on its own, but it makes
    // "the same list" ambiguous, and whoever adds one should say here which
    // list they mean rather than let this test pick.
    expect(typed).toHaveLength(1);
    const [files] = typed;
    if (files === undefined || files === null) throw new Error('the type-aware block names no files');

    expect(stringList(files, 'eslint type-aware files')).toEqual(tsconfigInclude());
  });
});
