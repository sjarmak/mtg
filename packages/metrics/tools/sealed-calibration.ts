#!/usr/bin/env -S npx tsx
/**
 * Generic executable-set Sealed campaign launcher; no provider or human input.
 *
 * Raw campaigns belong under the ignored `out/` tree:
 *
 *   npm run calibrate:sealed -- --set set.json --collation collation.json \
 *     --seed study-v1 --out out/calibration/sealed.json
 */
import { runSealedCalibrationCli } from '../src/sealed-calibration';

runSealedCalibrationCli(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
