/** Run Forge independently of asset staging and Vite; never expose beyond loopback. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackendPort, startBackendService } from './backend-service';
import { gameplayDir, resolveDataDir } from './data-path';
import { gameplayRecorder } from './gameplay-recorder';
import { installedPrintedAdmissions } from './printed-format-registry';

async function main(): Promise<void> {
  const port = readBackendPort(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  // The same admissions the play launcher loads, so a page attached to this
  // gateway is offered every printed format its files say is installed.
  // A gateway session is a printed-card game, identified by its format rather
  // than by a staged set, so the recorder is built over no sets at all.
  const gameplayRoot = resolveDataDir(gameplayDir(repoRoot), repoRoot);
  const service = await startBackendService({
    repoRoot,
    port,
    printedAdmissions: installedPrintedAdmissions(repoRoot).admissions,
    recorder: gameplayRecorder({ root: gameplayRoot, sets: [] }),
  });
  process.stdout.write(
    `${service.message}\nBackend gateway: http://127.0.0.1:${String(service.gateway.port)}\n` +
      `Recording finished games under ${gameplayRoot}\n`,
  );
  process.stdout.write(`Start a UI with MTG_BACKEND_GATEWAY_PORT=${String(port)} npm run play\n`);
  const stop = (): void => {
    void service.close().then(
      () => process.exit(0),
      (cause: unknown) => {
        process.stderr.write(`Backend shutdown failed: ${String(cause)}\n`);
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void main().catch((cause: unknown) => {
  process.stderr.write(`Backend startup failed: ${String(cause)}\n`);
  process.exitCode = 1;
});
