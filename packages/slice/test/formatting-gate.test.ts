/**
 * The formatting gate covers TypeScript and JSON, and markdown on purpose not.
 *
 * `mtg-r9vm` settled that markdown stays out: Prettier's markdown printer
 * rewraps prose and normalizes list syntax, and the docs here are hand-authored
 * argument whose line breaks carry the structure a reader scans by. The
 * decision is written down in `AGENTS.md`, which quotes the glob that
 * implements it — and a quoted glob is a claim that goes stale the first time
 * somebody widens the script and nobody rereads the doc.
 *
 * So the two are checked against each other rather than against a literal
 * written twice. What this pins is not "the glob is exactly this string" but
 * the property the decision is about: whatever `npm run format` checks, it does
 * not reach `.md`, and the sentence in `AGENTS.md` still names the same glob
 * the script runs. Widening the gate to markdown is allowed — it is a decision,
 * not a law — and doing it means changing the doc in the same commit, which is
 * the whole of what this test asks for.
 *
 * It lives in `@mtg/slice` for the reason the workspace roster check does: this
 * is the package whose tests already fail when the repository changes shape.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);

interface Scripts {
  readonly scripts?: Readonly<Record<string, string>>;
}

function scriptNamed(name: string): string {
  const parsed: unknown = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
  const script = (parsed as Scripts).scripts?.[name];
  if (script === undefined) throw new Error(`the root package.json has no ${name} script`);
  return script;
}

/** The quoted glob out of the script, without the shell quoting around it. */
function globOf(script: string): string {
  const quoted = /"([^"]+)"/.exec(script);
  if (quoted?.[1] === undefined) throw new Error(`no quoted glob in: ${script}`);
  return quoted[1];
}

describe('what npm run format is pointed at', () => {
  it('checks and writes the same files, so fixing a failure cannot widen the gate', () => {
    expect(globOf(scriptNamed('format'))).toBe(globOf(scriptNamed('format:fix')));
  });

  it('does not reach markdown', () => {
    const glob = globOf(scriptNamed('format'));
    expect(glob).not.toContain('md');
  });

  it('is the glob AGENTS.md quotes when it says why', () => {
    const agents = readFileSync(new URL('AGENTS.md', ROOT), 'utf8');
    expect(agents).toContain('mtg-r9vm');
    expect(agents).toContain(`\`${globOf(scriptNamed('format'))}\``);
  });
});
