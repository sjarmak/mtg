import { expect, it, vi } from 'vitest';
import { startPlayServices } from '../../tools/play-services';

it('closes earlier services when later startup fails, retaining cleanup failures', async () => {
  const killed = vi.fn(() => true);
  const closed = vi.fn(async () => undefined);
  const startup = new Error('table failed');
  const options = {
    startDecks: () => ({ kill: killed }),
    startBackend: async () => ({ close: closed }),
    startTables: async (): Promise<{ close(): Promise<void> }> => {
      throw startup;
    },
  };
  await expect(startPlayServices(options)).rejects.toBe(startup);
  expect(killed).toHaveBeenCalledTimes(1);
  expect(closed).toHaveBeenCalledTimes(1);
  const cleanup = new Error('close failed');
  closed.mockRejectedValue(cleanup);
  await expect(startPlayServices(options)).rejects.toMatchObject({ errors: [startup, cleanup] });
});

it('closes the deck process if backend startup fails, before any table is started', async () => {
  const kill = vi.fn(() => true);
  const startTables = vi.fn();
  await expect(
    startPlayServices({
      startDecks: () => ({ kill }),
      startBackend: async () => {
        throw new Error('compile failed');
      },
      startTables,
    }),
  ).rejects.toThrow('compile failed');
  expect(kill).toHaveBeenCalledTimes(1);
  expect(startTables).not.toHaveBeenCalled();
});

it('hands the started backend to the table server', async () => {
  const backend = { close: vi.fn(async () => undefined) };
  const startTables = vi.fn(async (given: typeof backend) => ({ close: async () => undefined, given }));
  const services = await startPlayServices({
    startDecks: () => null,
    startBackend: async () => backend,
    startTables,
  });
  expect(startTables).toHaveBeenCalledWith(backend);
  expect(services.tables.given).toBe(backend);
  await services.close();
});

it('closes every owned service once even if a close fails', async () => {
  const kill = vi.fn(() => true);
  const tableClose = vi.fn(async () => {
    throw new Error('close failed');
  });
  const backendClose = vi.fn(async () => undefined);
  const services = await startPlayServices({
    startDecks: () => ({ kill }),
    startBackend: async () => ({ close: backendClose }),
    startTables: async () => ({ close: tableClose }),
  });
  await expect(services.close()).rejects.toThrow('play service shutdown failed');
  await expect(services.close()).rejects.toThrow('play service shutdown failed');
  expect(kill).toHaveBeenCalledTimes(1);
  expect(tableClose).toHaveBeenCalledTimes(1);
  expect(backendClose).toHaveBeenCalledTimes(1);
});

it('permits externally owned deck and table services', async () => {
  const close = vi.fn(async () => undefined);
  const services = await startPlayServices({
    startDecks: () => null,
    startBackend: async () => ({ close }),
    startTables: async () => null,
  });
  await services.close();
  expect(close).toHaveBeenCalledTimes(1);
});
