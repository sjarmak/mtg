/** Explicit offline build entry point; neither launches Forge nor changes app admission. */
import { parseArgs } from 'node:util';
import { writePrintedFormat } from '../src/printed-card/format-build-files';

const usage =
  'Usage: build-printed-format --config <recipe.json> --sources <pin-directory> --forge-scripts <cardsfolder.zip> --forge-version <version> --out <new-directory>';
const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    config: { type: 'string' },
    sources: { type: 'string' },
    'forge-scripts': { type: 'string' },
    'forge-version': { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
if (values.help) {
  process.stdout.write(
    `${usage}\nOffline catalog build; does not admit play or replace an existing directory.\n`,
  );
  process.exit(0);
}
if (
  !values.config ||
  !values.sources ||
  !values['forge-scripts'] ||
  !values['forge-version'] ||
  !values.out
) {
  throw new Error(usage);
}
const report = await writePrintedFormat({
  config: values.config,
  sourceRoot: values.sources,
  archive: values['forge-scripts'],
  forgeVersion: values['forge-version'],
  output: values.out,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
