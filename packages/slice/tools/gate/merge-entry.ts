import { spawnSync } from 'node:child_process';

const MERGE_PATH = 'packages/slice/tools/gate/merge.ts';

interface Invocation {
  readonly command: string;
  readonly args: string[];
}

interface SpawnOptions {
  readonly stdio: 'ignore' | 'inherit';
  readonly env: NodeJS.ProcessEnv;
}

type Spawn = (command: string, args: string[], options: SpawnOptions) => { readonly status: number | null };

interface MainOptions {
  readonly available?: () => boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly spawn?: Spawn;
  readonly write?: (message: string) => unknown;
}

export function buildMergeInvocation(systemdAvailable: boolean, argv: readonly string[]): Invocation {
  const mergeArgs = [MERGE_PATH, ...argv];
  if (!systemdAvailable) return { command: 'tsx', args: mergeArgs };
  return {
    command: 'systemd-run',
    args: ['--user', '--scope', '--collect', '-p', 'CPUWeight=100', '--', 'tsx', ...mergeArgs],
  };
}

export function systemdUserScopeAvailable(
  spawn: Spawn = spawnSync,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const binary = spawn('systemd-run', ['--version'], { stdio: 'ignore', env });
  if (binary.status !== 0) return false;
  return spawn('systemctl', ['--user', 'show-environment'], { stdio: 'ignore', env }).status === 0;
}

export function main(argv: readonly string[] = [], options: MainOptions = {}): number {
  const env = options.env ?? process.env;
  const spawn = options.spawn ?? spawnSync;
  const available = options.available?.() ?? systemdUserScopeAvailable(spawn, env);
  if (!available) {
    const write = options.write ?? process.stdout.write.bind(process.stdout);
    write("gate:merge: systemd user scope isn't available; running in the caller scope.\n");
  }
  const invocation = buildMergeInvocation(available, argv);
  return spawn(invocation.command, invocation.args, { stdio: 'inherit', env }).status ?? 1;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
