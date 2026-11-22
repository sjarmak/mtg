import { createServer } from 'node:http';
import { parentPort, workerData } from 'node:worker_threads';
import { BACKEND_GATEWAY_PROTOCOL, failure } from './gateway-envelope';
import { json } from './http-support';
import type { StartingBackendGatewayOptions, StartingGatewayReport } from './starting-gateway';

if (parentPort === null) throw new Error('The starting gateway runs only as a worker thread.');
const parent = parentPort;
const options = workerData as StartingBackendGatewayOptions;
const report = (message: StartingGatewayReport): void => {
  parent.postMessage(message);
};

const server = createServer((request, response) => {
  request.resume();
  const url = new URL(request.url ?? '/', 'http://gateway.invalid');
  if (url.pathname === '/engine-api/readiness') {
    if (request.method !== 'GET') {
      failure(response, 405, 'wrong-method', 'gateway readiness is read with GET');
      return;
    }
    json(response, 200, {
      protocol: BACKEND_GATEWAY_PROTOCOL,
      ok: true,
      format: url.searchParams.get('format'),
      ready: false,
      starting: true,
    });
    return;
  }
  failure(response, 503, 'gateway-starting', 'the backend gateway is still running its startup checks');
});

server.on('error', (cause: NodeJS.ErrnoException) => {
  report({ kind: 'failed', message: cause.message, code: cause.code ?? null });
});
server.listen(options.port, options.host, () => {
  const address = server.address();
  report({
    kind: 'listening',
    port: typeof address === 'object' && address !== null ? address.port : options.port,
  });
});
parent.once('message', () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
