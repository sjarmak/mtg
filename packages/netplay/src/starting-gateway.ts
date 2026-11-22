import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import type { RunningBackendGateway } from './backend-gateway';

export interface StartingBackendGatewayOptions {
  readonly host: string;
  readonly port: number;
}

export type StartingGatewayReport =
  | { readonly kind: 'listening'; readonly port: number }
  | { readonly kind: 'failed'; readonly message: string; readonly code: string | null };

const WORKER_URL = new URL('./starting-gateway-worker.ts', import.meta.url);

function bootstrapSource(): string {
  const loaderPath = createRequire(import.meta.url).resolve('tsx/esm/api');
  return `
    let loaderError = '';
    try { require(${JSON.stringify(loaderPath)}).register(); }
    catch (error) { loaderError = String(error && error.message); }
    import(${JSON.stringify(WORKER_URL.href)}).catch((error) => {
      const suffix = loaderError ? ' (TypeScript loader registration failed: ' + loaderError + ')' : '';
      require('node:worker_threads').parentPort.postMessage({
        kind: 'failed',
        message: String(error && error.message) + suffix,
        code: null,
      });
    });
  `;
}

export function serveStartingBackendGateway(
  options: StartingBackendGatewayOptions,
): Promise<RunningBackendGateway> {
  return new Promise<RunningBackendGateway>((resolve, reject) => {
    const worker = new Worker(bootstrapSource(), { eval: true, workerData: options });
    const exited = new Promise<void>((done) => {
      worker.once('exit', () => done());
    });
    let listening = false;
    const fail = (cause: Error): void => {
      if (listening) {
        process.emitWarning(cause);
        return;
      }
      void worker.terminate();
      reject(cause);
    };
    worker.on('error', fail);
    worker.once('exit', (code) => {
      if (!listening) reject(new Error(`The starting gateway thread exited with code ${String(code)}.`));
    });
    worker.on('message', (report: StartingGatewayReport) => {
      if (report.kind === 'failed') {
        fail(Object.assign(new Error(report.message), report.code === null ? {} : { code: report.code }));
        return;
      }
      listening = true;
      let closing: Promise<void> | null = null;
      resolve({
        port: report.port,
        host: options.host,
        close: (): Promise<void> => {
          if (closing === null) {
            worker.postMessage('close');
            closing = exited;
          }
          return closing;
        },
      });
    });
  });
}
