/** Owned executable inputs for admission-sensitive launchers; no shared-install writes. */
import {
  chmodSync,
  constants,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { findForgeInstall } from '../install';
import { measureForgeRuntime } from './runtime-identity';
import type { ForgeRuntimeIdentity, ForgeRuntimeIdentityOptions } from './runtime-identity';

export interface ForgeRuntimeSnapshot {
  readonly inputs: ForgeRuntimeIdentityOptions;
  readonly identity: ForgeRuntimeIdentity;
  /** Only after every process using these inputs has ended. Idempotent. */
  readonly dispose: () => void;
}

function copyArtifact(source: string, destination: string): void {
  cpSync(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    mode: constants.COPYFILE_FICLONE,
    filter: (path) => {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Runtime artifact contains a symbolic link: ${path}`);
      if (!stat.isFile() && !stat.isDirectory())
        throw new Error(`Runtime artifact contains a non-file: ${path}`);
      return true;
    },
  });
}

function readOnlyFiles(path: string): void {
  if (lstatSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) readOnlyFiles(join(path, entry));
  } else {
    chmodSync(path, 0o444);
  }
}

/**
 * Copy first, then hash the copied bytes. A source edit during copying either
 * produces the qualified hashes or fails later admission; source paths are never
 * launched. Reflinks may save disk space but hardlinks and symlinks are not used.
 * Files are read-only as an accident guard, not a sandbox against their owner.
 * The caller must execute the copied adapter bundle and bridge, retain this
 * snapshot through all sessions, and independently verify qualification evidence.
 */
export function createForgeRuntimeSnapshot(
  options: ForgeRuntimeIdentityOptions & { readonly outputParent?: string },
): ForgeRuntimeSnapshot {
  const install = findForgeInstall({ forgeHome: options.forgeHome });
  if (install === null) throw new Error('Forge is not installed at the selected home.');
  const root = mkdtempSync(join(resolve(options.outputParent ?? tmpdir()), 'mtg-forge-artifacts-'));
  try {
    const forgeHome = join(root, 'forge');
    mkdirSync(forgeHome);
    copyArtifact(install.jar, join(forgeHome, basename(install.jar)));
    // A selected resource-root alias is allowed; entries inside it must be real files/directories.
    copyArtifact(realpathSync(join(install.home, 'res')), join(forgeHome, 'res'));
    const bridge = {
      kind: options.bridge.kind,
      path: join(root, options.bridge.kind === 'compiled' ? 'classes' : 'ForgeBridge.java'),
    };
    copyArtifact(options.bridge.path, bridge.path);
    const adapterBundlePath = join(root, 'adapter.mjs');
    copyArtifact(options.adapterBundlePath, adapterBundlePath);
    const inputs = { forgeHome, bridge, adapterBundlePath };
    const identity = measureForgeRuntime(inputs);
    readOnlyFiles(root);
    return { inputs, identity, dispose: () => rmSync(root, { recursive: true, force: true }) };
  } catch (cause) {
    rmSync(root, { recursive: true, force: true });
    throw cause;
  }
}
