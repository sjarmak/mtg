/**
 * Filing the GitHub issue, through the `gh` on this machine.
 *
 * Argument array, never a shell: the title is whatever somebody typed into a
 * text field. A filer that fails does not fail the report — the directory is
 * already written — so its answer is a sentence for the panel, and the
 * command to run by hand is in it. The issue goes to the repository `origin`
 * names, so nothing here spells a repository out.
 */
import { execFile } from 'node:child_process';

export type IssueFiled =
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: string };

export type IssueFiler = (args: readonly string[]) => Promise<IssueFiled>;

function run(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { cwd, encoding: 'utf8', timeout: 30_000 }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(stderr.trim() === '' ? error.message : stderr.trim().split('\n')[0]));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** `owner/repo` from `origin`'s URL, or null when there is none `gh` could address. */
export function repoOf(url: string): string | null {
  const match = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match?.[1] ?? null;
}

/** The repository issues are filed in, when `gh` is signed in here and `origin` is on GitHub. */
export async function issueRepo(cwd: string): Promise<string | null> {
  try {
    await run('gh', ['auth', 'status'], cwd);
    const { stdout } = await run('git', ['remote', 'get-url', 'origin'], cwd);
    return repoOf(stdout);
  } catch {
    return null;
  }
}

/** The one real filer: `gh <args>` in the repository, reading the issue URL off stdout. */
export function ghFiler(cwd: string): IssueFiler {
  return async (args) => {
    try {
      const { stdout } = await run('gh', args, cwd);
      const id = stdout.trim().split('\n').pop() ?? '';
      if (id === '') return { ok: false, reason: 'gh issue create printed no URL' };
      return { ok: true, id };
    } catch (cause: unknown) {
      return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
    }
  };
}

/** The command to run by hand when the filer could not, spelled with the report's own file. */
export function retryCommand(args: readonly string[]): string {
  const quoted = args.map((arg) =>
    /^[A-Za-z0-9_./:=-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`,
  );
  return `gh ${quoted.join(' ')}`;
}
