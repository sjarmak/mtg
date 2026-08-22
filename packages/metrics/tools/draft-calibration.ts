#!/usr/bin/env node
/** Checked command-line entry point for the native Draft calibration artifact. */
import { runDraftCalibrationCli } from '../src/draft-calibration';

runDraftCalibrationCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Draft calibration failed: ${message}\n`);
  process.exitCode = 1;
});
