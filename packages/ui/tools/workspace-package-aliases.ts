import { join, resolve } from 'node:path';

export interface WorkspacePackageAlias {
  readonly find: string | RegExp;
  readonly replacement: string;
}

/** Resolve every workspace package from the checkout whose runtime is being measured. */
export function workspacePackageAliases(
  workspace: string,
  overrides: readonly WorkspacePackageAlias[] = [],
): WorkspacePackageAlias[] {
  const root = resolve(workspace);
  return [
    ...overrides,
    {
      find: /^@mtg\/printed-card\/node$/,
      replacement: join(root, 'packages/printed-card/src/node/index.ts'),
    },
    {
      find: /^@mtg\/sim\/bot$/,
      replacement: join(root, 'packages/sim/src/greedy-bot.ts'),
    },
    {
      find: /^@mtg\/(.*)$/,
      replacement: join(root, 'packages/$1/src/index.ts'),
    },
  ];
}
