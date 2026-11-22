import { describe, expect, it, vi } from 'vitest';
import { onPageLeft, pageLeaveSource } from '../../src/routes/play/page-leave';
import type { PageLeaveEvent, PageLeaveSource } from '../../src/routes/play/page-leave';

function fakePage(): PageLeaveSource & { fire(event: PageLeaveEvent): void; readonly listening: number } {
  const listeners = new Set<(event: PageLeaveEvent) => void>();
  return {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    fire: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
    get listening() {
      return listeners.size;
    },
  };
}

describe('leaving the page', () => {
  it('reports a page that is being discarded and ignores one kept for the back button', () => {
    const page = fakePage();
    const leave = vi.fn();
    onPageLeft(leave, page);

    page.fire({ persisted: true });
    expect(leave).not.toHaveBeenCalled();

    page.fire({ persisted: false });
    page.fire({});
    expect(leave).toHaveBeenCalledTimes(2);
  });

  it('stops listening when asked', () => {
    const page = fakePage();
    const leave = vi.fn();
    const stop = onPageLeft(leave, page);
    expect(page.listening).toBe(1);

    stop();
    expect(page.listening).toBe(0);
    page.fire({ persisted: false });
    expect(leave).not.toHaveBeenCalled();
  });

  it('is inert where there is no page to leave', () => {
    expect(pageLeaveSource()).toBeNull();
    const leave = vi.fn();
    const stop = onPageLeft(leave);
    stop();
    expect(leave).not.toHaveBeenCalled();
  });
});
