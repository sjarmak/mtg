#!/usr/bin/env node
/** Checked command-line entry point for deterministic multi-pod Draft evidence. */
import { runDraftCalibrationCampaignCli } from '../src/draft-campaign';

runDraftCalibrationCampaignCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Draft campaign failed: ${message}\n`);
  process.exitCode = 1;
});
