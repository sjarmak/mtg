/**
 * The positional arguments `frame-review.ts` accepts.
 *
 * The tool used to hardcode the fixture set and ignore every argument passed to
 * it: `frame-review.ts <out> <set> <art>` ran, exited 0, and printed frame
 * counts for `tideglass-reach.set.json` regardless of what `<set>` named,
 * because the constant it read from was never the argument. Extracting the
 * parse into its own function is what makes that contract testable without
 * running the script, which writes real files and prints to stdout as a side
 * effect of module load — the same split `play.ts` uses for `readPlayArgs`.
 */
export interface FrameReviewArgs {
  readonly out: string | undefined;
  readonly set: string | undefined;
  readonly artManifest: string | undefined;
}

/** Reads the three positional arguments, in the order `frame-review.ts` prints them in its usage. */
export function readFrameReviewArgs(argv: readonly string[]): FrameReviewArgs {
  if (argv.length > 3) {
    throw new Error(
      'frame-review.ts takes at most an output directory, a set path, and an art manifest path',
    );
  }
  return { out: argv[0], set: argv[1], artManifest: argv[2] };
}
