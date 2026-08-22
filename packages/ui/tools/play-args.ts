/** The two positional arguments and narrow art override accepted by `npm run play`. */
export interface PlayArgs {
  readonly set: string | undefined;
  readonly port: number | undefined;
  readonly artManifest: string | undefined;
}

interface ArtManifestArg {
  readonly argv: readonly string[];
  readonly artManifest: string | undefined;
}

/**
 * Removes the one shared art flag before either launcher reads its own args.
 *
 * Kept here rather than teaching `netplay.ts` a second spelling: netplay passes
 * this exact value through to play, which is the process that stages the art.
 */
export function takeArtManifestArg(argv: readonly string[]): ArtManifestArg {
  const rest: string[] = [];
  let artManifest: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value !== '--art-manifest') {
      if (value !== undefined) rest.push(value);
      continue;
    }
    const path = argv[index + 1];
    if (path === undefined || path.startsWith('--')) throw new Error('--art-manifest needs a value');
    if (artManifest !== undefined) throw new Error('--art-manifest may be given only once');
    artManifest = path;
    index += 1;
  }
  return { argv: rest, artManifest };
}

/**
 * Reads a set path followed by an optional web port.
 *
 * A stated port is a promise about where the new game will appear, so invalid
 * and extra values are refused instead of being left for Vite to ignore.
 */
export function readPlayArgs(argv: readonly string[]): PlayArgs {
  const extracted = takeArtManifestArg(argv);
  if (extracted.argv.length > 2) {
    throw new Error('npm run play takes at most a set path and port');
  }
  const set = extracted.argv[0];
  const rawPort = extracted.argv[1];
  if (rawPort === undefined) return { set, port: undefined, artManifest: extracted.artManifest };
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${rawPort} is not a port`);
  }
  return { set, port, artManifest: extracted.artManifest };
}

/**
 * The port the page appears on when nobody named one.
 *
 * A copy of `server.port` in `../vite.config.ts`, kept here so the launcher can
 * say something useful about a busy port before Vite says something cryptic
 * about it. `test/play/play-args.test.ts` reads the config and fails when the
 * two drift.
 */
export const DEFAULT_WEB_PORT = 5273;

/**
 * What to say when the port is already answering.
 *
 * `strictPort` is on in `../vite.config.ts` for a stated reason — walking upward
 * from 5273 lands on the netplay server's port and then on the curation
 * writer's — so a busy port is a refusal rather than a quiet move, and the
 * refusal Vite prints is a stack trace. The usual cause is a lab from an earlier
 * run still running in another terminal, which is not a failure at all: the page
 * is already there, and it is serving the files this run just staged.
 */
export function portBusyMessage(port: number): string {
  return (
    `Something is already listening on port ${String(port)}, so this run did not start a second lab.\n` +
    `That is usually a lab from an earlier run, still open in another terminal. It serves\n` +
    `the files this run just staged, so open http://localhost:${String(port)}/ and play there,\n` +
    'or stop that terminal with Ctrl-C and run this again.'
  );
}

/** Vite arguments for either its ordinary default or a promised address. */
export function viteArgsFor(port: number | string | undefined): readonly string[] {
  return port === undefined ? ['vite', '--open'] : ['vite', '--open', '--port', String(port), '--strictPort'];
}
