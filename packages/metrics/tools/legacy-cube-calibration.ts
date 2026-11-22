import { runLegacyCubeCalibrationCli } from '../src/legacy-cube-calibration/io';
import { createInstalledGameplay } from '../src/legacy-cube-calibration/installed';

runLegacyCubeCalibrationCli(process.argv.slice(2), createInstalledGameplay).catch((error: unknown) => {
  process.stderr.write(
    `Legacy Cube calibration failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
