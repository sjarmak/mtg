/**
 * The harness's event surface, and why it exists.
 *
 * `mtg-l191`. `CdpClient` dropped every CDP event outright — `if (message.id ===
 * undefined) return` — so nothing in this repository could watch
 * `Browser.downloadWillBegin`. That matters because of what
 * `../../src/routes/deck/browser-file.ts` documents at length: a page-initiated
 * download reports nothing to the page in any browser, so the browser's own
 * account of the window is the only account there is, and a test that cannot
 * read it cannot tell a file that landed from a request that was dropped.
 *
 * No browser here. These drive a `HostileSocket` directly, which is the only way
 * to assert what happens to an event that arrives while nothing is recording, or
 * after a recording stops: a real Chrome will not oblige on request.
 */
import { describe, expect, it } from 'vitest';
import { HostileSocket, hostileClient } from './chrome-driver';

function deliver(socket: HostileSocket, method: string, params: Record<string, unknown> = {}): void {
  socket.onmessage?.({ data: JSON.stringify({ method, params }) });
}

describe('recording CDP events', () => {
  it('buffers the named events and ignores the rest', () => {
    const socket = new HostileSocket();
    const client = hostileClient(socket);
    const recording = client.record('Browser.downloadWillBegin', 'Browser.downloadProgress');

    deliver(socket, 'Browser.downloadWillBegin', { url: 'blob:deck.txt' });
    deliver(socket, 'Page.loadEventFired');
    deliver(socket, 'Browser.downloadProgress', { state: 'completed' });

    expect(recording.events.map((event) => event.method)).toEqual([
      'Browser.downloadWillBegin',
      'Browser.downloadProgress',
    ]);
    expect(recording.of('Browser.downloadWillBegin')[0]?.params['url']).toBe('blob:deck.txt');
    recording.stop();
  });

  it('records everything when no method is named, and carries the session', () => {
    const socket = new HostileSocket();
    const client = hostileClient(socket);
    const recording = client.record();

    socket.onmessage?.({ data: JSON.stringify({ method: 'Page.loadEventFired', sessionId: 'S1' }) });

    expect(recording.events).toStrictEqual([{ method: 'Page.loadEventFired', params: {}, sessionId: 'S1' }]);
    recording.stop();
  });

  /**
   * The assertion the download seam actually needs. A recording that saw nothing
   * is the evidence that nothing happened, and it is only evidence if a running
   * recording would have caught it.
   */
  it('leaves an empty recording when the event never fires', () => {
    const socket = new HostileSocket();
    const client = hostileClient(socket);
    const recording = client.record('Browser.downloadWillBegin');

    deliver(socket, 'Page.loadEventFired');

    expect(recording.events).toStrictEqual([]);
    recording.stop();
  });

  it('hands a waiter the next event, and fails it by name when none comes', async () => {
    const socket = new HostileSocket();
    const client = hostileClient(socket);
    const recording = client.record('Browser.downloadWillBegin');

    const waited = recording.next(200);
    deliver(socket, 'Browser.downloadWillBegin', { suggestedFilename: 'deck.txt' });
    expect((await waited).params['suggestedFilename']).toBe('deck.txt');

    await expect(recording.next(20)).rejects.toThrow('no CDP Browser.downloadWillBegin within 20ms');
    recording.stop();
  });

  it('stops recording, and says so to anything still waiting', async () => {
    const socket = new HostileSocket();
    const client = hostileClient(socket);
    const recording = client.record('Browser.downloadWillBegin');
    const waited = recording.next(5_000);

    recording.stop();
    await expect(waited).rejects.toThrow('CDP recording stopped while waiting');

    deliver(socket, 'Browser.downloadWillBegin');
    expect(recording.events).toStrictEqual([]);
    expect(() => recording.stop()).not.toThrow();
    await expect(recording.next()).rejects.toThrow('CDP recording is stopped');
  });

  it('leaves the request path alone: an answer is not an event', async () => {
    const socket = new HostileSocket();
    const client = hostileClient(socket);
    const recording = client.record();
    const call = client.call('Runtime.evaluate', {}, undefined, 200);

    socket.onmessage?.({ data: JSON.stringify({ id: 1, result: { value: 7 } }) });

    expect(await call).toStrictEqual({ value: 7 });
    expect(recording.events).toStrictEqual([]);
    recording.stop();
  });
});
